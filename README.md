# Sessions for WhatsApp

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **Unofficial.** This project is not affiliated with, endorsed by, or sponsored by WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of WhatsApp LLC and is used here only to describe what the extension works with.

A Chrome extension for running several WhatsApp Web accounts side by side in one Chrome profile. Each session is its own tab with its own login. You don't need extra Chrome profiles or incognito windows.

It runs only in your browser. There's no server and no account, and nothing is sent anywhere. The session list is saved in `chrome.storage.local`.

## Load it in Chrome

1. Download this repository (**Code → Download ZIP** and unzip it, or `git clone https://github.com/codecaliper/whatsapp-sessions.git`).
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the `whatsapp-sessions` folder.
4. Click the extension icon (or press **Alt+Shift+W**), type a name such as "Work", pick a colour and press **Add**.
5. Press **Open**. A WhatsApp tab opens, titled `Work · WhatsApp`. Scan its QR code with the phone for that account.
6. Repeat for each account. Each session stays logged in across reloads and browser restarts, just like normal WhatsApp Web.

| In the popup | What it does |
| --- | --- |
| **Open** / **Show** | Opens the session's tab, or switches to it if it's already open |
| **Open all** | Opens every session |
| ✎ | Rename, change colour, or remove |
| ↑ ↓ | Reorder |
| Green count | Unread chats in that session (the toolbar badge shows the total) |

All session tabs go into one Chrome **tab group** called `WhatsApp` (one per window). The group shows the total unread count, for example `WhatsApp (3)`, so you can still see it when the group is collapsed. Each tab's title still starts with its session name. Pinned tabs, and tabs you've moved into a group of your own, are left where they are.

Don't want a group, for example because you only use one session? Untick **Group session tabs** in the popup. Session tabs leave the group straight away, and new ones open ungrouped. Tick it again to regroup the open session tabs. The setting is saved in `chrome.storage.local`.

**Remove** closes the session's tab and deletes all of its WhatsApp data from this browser. It logs out on this browser only; to unlink the device completely, remove it on the phone under *Linked devices*.

Plain `web.whatsapp.com` tabs, opened without the extension, work as before. They're another separate account, and they can't see or clear the sessions' data.

## How it works

WhatsApp Web keeps its login in the site's own storage: IndexedDB, localStorage and Cache Storage. Normally a browser profile can hold only one copy of that storage per site. WhatsApp also blocks being embedded in frames, so frame-based tricks don't work.

`src/isolate.js` runs inside the WhatsApp page (`world: "MAIN"`, `document_start`) before any WhatsApp code. In a session tab, it prefixes every storage name with `wams:<session id>:`, so each session gets its own copy:

- IndexedDB: `open`, `deleteDatabase`, `databases()`, and `IDBDatabase.name`
- `localStorage`, which is replaced by a namespaced view. It also filters `storage` events, so tabs of other sessions stay silent.
- Cache Storage, Web Locks, BroadcastChannel and Storage Buckets
- Web Workers. WhatsApp's CSP only lets its own bootstrap script start workers. That script loads the real bundle when the page sends it an `sr-init` or `execute-worker` message. The patch redirects that message to `src/isolate.js?p=<prefix>&b=<bundle>`, a web-accessible resource. Inside the worker, it installs the same patch and then loads the real bundle. Shared workers also get per-session names.

A tab joins a session by opening `https://web.whatsapp.com/#wams=<id>`. The id is moved into the tab's `sessionStorage`, and the hash is removed before WhatsApp starts. The tab stays in its session across reloads and restored sessions.

In plain WhatsApp tabs, nothing is renamed. `wams:` data is hidden from them, so a plain logout, `localStorage.clear()` or database cleanup never touches the sessions.

`src/bridge.js` is the isolated-world side. It labels the tab title with the session name and reports unread counts. `background.js` keeps track of which tab shows which session, keeps session tabs in the shared WhatsApp tab group, and serialises all changes. When a session is removed, it deletes that session's data from a WhatsApp-origin page.

## Limits

- WhatsApp's **service worker** is shared by the whole site, and extensions can't patch it. It keeps its own logs, analytics and push-notification bookkeeping in the unprefixed `sw` and `wawc` databases. Your login keys aren't stored there; they live in each session's own databases. Web push notifications may therefore only work reliably for plain WhatsApp while its tab is closed. Keep session tabs open, or pinned, to get their messages.
- Each session can be open in only one tab at a time, just like normal WhatsApp Web.
- This depends on how WhatsApp Web uses browser storage. If WhatsApp changes how it starts workers or adds new storage APIs, run the end-to-end test (below). It will show what needs updating in `src/isolate.js`.
- Using more than one account is allowed by WhatsApp (up to 4 linked devices per phone). This extension doesn't automate or scrape WhatsApp.

## Tests

```bash
node sessions.test.mjs          # session list helpers, and the isolation patch against fake browser APIs
cd e2e && npm install && npm run e2e   # live check against web.whatsapp.com (HEADFUL=1 to watch)
```

The end-to-end test loads the extension into Chrome for Testing and runs these checks against the real WhatsApp login page. It doesn't need an account or a phone:

- Two sessions each boot WhatsApp with their own QR code.
- WhatsApp's real workers run with the patch.
- All page and worker storage is namespaced.
- A reload keeps the session.
- Plain WhatsApp still works and can't see or clear the sessions.
- Session tabs share one WhatsApp tab group, and the **Group session tabs** setting ungroups and regroups them.
- Renaming relabels the tab.
- Removing a session deletes its data.

Regenerate the toolbar icons with `node tools/make-icons.mjs`.

## Files

- `manifest.json`: MV3 manifest
- `src/isolate.js`: the storage namespacing patch, for pages and workers
- `src/bridge.js`: tab title label, unread counts and session registration
- `src/sessions.js`: session list helpers shared by the popup, the service worker and the tests
- `background.js`: tab tracking, open/focus, tab groups, badge, and data removal
- `popup.html`, `popup.css`, `popup.js`: the session list

## Use at your own risk

This extension changes how WhatsApp Web stores its data inside your browser, so that several accounts can run at once. It doesn't automate messages, scrape chats, or talk to any server other than WhatsApp's own. WhatsApp's [Terms of Service](https://www.whatsapp.com/legal/terms-of-service) don't allow unofficial or modified clients, however. Using any third-party extension with WhatsApp is at your own risk, and WhatsApp could restrict accounts that use one. The software is provided as is, without warranty; see the [licence](LICENSE).

## Privacy

Everything stays in your browser. The extension has no server, analytics or tracking. Session names and settings are saved in `chrome.storage.local`, and each account's WhatsApp data stays in WhatsApp's own storage on your machine.

## Contributing

Issues and pull requests are welcome. Please run `node sessions.test.mjs`, and if you changed `src/isolate.js`, run the end-to-end test too.

## License

[MIT](LICENSE) © codecaliper
