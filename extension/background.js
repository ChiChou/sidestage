// The toolbar button opens and closes the side panel.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.commands.onCommand.addListener((cmd) => {
  chrome.runtime.sendMessage({ type: 'cmd', cmd }).catch(() => {});
});

// Strings for the content script and idle page. The language is the DJ's explicit choice
// (storage `lang`), else the browser UI language, mapped the same way the dashboard does it.
const LOCALES = ['en', 'zh_CN', 'it', 'es'];
function resolveLocale(pref, ui) {
  if (pref && LOCALES.includes(pref)) return pref;
  const u = (ui || '').toLowerCase();
  if (u.startsWith('zh')) return 'zh_CN';
  if (u.startsWith('it')) return 'it';
  if (u.startsWith('es')) return 'es';
  return 'en';
}
let cache = {};
async function strings() {
  const { lang } = await chrome.storage.local.get('lang');
  const loc = resolveLocale(lang, chrome.i18n.getUILanguage());
  if (!cache[loc]) {
    const json = await (await fetch(chrome.runtime.getURL(`_locales/${loc}/messages.json`))).json();
    cache[loc] = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, v.message]));
  }
  return cache[loc];
}
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'controller') {
    controllerOpen().then((open) => sendResponse({ open }));
    return true;
  }
  if (msg?.type !== 'i18n') return;
  strings().then(sendResponse).catch(() => sendResponse(null));
  return true;
});

// Controller ports announce panel opening and closing; queries also check
// Chrome's live panel contexts so worker restarts do not lose panel presence.
const controllers = new Set();
// A worker can restart while the side panel stays open. Ports in this worker's
// memory are not an authoritative inventory of those already-running pages.
async function controllerOpen() {
  if (chrome.runtime.getContexts) {
    try {
      const contexts = await chrome.runtime.getContexts({
        contextTypes: ['SIDE_PANEL'],
        documentUrls: [chrome.runtime.getURL('panel.html')],
      });
      return contexts.length > 0;
    } catch { /* Older Chrome versions fall back to connected controller ports. */ }
  }
  return controllers.size > 0;
}
async function broadcastController() {
  const open = await controllerOpen();
  const tabs = await chrome.tabs.query({ url: '*://www.youtube.com/*' }).catch(() => []);
  for (const tab of tabs) chrome.tabs.sendMessage(tab.id, { type: 'controller', open }).catch(() => {});
}
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'controller') return;
  controllers.add(port);
  port.onDisconnect.addListener(() => { controllers.delete(port); broadcastController(); });
  broadcastController();
});
