import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Play, Pause, SkipForward, Volume2, Plus, Link2, ExternalLink, Trash2, MonitorPlay, Check, X, FileAudio, Disc3, Download, Languages, Palette, Maximize, Minimize } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Toaster } from '@/components/ui/sonner'
import { UpcomingList, SungList, BridgeList } from '@/components/queue-list'
import * as dj from '@/lib/dj'
import { t, LOCALES, LOCALE_NAMES, LOCALE_FLAGS, getLangPref, setLangPref } from '@/lib/i18n'
import { SKINS, SKIN_LABELS, getSkin, setSkin, subscribeSkin, isDarkSkin, type Skin } from '@/lib/skin'
import { cn } from '@/lib/utils'
import { isTransportShortcut } from '@/lib/keyboard'

const fmt = (s: number) => {
  s = Math.max(0, Math.floor(s || 0))
  const m = Math.floor(s / 60), r = s % 60, h = Math.floor(m / 60)
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

type Tab = 'upcoming' | 'sung'
// Where dropped links and files go: the open queue tab, or the bridges pane when it is open.
type Zone = Tab | 'bridges'

export default function App() {
  const s = useSyncExternalStore(dj.subscribe, dj.getSnapshot)
  const skin = useSyncExternalStore(subscribeSkin, getSkin)
  const playing = s.status.state === 1 || s.status.state === 3
  const [seekVal, setSeekVal] = useState<number | null>(null)
  const [vol, setVol] = useState<number | null>(null)
  const [tab, setTab] = useState<Tab>('upcoming')
  // The bridges panel remembers whether it was open (its height persists too, see BridgesPanel).
  const [bridgesOpen, setBridgesOpen] = useState(() => { try { return localStorage.getItem('bridgesPanelOpen') === '1' } catch { return false } })
  const toggleBridges = () => setBridgesOpen((o) => { try { localStorage.setItem('bridgesPanelOpen', o ? '0' : '1') } catch {} return !o })
  const tabsRef = useRef<HTMLDivElement>(null)
  // The tab strip scrolls when the panel is narrow: keep the active tab fully in view.
  useEffect(() => {
    const list = tabsRef.current
    if (!list) return
    const show = () => list.querySelector<HTMLElement>('[role=tab][data-state=active]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    show()
    const ro = new ResizeObserver(show)
    ro.observe(list)
    return () => ro.disconnect()
  }, [tab])
  const nxt = s.upcoming[0]
  const bridgeOn = s.bridgeSettings.enabled && s.bridges.length > 0

  useEffect(() => {
    dj.setToastHandler((m) => toast(m))
    dj.setDuplicateHandler((title, addAnyway) => toast(t('alreadyQueuedX', title), {
      duration: 8000, action: { label: t('addAnyway'), onClick: addAnyway }, cancel: { label: t('dismiss'), onClick: () => {} },
    }))
    const onKey = (e: KeyboardEvent) => {
      if (!isTransportShortcut(e)) return
      if (e.code === 'Space') { e.preventDefault(); dj.primary() }
      else if (e.key === 'p' || e.key === 'P') dj.togglePlay()
      else if (e.key === 'ArrowRight' && e.shiftKey) dj.next(true)
      else if (e.key === 'ArrowLeft' && e.shiftKey) dj.prev()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // What the pink button does right now (its accessible name), and what plays after the current song.
  const primaryLabel = s.phase === 'song' ? (bridgeOn ? t('nextBridge') : t('next'))
    : s.phase === 'bridge' || nxt ? (nxt ? t('start') : t('nothingQueued'))
      : bridgeOn ? t('playBridge') : t('nothingQueued')
  const nextLine = s.phase === 'song' ? (nxt ? dj.label(nxt) : null) : undefined

  return (
    <div className="relative flex h-screen flex-col bg-(image:--backdrop)">
      <header className="flex items-baseline gap-2 px-4 pt-3 pb-1">
        <img src={chrome.runtime.getURL('icons/sidestage-32.png')} alt="" className="size-6 self-center" />
        <h1 className="text-lg font-extrabold tracking-tight">Side<span className="text-highlight">Stage</span></h1>
        <div className="ml-auto flex items-center gap-1">
          <SkinMenu />
          <LangMenu />
        </div>
      </header>

      <section className="px-4 pb-3">
        {s.phase === 'bridge' && (
          <div className="truncate font-mono text-[10px] uppercase tracking-[.14em] text-bridge">♪ {s.bridge?.title}</div>
        )}
        <div className="mt-1 mb-2 line-clamp-2 min-h-[2.4em] text-balance text-[16px] font-bold leading-[1.2] break-words [overflow-wrap:anywhere]">
          {s.current ? dj.label(s.current)
            : nxt ? <><span className="text-muted-foreground">{t('upNext')}: </span>{dj.label(nxt)}</>
              : s.phase === 'bridge' ? t('queueIsEmpty') : t('notPlaying')}
        </div>
        <div className="flex items-center gap-2">
          <span className="w-11 text-center font-mono text-[11px] text-muted-foreground">{fmt(seekVal ?? s.status.t)}</span>
          <Slider
            aria-label={t('playbackPosition')}
            disabled={s.phase === 'idle' || s.status.d <= 0}
            min={0} max={Math.max(1, Math.floor(s.status.d))} step={1}
            value={[seekVal ?? Math.floor(s.status.t)]}
            onValueChange={([v]) => setSeekVal(v)}
            onValueCommit={([v]) => { dj.seek(v); setTimeout(() => setSeekVal(null), 400) }}
          />
          <span className="w-11 text-center font-mono text-[11px] text-muted-foreground">{fmt(s.status.d)}</span>
        </div>

        <div className="@container mt-3">
          <div className="flex items-center gap-2">
            <button
              disabled={s.phase === 'idle'} onClick={() => dj.togglePlay()} title={t('pauseResume')} aria-label={playing ? t('pause') : t('play')}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-border/70 text-foreground/80 transition hover:border-border hover:bg-muted/50 hover:text-foreground active:scale-95 disabled:opacity-40"
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
            </button>
            <button
              onClick={() => dj.primary()} title={`${primaryLabel} (${t('spaceHint')})`} aria-label={primaryLabel}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-primary/50 text-primary transition hover:border-primary hover:bg-primary/10 active:scale-95"
            >
              <SkipForward className="size-4" />
            </button>
            <div className="ml-auto flex shrink-0 items-center gap-2 text-muted-foreground">
              <Volume2 className="size-3.5 shrink-0" />
              <Slider aria-label={t('volume')} className="w-16 @min-[360px]:w-24" min={0} max={100} step={1} value={[vol ?? s.status.volume]}
                onValueChange={([v]) => { setVol(v); dj.setVolume(v) }}
                onValueCommit={() => setTimeout(() => setVol(null), 300)} />
            </div>
          </div>
          {nextLine !== undefined && (
            <div className="mt-2 flex h-4 items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="shrink-0 font-mono text-[10px] uppercase tracking-[.12em]">{t('upNext')}</span>
              {bridgeOn && <Disc3 className="size-3 shrink-0 text-bridge" />}
              <span className={cn('truncate', nextLine ? 'text-foreground/80' : 'italic')}>{nextLine ?? t('queueEmpty')}</span>
            </div>
          )}
        </div>
      </section>

      <Separator />

      <DropZone tab={tab}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
        <div className="@container flex items-center gap-1 px-4 pt-2 pb-1">
          <TabsList ref={tabsRef} className="h-8 min-w-0 shrink justify-start overflow-x-auto [scrollbar-width:none]">
            <TabsTrigger value="upcoming" className="shrink-0 px-1 text-[11px] uppercase tracking-normal @min-[360px]:px-2 @min-[360px]:tracking-[.08em]">
              {t('upcoming')} <span className="ml-0.5 font-mono text-highlight @min-[360px]:ml-1">{s.upcoming.length}</span>
            </TabsTrigger>
            <TabsTrigger value="sung" className="shrink-0 px-1 text-[11px] uppercase tracking-normal @min-[360px]:px-2 @min-[360px]:tracking-[.08em]">
              {t('sung')} <span className="ml-0.5 font-mono text-muted-foreground @min-[360px]:ml-1">{s.sung.length}</span>
            </TabsTrigger>
          </TabsList>
          <div className="ml-auto flex items-center gap-1">
            {tab === 'upcoming' && <ClearMenu name={(n) => t('clearAllUpcoming', n)} items={s.upcoming} onClear={dj.clearUpcoming} />}
            {tab === 'sung' && <ClearMenu name={(n) => t('clearAllSung', n)} items={s.sung} onClear={dj.clearSung} />}
          </div>
        </div>
        <TabsContent value="upcoming" className="min-h-0 flex-1">
          <ScrollArea className="h-full px-2">
            <UpcomingList items={s.upcoming} onPlay={dj.playUpcoming} onMove={dj.moveUpcoming} onPlayNextUp={dj.playNextUp} onRemove={dj.removeUpcoming} onSinger={dj.setSinger} />
          </ScrollArea>
        </TabsContent>
        <TabsContent value="sung" className="min-h-0 flex-1">
          <ScrollArea className="h-full px-2">
            <SungList items={s.sung.slice().reverse()} onRequeue={(i) => dj.requeue(s.sung.length - 1 - i)} onRemove={(i) => dj.removeSung(s.sung.length - 1 - i)} />
          </ScrollArea>
        </TabsContent>
      </Tabs>
      <AddFab mode="song" />
      </DropZone>

      {bridgesOpen && <BridgesPanel s={s} />}

      <Separator />
      <footer className="relative z-10 flex shrink-0 items-center gap-1.5 bg-background px-3 py-2 text-[11px] text-muted-foreground">
        <Button variant="ghost" size="icon" aria-pressed={bridgesOpen} aria-label={t('bridges')} title={t('bridges')}
          className={cn('size-7 shrink-0', bridgesOpen ? 'bg-bridge/15 text-bridge hover:bg-bridge/25 hover:text-bridge' : bridgeOn ? 'text-bridge hover:text-bridge' : 'text-muted-foreground')}
          onClick={toggleBridges}>
          <Disc3 className={cn('size-3.5', s.phase === 'bridge' && 'animate-[spin_3s_linear_infinite]')} />
        </Button>
        <Select value={s.activeDisplayId ?? ''} onValueChange={(v) => v && dj.useDisplay(v)}>
          <SelectTrigger aria-label={t('display')} className="h-7 min-w-0 flex-1 text-[11px]"><SelectValue placeholder={s.playerOpen ? t('windowed') : t('playerClosed')} /></SelectTrigger>
          <SelectContent>
            {s.displays.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}{d.isPrimary ? ` ${t('mainDisplay')}` : ''} ({d.width}×{d.height})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" aria-pressed={s.fullscreen} aria-label={s.fullscreen ? t('fullscreenOn') : t('fullscreenOff')} title={s.fullscreen ? t('fullscreenOn') : t('fullscreenOff')}
          className={cn('size-7 shrink-0', s.fullscreen ? 'bg-primary/15 text-primary hover:bg-primary/25 hover:text-primary' : 'text-muted-foreground')}
          onClick={() => dj.toggleFullscreen()}>
          {s.fullscreen ? <Maximize className="size-3.5" /> : <Minimize className="size-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground" aria-label={t('showPlayer')} title={t('showPlayer')} onClick={() => dj.recreatePlayer()}>
          <MonitorPlay className="size-3.5" />
        </Button>
      </footer>
      <Toaster position="bottom-center" theme={isDarkSkin(skin) ? 'dark' : 'light'} />
    </div>
  )
}

// Accepts YouTube links and media files dropped from other tabs, the address bar or Finder: they go to
// Upcoming, or to Bridges when that tab is open (audio only there). Internal row drags are tagged and ignored.
function DropZone({ tab, children }: { tab: Zone; children: React.ReactNode }) {
  const [over, setOver] = useState<'link' | 'file' | null>(null)
  const depth = useRef(0)
  const kind = (dt: DataTransfer): 'link' | 'file' | null => {
    const t = Array.from(dt.types)
    if (t.includes('text/x-sidestage')) return null
    if (t.includes('Files')) return 'file'
    if (t.includes('text/uri-list') || t.includes('text/plain')) return 'link'
    return null
  }
  const onDrop = async (e: React.DragEvent) => {
    const k = kind(e.dataTransfer)
    depth.current = 0; setOver(null)
    if (!k) return
    e.preventDefault()
    if (k === 'file') {
      const files = Array.from(e.dataTransfer.files)
      if (tab === 'bridges') {
        const ok = files.filter((f) => /^(audio|image)\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|flac|opus|png|jpe?g|gif|webp|avif)$/i.test(f.name))
        if (!ok.length) return toast.error(t('onlyAudio'))
        await dj.addBridgeFiles(ok)
      } else {
        const media = files.filter((f) => /^(audio|video)\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|flac|opus|mp4|m4v|webm|mov|mkv)$/i.test(f.name))
        if (!media.length) return toast.error(t('onlyMedia'))
        await dj.enqueueFiles(media)
      }
      return
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    const links = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    let handled = 0 // queued, or already queued and now prompting
    for (const l of links) {
      const r = tab === 'bridges' ? await dj.addBridge(l) : await dj.enqueue(l)
      if (r.ok || ('duplicate' in r && r.duplicate)) handled++
    }
    if (!handled) toast.error(t('noVideoDropped'))
  }
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(e) => { const k = kind(e.dataTransfer); if (!k) return; e.preventDefault(); depth.current++; setOver(k) }}
      onDragOver={(e) => { const k = kind(e.dataTransfer); if (!k) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }}
      onDragLeave={() => { if (--depth.current <= 0) { depth.current = 0; setOver(null) } }}
      onDrop={onDrop}
    >
      {children}
      {over && (
        <div className={cn('pointer-events-none absolute inset-x-2 inset-y-0 z-10 grid place-items-center rounded-xl border-2 border-dashed bg-background/80 backdrop-blur-sm',
          tab === 'bridges' ? 'border-bridge text-bridge' : 'border-primary text-primary')}>
          <div className="flex flex-col items-center gap-2 text-sm font-bold">
            <Download className="size-6" />
            {tab === 'bridges' ? (over === 'file' ? t('dropAudio') : t('dropLinkBridge')) : (over === 'file' ? t('dropMediaQueue') : t('dropLinkQueue'))}
          </div>
        </div>
      )}
    </div>
  )
}

// Which bridge the rotation will pick next (mirrors the controller's bridgeIndex, read from storage-free snapshot).
function bridgeNextIndex(s: dj.Snapshot): number {
  if (!s.bridges.length) return -1
  const playing = s.bridge ? s.bridges.findIndex((b) => b.key === s.bridge!.key) : -1
  return playing >= 0 ? (playing + 1) % s.bridges.length : (dj.getNextBridgeIndex() % s.bridges.length)
}

// Bridges live in a panel docked between the queue and the footer, toggled by the footer's disc
// button: the switch, the settings laid out flat, plain add buttons, then the (short) list with its
// clear menu. The handle on its top edge drags to resize; the queue above keeps at least some room.
const PANEL_MIN = 220
const PANEL_RESERVE = 400   // header, transport, tab row, a few queue rows and the footer
function BridgesPanel({ s }: { s: dj.Snapshot }) {
  const b = s.bridgeSettings
  const row = 'flex h-7 items-center justify-between gap-3 text-xs'
  const [height, setHeight] = useState(() => { try { return Number(localStorage.getItem('bridgesPanelH')) || 400 } catch { return 400 } })
  const clamp = (h: number) => Math.max(PANEL_MIN, Math.min(Math.max(PANEL_MIN, window.innerHeight - PANEL_RESERVE), h))
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    const startY = e.clientY, startH = height, el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent) => setHeight(clamp(startH + (startY - ev.clientY)))
    const up = () => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up)
      setHeight((h) => { try { localStorage.setItem('bridgesPanelH', String(h)) } catch {} return h })
    }
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up)
  }
  return (
    <section aria-label={t('bridges')} style={{ height: clamp(height) }}
      className="relative flex shrink-0 flex-col overflow-hidden border-t border-border bg-popover/70 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div role="separator" aria-orientation="horizontal" aria-label={t('bridges')} className="shrink-0 cursor-row-resize touch-none py-1.5 hover:bg-muted/40" onPointerDown={drag}>
            <div className="mx-auto h-1 w-10 rounded-full bg-muted-foreground/40" />
          </div>
          <DropZone tab="bridges">
          <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-0.5 px-4 pb-2">
              <label className={cn(row, 'font-semibold')}>
                <span className="flex items-center gap-2"><Disc3 className="size-4 text-bridge" />{t('bridgeSwitch')}</span>
                <Switch size="sm" checked={b.enabled} onCheckedChange={(v) => dj.setBridgeSettings({ enabled: v })} />
              </label>
              <div className={row}>
                <span className="shrink-0">{t('bedVolume')}</span>
                <span className="flex min-w-0 flex-1 items-center justify-end gap-2">
                  <Slider aria-label={t('bedVolume')} className="max-w-36" min={0} max={100} step={1} value={[b.volume]} onValueChange={([v]) => dj.setBridgeSettings({ volume: v })} />
                </span>
              </div>
              <div className={row}>
                <span>{t('autoContinue')}</span>
                <span className="flex items-center gap-1">
                  <input aria-label={t('autoContinue')} type="number" min={0} max={600} value={b.autoContinue || ''} placeholder={t('off')}
                    onChange={(e) => dj.setBridgeSettings({ autoContinue: Math.max(0, Number(e.target.value) || 0) })}
                    className="h-6 w-14 rounded-md border border-border bg-background px-2 text-right font-mono text-xs outline-none focus:border-primary" />
                  <span className="text-muted-foreground">{t('seconds')}</span>
                </span>
              </div>
              <label className={row}>
                <span className="shrink-0">{t('screenTitle')}</span>
                <input value={b.message} placeholder={t('karaokeNight')} onChange={(e) => dj.setBridgeSettings({ message: e.target.value })}
                  className="h-6 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-bridge" />
              </label>
            </div>
            <Separator />
            <div className="flex items-center gap-1 px-4 pt-2 pb-1">
              <span className="text-[11px] font-medium uppercase tracking-[.08em] text-bridge">{t('bridges')}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{s.bridges.length}</span>
              <div className="ml-auto"><ClearMenu name={(n) => t('clearAllBridges', n)} items={s.bridges} onClear={dj.clearBridges} /></div>
            </div>
            <BridgeAdder />
            <div className="px-2 pb-2">
              <BridgeList items={s.bridges} playingKey={s.bridge?.key ?? null} nextIndex={bridgeNextIndex(s)} onPlay={(i) => dj.startBridge(i)} onMove={dj.moveBridge} onRemove={dj.removeBridge} />
            </div>
          </ScrollArea>
          </DropZone>
    </section>
  )
}

