import {
  SETTINGS_KEY,
  STORAGE_KEY,
  WHATSAPP_URL,
  addSession,
  badgeText,
  cleanSettings,
  groupTitle,
  isGroupTitleFor,
  isSessionId,
  moveSession,
  removeSession,
  sessionUrl,
  storagePrefix,
  updateSession,
} from "./src/sessions.js";

// chrome.storage.session: which tab shows which session, each session's unread count, and each window's WhatsApp tab group.
const TABS_KEY = "tabs";
const UNREAD_KEY = "unread";
const GROUPS_KEY = "groups";
const GROUP_NAME = "WhatsApp";

async function getSessions() {
  return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || [];
}

async function getSettings() {
  return cleanSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
}

async function getLive() {
  const stored = await chrome.storage.session.get([TABS_KEY, UNREAD_KEY]);
  return { tabs: stored[TABS_KEY] || {}, unread: stored[UNREAD_KEY] || {} };
}

// Every read-modify-write goes through one queue, so popup clicks and tab events can't race.
let queue = Promise.resolve();
const serial = (work) => (queue = queue.then(work, work));

async function updateBadge() {
  const total = await totalUnread();
  await chrome.action.setBadgeBackgroundColor({ color: "#25d366" });
  await chrome.action.setBadgeText({ text: badgeText(total) });
  await styleGroups(total);
}

const tabsOf = (tabs, id) => Object.entries(tabs).filter(([, owner]) => owner === id).map(([tabId]) => Number(tabId));

async function forgetTab(tabId) {
  const { tabs } = await getLive();
  if (!(tabId in tabs)) return;
  delete tabs[tabId];
  await chrome.storage.session.set({ [TABS_KEY]: tabs });
  await updateBadge();
}

async function getGroups() {
  return (await chrome.storage.session.get(GROUPS_KEY))[GROUPS_KEY] || {};
}

async function totalUnread() {
  const { tabs, unread } = await getLive();
  const open = new Set(Object.values(tabs));
  return Object.entries(unread).reduce((sum, [id, count]) => sum + (open.has(id) ? count : 0), 0);
}

async function styleGroups(total) {
  for (const groupId of Object.values(await getGroups())) {
    await chrome.tabGroups.update(groupId, { title: groupTitle(GROUP_NAME, total), color: "green" }).catch(() => {});
  }
}

// The window's shared "WhatsApp" group: the one we made, or one Chrome restored after a restart.
async function windowGroup(windowId, groups) {
  const recorded = groups[windowId] === undefined ? null : await chrome.tabGroups.get(groups[windowId]).catch(() => null);
  if (recorded?.windowId === windowId) return recorded.id;
  const restored = (await chrome.tabGroups.query({ windowId })).find((group) => isGroupTitleFor(group.title, GROUP_NAME));
  return restored?.id ?? null;
}

// Keeps every session tab in one "WhatsApp" tab group per window. Pinned tabs and tabs the user
// put in a group of their own are left where they are.
async function groupTab(tabId) {
  if (!(await getSettings()).groupTabs) return;
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab || tab.pinned) return;
  const groups = await getGroups();
  const existing = await windowGroup(tab.windowId, groups);
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE && tab.groupId !== existing) return;
  const groupId = tab.groupId === existing
    ? existing
    : await chrome.tabs.group(existing === null
      ? { tabIds: tabId, createProperties: { windowId: tab.windowId } }
      : { tabIds: tabId, groupId: existing });
  await chrome.storage.session.set({ [GROUPS_KEY]: { ...groups, [tab.windowId]: groupId } });
  await styleGroups(await totalUnread());
}

// Turning grouping off takes session tabs out of our groups; turning it on groups the open ones.
async function applyGrouping(groupTabs) {
  const { tabs } = await getLive();
  if (groupTabs) {
    for (const tabId of Object.keys(tabs)) await groupTab(Number(tabId)).catch(() => {});
    return;
  }
  const ours = new Set(Object.values(await getGroups()));
  for (const tabId of Object.keys(tabs)) {
    const tab = await chrome.tabs.get(Number(tabId)).catch(() => null);
    if (tab && ours.has(tab.groupId)) await chrome.tabs.ungroup(tab.id).catch(() => {});
  }
  await chrome.storage.session.set({ [GROUPS_KEY]: {} });
}

async function openSession(id) {
  const session = (await getSessions()).find((entry) => entry.id === id);
  if (!session) return { ok: false };
  const { tabs } = await getLive();
  for (const tabId of tabsOf(tabs, id)) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.url?.startsWith(WHATSAPP_URL)) continue;
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true, tabId };
  }
  const tab = await chrome.tabs.create({ url: sessionUrl(id) });
  await groupTab(tab.id).catch(() => {});
  return { ok: true, tabId: tab.id };
}

