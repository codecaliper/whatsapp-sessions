import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import {
  COLORS,
  addSession,
  badgeText,
  cleanName,
  cleanSettings,
  groupTitle,
  isGroupTitleFor,
  isSessionId,
  labelTitle,
  moveSession,
  removeSession,
  sessionUrl,
  storagePrefix,
  unreadFromTitle,
  updateSession,
} from "./src/sessions.js";

// --- session list ---------------------------------------------------------------
const sequence = (...values) => { let i = 0; return () => values[i++ % values.length]; };

let { sessions, session: work } = addSession([], { name: "  Work   phone ", color: COLORS[2] }, { random: sequence(0), now: () => 1 });
assert.equal(work.id, "aaaaaaaa");
assert.equal(work.name, "Work phone", "whitespace is collapsed");
assert.equal(work.color, COLORS[2]);
assert.ok(isSessionId(work.id));

({ sessions } = addSession(sessions, { name: "", color: "red" }, { random: sequence(0, 0, 0, 0, 0, 0, 0, 0, 0.99), now: () => 2 }));
assert.equal(sessions[1].name, "WhatsApp 2", "a blank name gets a default");
assert.equal(sessions[1].color, COLORS[1], "unknown colours fall back to the palette");
assert.notEqual(sessions[1].id, work.id, "ids never collide");

assert.equal(cleanName("x".repeat(80), "f").length, 32);
sessions = updateSession(sessions, work.id, { name: "Office", color: COLORS[4] });
assert.deepEqual([sessions[0].name, sessions[0].color], ["Office", COLORS[4]]);
assert.equal(updateSession(sessions, work.id, { name: "   " })[0].name, "Office", "renaming to blank keeps the old name");

assert.deepEqual(moveSession(sessions, sessions[1].id, -1).map((s) => s.name), ["WhatsApp 2", "Office"]);
assert.equal(moveSession(sessions, sessions[0].id, -1), sessions, "moving past the top is a no-op");
assert.deepEqual(removeSession(sessions, work.id).map((s) => s.name), ["WhatsApp 2"]);

assert.equal(sessionUrl("abc123"), "https://web.whatsapp.com/#wams=abc123");
assert.equal(storagePrefix("abc123"), "wams:abc123:");
for (const bad of ["", "ABC", "a:b", "x".repeat(25), null]) assert.equal(isSessionId(bad), false, `${bad} is not an id`);

assert.equal(unreadFromTitle("(12) WhatsApp"), 12);
assert.equal(unreadFromTitle("WhatsApp"), 0);
assert.equal(labelTitle("(3) WhatsApp", "Work"), "Work · (3) WhatsApp");
assert.equal(labelTitle("Work · WhatsApp", "Work"), "Work · WhatsApp");
assert.equal(badgeText(0), "");
assert.equal(badgeText(1200), "999+");

assert.deepEqual(cleanSettings(undefined), { groupTabs: true }, "grouping is on by default");
assert.deepEqual(cleanSettings({ groupTabs: false, junk: 1 }), { groupTabs: false });
assert.deepEqual(cleanSettings({ groupTabs: "no" }), { groupTabs: true }, "bad values fall back to the default");
assert.equal(groupTitle("Work"), "Work");
assert.equal(groupTitle("Work", 3), "Work (3)");
assert.ok(isGroupTitleFor("Work", "Work") && isGroupTitleFor("Work (12)", "Work"));
assert.ok(isGroupTitleFor("a.b (1)", "a.b") && !isGroupTitleFor("axb (1)", "a.b"), "names are matched literally");
assert.ok(!isGroupTitleFor("Workshop", "Work") && !isGroupTitleFor(undefined, "Work"));

// --- storage isolation, against fake browser APIs --------------------------------
const isolateSource = readFileSync(new URL("./src/isolate.js", import.meta.url), "utf8");

/** One origin's storage, shared by every fake tab and worker. */
function makeOrigin() {
  return { dbs: new Set(), local: new Map(), caches: new Map(), locks: [], channels: [], workers: [], posted: [], buckets: new Set() };
}