// Plain add controls for the bridges sheet: a link field, a file picker, and the current tab when it is a YouTube video.
function BridgeAdder() {
  const [url, setUrl] = useState('')
  const [active, setActive] = useState<chrome.tabs.Tab | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const look = () => chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setActive(t ?? null)).catch(() => setActive(null))
    look()
    chrome.tabs.onActivated.addListener(look); chrome.tabs.onUpdated.addListener(look)
    return () => { chrome.tabs.onActivated.removeListener(look); chrome.tabs.onUpdated.removeListener(look) }
  }, [])
  const activeId = dj.parseVideoId(active?.url || '')
  const activeTitle = (active?.title || '').replace(/\s*-\s*YouTube$/, '')
  const submit = async () => {
    const v = url.trim()
    if (!v) return
    const r = await dj.addBridge(v)
    if (!r.ok) { toast.error(r.error || t('failed')); inputRef.current?.select(); return }
    setUrl('')
  }
  const useTab = async () => { const r = await dj.addBridgeFromActiveTab(); if (!r.ok) toast.error(r.error || t('failed')) }
  const btn = 'h-7 gap-1.5 rounded-full border-bridge/40 px-2.5 text-[11px] text-bridge hover:border-bridge hover:bg-bridge/10 hover:text-bridge'
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
      <input ref={fileRef} type="file" accept="audio/*,image/*" multiple hidden
        onChange={async (e) => { const f = e.target.files; if (f?.length) await dj.addBridgeFiles(f); e.target.value = '' }} />
      <form className="flex h-7 min-w-40 flex-1 items-center rounded-full border border-border bg-background pl-3 focus-within:border-bridge" onSubmit={(e) => { e.preventDefault(); submit() }}>
        <input aria-label={t('addLink')} ref={inputRef} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t('bridgePlaceholder')}
          className="min-w-0 flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground" />
        <button type="submit" aria-label={t('ok')} disabled={!url.trim()} className="grid size-7 shrink-0 place-items-center rounded-full text-bridge disabled:opacity-30"><Check className="size-3.5" /></button>
      </form>
      <Button variant="outline" size="sm" className={btn} onClick={() => fileRef.current?.click()}><FileAudio className="size-3.5" />{t('actLocal')}</Button>
      {activeId && (
        <Button variant="outline" size="sm" className={cn(btn, 'max-w-full')} title={activeTitle} onClick={useTab}>
          <Plus className="size-3.5" /><span className="truncate">{t('actTab')}</span>
        </Button>
      )}
    </div>
  )
}

