// SideStage controller: owns the queue, the bridges, the big-screen player window and the force-mute rule.
// Pure chrome.* logic, no React. The UI subscribes via useSyncExternalStore.
//
// Queue model: `sung` (already played), `current` (song on the big screen now), `upcoming` (sortable).
// Bridges: background mixes played between songs. While one plays, `bridge` is set and `current` is null.
// Local files (songs or bridges) live in IndexedDB and play on media.html, which reports `filePos` and takes `fileCmd`.

import { withMediaLock } from './ownership'
import { bridgeOverlay, type OverlayData } from './overlay'
import { t as tr } from './i18n'
import { putFile, deleteFile, listFileKeys } from './idb'

// A song is a YouTube video (id = video id) or a local file (kind 'file', id = IndexedDB key).
export type QueueItem = { id: string; title: string; singer?: string; kind?: 'file'; media?: 'audio' | 'video' }
// A bridge is a YouTube video or a local file: audio (the default) or a still image shown silently.
export type BridgeItem = { key: string; kind: 'yt' | 'file'; ytId?: string; title: string; pos: number; media?: 'audio' | 'image' }
export type BridgeSettings = { enabled: boolean; volume: number; autoContinue: number; message: string }
export type Status = { state: number; t: number; d: number; volume: number }
export type DisplayInfo = { id: string; name: string; isPrimary: boolean; width: number; height: number }
export type Phase = 'idle' | 'song' | 'bridge'
export type Snapshot = {
  sung: QueueItem[]
  current: QueueItem | null
  upcoming: QueueItem[]
  bridges: BridgeItem[]
  bridge: BridgeItem | null
  phase: Phase
  bridgeSettings: BridgeSettings
  autoDeadline: number | null
  status: Status
  displays: DisplayInfo[]
  activeDisplayId: string | null
  playerOpen: boolean
  fullscreen: boolean
}

const IDLE_URL = chrome.runtime.getURL('idle.html')
const MEDIA_URL = chrome.runtime.getURL('media.html')

const state = {
  sung: [] as QueueItem[],
  current: null as QueueItem | null,
  upcoming: [] as QueueItem[],
  bridges: [] as BridgeItem[],
  bridge: null as BridgeItem | null,
  bridgeIndex: 0,
}
const settings = {
  displayId: null as string | null,
  fullscreen: true,
  volume: 100,             // song volume; bridges have their own bed volume below
  bridge: { enabled: false, volume: 35, autoContinue: 0, message: '' } as BridgeSettings,
}
let playerWindowId: number | null = null
let playerTabId: number | null = null
let advanceLock = false
let status: Status = { state: -1, t: 0, d: 0, volume: 100 }
let displays: DisplayInfo[] = []
let activeDisplayId: string | null = null
let autoTimer: ReturnType<typeof setTimeout> | null = null
let autoDeadline: number | null = null
let loadSeq = 0          // bumps on every player navigation
let readySeq = -1        // loadSeq for which onPlayerReady already ran
let controllerReady = false

let snap: Snapshot = build()
const listeners = new Set<() => void>()
let toastFn: (msg: string) => void = () => {}

function phase(): Phase { return state.current ? 'song' : state.bridge ? 'bridge' : 'idle' }

function build(): Snapshot {
  return {
    sung: state.sung.slice(),
    current: state.current,
    upcoming: state.upcoming.slice(),
    bridges: state.bridges.slice(),
    bridge: state.bridge,
    phase: phase(),
    bridgeSettings: { ...settings.bridge },
    autoDeadline,
    status: { ...status, volume: state.bridge ? settings.bridge.volume : settings.volume },
    displays,
    activeDisplayId,
    playerOpen: playerTabId != null,
    fullscreen: settings.fullscreen,
  }
}
function emit() {
  snap = build()
  listeners.forEach((l) => l())
  refreshOverlay()
}
export const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const getSnapshot = () => snap
export const setToastHandler = (fn: (msg: string) => void) => { toastFn = fn }
// Asked before queueing a video that is already playing or waiting. The panel shows a prompt
// with an "add anyway" action; without a UI (tests, no panel) the song is simply added.
let duplicateFn: (title: string, addAnyway: () => void) => void = (_title, addAnyway) => addAnyway()
export const setDuplicateHandler = (fn: typeof duplicateFn) => { duplicateFn = fn }

