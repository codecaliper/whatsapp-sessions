# Sessions for WhatsApp

[![Release](https://img.shields.io/github/v/release/codecaliper/whatsapp-sessions)](https://github.com/codecaliper/whatsapp-sessions/releases/latest)
[![CI](https://github.com/codecaliper/whatsapp-sessions/actions/workflows/ci.yml/badge.svg)](https://github.com/codecaliper/whatsapp-sessions/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **Unofficial.** This project is not affiliated with, endorsed by, or sponsored by WhatsApp LLC or Meta Platforms, Inc. "WhatsApp" is a trademark of WhatsApp LLC and is used here only to describe what the extension works with.

A Chrome extension for running several WhatsApp Web accounts side by side in one Chrome profile. Each session is its own tab with its own login. You don't need extra Chrome profiles or incognito windows.

It runs only in your browser. There's no server and no account, and nothing is sent anywhere. The session list is saved in `chrome.storage.local`.

## Load it in Chrome

1. Download `whatsapp-sessions-<version>.zip` from the [latest release](https://github.com/codecaliper/whatsapp-sessions/releases/latest) and unzip it. You can also clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped `whatsapp-sessions` folder.
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
npm run check                  # manifest references, syntax and imports
npm test                       # session list helpers, and the isolation patch against fake browser APIs
cd e2e && npm install && npm run e2e   # live check against web.whatsapp.com (HEADFUL=1 to watch)
npm run package                # builds dist/whatsapp-sessions-<version>.zip
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

Regenerate the toolbar icons with `npm run icons`.

## Releases

Every push to `main` publishes a [GitHub release](https://github.com/codecaliper/whatsapp-sessions/releases), done by `.github/workflows/release.yml`. The version comes from the [Conventional Commits](https://www.conventionalcommits.org/) since the last tag:

| Commits since the last release | Version bump |
| --- | --- |
| `feat!: …`, or a `BREAKING CHANGE:` footer | major (`1.4.2` → `2.0.0`) |
| `feat: …` | minor (`1.4.2` → `1.5.0`) |
| anything else (`fix:`, `docs:`, `chore:`, `ci:`, …) | patch (`1.4.2` → `1.4.3`) |

The workflow then does the following:

1. Runs the checks and unit tests.
2. Commits the new version to `manifest.json` and `package.json` as `chore(release): vX.Y.Z`.
3. Tags that commit.
4. Publishes a release with grouped notes and the extension zip.

To pick the version yourself, run the **Release** workflow by hand with a version. `.github/workflows/ci.yml` runs the checks, unit tests and live end-to-end test on every pull request and push.

## Files

- `manifest.json`: MV3 manifest
- `src/isolate.js`: the storage namespacing patch, for pages and workers
- `src/bridge.js`: tab title label, unread counts and session registration
- `src/sessions.js`: session list helpers shared by the popup, the service worker and the tests
- `background.js`: tab tracking, open/focus, tab groups, badge, and data removal
- `popup.html`, `popup.css`, `popup.js`: the session list
- `tools/`: static checks (`check.mjs`), release zip (`package.mjs`), version bump (`set-version.mjs`), release notes (`release-notes.mjs`), icons
- `.github/`: CI and release workflows, the commit message check, Dependabot

## Use at your own risk

This extension changes how WhatsApp Web stores its data inside your browser, so that several accounts can run at once. It doesn't automate messages, scrape chats, or talk to any server other than WhatsApp's own. WhatsApp's [Terms of Service](https://www.whatsapp.com/legal/terms-of-service) don't allow unofficial or modified clients, however. Using any third-party extension with WhatsApp is at your own risk, and WhatsApp could restrict accounts that use one. The software is provided as is, without warranty; see the [licence](LICENSE).

## Privacy

Everything stays in your browser. The extension has no server, analytics or tracking. Session names and settings are saved in `chrome.storage.local`, and each account's WhatsApp data stays in WhatsApp's own storage on your machine.

## Contributing

Issues and pull requests are welcome. Before you open one:

1. Run `npm run check && npm test`.
2. If you changed `src/isolate.js`, run the end-to-end test too.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) (`feat: …`, `fix: …`, `docs: …`). CI checks this, and releases depend on it. Run `npm run hooks` once to check your messages locally as you commit.

## License

[MIT](LICENSE) © codecaliper
