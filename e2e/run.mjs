// End-to-end test against the live web.whatsapp.com login page: loads the unpacked extension
// into Chrome for Testing, creates two sessions from the popup and checks that each tab boots
// WhatsApp with its own QR code and its own storage, that plain WhatsApp is unaffected, and
// that removing a session deletes its data. No account or phone is needed.
//
//   npm run e2e            (HEADFUL=1 to watch, CHROME_PATH=... to pick a binary)
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";
import { RUNTIME_FILES } from "../tools/runtime-files.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const work = fs.mkdtempSync(path.join(os.tmpdir(), "wams-e2e-"));

// Load a copy of just the runtime files, so e2e/node_modules never ends up in the extension.
const EXTENSION = path.join(work, "extension");
for (const entry of RUNTIME_FILES) {
  fs.cpSync(path.resolve(here, "..", entry), path.join(EXTENSION, entry), { recursive: true });
}

// WhatsApp refuses "HeadlessChrome", so present as regular desktop Chrome.
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const WHATSAPP = "https://web.whatsapp.com/";
// WhatsApp's service worker is shared by the whole origin and can't be patched by an extension;
// it keeps its own logs, analytics and push bookkeeping in these.
const SERVICE_WORKER_DBS = new Set(["sw", "wawc"]);

const browser = await puppeteer.launch({
  headless: !process.env.HEADFUL,
  // Puppeteer 25 returns a promise here; awaiting works for both.
  executablePath: process.env.CHROME_PATH || await puppeteer.executablePath(),
  userDataDir: path.join(work, "profile"),
  ignoreDefaultArgs: ["--disable-extensions"],
  args: [
    `--disable-extensions-except=${EXTENSION}`,
    `--load-extension=${EXTENSION}`,
    `--user-agent=${USER_AGENT}`,
    "--window-size=1280,900",
    // GitHub's Ubuntu runners don't allow Chrome's user-namespace sandbox.
    ...(process.env.CI ? ["--no-sandbox"] : []),
  ],
});