function makeScope(origin, { worker = false, href = "https://web.whatsapp.com/" } = {}) {
  const scope = { location: { href }, URL, URLSearchParams };
  scope.IDBFactory = class {
    open(name) { origin.dbs.add(name); return { name }; }
    deleteDatabase(name) { origin.dbs.delete(name); return {}; }
    async databases() { return [...origin.dbs].map((name) => ({ name, version: 1 })); }
  };
  scope.IDBDatabase = class {};
  Object.defineProperty(scope.IDBDatabase.prototype, "name", { configurable: true, get() { return this._name; } });
  scope.indexedDB = new scope.IDBFactory();
  scope.CacheStorage = class {
    async open(name) { if (!origin.caches.has(name)) origin.caches.set(name, new Map()); const store = origin.caches.get(name); return { match: async (key) => store.get(key), put: async (key, value) => store.set(key, value) }; }
    async has(name) { return origin.caches.has(name); }
    async delete(name) { return origin.caches.delete(name); }
    async keys() { return [...origin.caches.keys()]; }
    async match(key, options) { return origin.caches.get(options?.cacheName)?.get(key); }
  };
  scope.caches = new scope.CacheStorage();
  scope.LockManager = class {
    async request(name, callback) { origin.locks.push(name); return callback({ name }); }
    async query() { return { held: origin.locks.map((name) => ({ name, mode: "exclusive" })), pending: [] }; }
  };
  scope.navigator = { locks: new scope.LockManager() };
  scope.StorageBucketManager = class {
    async open(name) { origin.buckets.add(name); return { name }; }
    async delete(name) { origin.buckets.delete(name); }
    async keys() { return [...origin.buckets]; }
  };
  scope.navigator.storageBuckets = new scope.StorageBucketManager();
  scope.BroadcastChannel = class { constructor(name) { this._name = name; origin.channels.push(name); } get name() { return this._name; } };
  scope.MessagePort = class { postMessage(message) { origin.posted.push(message); } };
  scope.Worker = class { constructor(url, options) { origin.workers.push({ kind: "Worker", url, options }); } postMessage(message) { origin.posted.push(message); } };
  scope.SharedWorker = class { constructor(url, options) { origin.workers.push({ kind: "SharedWorker", url, options }); this.port = new scope.MessagePort(); } };
  if (worker) {
    scope.imported = [];
    scope.importScripts = (...urls) => scope.imported.push(...urls);
    scope.name = "";
  } else {
    const listeners = [];
    scope.Storage = class {
      get length() { return origin.local.size; }
      key(i) { return [...origin.local.keys()][i] ?? null; }
      getItem(key) { return origin.local.has(key) ? origin.local.get(key) : null; }
      setItem(key, value) { origin.local.set(key, String(value)); }
      removeItem(key) { origin.local.delete(key); }
    };
    scope.localStorage = new scope.Storage();
    scope.StorageEvent = class { constructor(type, init) { Object.assign(this, { type, storageArea: null }, init); } };
    scope.addEventListener = (type, listener) => listeners.push({ type, listener });
    scope.dispatchEvent = (event) => {
      let stopped = false;
      event.stopImmediatePropagation = () => { stopped = true; };
      for (const { type, listener } of listeners) {
        if (type === event.type && !stopped) listener(event);
      }
    };
  }
  scope.self = scope;
  return scope;
}

const origin = makeOrigin();
const LOADER = "chrome-extension://abcdefghijklmnopabcdefghijklmnop/src/isolate.js";
const install = (scope, prefix) => {
  const context = vm.createContext({ __WAMS_TEST__: {} });
  vm.runInContext(isolateSource, context);
  context.__WAMS_TEST__.install(scope, prefix, LOADER);
};

const plain = makeScope(origin);
const tabA = makeScope(origin);
const tabB = makeScope(origin);
const rawStorageA = tabA.localStorage;
install(plain, "");
install(tabA, "wams:a:");
install(tabB, "wams:b:");

// IndexedDB
tabA.indexedDB.open("wawc");
tabB.indexedDB.open("wawc");
plain.indexedDB.open("wawc");
assert.deepEqual([...origin.dbs].sort(), ["wams:a:wawc", "wams:b:wawc", "wawc"]);
assert.deepEqual((await tabA.indexedDB.databases()).map((db) => db.name), ["wawc"]);
assert.deepEqual((await plain.indexedDB.databases()).map((db) => db.name), ["wawc"], "plain tabs don't see sessions");
tabB.indexedDB.deleteDatabase("wawc");
assert.ok(origin.dbs.has("wams:a:wawc") && origin.dbs.has("wawc") && !origin.dbs.has("wams:b:wawc"));
const database = Object.assign(Object.create(tabA.IDBDatabase.prototype), { _name: "wams:a:wawc" });
assert.equal(database.name, "wawc", "IDBDatabase.name hides the prefix");