// Icon-only trash button; choosing a menu item is the confirmation.
function ClearMenu({ name, items, onClear }: { name: (n: number) => string; items: unknown[]; onClear: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" disabled={!items.length} className="size-7 text-muted-foreground hover:text-destructive" aria-label={t('clearList')} title={t('clearList')}>
          <Trash2 className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem variant="destructive" onSelect={onClear} className="whitespace-nowrap"><Trash2 /> {name(items.length)}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Floating "+" speed dial, anchored to the bottom-right of the list it adds to: link field, local media,
// current tab (only when it is a YouTube video), open YouTube. In bridge mode the link and tab actions add bridges.
function AddFab({ mode, offset = 'bottom-3' }: { mode: 'song' | 'bridge'; offset?: string }) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState(false)
  const [url, setUrl] = useState('')
  const [active, setActive] = useState<chrome.tabs.Tab | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setActive(null)
    chrome.tabs.query({ active: true, currentWindow: true }).then(([t]) => setActive(t ?? null)).catch(() => setActive(null))
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => { if (field) inputRef.current?.focus() }, [field])

  const close = () => { setOpen(false); setField(false); setUrl('') }
  const activeId = dj.parseVideoId(active?.url || '')
  const activeTitle = (active?.title || '').replace(/\s*-\s*YouTube$/, '')
  const bridge = mode === 'bridge'
  const submit = async () => {
    const v = url.trim()
    if (!v) return close()
    const r = bridge ? await dj.addBridge(v) : await dj.enqueue(v)
    if (!r.ok && !('duplicate' in r && r.duplicate)) { toast.error(r.error || t('failed')); inputRef.current?.select(); return }
    close()
  }
  const useTab = async () => {
    const r = bridge ? await dj.addBridgeFromActiveTab() : await dj.enqueueActiveTab()
    if (!r.ok && !('duplicate' in r && r.duplicate)) { toast.error(r.error || t('failed')); return }
    close()
  }
  const tone = bridge ? 'text-bridge' : 'text-primary'
  const actions: { icon: React.ReactNode; label: string; hint?: string; run: () => void }[] = [
    { icon: <Link2 className="size-4" />, label: t('actLink'), run: () => setField(true) },
    { icon: <FileAudio className="size-4" />, label: t('actLocal'), run: () => fileRef.current?.click() },
    ...(activeId ? [{ icon: <Plus className="size-4" />, label: t('actTab'), hint: activeTitle, run: useTab }] : []),
    { icon: <ExternalLink className="size-4" />, label: t('openYouTube'), run: () => { dj.openYouTube(); close() } },
  ]

  return (
    <>
      {open && <div data-dial-open className="absolute inset-0 z-10 bg-background/60 backdrop-blur-[2px]" onClick={close} />}
      <input ref={fileRef} type="file" accept={bridge ? 'audio/*,image/*' : 'audio/*,video/*'} multiple hidden
        onChange={async (e) => { const f = e.target.files; if (f?.length) { await (bridge ? dj.addBridgeFiles(f) : dj.enqueueFiles(f)); close() } }} />
      <div className={cn('pointer-events-none absolute right-4 z-20 flex flex-col items-end gap-3', offset)}>
        {open && field && (
          <form
            className="pointer-events-auto flex h-11 w-[calc(100vw-2rem)] max-w-sm items-center gap-1 rounded-full border border-border bg-popover/95 pr-1.5 pl-4 shadow-xl backdrop-blur animate-in fade-in slide-in-from-bottom-2"
            onSubmit={(e) => { e.preventDefault(); submit() }}
          >
            <input
              aria-label={bridge ? t('addBridge') : t('addLink')}
              ref={inputRef}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={bridge ? t('bridgePlaceholder') : t('linkPlaceholder')}
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
            <button type="button" aria-label={t('cancel')} onClick={close}
              className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="size-4" />
            </button>
            <button type="submit" aria-label={t('ok')} disabled={!url.trim()}
              className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground transition hover:brightness-110 disabled:opacity-40">
              <Check className="size-4" />
            </button>
          </form>
        )}
        {open && !field && actions.map((a, i) => (
          <button
            key={a.label} type="button" onClick={a.run}
            style={{ animationDelay: `${(actions.length - 1 - i) * 40}ms` }}
            className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-3 animate-in fade-in slide-in-from-bottom-2 fill-mode-backwards"
          >
            <span className="flex min-w-0 flex-col items-end rounded-lg border border-border bg-popover/95 px-3 py-1.5 text-right shadow-lg backdrop-blur">
              <span className="text-[12px] font-semibold">{a.label}</span>
              {a.hint && <span className="max-w-[52vw] truncate text-[10px] text-muted-foreground">{a.hint}</span>}
            </span>
            <span className={cn('grid size-10 shrink-0 place-items-center rounded-full border border-border bg-popover shadow-lg', tone)}>{a.icon}</span>
          </button>
        ))}
        <button
          type="button"
          aria-label={open ? t('close') : bridge ? t('addBridge') : t('addLink')}
          onClick={() => (open ? close() : setOpen(true))}
          className={cn('pointer-events-auto grid size-14 place-items-center rounded-full transition-transform duration-200 hover:scale-105 active:scale-95',
            bridge ? 'bg-bridge text-bridge-foreground shadow-[0_6px_20px_var(--bridge-glow)]' : 'bg-primary text-primary-foreground shadow-[0_6px_20px_var(--glow)]')}
        >
          <Plus className={cn('size-7 transition-transform duration-200', open && 'rotate-45')} />
        </button>
      </div>
    </>
  )
}