// ---------- utils ----------
export function parseVideoId(input: string | undefined | null): string | null {
  if (!input) return null
  const s = String(input).trim()
  if (/^[\w-]{11}$/.test(s)) return s
  let u: URL
  try { u = new URL(s) } catch { return null }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, '')
  if (host === 'youtu.be') return u.pathname.slice(1, 12) || null
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const v = u.searchParams.get('v')
    if (v) return v.slice(0, 11)
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{11})/)
    if (m) return m[1]
  }
  return null
}
const isYouTube = (url?: string) => /^https?:\/\/([\w-]+\.)?youtube\.com\//.test(url || '')
const cleanTitle = (t?: string) => (t || '').replace(/\s*-\s*YouTube$/i, '').trim()
export const label = (it: QueueItem) => (it.singer ? `${it.singer} — ${it.title}` : it.title)

async function fetchTitle(id: string): Promise<string | null> {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`)
    if (r.ok) { const t = (await r.json()).title; if (t) return t }
  } catch { /* fall through */ }
  // oEmbed refuses some videos (embedding off, age/region gates); read the watch page instead.
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}`, { credentials: 'include' })
    if (!r.ok) return null
    const html = await r.text()
    const m = html.match(/<meta name="title" content="([^"]*)"/) || html.match(/<title>([^<]*)<\/title>/)
    if (!m) return null
    const el = document.createElement('textarea')
    el.innerHTML = m[1]
    return cleanTitle(el.value) || null
  } catch { return null }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function save() {
  chrome.storage.local.set({
    sung: state.sung, current: state.current, upcoming: state.upcoming,
    bridges: state.bridges, bridgeIndex: state.bridgeIndex, settings,
  })
  chrome.storage.session.set({ playerWindowId, playerTabId, activeBridge: state.bridge })
}
// for the once-a-second bridge position updates
function saveSoon() {
  if (saveTimer) return
  saveTimer = setTimeout(() => { saveTimer = null; save() }, 3000)
}

// ---------- displays ----------
type ChromeDisplay = Awaited<ReturnType<typeof chrome.system.display.getInfo>>[number]

async function refreshDisplays() {
  try {
    const list = await chrome.system.display.getInfo()
    displays = list.map((d) => ({
      id: d.id, name: d.name || (d.isInternal ? 'Built-in display' : `Display ${d.id}`),
      isPrimary: d.isPrimary, width: d.bounds.width, height: d.bounds.height,
    }))
  } catch { displays = [] }
  const d = playerTabId != null ? await pickDisplay() : null
  activeDisplayId = d ? d.id : null
  emit()
}

async function pickDisplay(): Promise<ChromeDisplay | null> {
  let list: ChromeDisplay[] = []
  try { list = await chrome.system.display.getInfo() } catch { return null }
  if (settings.displayId != null) {
    const d = list.find((x) => x.id === settings.displayId)
    if (d) return d
  }
  return list.find((d) => !d.isPrimary) || null
}

// ---------- player window ----------
async function playerAlive() {
  if (playerTabId == null) return false
  try { await chrome.tabs.get(playerTabId); return true } catch {
    playerTabId = null; playerWindowId = null; return false
  }
}

