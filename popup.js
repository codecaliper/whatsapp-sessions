import { COLORS, SETTINGS_KEY, STORAGE_KEY, cleanSettings } from "./src/sessions.js";

const list = document.querySelector("#sessions");
const empty = document.querySelector("#empty");
const openAll = document.querySelector("#open-all");
const addForm = document.querySelector("#add");
const addName = document.querySelector("#add-name");
const addColors = document.querySelector("#add-colors");
const groupTabs = document.querySelector("#group-tabs");

let editing = null;
let confirmingRemove = null;
let addColor = null;
let state = { sessions: [], tabs: {}, unread: {}, settings: cleanSettings() };

const send = (message) => chrome.runtime.sendMessage(message);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key === "on") Object.entries(value).forEach(([event, handler]) => node.addEventListener(event, handler));
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

function swatches(selected, onPick) {
  return COLORS.map((color) => el("button", {
    type: "button",
    class: "swatch",
    role: "radio",
    title: color,
    "aria-checked": String(color === selected),
    style: `background:${color}`,
    on: { click: () => onPick(color) },
  }));
}

const initials = (name) => name.split(" ").filter(Boolean).slice(0, 2).map((word) => [...word][0]).join("").toUpperCase() || "?";

function renderSession(session, index) {
  const open = Object.values(state.tabs).includes(session.id);
  const unread = open ? state.unread[session.id] || 0 : 0;
  const status = el("p", { class: `status${open ? " live" : ""}` }, open ? "Open" : "Not open",
    unread ? el("span", { class: "unread", title: "Unread chats" }, String(unread)) : null);

  const actions = el("div", { class: "actions" },
    el("button", { type: "button", class: "icon", title: "Move up", disabled: index === 0, on: { click: () => send({ type: "wams-move", id: session.id, offset: -1 }) } }, "↑"),
    el("button", { type: "button", class: "icon", title: "Move down", disabled: index === state.sessions.length - 1, on: { click: () => send({ type: "wams-move", id: session.id, offset: 1 }) } }, "↓"),
    el("button", { type: "button", class: "icon", title: "Edit", "aria-expanded": String(editing === session.id), on: { click: () => { editing = editing === session.id ? null : session.id; confirmingRemove = null; render(); } } }, "✎"),
    el("button", { type: "button", class: "primary", on: { click: () => send({ type: "wams-open", id: session.id }).then(() => window.close()) } }, open ? "Show" : "Open"),
  );

  const item = el("li", { class: "session", "data-id": session.id },
    el("span", { class: "dot", style: `background:${session.color}`, "aria-hidden": "true" }, initials(session.name)),
    el("div", { class: "info" }, el("p", { class: "name", title: session.name }, session.name), status),
    actions,
  );

  if (editing === session.id) item.append(renderEditor(session));
  return item;
}

function renderEditor(session) {
  const name = el("input", { type: "text", value: session.name, maxLength: 32, "aria-label": "Session name" });
  let color = session.color;
  const colors = el("div", { class: "swatches", role: "radiogroup", "aria-label": "Colour" });
  const paint = () => colors.replaceChildren(...swatches(color, (picked) => { color = picked; paint(); }));
  paint();

  const save = async () => {
    await send({ type: "wams-update", id: session.id, name: name.value, color });
    editing = null;
    render();
  };
  name.addEventListener("keydown", (event) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") { editing = null; render(); }
  });

  const removing = confirmingRemove === session.id;
  const remove = el("button", {
    type: "button",
    class: "danger",
    on: {
      click: async (event) => {
        if (!removing) { confirmingRemove = session.id; render(); return; }
        event.currentTarget.disabled = true;
        event.currentTarget.textContent = "Removing…";
        await send({ type: "wams-remove", id: session.id });
        editing = null;
        confirmingRemove = null;
      },
    },
  }, removing ? "Really remove? Logs out & deletes its data" : "Remove");

  queueMicrotask(() => name.focus());
  return el("div", { class: "editor" }, name, colors,
    el("div", { class: "row" }, remove, el("button", { type: "button", class: "primary", on: { click: save } }, "Save")));
}

function render() {
  list.replaceChildren(...state.sessions.map(renderSession));
  empty.hidden = state.sessions.length > 0;
  openAll.hidden = state.sessions.length < 2;
  addColor ??= COLORS[state.sessions.length % COLORS.length];
  addColors.replaceChildren(...swatches(addColor, (picked) => { addColor = picked; render(); }));
  groupTabs.checked = state.settings.groupTabs;
}

async function load() {
  const [local, live] = await Promise.all([chrome.storage.local.get([STORAGE_KEY, SETTINGS_KEY]), chrome.storage.session.get(["tabs", "unread"])]);
  state = {
    sessions: local[STORAGE_KEY] || [],
    tabs: live.tabs || {},
    unread: live.unread || {},
    settings: cleanSettings(local[SETTINGS_KEY]),
  };
  render();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "local" && (changes[STORAGE_KEY] || changes[SETTINGS_KEY])) || (area === "session" && (changes.tabs || changes.unread))) load();
});

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await send({ type: "wams-add", name: addName.value, color: addColor });
  addName.value = "";
  addColor = null;
});

groupTabs.addEventListener("change", async () => {
  groupTabs.disabled = true;
  await send({ type: "wams-settings", settings: { groupTabs: groupTabs.checked } });
  groupTabs.disabled = false;
});

openAll.addEventListener("click", async () => {
  for (const session of state.sessions) await send({ type: "wams-open", id: session.id });
  window.close();
});

load();
