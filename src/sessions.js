// The session list: pure helpers shared by the popup, the service worker and the tests.

export const STORAGE_KEY = "sessions";
export const SETTINGS_KEY = "settings";
export const DEFAULT_SETTINGS = { groupTabs: true };
export const WHATSAPP_URL = "https://web.whatsapp.com/";
export const COLORS = ["#25d366", "#34b7f1", "#f5a623", "#e5534b", "#a371f7", "#ec6cb9", "#8b949e"];
export const MAX_NAME = 32;

const ID_PATTERN = /^[a-z0-9]{1,24}$/;

export const isSessionId = (id) => typeof id === "string" && ID_PATTERN.test(id);

/** Everything a session stores in WhatsApp's origin starts with this. Mirrors src/isolate.js. */
export const storagePrefix = (id) => `wams:${id}:`;

/** Opening this URL makes src/isolate.js adopt the session for the tab. */
export const sessionUrl = (id) => `${WHATSAPP_URL}#wams=${id}`;

export function newSessionId(sessions, random = Math.random) {
  const taken = new Set(sessions.map((session) => session.id));
  for (;;) {
    const id = Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(random() * 36)]).join("");
    if (!taken.has(id)) return id;
  }
}

export function cleanName(name, fallback) {
  const cleaned = String(name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return cleaned || fallback;
}

export const cleanColor = (color, fallback = COLORS[0]) => (COLORS.includes(color) ? color : fallback);

export function addSession(sessions, { name, color } = {}, { random = Math.random, now = Date.now } = {}) {
  const session = {
    id: newSessionId(sessions, random),
    name: cleanName(name, `WhatsApp ${sessions.length + 1}`),
    color: cleanColor(color, COLORS[sessions.length % COLORS.length]),
    createdAt: now(),
  };
  return { sessions: [...sessions, session], session };
}

export function updateSession(sessions, id, { name, color } = {}) {
  return sessions.map((session) => (session.id !== id ? session : {
    ...session,
    name: name === undefined ? session.name : cleanName(name, session.name),
    color: color === undefined ? session.color : cleanColor(color, session.color),
  }));
}

export const removeSession = (sessions, id) => sessions.filter((session) => session.id !== id);

export function moveSession(sessions, id, offset) {
  const from = sessions.findIndex((session) => session.id === id);
  const to = from + offset;
  if (from < 0 || to < 0 || to >= sessions.length) return sessions;
  const next = [...sessions];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/** WhatsApp titles its tab "(3) WhatsApp" when there are unread chats. */
export function unreadFromTitle(title) {
  const match = /^\((\d+)\)/.exec(String(title ?? "").trim());
  return match ? Number(match[1]) : 0;
}

export const titleLabel = (name) => `${name} · `;

/** "(3) WhatsApp" -> "Work · (3) WhatsApp"; leaves an already-labelled title alone. */
export function labelTitle(title, name) {
  const label = titleLabel(name);
  return String(title ?? "").startsWith(label) ? title : label + (title || "WhatsApp");
}

/** Tab group label: "WhatsApp", or "WhatsApp (3)" with unread chats. */
export const groupTitle = (name, unread = 0) => (unread > 0 ? `${name} (${unread})` : name);

/** Whether a tab group's title is `name` with or without an unread count, e.g. after Chrome restores it. */
export function isGroupTitleFor(title, name) {
  const text = String(title ?? "");
  return text === name || new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\(\\d+\\)$`).test(text);
}

/** Stored settings with defaults filled in and unknown keys dropped. */
export function cleanSettings(stored) {
  const source = stored && typeof stored === "object" ? stored : {};
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([key, fallback]) => [
    key,
    typeof source[key] === typeof fallback ? source[key] : fallback,
  ]));
}

export const badgeText = (total) => (total > 0 ? (total > 999 ? "999+" : String(total)) : "");