async function ensurePlayer() {
  if (await playerAlive()) return
  const d = await pickDisplay()
  const b = d ? d.bounds : null
  const win = await chrome.windows.create({
    url: IDLE_URL, type: 'popup', focused: false,
    ...(b ? { left: b.left, top: b.top, width: b.width, height: b.height } : { width: 960, height: 540 }),
  })
  if (!win) return
  playerWindowId = win.id ?? null
  playerTabId = win.tabs?.[0]?.id ?? null
  if (b && win.id != null) {
    // macOS ignores the bounds passed to windows.create; moving the window afterwards works,
    // and fullscreen must come after the move or it lands on the primary display.
    try { await chrome.windows.update(win.id, { left: b.left, top: b.top, width: b.width, height: b.height }) } catch { /* ignore */ }
    if (settings.fullscreen) {
      await new Promise((r) => setTimeout(r, 300))
      try { await chrome.windows.update(win.id, { state: 'fullscreen' }) } catch { /* ignore */ }
    }
  }
  if (playerTabId != null) chrome.tabs.update(playerTabId, { muted: false }).catch(() => {})
  save()
  refreshDisplays()
}

export async function recreatePlayer() {
  if (playerWindowId != null) { try { await chrome.windows.remove(playerWindowId) } catch { /* ignore */ } }
  playerWindowId = null; playerTabId = null
  await loadPlayer()
}

function playerUrl(): string {
  const c = state.current
  if (c) return c.kind === 'file' ? `${MEDIA_URL}?key=${encodeURIComponent(c.id)}` : `https://www.youtube.com/watch?v=${c.id}`
  const b = state.bridge
  if (b) {
    if (b.kind === 'yt') return `https://www.youtube.com/watch?v=${b.ytId}&t=${Math.floor(b.pos)}s`
    return `${MEDIA_URL}?mode=bridge&key=${encodeURIComponent(b.key)}&pos=${Math.floor(b.pos)}`
  }
  return IDLE_URL
}

async function loadPlayer() {
  await ensurePlayer()
  loadSeq++
  overlaySent = ''
  advanceLock = true
  status = { ...status, state: -1, t: 0, d: 0 }
  emit()
  try {
    if (playerTabId == null) throw new Error('no player')
    await chrome.tabs.update(playerTabId, { url: playerUrl(), muted: false })
  } catch { advanceLock = false }
  if (phase() === 'idle') advanceLock = false
  save()
}

// ---------- transitions ----------
function clearAuto() {
  if (autoTimer) { clearTimeout(autoTimer); autoTimer = null }
  autoDeadline = null
}

// Put the finished song away and start `item` (or go idle).
function start(item: QueueItem | null) {
  clearAuto()
  if (state.current) state.sung.push(state.current)
  state.current = item
  state.bridge = null
  gcFiles()
  return loadPlayer()
}

// Raw "start the next queued song" (bypasses bridges).
export function next(force = false) {
  if (force) advanceLock = false
  if (advanceLock) return
  return start(state.upcoming.shift() ?? null)
}

// A song finished (or the DJ hit Next): bridge if enabled, otherwise straight to the next song.
export function endSong(force = false) {
  if (force) advanceLock = false
  if (advanceLock) return
  if (settings.bridge.enabled && state.bridges.length) return startBridge()
  return next()
}

// Cut to a bridge: the one at `i`, or the next in rotation.
export function startBridge(i?: number) {
  if (!state.bridges.length) return next(true)
  clearAuto()
  advanceLock = false
  const idx = i != null ? i : state.bridgeIndex % state.bridges.length
  state.bridgeIndex = (idx + 1) % state.bridges.length
  if (state.current) state.sung.push(state.current)
  state.current = null
  state.bridge = state.bridges[idx]
  gcFiles()
  if (settings.bridge.autoContinue > 0 && state.upcoming.length) {
    autoDeadline = Date.now() + settings.bridge.autoContinue * 1000
    autoTimer = setTimeout(() => { autoTimer = null; startSong() }, settings.bridge.autoContinue * 1000)
  }
  return loadPlayer()
}

// Leave the bridge and start the next queued song.
export function startSong() { return next(true) }
export const getNextBridgeIndex = () => state.bridgeIndex

// The big button: whatever makes sense right now.
export function primary() {
  if (state.current) return endSong(true)
  if (state.bridge) return startSong()
  if (state.upcoming.length) return next(true)
  if (settings.bridge.enabled && state.bridges.length) return startBridge()
}