// localStorage
tabA.localStorage.setItem("Session", "A");
tabB.localStorage.Session = "B";
plain.localStorage.setItem("Session", "plain");
assert.equal(tabA.localStorage.getItem("Session"), "A");
assert.equal(tabB.localStorage.Session, "B");
assert.equal(plain.localStorage.getItem("Session"), "plain");
assert.equal(origin.local.get("wams:a:Session"), "A");
assert.deepEqual(Object.keys(tabA.localStorage), ["Session"]);
assert.equal(tabA.localStorage.length, 1);
assert.equal(tabA.localStorage.key(0), "Session");
assert.equal(tabA.localStorage.key(5), null);
assert.ok("Session" in tabB.localStorage && !("Nope" in tabB.localStorage));
assert.equal(typeof tabA.localStorage.getItem, "function", "methods win over stored keys, like real Storage");
assert.ok(tabA.localStorage instanceof tabA.Storage);
plain.localStorage.clear();
assert.equal(tabA.localStorage.getItem("Session"), "A", "clearing plain WhatsApp keeps sessions");
assert.equal(origin.local.has("Session"), false);
delete tabB.localStorage.Session;
assert.equal(tabB.localStorage.getItem("Session"), null);

// storage events from other tabs: only this session's keys, with the prefix removed
const heard = [];
tabA.addEventListener("storage", (event) => heard.push(event.key));
for (const key of ["wams:b:Session", "Session", "wams:a:whatsapp-mutex", null]) {
  tabA.dispatchEvent({ type: "storage", key, storageArea: rawStorageA });
}
tabA.dispatchEvent({ type: "storage", key: "tab-only", storageArea: "sessionStorage" });
assert.deepEqual(heard, ["whatsapp-mutex", null, "tab-only"], "only this session's changes arrive, unprefixed");

// Cache Storage
await (await tabA.caches.open("wa-stickers")).put("k", "A");
await (await plain.caches.open("wa-stickers")).put("k", "plain");
assert.deepEqual(await tabA.caches.keys(), ["wa-stickers"]);
assert.equal(await tabA.caches.match("k"), "A");
assert.equal(await tabA.caches.match("k", { cacheName: "wa-stickers" }), "A");
assert.equal(await tabB.caches.match("k"), undefined);
assert.equal(await tabB.caches.has("wa-stickers"), false);

// Web Locks
await tabA.navigator.locks.request("wa-mutex", () => {});
await plain.navigator.locks.request("wa-mutex", () => {});
assert.deepEqual(origin.locks, ["wams:a:wa-mutex", "wa-mutex"]);
assert.deepEqual((await tabA.navigator.locks.query()).held.map((lock) => lock.name), ["wa-mutex"]);

// Storage Buckets
await tabA.navigator.storageBuckets.open("media");
await plain.navigator.storageBuckets.open("media");
assert.deepEqual([...origin.buckets], ["wams-a-media", "media"]);
assert.deepEqual(await tabA.navigator.storageBuckets.keys(), ["media"]);
assert.deepEqual(await plain.navigator.storageBuckets.keys(), ["media"]);
await plain.navigator.storageBuckets.delete("media");
assert.deepEqual([...origin.buckets], ["wams-a-media"], "plain WhatsApp can't delete a session's bucket");

// BroadcastChannel
const channel = new tabA.BroadcastChannel("x-storagemutated-1");
assert.equal(channel.name, "x-storagemutated-1");
new plain.BroadcastChannel("x-storagemutated-1");
assert.deepEqual(origin.channels, ["wams:a:x-storagemutated-1", "x-storagemutated-1"]);

// Workers: WhatsApp's worker bootstrap is sent to this extension's loader instead of the bundle
const worker = new tabA.Worker("/static_resources/webworker_v1/init_script/?v=1", { name: "RSTWebWorker" });
const bundle = "https://static.whatsapp.net/rsrc.php/bundle.js";
const transfer = [];
worker.postMessage({ type: "sr-init", bundleUrl: bundle, resource: { id: 1 } }, transfer);
const [init] = origin.posted;
const loaderUrl = new URL(init.bundleUrl);
assert.equal(init.bundleUrl.split("?")[0], LOADER);
assert.deepEqual([loaderUrl.searchParams.get("p"), loaderUrl.searchParams.get("b")], ["wams:a:", bundle]);
assert.deepEqual(init.resource, { id: 1 }, "the rest of the message is untouched");
worker.postMessage({ type: "other", bundleUrl: bundle });
assert.equal(origin.posted[1].bundleUrl, bundle, "only the bootstrap message is redirected");

