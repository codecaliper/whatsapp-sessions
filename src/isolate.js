// Runs inside WhatsApp Web's own page (MAIN world) at document_start, before any WhatsApp
// script. A tab opened as a session gets its own copy of every storage WhatsApp uses, by
// prefixing names with `wams:<id>:` — IndexedDB, localStorage, Cache Storage, BroadcastChannel
// and Web Locks. WhatsApp's workers load this file too (see "Workers"), so they get the same patch.
//
// Plain WhatsApp tabs (no session) get the empty prefix: nothing is renamed, but `wams:` data
// is hidden from them, so logging out of plain WhatsApp can't wipe the sessions.
(() => {
  const SESSION_KEY = "__wamsSession";
  const ID_PATTERN = /^[a-z0-9]{1,24}$/;

  function install(scope, prefix, loaderUrl) {
    if (scope.__wamsInstalled) return;
    Object.defineProperty(scope, "__wamsInstalled", { value: true });

    const add = (name) => prefix + String(name);
    const strip = (name) => name.slice(prefix.length);
    const own = prefix
      ? (name) => typeof name === "string" && name.startsWith(prefix)
      : (name) => typeof name === "string" && !name.startsWith("wams:");
    const define = (target, key, value) =>
      Object.defineProperty(target, key, { value, configurable: true, writable: true, enumerable: false });

    // --- IndexedDB -------------------------------------------------------------
    const idb = scope.IDBFactory && scope.IDBFactory.prototype;
    if (idb) {
      const { open, deleteDatabase, databases } = idb;
      define(idb, "open", function (name, ...rest) { return open.call(this, add(name), ...rest); });
      define(idb, "deleteDatabase", function (name) { return deleteDatabase.call(this, add(name)); });
      if (databases) {
        define(idb, "databases", async function () {
          return (await databases.call(this)).filter((db) => own(db.name)).map((db) => ({ ...db, name: strip(db.name) }));
        });
      }
      const database = scope.IDBDatabase && scope.IDBDatabase.prototype;
      const nameGetter = database && Object.getOwnPropertyDescriptor(database, "name");
      if (nameGetter && nameGetter.get) {
        Object.defineProperty(database, "name", {
          ...nameGetter,
          get() { const name = nameGetter.get.call(this); return own(name) ? strip(name) : name; },
        });
      }
    }

    // --- localStorage ----------------------------------------------------------
    let real = null;
    try { real = scope.localStorage || null; } catch {}
    if (real && scope.Storage) {
      const keys = () => {
        const found = [];
        for (let i = 0; i < real.length; i += 1) {
          const key = real.key(i);
          if (own(key)) found.push(strip(key));
        }
        return found;
      };
      const api = {
        getItem: (key) => real.getItem(add(key)),
        setItem: (key, value) => real.setItem(add(key), String(value)),
        removeItem: (key) => real.removeItem(add(key)),
        clear: () => keys().forEach((key) => real.removeItem(add(key))),
        key: (index) => { const all = keys(); return index >= 0 && index < all.length ? all[index] : null; },
      };
      const stored = (key) => (typeof key === "string" ? real.getItem(add(key)) : null);
      const facade = new Proxy(Object.create(scope.Storage.prototype), {
        get(target, key) {
          if (key === "length") return keys().length;
          if (typeof key === "string" && Object.hasOwn(api, key)) return api[key];
          if (key in target) return Reflect.get(target, key);
          return stored(key) ?? undefined;
        },
        set(target, key, value) {
          if (typeof key === "symbol") return Reflect.set(target, key, value);
          api.setItem(key, value);
          return true;
        },
        deleteProperty(target, key) {
          if (typeof key === "string") api.removeItem(key);
          return true;
        },
        has: (target, key) => stored(key) !== null || key in target,
        ownKeys: () => keys(),
        getOwnPropertyDescriptor(target, key) {
          const value = stored(key);
          return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
        },
      });
      Object.defineProperty(scope, "localStorage", { configurable: true, enumerable: true, get: () => facade });

      // Other tabs' writes arrive as storage events; only this session's reach WhatsApp.
      const relayed = new WeakSet();
      scope.addEventListener("storage", (event) => {
        if (relayed.has(event) || event.storageArea !== real) return;
        event.stopImmediatePropagation();
        if (event.key !== null && !own(event.key)) return;
        const copy = new scope.StorageEvent("storage", {
          key: event.key === null ? null : strip(event.key),
          oldValue: event.oldValue,
          newValue: event.newValue,
          url: event.url,
        });
        relayed.add(copy);
        scope.dispatchEvent(copy);
      }, true);
    }

    // --- Cache Storage ---------------------------------------------------------
    const cacheStorage = scope.CacheStorage && scope.CacheStorage.prototype;
    if (cacheStorage) {
      const { open, has, keys, match } = cacheStorage;
      const remove = cacheStorage.delete;
      define(cacheStorage, "open", function (name) { return open.call(this, add(name)); });
      define(cacheStorage, "has", function (name) { return has.call(this, add(name)); });
      define(cacheStorage, "delete", function (name) { return remove.call(this, add(name)); });
      define(cacheStorage, "keys", async function () { return (await keys.call(this)).filter(own).map(strip); });
      define(cacheStorage, "match", async function (request, options) {
        if (options && options.cacheName !== undefined) return match.call(this, request, { ...options, cacheName: add(options.cacheName) });
        for (const name of await keys.call(this)) {
          if (!own(name)) continue;
          const found = await (await open.call(this, name)).match(request, options);
          if (found) return found;
        }
        return undefined;
      });
    }

    // --- Web Locks -------------------------------------------------------------
    const locks = scope.LockManager && scope.LockManager.prototype;
    if (locks) {
      const { request, query } = locks;
      define(locks, "request", function (name, ...rest) { return request.call(this, add(name), ...rest); });
      define(locks, "query", async function () {
        const snapshot = await query.call(this);
        const mine = (list) => (list || []).filter((lock) => own(lock.name)).map((lock) => ({ ...lock, name: strip(lock.name) }));
        return { held: mine(snapshot.held), pending: mine(snapshot.pending) };
      });
    }

    // --- Storage Buckets (unused by WhatsApp today; bucket names only allow [a-z0-9_-]) ---
    const buckets = scope.StorageBucketManager && scope.StorageBucketManager.prototype;
    if (buckets) {
      const bucketPrefix = prefix.replace(/:/g, "-");
      const ownBucket = bucketPrefix ? (name) => name.startsWith(bucketPrefix) : (name) => !name.startsWith("wams-");
      const { open, keys } = buckets;
      const remove = buckets.delete;
      define(buckets, "open", function (name, ...rest) { return open.call(this, bucketPrefix + name, ...rest); });
      define(buckets, "delete", function (name) { return remove.call(this, bucketPrefix + name); });
      define(buckets, "keys", async function () {
        return (await keys.call(this)).filter(ownBucket).map((name) => name.slice(bucketPrefix.length));
      });
    }

    if (!prefix) return;

    // --- BroadcastChannel ------------------------------------------------------
    const Channel = scope.BroadcastChannel;
    if (Channel) {
      define(scope, "BroadcastChannel", class BroadcastChannel extends Channel {
        constructor(name) { super(add(name)); }
        get name() { return strip(super.name); }
      });
    }

    // --- Workers ---------------------------------------------------------------
    // WhatsApp's CSP only allows its own worker script, which then loads the real bundle when
    // the page sends "sr-init" (dedicated) or "execute-worker" (shared). Those messages are
    // redirected to this file, which installs the same patch inside the worker and then loads
    // the real bundle. Shared workers also get a per-session name, so sessions don't share one.
    if (!loaderUrl) return;
    const base = String(scope.location.href);
    const loader = (bundle) => `${loaderUrl}?p=${encodeURIComponent(prefix)}&b=${encodeURIComponent(new scope.URL(String(bundle), base).href)}`;
    const redirect = (data) => {
      if (!data || typeof data !== "object") return data;
      if (data.type === "sr-init" && typeof data.bundleUrl === "string") return { ...data, bundleUrl: loader(data.bundleUrl) };
      const first = data.type === "execute-worker" && Array.isArray(data.args) ? data.args[0] : null;
      if (first && typeof first === "object" && typeof first.url === "string") {
        return { ...data, args: [{ ...first, url: loader(first.url) }, ...data.args.slice(1)] };
      }
      return data;
    };
    for (const Target of [scope.Worker, scope.MessagePort]) {
      const proto = Target && Target.prototype;
      if (!proto) continue;
      const { postMessage } = proto;
      define(proto, "postMessage", function (message, ...rest) { return postMessage.call(this, redirect(message), ...rest); });
    }
    const Shared = scope.SharedWorker;
    if (Shared) {
      const Wrapped = class extends Shared {
        constructor(url, options) {
          const settings = typeof options === "string" ? { name: options } : { ...options };
          super(url, { ...settings, name: add(settings.name ?? "") });
        }
      };
      Object.defineProperty(Wrapped, "name", { value: "SharedWorker" });
      define(scope, "SharedWorker", Wrapped);
    }
    if (typeof scope.name === "string" && own(scope.name)) {
      const name = strip(scope.name);
      Object.defineProperty(scope, "name", { configurable: true, get: () => name });
    }
  }

  if (globalThis.__WAMS_TEST__) {
    globalThis.__WAMS_TEST__.install = install;
    return;
  }

  // This file's own extension URL, e.g. chrome-extension://<id>/src/isolate.js.
  const loaderUrl = /chrome-extension:\/\/[a-p]{32}\/src\/isolate\.js/.exec(new Error().stack || "")?.[0] || "";

  // Loaded inside a WhatsApp worker (see "Workers" above): patch, then load the real bundle.
  // (WhatsApp's worker sets self.window = self, so test for importScripts, not window.)
  if (typeof importScripts === "function") {
    const query = /isolate\.js\?([^\s):]+)/.exec(new Error().stack || "")?.[1];
    const params = new URLSearchParams(query || "");
    const prefix = params.get("p") || "";
    const bundle = params.get("b");
    if (!/^wams:[a-z0-9]{1,24}:$/.test(prefix) || !/^https:\/\//.test(bundle || "")) throw new Error("WhatsApp Sessions: bad worker loader URL");
    install(self, prefix, loaderUrl);
    importScripts(bundle);
    return;
  }

  let id = null;
  try {
    const fromHash = /(?:^#|&)wams=([a-z0-9]+)/.exec(location.hash);
    if (fromHash && ID_PATTERN.test(fromHash[1])) {
      sessionStorage.setItem(SESSION_KEY, fromHash[1]);
      history.replaceState(history.state, "", location.pathname + location.search);
    }
    id = sessionStorage.getItem(SESSION_KEY);
  } catch {}
  install(window, id && ID_PATTERN.test(id) ? `wams:${id}:` : "", loaderUrl);
})();