export function prev() {
  advanceLock = false
  if (state.sung.length) {
    clearAuto()
    if (state.current) state.upcoming.unshift(state.current)
    state.current = state.sung.pop()!
    state.bridge = null
    gcFiles()
    return loadPlayer()
  }
  return seek(0)
}

// Jump to an upcoming song now; the ones skipped over stay upcoming.
export function playUpcoming(i: number) {
  if (i < 0 || i >= state.upcoming.length) return
  advanceLock = false
  const [it] = state.upcoming.splice(i, 1)
  return start(it)
}
export function playNextUp(i: number) { moveUpcoming(i, 0) }

// ---------- driving the player tab ----------
async function playerExec<T, A extends unknown[]>(func: (...args: A) => T, args?: A): Promise<T | null> {
  if (!(await playerAlive())) return null
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: playerTabId! }, world: 'MAIN', injectImmediately: true,
      func: func as (...a: unknown[]) => unknown, args: args as unknown[],
    })
    return (r?.result as T) ?? null
  } catch { return null }
}

// media.html (local file song or bridge) is driven by messages instead of injected script.
const fileCmd = (cmd: string, v?: number) => chrome.runtime.sendMessage({ type: 'fileCmd', cmd, v }).catch(() => {})
const onFileBridge = () => state.bridge?.kind === 'file'
const onFilePlayer = () => onFileBridge() || state.current?.kind === 'file'

export async function togglePlay() {
  if (phase() === 'idle') return primary()
  if (onFilePlayer()) return fileCmd(status.state === 1 ? 'pause' : 'play')
  const s = await playerExec(() => { const p = document.getElementById('movie_player') as any; return p?.getPlayerState ? p.getPlayerState() : -1 })
  if (s === 1 || s === 3) playerExec(() => (document.getElementById('movie_player') as any).pauseVideo())
  else playerExec(() => (document.getElementById('movie_player') as any).playVideo())
}
export const seek = (sec: number) => {
  if (onFilePlayer()) return fileCmd('seek', sec)
  return playerExec((s: number) => (document.getElementById('movie_player') as any).seekTo(s, true), [sec])
}
export const setVolume = (v: number) => {
  if (state.bridge) settings.bridge.volume = v; else settings.volume = v
  emit(); saveSoon()
  if (onFilePlayer()) return fileCmd('volume', v)
  return playerExec((x: number) => (document.getElementById('movie_player') as any).setVolume(x), [v])
}

// Size YouTube's player to the big-screen window (player.css); it leaves ads, controls and dialogs alone.
function fitPlayer(tabId: number) {
  chrome.scripting.insertCSS({ target: { tabId }, files: ['player.css'] }).catch(() => {})
}

// The next song (top-right) and the DJ's title drawn over a YouTube bridge; over a YouTube song only
// the next song. Redrawn (debounced) from emit(), but only when what it shows has changed, so the
// 500ms status poll never makes it flicker.
const onYouTubePage = () => phase() === 'bridge' ? state.bridge?.kind === 'yt' : phase() === 'song' && state.current?.kind !== 'file'
function overlayData(): OverlayData {
  const song = phase() === 'song'
  return {
    next: state.upcoming.slice(0, 1).map((it) => ({ singer: it.singer || '', title: it.title })),
    deadline: song ? null : autoDeadline,
    bridgeTitle: song ? '' : state.bridge?.title || '',
    upNextLabel: tr('upNext'),
    message: song ? '' : settings.bridge.message.trim(),
  }
}
let overlayTimer: ReturnType<typeof setTimeout> | null = null
let overlaySent = ''   // JSON of the data last drawn on the current page
function drawOverlay() {
  const data = overlayData()
  const key = JSON.stringify(data)
  if (key === overlaySent) return
  overlaySent = key
  playerExec(bridgeOverlay, [data])
}
function refreshOverlay() {
  if (!controllerReady || !onYouTubePage() || playerTabId == null) return
  if (overlayTimer) return
  overlayTimer = setTimeout(() => { overlayTimer = null; drawOverlay() }, 150)
}

