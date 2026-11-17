// Runs in every youtube.com tab: adds "+ Queue" buttons that talk to the SideStage side panel.
(() => {
  let role = 'browser';
  let strings = null;
  const t = (k) => (strings && strings[k]) || chrome.i18n.getMessage(k) || k;

  function videoIdFrom(href) {
    try {
      const u = new URL(href, location.href);
      if (u.searchParams.get('v')) return u.searchParams.get('v');
      const m = u.pathname.match(/\/(?:shorts|embed|live)\/([\w-]{11})/);
      return m ? m[1] : null;
    } catch { return null; }
  }

  function titleNear(el) {
    const card = el.closest(
      'ytd-video-renderer, ytd-rich-item-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ' +
      'ytd-grid-video-renderer, yt-lockup-view-model, ytd-playlist-panel-video-renderer, ytd-reel-item-renderer',
    );
    if (!card) return '';
    const t = card.querySelector('#video-title, .yt-lockup-metadata-view-model__title, h3, [title]');
    return (t && (t.getAttribute('title') || t.textContent) || '').trim();
  }

  async function send(url, title, btn) {
    const old = btn.textContent;
    let res;
    try { res = await chrome.runtime.sendMessage({ type: 'enqueue', url, title }); } catch { res = null; }
    if (res && res.ok) {
      btn.textContent = t('queuedShort'); btn.classList.add('kdj-done');
    } else {
      btn.textContent = res ? res.error : t('openFirst'); btn.classList.add('kdj-err');
    }
    setTimeout(() => { btn.textContent = old; btn.classList.remove('kdj-done', 'kdj-err'); }, 1800);
  }

  function decorate() {
    if (role === 'player') return;
    document.querySelectorAll('a[href*="watch?v="], a[href*="/shorts/"]').forEach((a) => {
      if (a.dataset.kdj) return;
      if (!a.querySelector('img, yt-image, yt-img-shadow')) return;
      if (a.closest('ytd-macro-markers-list-item-renderer')) return; // chapter links, not videos
      if (!videoIdFrom(a.getAttribute('href'))) return;
      a.dataset.kdj = '1';
      if (getComputedStyle(a).position === 'static') a.style.position = 'relative';
      const b = document.createElement('button');
      b.className = 'kdj-btn';
      b.textContent = t('queueBtn');
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        // YouTube recycles result rows, so read the link at click time, never at decorate time.
        const id = videoIdFrom(a.getAttribute('href'));
        if (!id) return;
        send(`https://www.youtube.com/watch?v=${id}`, titleNear(a), b);
      });
      a.appendChild(b);
    });

    const onWatch = /^\/watch/.test(location.pathname) && new URLSearchParams(location.search).get('v');
    let fab = document.querySelector('.kdj-fab');
    if (onWatch && !fab) {
      fab = document.createElement('button');
      fab.className = 'kdj-fab';
      fab.textContent = t('queueThisSong');
      fab.addEventListener('click', () => send(location.href, document.title, fab));
      document.body.appendChild(fab);
    } else if (!onWatch && fab) {
      fab.remove();
    }
  }

  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; decorate(); }, 250);
  };

  // Hide the buttons while the side panel is closed: there is nothing to queue into.
  const setOpen = (open) => document.documentElement.classList.toggle('kdj-off', !open);
  setOpen(false);
  let presenceRevision = 0;
  const refreshController = () => {
    const revision = ++presenceRevision;
    return chrome.runtime.sendMessage({ type: 'controller' }).then((r) => {
      // An opening/closing notification or newer query takes precedence.
      if (revision === presenceRevision) setOpen(!!(r && r.open));
    }).catch(() => {});
  };
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'controller') return;
    presenceRevision++;
    setOpen(msg.open);
    // The panel may have opened after this tab loaded; the player tab must stay clean.
    if (msg.open) chrome.runtime.sendMessage({ type: 'whoami' }).then((r) => { if (r && r.role) role = r.role; }).catch(() => {});
  });

  const ready = Promise.all([
    refreshController(),
    chrome.runtime.sendMessage({ type: 'whoami' }).then((r) => { if (r && r.role) role = r.role; }).catch(() => {}),
    chrome.runtime.sendMessage({ type: 'i18n' }).then((r) => { if (r) strings = r; }).catch(() => {}),
  ]);
  ready.finally(() => {
    new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('yt-navigate-finish', () => { refreshController(); schedule(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshController();
    });
    schedule();
  });
})();