const pageErrors = [];
const watch = (page, label) => {
  page.on("pageerror", (error) => pageErrors.push(`${label}: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(`${label} console: ${message.text().slice(0, 300)}`); });
  return page;
};

const step = (name) => console.log(`• ${name}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, what, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check().catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await sleep(250);
  }
}

// Storage exactly as the origin holds it, read from puppeteer's isolated world, which the
// MAIN-world patch doesn't touch.
const rawStorage = (page) => page.mainFrame().isolatedRealm().evaluate(async () => ({
  dbs: (await indexedDB.databases()).map((db) => db.name).sort(),
  local: Object.keys(localStorage).sort(),
  caches: (await caches.keys()).sort(),
}));

// Storage as WhatsApp itself sees it.
const pageStorage = (page) => page.evaluate(async () => ({
  dbs: (await indexedDB.databases()).map((db) => db.name).sort(),
  local: Object.keys(localStorage).sort(),
}));

const qrRef = (page) => page.evaluate(() => document.querySelector("[data-ref]")?.getAttribute("data-ref") || null);

async function whatsappPage(predicate, what) {
  const target = await browser.waitForTarget((candidate) => candidate.type() === "page" && candidate.url().startsWith(WHATSAPP) && predicate(candidate), { timeout: 30000 })
    .catch(() => { throw new Error(`No tab for ${what}`); });
  return watch(await target.page(), what);
}

try {
  const worker = await browser.waitForTarget((target) => target.type() === "service_worker" && target.url().endsWith("/background.js"));
  const extensionId = new URL(worker.url()).host;

  step("popup adds two sessions");
  const popup = watch(await browser.newPage(), "popup");
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  for (const name of ["Work", "Personal"]) {
    await popup.type("#add-name", name);
    await popup.click("#add button[type=submit]");
    await popup.waitForFunction((count) => document.querySelectorAll(".session").length === count, {}, name === "Work" ? 1 : 2);
  }
  const sessions = await popup.evaluate(async () => (await chrome.storage.local.get("sessions")).sessions);
  assert.deepEqual(sessions.map((session) => session.name), ["Work", "Personal"]);
  const [workId, personalId] = sessions.map((session) => session.id);

  step("each session opens in its own tab");
  const known = new Set();
  const openFromPopup = async (id) => {
    await popup.evaluate((sessionId) => chrome.runtime.sendMessage({ type: "wams-open", id: sessionId }), id);
    const page = await whatsappPage((target) => !known.has(target), id);
    known.add(page.target());
    return page;
  };
  const workTab = await openFromPopup(workId);
  const personalTab = await openFromPopup(personalId);

  for (const [page, name] of [[workTab, "Work"], [personalTab, "Personal"]]) {
    await waitFor(() => qrRef(page), `${name} QR code`);
    await waitFor(async () => (await page.title()).startsWith(`${name} · `), `${name} title label`, 10000);
    assert.ok(!page.url().includes("wams="), "the session marker is removed from the URL");
  }
  assert.notEqual(await qrRef(workTab), await qrRef(personalTab), "each session is a separate WhatsApp client");

  step("session tabs share one WhatsApp tab group");
  const groupOf = async (page) => popup.evaluate(async (title) => {
    const [tab] = (await chrome.tabs.query({})).filter((entry) => entry.title === title);
    if (!tab || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;
    const group = await chrome.tabGroups.get(tab.groupId);
    return { id: group.id, title: group.title, color: group.color };
  }, await page.title());
  const workGroup = await waitFor(() => groupOf(workTab), "Work tab group", 10000);
  const personalGroup = await waitFor(() => groupOf(personalTab), "Personal tab group", 10000);
  assert.deepEqual([workGroup.title, workGroup.color], ["WhatsApp", "green"]);
  assert.deepEqual(personalGroup, workGroup, "every session joins the same group");

  step("the Group session tabs setting ungroups and regroups tabs");
  await popup.bringToFront();
  await popup.waitForFunction(() => document.querySelector("#group-tabs").checked);
  await popup.click("#group-tabs");
  await waitFor(async () => !(await groupOf(workTab)) && !(await groupOf(personalTab)), "tabs to leave the group", 10000);
  await personalTab.reload();
  await waitFor(async () => (await personalTab.title()).startsWith("Personal · "), "Personal label after reload", 30000);
  await sleep(1000);
  assert.equal(await groupOf(personalTab), null, "a tab that reconnects stays ungrouped while the setting is off");
  await popup.click("#group-tabs");
  const regrouped = await waitFor(async () => {
    const [a, b] = [await groupOf(workTab), await groupOf(personalTab)];
    return a && b && a.id === b.id && a.title === "WhatsApp" && a;
  }, "tabs to rejoin one group", 10000);
  assert.ok(regrouped);

  step("WhatsApp's own workers run with the patch");
  let patched = 0;
  for (const page of [workTab, personalTab]) {
    const workers = page.workers().filter((worker) => worker.url().includes("/webworker_v1/init_script/"));
    assert.ok(workers.length > 0, "WhatsApp started workers");
    for (const worker of workers) {
      await waitFor(() => worker.evaluate(() => self.__wamsInstalled === true && typeof StartBundle !== "undefined"), "patched worker", 20000);
      patched += 1;
    }
  }
  console.log(`  ${patched} workers patched`);

  step("popup shows both sessions open");
  await popup.bringToFront();
  await popup.waitForFunction(() => [...document.querySelectorAll(".status")].every((status) => status.textContent.startsWith("Open")));

  step("storage is namespaced per session, including worker storage");
  await sleep(4000);
  const raw = await rawStorage(workTab);
  console.log("  raw databases:", raw.dbs.join(", "));
  console.log("  raw caches:", raw.caches.join(", ") || "(none)");
  const workDbs = raw.dbs.filter((name) => name.startsWith(`wams:${workId}:`)).map((name) => name.split(":")[2]);
  const personalDbs = raw.dbs.filter((name) => name.startsWith(`wams:${personalId}:`)).map((name) => name.split(":")[2]);
  assert.ok(workDbs.includes("wawc") && personalDbs.includes("wawc"), "each session has its own WhatsApp database");
  const leaked = raw.dbs.filter((name) => !name.startsWith("wams:") && !SERVICE_WORKER_DBS.has(name));
  assert.deepEqual(leaked, [], "session tabs create no shared databases (the service worker's aside)");
  assert.deepEqual(raw.local.filter((key) => !key.startsWith("wams:")), [], "session tabs write no shared localStorage");
  assert.ok(raw.local.some((key) => key.startsWith(`wams:${workId}:`)) && raw.local.some((key) => key.startsWith(`wams:${personalId}:`)));

  const seen = await pageStorage(workTab);
  assert.ok(seen.dbs.includes("wawc") && seen.dbs.every((name) => !name.includes("wams:")), "WhatsApp sees plain names");
  assert.ok(seen.local.length > 0 && seen.local.every((key) => !key.includes("wams:")));

  step("a reload keeps the tab in its session");
  const refBefore = await qrRef(workTab);
  await workTab.reload();
  await waitFor(() => qrRef(workTab), "Work QR after reload");
  await waitFor(async () => (await workTab.title()).startsWith("Work · "), "Work label after reload", 10000);
  assert.ok(refBefore);
  const afterReload = await rawStorage(workTab);
  assert.deepEqual(afterReload.dbs.filter((name) => !name.startsWith("wams:") && !SERVICE_WORKER_DBS.has(name)), [], "still namespaced after reload");

  step("plain WhatsApp still works and can't see sessions");
  const plainTab = watch(await browser.newPage(), "plain");
  await plainTab.goto(WHATSAPP);
  await waitFor(() => qrRef(plainTab), "plain QR code");
  const plainSeen = await pageStorage(plainTab);
  assert.ok(plainSeen.dbs.includes("wawc") && plainSeen.dbs.every((name) => !name.startsWith("wams:")));
  assert.ok(!(await plainTab.title()).includes(" · "), "plain tabs aren't labelled");
  await plainTab.evaluate(() => localStorage.clear());
  const afterClear = await rawStorage(plainTab);
  assert.ok(afterClear.local.some((key) => key.startsWith(`wams:${workId}:`)), "clearing plain WhatsApp keeps the sessions' data");

  step("rename updates the open tab's label");
  await popup.bringToFront();
  await popup.evaluate((id) => chrome.runtime.sendMessage({ type: "wams-update", id, name: "Office" }), workId);
  await waitFor(async () => (await workTab.title()).startsWith("Office · "), "renamed label", 10000);
  assert.equal((await groupOf(workTab))?.id, regrouped.id, "the tab stays in the shared group after a reload");

  step("removing a session closes its tab and deletes its data");
  await popup.bringToFront();
  const personalRow = `.session[data-id="${personalId}"]`;
  await popup.click(`${personalRow} button[title=Edit]`);
  await popup.click(`${personalRow} .danger`);
  const removed = popup.evaluate(() => new Promise((resolve) => {
    // Hear the popup's own remove request finish, including any error from the data wipe.
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (message) => {
      const reply = send(message);
      if (message.type === "wams-remove") reply.then(resolve, (error) => resolve({ ok: false, error: String(error) }));
      return reply;
    };
  }));
  await popup.click(`${personalRow} .danger`);
  await waitFor(async () => personalTab.isClosed(), "Personal tab to close", 10000);
  await popup.waitForFunction(() => document.querySelectorAll(".session").length === 1);
  const removal = await removed;
  assert.equal(removal?.ok, true, `removal reported: ${JSON.stringify(removal)}`);
  const personalLeft = async () => {
    const all = await rawStorage(plainTab);
    return [...all.dbs, ...all.local, ...all.caches].filter((name) => name.startsWith(`wams:${personalId}:`));
  };
  try {
    await waitFor(async () => (await personalLeft()).length === 0, "Personal data to be deleted", 20000);
  } catch (error) {
    throw new Error(`${error.message}; still there: ${(await personalLeft()).join(", ")}`);
  }
  const remaining = await rawStorage(plainTab);
  assert.ok(remaining.dbs.some((name) => name.startsWith(`wams:${workId}:`)), "other sessions keep their data");

  const ours = pageErrors.filter((message) => /Illegal invocation|wams|__wamsInstalled|isolate/i.test(message));
  if (pageErrors.length) console.log(`  page errors (${pageErrors.length}):\n   ${pageErrors.slice(0, 8).join("\n   ")}`);
  assert.deepEqual(ours, [], "no errors caused by the isolation patch");

  console.log("e2e: all checks passed");
} catch (error) {
  for (const page of await browser.pages()) {
    if (!page.url().startsWith(WHATSAPP)) continue;
    const text = await page.evaluate(() => document.body?.innerText.slice(0, 300)).catch(() => "?");
    console.log(`--- ${page.url()} [${await page.title().catch(() => "?")}]\n${text}`);
  }
  console.log(`page errors:\n ${pageErrors.slice(0, 15).join("\n ")}`);
  throw error;
} finally {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
}