// Runs once per navigation, as soon as the YouTube player object exists (the page's own
// 'complete' event can take ages because YouTube keeps requests open).
function onPlayerReady(tab?: chrome.tabs.Tab) {
  if (readySeq === loadSeq) return
  readySeq = loadSeq
  advanceLock = false
  if (playerTabId != null) fitPlayer(playerTabId)
  if (onYouTubePage()) { overlaySent = ''; drawOverlay() }
  const cur = state.current
  if (cur && cur.title === cur.id && tab?.title && parseVideoId(tab.url) === cur.id) {
    cur.title = cleanTitle(tab.title) || cur.id
    emit(); save()
  }
  const vol = state.bridge ? settings.bridge.volume : settings.volume
  playerExec((v: number) => {
    const b = document.querySelector('.ytp-autonav-toggle-button')
    if (b && b.getAttribute('aria-checked') === 'true') (b as HTMLElement).click()
    const p = document.getElementById('movie_player') as any
    if (p?.setVolume) p.setVolume(v)
    if (p?.playVideo) p.playVideo()
  }, [vol])
}

// Poll the YouTube player on the big-screen tab (YouTube songs and bridges; local files report themselves).
setInterval(async () => {
  if (!controllerReady) return
  if (playerTabId == null || phase() === 'idle' || onFilePlayer()) return
  const r = await playerExec(() => {
    const p = document.getElementById('movie_player') as any
    if (!p || !p.getPlayerState) return null
    return { state: p.getPlayerState(), t: p.getCurrentTime(), d: p.getDuration(), volume: p.getVolume() }
  })
  if (!r) return
  if (readySeq !== loadSeq) {
    const tab = await chrome.tabs.get(playerTabId).catch(() => undefined)
    if (tab && isYouTube(tab.url)) onPlayerReady(tab)
  }
  status = r
  if (state.bridge && r.t > 0) { state.bridge.pos = r.t; saveSoon() }
  emit()
  if (r.state === 0 && !advanceLock) {
    const tab = await chrome.tabs.get(playerTabId).catch(() => null)
    const id = parseVideoId(tab?.url)
    if (state.current && id === state.current.id) endSong()
    else if (state.bridge && id === state.bridge.ytId) { state.bridge.pos = 0; startBridge() }
  }
}, 500)

// Tab events: size the player tab, guard against YouTube autoplay and force-mute other YouTube tabs.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (!controllerReady) return
  if (tabId === playerTabId) {
    if (!isYouTube(tab.url)) { if (info.status === 'complete') advanceLock = false; return }
    if (info.status === 'loading' || info.status === 'complete') fitPlayer(tabId)
    if (info.status === 'complete') onPlayerReady(tab)
    if (info.url && !advanceLock) {
      const id = parseVideoId(info.url)
      if (state.current && id && id !== state.current.id) endSong()
      else if (state.bridge?.kind === 'yt' && id && id !== state.bridge.ytId) { state.bridge.pos = 0; startBridge() }
    }
    if (info.mutedInfo?.muted) chrome.tabs.update(tabId, { muted: false }).catch(() => {})
    return
  }
  if (isYouTube(tab.url) && !tab.mutedInfo?.muted) chrome.tabs.update(tabId, { muted: true }).catch(() => {})
})

async function muteAllYouTubeTabs() {
  const tabs = await chrome.tabs.query({ url: '*://*.youtube.com/*' })
  for (const t of tabs) {
    if (t.id != null && t.id !== playerTabId && !t.mutedInfo?.muted) chrome.tabs.update(t.id, { muted: true }).catch(() => {})
  }
}

// The big-screen window went away (closed by hand or by the OS): forget it and show the transport as stopped.
chrome.windows.onRemoved.addListener((id) => {
  if (id !== playerWindowId) return
  playerWindowId = null; playerTabId = null
  advanceLock = false
  status = { ...status, state: -1, t: 0, d: 0 }
  save(); refreshDisplays()
})