const shared = new tabA.SharedWorker("/static_resources/webworker_v1/init_script/", "hub");
shared.port.postMessage({ type: "execute-worker", args: [{ url: "/relative/bundle.js" }, true] });
assert.equal(origin.workers.at(-1).options.name, "wams:a:hub", "shared workers are per session");
const sharedLoader = new URL(origin.posted[2].args[0].url);
assert.equal(sharedLoader.searchParams.get("b"), "https://web.whatsapp.com/relative/bundle.js");
assert.equal(origin.posted[2].args[1], true);

new plain.Worker("/plain.js").postMessage({ type: "sr-init", bundleUrl: bundle });
assert.equal(origin.posted[3].bundleUrl, bundle, "plain tabs' workers are left alone");

// ...and the loader, running inside the worker, patches it and then loads the real bundle.
const workerScope = makeScope(origin, { worker: true, href: "https://web.whatsapp.com/static_resources/webworker_v1/init_script/?v=1" });
workerScope.name = "wams:a:hub";
vm.runInContext(isolateSource, vm.createContext(workerScope), { filename: init.bundleUrl });
assert.deepEqual(workerScope.imported, [bundle], "the loader imports the real bundle");
workerScope.indexedDB.open("fts-storage");
assert.ok(origin.dbs.has("wams:a:fts-storage"), "workers use the session's databases");
assert.equal(workerScope.name, "hub", "the worker sees its own name");
const badScope = makeScope(origin, { worker: true });
assert.throws(() => vm.runInContext(isolateSource, vm.createContext(badScope), { filename: `${LOADER}?p=evil&b=${encodeURIComponent(bundle)}` }), /bad worker loader/);
assert.deepEqual(badScope.imported, []);

console.log("sessions.test.mjs: all tests passed");

// --- bridge.js: tab helper, including after the extension is reloaded ---------------------------
const bridgeSource = readFileSync(new URL("./src/bridge.js", import.meta.url), "utf8");

async function runBridge({ runtime, title = "WhatsApp", hash = "#wams=abc123" }) {
  const observers = [];
  const scope = {
    location: { hash, replace() {} },
    sessionStorage: { getItem: () => null, removeItem() {} },
    document: { title, head: {}, documentElement: {}, querySelector: () => ({}) },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; this.active = true; observers.push(this); }
      observe() {}
      disconnect() { this.active = false; }
    },
    chrome: { runtime },
  };
  scope.globalThis = scope;
  vm.runInNewContext(bridgeSource, scope);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { scope, observers, mutate: () => observers.forEach((observer) => observer.active && observer.callback([])) };
}

const sent = [];
const liveRuntime = {
  id: "ext",
  onMessage: { addListener() {} },
  sendMessage: async (message) => {
    sent.push(message);
    return message.type === "wams-hello" ? { session: { id: "abc123", name: "Work" } } : { ok: true };
  },
};
const live = await runBridge({ runtime: liveRuntime, title: "(2) WhatsApp" });
assert.equal(live.scope.document.title, "Work · (2) WhatsApp", "the tab title gets the session label");
assert.deepEqual(sent.map((message) => message.type), ["wams-hello", "wams-unread"]);
assert.equal(sent[1].unread, 2);

// The extension is reloaded: the old copy loses chrome.runtime.id and sendMessage throws.
delete liveRuntime.id;
liveRuntime.sendMessage = () => { throw new Error("Extension context invalidated."); };
live.scope.document.title = "(5) WhatsApp";
assert.doesNotThrow(() => live.mutate(), "an orphaned helper doesn't throw");
assert.equal(live.observers[0].active, false, "an orphaned helper stops watching the title");

const orphan = await runBridge({
  runtime: { onMessage: { addListener() {} }, sendMessage: () => { throw new Error("Extension context invalidated."); } },
});
assert.equal(orphan.scope.document.title, "WhatsApp", "a helper that starts orphaned does nothing");

let helloCount = 0;
const again = { id: "ext", onMessage: { addListener() {} }, sendMessage: async () => { helloCount += 1; return {}; } };
const first = await runBridge({ runtime: again });
vm.runInNewContext(bridgeSource, first.scope);
assert.equal(helloCount, 1, "injecting the helper twice into the same world runs it once");

console.log("bridge.js: all tests passed");