// A skin's colours at a glance, like Chrome's theme picker: background on top, primary and the
// break accent below. Drawn as SVG so the wedges meet cleanly; `data-skin` scopes the tokens.
function SkinSwatch({ skin }: { skin: Skin }) {
  return (
    <svg data-skin={skin} viewBox="0 0 16 16" aria-hidden className="size-4 shrink-0">
      <path d="M0 8A8 8 0 0 1 16 8Z" fill="var(--background)" />
      <path d="M0 8A8 8 0 0 0 8 16V8Z" fill="var(--primary)" />
      <path d="M8 8V16A8 8 0 0 0 16 8Z" fill="var(--bridge)" />
      <circle cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" strokeOpacity="0.25" />
    </svg>
  )
}

// Header palette: pick one of the built-in skins (persisted, applied instantly).
function SkinMenu() {
  const cur = useSyncExternalStore(subscribeSkin, getSkin)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-7 self-center text-muted-foreground" aria-label={t('skin')} title={t('skin')}><Palette className="size-3.5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        {SKINS.map((k) => (
          <DropdownMenuItem key={k} onSelect={() => setSkin(k)} className={cn(cur === k && 'text-primary')}>
            <SkinSwatch skin={k} />
            {t(SKIN_LABELS[k])}{cur === k && <Check className="ml-auto size-3.5" />}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Header globe: pick the console language (persisted, pages reload with the new strings).
function LangMenu() {
  const cur = getLangPref()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="-mr-2 size-7 self-center text-muted-foreground" aria-label={t('language')} title={t('language')}><Languages className="size-3.5" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onSelect={() => setLangPref('auto')} className={cn(cur === 'auto' && 'text-primary')}><span aria-hidden className="w-5 text-center">🌐</span>{t('langAuto')}{cur === 'auto' && <Check className="ml-auto size-3.5" />}</DropdownMenuItem>
        <DropdownMenuSeparator />
        {LOCALES.map((l) => (
          <DropdownMenuItem key={l} onSelect={() => setLangPref(l)} className={cn(cur === l && 'text-primary')}><span aria-hidden className="w-5 text-center">{LOCALE_FLAGS[l]}</span>{LOCALE_NAMES[l]}{cur === l && <Check className="ml-auto size-3.5" />}</DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
