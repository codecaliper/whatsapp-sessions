// Isolated-world helper for WhatsApp tabs. Tells the service worker which session the tab
// belongs to, labels the tab title with the session name and reports unread counts.
// Content scripts can't be modules, so the title helpers are small copies of src/sessions.js.
(() => {
  const SESSION_KEY = "__wamsSession";
  const fromHash = /(?:^#|&)wams=([a-z0-9]{1,24})(?:&|$)/.exec(location.hash);
  const id = fromHash?.[1] || sessionStorage.getItem(SESSION_KEY);
  if (!id) return;

  let label = "";
  let lastUnread = -1;

  const report = () => {
    const unread = Number(/^\((\d+)\)/.exec(document.title.slice(label.length))?.[1] || 0);
    if (unread === lastUnread) return;
    lastUnread = unread;
    chrome.runtime.sendMessage({ type: "wams-unread", id, unread }).catch(() => {});
  };

  const relabel = () => {
    if (label && !document.title.startsWith(label)) document.title = label + (document.title || "WhatsApp");
    report();
  };

  chrome.runtime.sendMessage({ type: "wams-hello", id }).then((reply) => {
    if (reply?.unknown) {
      // The session was removed: turn this tab back into plain WhatsApp.
      sessionStorage.removeItem(SESSION_KEY);
      location.replace("https://web.whatsapp.com/");
      return;
    }
    if (!reply?.session) return;
    label = `${reply.session.name} · `;
    // Watch only <head> and <title>: WhatsApp's chat DOM changes constantly.
    const observer = new MutationObserver(() => { watch(); relabel(); });
    const watch = () => {
      observer.observe(document.head || document.documentElement, { childList: true });
      const title = document.querySelector("title");
      if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    };
    watch();
    relabel();
  }).catch(() => {});

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== "wams-renamed" || message.id !== id) return;
    const old = label;
    label = `${message.name} · `;
    if (old && document.title.startsWith(old)) document.title = document.title.slice(old.length);
    relabel();
  });
})();