// ---------- queue ops ----------
export type EnqueueResult = { ok: true; item: QueueItem } | { ok: false; error: string; duplicate?: true }
export function findQueued(id: string): QueueItem | undefined {
  return state.current?.id === id ? state.current : state.upcoming.find((it) => it.id === id)
}
export async function enqueue(input: string, titleHint?: string, opts?: { force?: boolean }): Promise<EnqueueResult> {
  const id = parseVideoId(input)
  if (!id) return { ok: false, error: tr('notYouTube') }
  const dup = opts?.force ? undefined : findQueued(id)
  if (dup) {
    duplicateFn(dup.title, () => { enqueue(input, titleHint, { force: true }) })
    return { ok: false, error: tr('alreadyQueued'), duplicate: true }
  }
  const item: QueueItem = { id, title: cleanTitle(titleHint) || id }
  state.upcoming.push(item)
  emit(); save()
  if (phase() === 'idle') next(true)
  const t = await fetchTitle(id)
  if (t) { item.title = t; emit(); save() }
  toastFn(tr('queuedX', item.title))
  return { ok: true, item }
}

// Store picked files and return queue/bridge-ready descriptors.
async function storeFiles(files: FileList | File[]) {
  const out: { key: string; title: string; media: 'audio' | 'video' | 'image' }[] = []
  try {
    for (const f of Array.from(files)) {
      const key = crypto.randomUUID()
      await putFile(key, f)
      out.push({ key, title: f.name.replace(/\.[^.]+$/, ''), media: f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : 'audio' })
    }
    return out
  } catch (error) {
    await Promise.allSettled(out.map((f) => deleteFile(f.key)))
    throw error
  }
}

// Imports hold the same lock until their queue references have been published.
// Recompute references after acquisition, not when the cleanup was scheduled.
function gcFiles() {
  return withMediaLock(async () => {
    const keys = await listFileKeys()
    const used = new Set<string>()
    for (const it of [...state.sung, ...state.upcoming, ...(state.current ? [state.current] : [])]) if (it.kind === 'file') used.add(it.id)
    for (const b of state.bridges) if (b.kind === 'file') used.add(b.key)
    if (state.bridge?.kind === 'file') used.add(state.bridge.key)
    await Promise.all(keys.filter((k) => !used.has(k)).map(deleteFile))
  }).catch(() => toastFn(tr('fileCleanupFailed')))
}

// Queue local audio/video files as songs.
export async function enqueueFiles(files: FileList | File[]) {
  try {
    await withMediaLock(async () => {
      const stored = await storeFiles(files)
      if (!stored.length) return
      for (const f of stored) state.upcoming.push({ id: f.key, title: f.title, kind: 'file', media: f.media === 'video' ? 'video' : 'audio' })
      emit(); save()
      if (phase() === 'idle') next(true)
      toastFn(stored.length === 1 ? tr('queuedX', stored[0].title) : tr('filesQueued', stored.length))
    })
  } catch { toastFn(tr('fileImportFailed')) }
}

export function removeUpcoming(i: number) {
  if (i < 0 || i >= state.upcoming.length) return
  state.upcoming.splice(i, 1)
  emit(); save(); gcFiles()
}
export function moveUpcoming(from: number, to: number) {
  const n = state.upcoming.length
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return
  const [it] = state.upcoming.splice(from, 1)
  state.upcoming.splice(to, 0, it)
  emit(); save()
}
export function setSinger(i: number, name: string) {
  const it = state.upcoming[i]
  if (!it) return
  const v = name.trim()
  if (v) it.singer = v; else delete it.singer
  emit(); save()
}
// Put a sung song back at the end of upcoming.
export function requeue(i: number) {
  if (i < 0 || i >= state.sung.length) return
  const [it] = state.sung.splice(i, 1)
  state.upcoming.push(it)
  emit(); save()
  if (phase() === 'idle') next(true)
}
export function clearUpcoming() { state.upcoming = []; emit(); save(); gcFiles() }
export function removeSung(i: number) {
  if (i < 0 || i >= state.sung.length) return
  state.sung.splice(i, 1)
  emit(); save(); gcFiles()
}
export function clearSung() { state.sung = []; emit(); save(); gcFiles() }

