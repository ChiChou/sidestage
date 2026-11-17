// Translate the idle screen with the strings the background resolves (DJ's choice, else browser language),
// then keep the title in sync with the DJ's "Title on the big screen" setting (falls back to "Karaoke Night").
let fallback = document.querySelector('h1').textContent;
chrome.runtime.sendMessage({ type: 'i18n' }).then((s) => {
  if (!s) return;
  document.querySelectorAll('[data-i18n]').forEach((el) => { if (s[el.dataset.i18n]) el.textContent = s[el.dataset.i18n]; });
  fallback = document.querySelector('h1').textContent;
}).catch(() => {});

async function syncTitle() {
  let custom = '';
  try { custom = ((await chrome.runtime.sendMessage({ type: 'getState' }))?.bridgeSettings?.message || '').trim(); } catch {}
  const h1 = document.querySelector('h1');
  const text = custom || fallback;
  if (h1.textContent !== text) h1.textContent = text;
}
syncTitle();
setInterval(syncTitle, 1000);