// Runs in the isolated world of a WhatsApp-origin page, where storage APIs are unpatched.
async function wipeStorage(prefix) {
  const settle = (request) => new Promise((resolve) => {
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
  for (const { name } of await indexedDB.databases()) {
    if (name?.startsWith(prefix)) await settle(indexedDB.deleteDatabase(name));
  }
  for (let i = localStorage.length - 1; i >= 0; i -= 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
  for (const name of await caches.keys()) {
    if (name.startsWith(prefix)) await caches.delete(name);
  }
  const bucketPrefix = prefix.replace(/:/g, "-");
  for (const name of navigator.storageBuckets ? await navigator.storageBuckets.keys() : []) {
    if (name.startsWith(bucketPrefix)) await navigator.storageBuckets.delete(name);
  }
  return true;
}

async function waitForLoad(tabId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("WhatsApp didn't load");
}

async function wipeSession(id) {
  const { tabs } = await getLive();
  // Any WhatsApp-origin page will do; a tiny one avoids booting WhatsApp just to delete data.
  const existing = (await chrome.tabs.query({ url: `${WHATSAPP_URL}*` })).find((tab) => tabs[tab.id] !== id);
  const helper = existing ? null : await chrome.tabs.create({ url: `${WHATSAPP_URL}robots.txt`, active: false });
  try {
    const tabId = existing?.id ?? helper.id;
    if (helper) await waitForLoad(tabId);
    await chrome.scripting.executeScript({ target: { tabId }, func: wipeStorage, args: [storagePrefix(id)] });
  } finally {
    if (helper) await chrome.tabs.remove(helper.id).catch(() => {});
  }
}

async function removeWholeSession(id) {
  const { tabs, unread } = await getLive();
  const closing = tabsOf(tabs, id);
  for (const tabId of closing) delete tabs[tabId];
  delete unread[id];
  await chrome.storage.session.set({ [TABS_KEY]: tabs, [UNREAD_KEY]: unread });
  await chrome.tabs.remove(closing).catch(() => {});
  await chrome.storage.local.set({ [STORAGE_KEY]: removeSession(await getSessions(), id) });
  await updateBadge();
  // Closing tabs releases WhatsApp's IndexedDB connections, so deletes aren't blocked.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await wipeSession(id);
  return { ok: true };
}

async function saveSessions(change) {
  const sessions = change(await getSessions());
  await chrome.storage.local.set({ [STORAGE_KEY]: sessions });
  return sessions;
}

const fromPopup = (sender) => sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(""));
const fromWhatsApp = (sender) => sender.tab?.id !== undefined && sender.url?.startsWith(WHATSAPP_URL);

const popupActions = {
  "wams-add": async ({ name, color }) => {
    let created;
    await saveSessions((sessions) => {
      const result = addSession(sessions, { name, color });
      created = result.session;
      return result.sessions;
    });
    return { ok: true, session: created };
  },
  "wams-update": async ({ id, name, color }) => {
    const sessions = await saveSessions((list) => updateSession(list, id, { name, color }));
    const session = sessions.find((entry) => entry.id === id);
    if (session && name !== undefined) {
      const { tabs } = await getLive();
      for (const tabId of tabsOf(tabs, id)) {
        chrome.tabs.sendMessage(tabId, { type: "wams-renamed", id, name: session.name }).catch(() => {});
      }
    }
    return { ok: Boolean(session) };
  },
  "wams-move": async ({ id, offset }) => {
    await saveSessions((list) => moveSession(list, id, Math.sign(offset)));
    return { ok: true };
  },
  "wams-open": ({ id }) => openSession(id),
  "wams-settings": async ({ settings }) => {
    const before = await getSettings();
    const next = cleanSettings({ ...before, ...settings });
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    if (next.groupTabs !== before.groupTabs) await applyGrouping(next.groupTabs);
    return { ok: true, settings: next };
  },
  "wams-remove": ({ id }) => removeWholeSession(id),
};

const tabActions = {
  "wams-hello": async ({ id }, tab) => {
    const session = (await getSessions()).find((entry) => entry.id === id);
    if (!session) return { unknown: true };
    const { tabs } = await getLive();
    tabs[tab.id] = id;
    await chrome.storage.session.set({ [TABS_KEY]: tabs });
    await updateBadge();
    await groupTab(tab.id).catch(() => {});
    return { session };
  },
  "wams-unread": async ({ id, unread }, tab) => {
    const live = await getLive();
    if (live.tabs[tab.id] !== id) return { ok: false };
    const count = Math.max(0, Math.floor(Number(unread) || 0));
    if (live.unread[id] === count) return { ok: true };
    live.unread[id] = count;
    await chrome.storage.session.set({ [UNREAD_KEY]: live.unread });
    await updateBadge();
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;
  if (!isSessionId(message?.id) && type !== "wams-add" && type !== "wams-settings") return false;
  let run = null;
  if (popupActions[type] && fromPopup(sender)) run = () => popupActions[type](message);
  if (tabActions[type] && fromWhatsApp(sender)) run = () => tabActions[type](message, sender.tab);
  if (!run) return false;
  serial(run).then(sendResponse, (error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => serial(() => forgetTab(tabId)));
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url && !change.url.startsWith(WHATSAPP_URL)) serial(() => forgetTab(tabId));
});
chrome.runtime.onStartup.addListener(() => serial(updateBadge));
chrome.runtime.onInstalled.addListener(() => serial(updateBadge));