export async function enqueueActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return { ok: false as const, error: tr('noActiveTab') }
  return enqueue(tab.url, tab.title)
}
export const openYouTube = () => chrome.tabs.create({ url: 'https://www.youtube.com/' })

// ---------- bridges ----------
export async function addBridge(input: string, titleHint?: string): Promise<{ ok: boolean; error?: string }> {
  const ytId = parseVideoId(input)
  if (!ytId) return { ok: false, error: tr('notYouTube') }
  const item: BridgeItem = { key: crypto.randomUUID(), kind: 'yt', ytId, title: cleanTitle(titleHint) || ytId, pos: 0 }
  state.bridges.push(item)
  emit(); save()
  const t = await fetchTitle(ytId)
  if (t) { item.title = t; emit(); save() }
  toastFn(tr('bridgeAddedX', item.title))
  return { ok: true }
}
export async function addBridgeFiles(files: FileList | File[]) {
  try {
    await withMediaLock(async () => {
      const stored = await storeFiles(files)
      for (const f of stored) state.bridges.push({ key: f.key, kind: 'file', title: f.title, pos: 0, media: f.media === 'image' ? 'image' : 'audio' })
      emit(); save()
      toastFn(stored.length === 1 ? tr('fileAdded') : tr('filesAdded', stored.length))
    })
  } catch { toastFn(tr('fileImportFailed')) }
}

export async function addBridgeFromActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return { ok: false, error: tr('noActiveTab') }
  return addBridge(tab.url, tab.title)
}
export function removeBridge(i: number) {
  const it = state.bridges[i]
  if (!it) return
  state.bridges.splice(i, 1)
  if (state.bridgeIndex > i) state.bridgeIndex--
  emit(); save(); gcFiles()
}
export function moveBridge(from: number, to: number) {
  const n = state.bridges.length
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return
  const [it] = state.bridges.splice(from, 1)
  state.bridges.splice(to, 0, it)
  emit(); save()
}
export function clearBridges() {
  state.bridges = []; state.bridgeIndex = 0
  emit(); save(); gcFiles()
}
export function setBridgeSettings(patch: Partial<BridgeSettings>) {
  Object.assign(settings.bridge, patch)
  emit(); save()
  if ('volume' in patch && state.bridge) setVolume(settings.bridge.volume)
}

export function useDisplay(id: string) { settings.displayId = id; save(); recreatePlayer() }
export function toggleFullscreen() { settings.fullscreen = !settings.fullscreen; save(); emit(); recreatePlayer() }

// ---------- messages from content scripts, bridge page and background ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!controllerReady) return
  if (msg?.type === 'enqueue') { enqueue(msg.url, msg.title).then(sendResponse); return true }
  if (msg?.type === 'getState') { sendResponse(snap); return }
  if (msg?.type === 'playUpcoming') { playUpcoming(msg.i); sendResponse(true); return }
  if (msg?.type === 'moveUpcoming') { moveUpcoming(msg.from, msg.to); sendResponse(true); return }
  if (msg?.type === 'playNextUp') { playNextUp(msg.i); sendResponse(true); return }
  if (msg?.type === 'removeUpcoming') { removeUpcoming(msg.i); sendResponse(true); return }
  if (msg?.type === 'whoami') { sendResponse({ role: sender.tab && sender.tab.id === playerTabId ? 'player' : 'browser' }); return }
  if (msg?.type === 'filePos') {
    // progress report from media.html (local file song or bridge)
    if (sender.tab?.id !== playerTabId) return
    if (state.bridge?.kind === 'file') {
      advanceLock = false
      status = { state: msg.state, t: msg.t, d: msg.d, volume: status.volume }
      if (msg.t > 0) { state.bridge.pos = msg.t; saveSoon() }
      emit()
      if (msg.state === 0) { state.bridge.pos = 0; startBridge() }
    } else if (state.current?.kind === 'file') {
      advanceLock = false
      status = { state: msg.state, t: msg.t, d: msg.d, volume: status.volume }
      emit()
      if (msg.state === 0) endSong()
    }
    return
  }
  if (msg?.type === 'cmd') {
    if (msg.cmd === 'primary' || msg.cmd === 'next-song') primary()
    else if (msg.cmd === 'toggle-play') togglePlay()
    else if (msg.cmd === 'prev-song') prev()
  }
})

