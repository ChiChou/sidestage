// The DJ's title (centered) and the next song (small, top-right) drawn over a YouTube bridge on the big screen;
// over a YouTube song only the next song is sent.
// This function is serialized and run inside the YouTube page via chrome.scripting.executeScript,
// so it must be self-contained: no imports, no references to anything outside its body.
// It is a banner layered over the page: it never hides or restyles YouTube's own player or controls,
// ignores pointer events, and sits below YouTube's dialogs.

export type OverlayData = {
  next: { singer: string; title: string }[]   // the next song, or empty
  deadline: number | null   // epoch ms when auto-continue fires, or null
  bridgeTitle: string
  upNextLabel: string      // translated "Up next"
  message: string          // the DJ's title for the screen ("Title on the big screen"), '' for none
}

export function bridgeOverlay(data: OverlayData) {
  const w = window as any
  if (w.__kdjTimer) { clearInterval(w.__kdjTimer); w.__kdjTimer = null }
  let root = document.getElementById('kdj-bridge')
  if (!root) {
    root = document.createElement('div')
    root.id = 'kdj-bridge'
    const style = document.createElement('style')
    style.textContent = `
      #kdj-bridge { position: fixed; inset: 0; z-index: 2150; display: grid; place-items: center;
        font-family: "Avenir Next", "Helvetica Neue", system-ui, sans-serif; color: #fff4e3; pointer-events: none; }
      #kdj-bridge.dim { background: radial-gradient(60% 60% at 50% 40%, rgba(0,0,0,.25), rgba(0,0,0,.6)); }
      @keyframes kdj-in { from { opacity: 0; transform: translateY(2vmin); } }
      #kdj-bridge .next { position: fixed; top: 4vmin; right: 4vmin; max-width: 40vw; text-align: right; font-size: 2.2vmin; line-height: 1.6;
        text-shadow: 0 .3vmin 2vmin rgba(0,0,0,.6); }
      #kdj-bridge .next .label { font: 600 1.6vmin/1.6 "DM Mono", Menlo, monospace; letter-spacing: .3em; text-transform: uppercase; opacity: .6; }
      #kdj-bridge .next div { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #kdj-bridge .next i { font-style: normal; color: #fcd34d; margin-right: .5em; }
      #kdj-bridge .ring { position: fixed; right: 4vmin; bottom: 4vmin; width: 12vmin; height: 12vmin; display: grid; place-items: center;
        font: 700 4vmin/1 "DM Mono", Menlo, monospace; }
      #kdj-bridge .ring svg { position: absolute; inset: 0; transform: rotate(-90deg); }
      #kdj-bridge .ring circle { fill: none; stroke-width: 6; }
      #kdj-bridge .bridge { position: fixed; left: 4vmin; bottom: 4vmin; font: 500 2vmin/1.4 "DM Mono", Menlo, monospace; opacity: .5; max-width: 50vw;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      #kdj-bridge .msg { max-width: 70vw; padding: .5em 1.4em; animation: kdj-in .6s ease both;
        border-radius: 999px; background: linear-gradient(90deg, #ffb347, #ff3d7f); color: #1d0912; font-size: 4vmin; font-weight: 800;
        line-height: 1.3; text-align: center; white-space: pre-wrap; text-wrap: balance; box-shadow: 0 1vmin 4vmin rgba(0,0,0,.4); }
    `
    root.appendChild(style)
    document.documentElement.appendChild(root)
  }
  // Nothing to show: no dimming, let the mix play.
  root.classList.toggle('dim', !!data.message)
  root.style.display = !data.next.length && !data.message ? 'none' : ''
  // YouTube enforces Trusted Types, so no innerHTML: build nodes by hand.
  const el = (tag: string, cls?: string, text?: string) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    return e
  }
  const styleEl = root.querySelector('style')
  while (root.lastChild && root.lastChild !== styleEl) root.removeChild(root.lastChild)
  if (data.message) root.append(el('div', 'msg', data.message))
  if (data.next.length) {
    const list = el('div', 'next')
    list.append(el('div', 'label', data.upNextLabel))
    data.next.forEach((s) => {
      const row = el('div')
      if (s.singer) row.append(el('i', undefined, s.singer))
      row.append(document.createTextNode(s.title))
      list.append(row)
    })
    root.append(list)
  }
  if (data.bridgeTitle) root.append(el('div', 'bridge', '♪ ' + data.bridgeTitle))
  if (data.deadline) {
    const ring = el('div', 'ring')
    const NS = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(NS, 'svg')
    svg.setAttribute('viewBox', '0 0 100 100')
    const mk = (stroke: string, id?: string) => {
      const c = document.createElementNS(NS, 'circle')
      c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', '46'); c.setAttribute('stroke', stroke)
      if (id) { c.id = id; c.setAttribute('stroke-linecap', 'round'); c.setAttribute('stroke-dasharray', '289'); c.setAttribute('stroke-dashoffset', '0') }
      return c
    }
    svg.append(mk('rgba(255,255,255,.15)'), mk('#ff3d7f', 'kdj-arc'))
    const count = el('span'); count.id = 'kdj-count'
    ring.append(svg, count)
    root.append(ring)
    const total = Math.max(1, data.deadline - Date.now())
    const tick = () => {
      const left = Math.max(0, data.deadline! - Date.now())
      const c = document.getElementById('kdj-count'), a = document.getElementById('kdj-arc')
      if (c) c.textContent = String(Math.ceil(left / 1000))
      if (a) a.setAttribute('stroke-dashoffset', String(289 * (1 - left / total)))
      if (left <= 0 && w.__kdjTimer) { clearInterval(w.__kdjTimer); w.__kdjTimer = null }
    }
    tick()
    w.__kdjTimer = setInterval(tick, 200)
  }
}