// The background tracks this port to show or hide the "+ Queue" buttons on YouTube.
// It drops when the service worker restarts, so reconnect for as long as this page lives.
function announceController() {
  chrome.runtime.connect({ name: 'controller' }).onDisconnect.addListener(() => setTimeout(announceController, 500))
}

// ---------- boot ----------
export async function boot() {
  const local = await chrome.storage.local.get(['sung', 'current', 'upcoming', 'bridges', 'bridgeIndex', 'settings'])
  if (Array.isArray(local.sung)) state.sung = local.sung
  if (Array.isArray(local.upcoming)) state.upcoming = local.upcoming
  if (Array.isArray(local.bridges)) state.bridges = local.bridges
  if (Number.isInteger(local.bridgeIndex)) state.bridgeIndex = local.bridgeIndex as number
  if (local.current) state.current = local.current as QueueItem
  if (local.settings) {
    const { bridge, ...rest } = local.settings as Partial<typeof settings>
    Object.assign(settings, rest)
    if (bridge) Object.assign(settings.bridge, bridge)
  }
  const sess = await chrome.storage.session.get(['playerWindowId', 'playerTabId', 'activeBridge'])
  if (sess.playerTabId != null) {
    playerTabId = sess.playerTabId as number; playerWindowId = (sess.playerWindowId as number | null) ?? null
  }
  if (await playerAlive()) {
    // panel reopened while the big screen is still on: trust what the player shows
    const tab = await chrome.tabs.get(playerTabId!)
    const url = tab.url || ''
    const media = url.startsWith(MEDIA_URL) ? new URL(url).searchParams : null
    const fileKey = media?.get('key') ?? null
    const id = fileKey && media?.get('mode') !== 'bridge' ? fileKey : parseVideoId(url)
    // A removed bridge can still be playing. Retain its reference across ownership handoff.
    const activeBridge = sess.activeBridge as BridgeItem | undefined
    const candidates = activeBridge ? [...state.bridges, activeBridge] : state.bridges
    const br = fileKey && media?.get('mode') === 'bridge' ? candidates.find((b) => b.kind === 'file' && b.key === fileKey)
      : id ? candidates.find((b) => b.kind === 'yt' && b.ytId === id && (!state.current || state.current.id !== id)) : undefined
    if (br) {
      if (state.current) { state.sung.push(state.current); state.current = null }
      state.bridge = br
    } else if (!id) {
      if (state.current) { state.sung.push(state.current); state.current = null }
    } else if (!state.current || state.current.id !== id) {
      const i = state.upcoming.findIndex((q) => q.id === id)
      if (state.current) state.sung.push(state.current)
      state.current = i >= 0 ? state.upcoming.splice(i, 1)[0] : fileKey ? null : { id, title: cleanTitle(tab.title) || id }
    }
  } else if (state.current) {
    // big screen is gone (browser restarted): the song that was on goes back to the front of the line
    state.upcoming.unshift(state.current)
    state.current = null
  }
  advanceLock = false
  controllerReady = true
  emit(); save()
  refreshDisplays()
  muteAllYouTubeTabs()
  announceController()
  gcFiles()
  chrome.system.display.onDisplayChanged?.addListener(refreshDisplays)
  ;(window as any).__kdj = {
    state, settings, enqueue, playUpcoming, playNextUp, moveUpcoming, requeue, next, prev, primary, endSong, startBridge, startSong,
    addBridge, addBridgeFiles, enqueueFiles, setBridgeSettings, setSinger, setVolume, removeUpcoming,
    get status() { return status }, get playerTabId() { return playerTabId }
  }
}
