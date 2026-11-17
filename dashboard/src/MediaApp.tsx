// Big-screen page for local files. Two modes, picked by the URL:
//   media.html?key=K              a queued song: the file plays fullscreen (video, or an ambient card for audio)
//   media.html?mode=bridge&key=K&pos=S   a local bridge: audio with the "Up next" card, or a still image
//                                        shown silently behind the card until the DJ moves on
// The page reports position with `filePos` and obeys `fileCmd` (pause/play/volume/seek) from the controller.
import { useEffect, useRef, useState } from 'react'
import { getFile } from '@/lib/idb'
import type { Snapshot } from '@/lib/dj'
import { t } from '@/lib/i18n'

const ask = async (): Promise<Snapshot | null> => { try { return (await chrome.runtime.sendMessage({ type: 'getState' })) ?? null } catch { return null } }

// Polls the controller for the queue (singer names, next songs, countdown).
function useSnapshot(ms: number) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  useEffect(() => {
    const poll = async () => setSnap(await ask())
    poll()
    const id = setInterval(poll, ms)
    return () => clearInterval(id)
  }, [ms])
  return snap
}

// Loads the stored file into the media element, starts it, reports progress, and takes commands.
function useFilePlayer(key: string, mode: 'song' | 'bridge', pos: number) {
  const ref = useRef<HTMLVideoElement>(null)
  const [blocked, setBlocked] = useState(false)
  const [audioOnly, setAudioOnly] = useState(mode === 'bridge')
  const [image, setImage] = useState('')
  useEffect(() => {
    const el = ref.current
    if (!el || !key) return
    let url = ''
    let lastReport = 0
    const report = (state: number) => chrome.runtime.sendMessage({ type: 'filePos', state, t: el.currentTime, d: el.duration || 0 }).catch(() => {})
    const onTime = () => { if (Date.now() - lastReport > 900) { lastReport = Date.now(); report(el.paused ? 2 : 1) } }
    const onPlay = () => report(1)
    const onPause = () => { if (!el.ended) report(2) }
    const onEnded = () => report(0)
    el.addEventListener('timeupdate', onTime); el.addEventListener('play', onPlay); el.addEventListener('pause', onPause); el.addEventListener('ended', onEnded)
    ;(async () => {
      const blob = await getFile(key)
      if (!blob) return
      url = URL.createObjectURL(blob)
      if (blob.type.startsWith('image/')) {
        // A still image: nothing to play, so tell the controller once that it is "playing" and stay put.
        setImage(url); setAudioOnly(false)
        chrome.runtime.sendMessage({ type: 'filePos', state: 1, t: 0, d: 0 }).catch(() => {})
        return
      }
      setAudioOnly(mode === 'bridge' || blob.type.startsWith('audio/'))
      el.src = url
      const s = await ask()
      const vol = mode === 'bridge' ? (s?.bridgeSettings.volume ?? 35) : (s?.status.volume ?? 100)
      el.volume = Math.max(0, Math.min(100, vol)) / 100
      if (pos > 0) el.currentTime = pos
      try { await el.play() } catch { setBlocked(true) }
    })()
    const onMsg = (msg: any) => {
      if (msg?.type !== 'fileCmd') return
      if (msg.cmd === 'pause') el.pause()
      else if (msg.cmd === 'play') el.play().then(() => setBlocked(false)).catch(() => setBlocked(true))
      else if (msg.cmd === 'volume') el.volume = Math.max(0, Math.min(100, msg.v)) / 100
      else if (msg.cmd === 'seek') el.currentTime = msg.v
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg)
      el.removeEventListener('timeupdate', onTime); el.removeEventListener('play', onPlay); el.removeEventListener('pause', onPause); el.removeEventListener('ended', onEnded)
      el.pause()
      if (url) URL.revokeObjectURL(url)
    }
  }, [key, mode, pos])
  return { ref, blocked, audioOnly, image }
}

export default function MediaApp() {
  const params = new URLSearchParams(location.search)
  const key = params.get('key') || ''
  const mode = params.get('mode') === 'bridge' ? 'bridge' : 'song'
  const pos = Number(params.get('pos') || 0)
  const snap = useSnapshot(1000)
  const { ref, blocked, audioOnly, image } = useFilePlayer(key, mode, pos)

  return (
    <div className="relative h-screen cursor-none overflow-hidden bg-[#07060b] text-[#fff4e3]">
      <video ref={ref} playsInline className={audioOnly || image ? 'hidden' : 'h-full w-full object-contain'} />
      {image && <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {image && <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_40%,rgba(0,0,0,.25),rgba(0,0,0,.6))]" />}
      {audioOnly && <Ambient />}
      {mode === 'bridge' ? <BridgeCard snap={snap} /> : (
        <>
          {audioOnly && snap?.current && <SongCard singer={snap.current.singer} title={snap.current.title} />}
          <NextList snap={snap} />
        </>
      )}
      {blocked && <div className="absolute top-[4vmin] right-[4vmin] font-mono text-[2vmin] text-amber-300">{t('audioBlocked')}</div>}
    </div>
  )
}

function Ambient() {
  return <div className="pointer-events-none absolute -inset-[20%] animate-[drift_18s_ease-in-out_infinite_alternate] bg-[radial-gradient(40%_60%_at_20%_30%,rgba(255,61,127,.35),transparent_60%),radial-gradient(35%_50%_at_80%_70%,rgba(255,179,71,.3),transparent_60%),radial-gradient(30%_40%_at_60%_20%,rgba(80,120,255,.25),transparent_60%)] blur-[40px]" />
}

// Audio-only song: who is singing what.
function SongCard({ singer, title }: { singer?: string; title: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="max-w-[80vw] text-center animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="text-[9vmin] leading-none animate-[bob_3s_ease-in-out_infinite]">🎤</div>
        {singer && <div className="mt-[2vmin] bg-gradient-to-r from-amber-400 via-[#ff3d7f] to-[#c58bff] bg-clip-text text-[12vmin] font-extrabold leading-none tracking-tighter text-transparent">{singer}</div>}
        <div className="mt-[2vmin] text-balance text-[6vmin] font-bold leading-tight">{title}</div>
      </div>
    </div>
  )
}

// Bridge: the DJ's title centered, the next song in the top-right corner, bridge title bottom-left, auto-continue ring bottom-right.
function BridgeCard({ snap }: { snap: Snapshot | null }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 200); return () => clearInterval(id) }, [])
  const deadline = snap?.autoDeadline ?? null
  const left = deadline ? Math.max(0, deadline - now) : 0
  const total = deadline && snap ? snap.bridgeSettings.autoContinue * 1000 : 1
  return (
    <>
      {snap?.bridgeSettings.message.trim() && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="max-w-[70vw] rounded-full bg-gradient-to-r from-amber-400 to-[#ff3d7f] px-[1.4em] py-[.5em] text-center text-[4vmin] font-extrabold leading-snug whitespace-pre-wrap text-balance text-[#1d0912] shadow-[0_1vmin_4vmin_rgba(0,0,0,.4)] animate-in fade-in slide-in-from-bottom-4 duration-700">
            {snap.bridgeSettings.message.trim()}
          </div>
        </div>
      )}
      <NextList snap={snap} />
      {snap?.bridge && <div className="absolute bottom-[4vmin] left-[4vmin] max-w-[50vw] truncate font-mono text-[2vmin] opacity-50">♪ {snap.bridge.title}</div>}
      {deadline && (
        <div className="absolute right-[4vmin] bottom-[4vmin] grid size-[12vmin] place-items-center font-mono text-[4vmin] font-bold">
          <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="6" />
            <circle cx="50" cy="50" r="46" fill="none" stroke="#ff3d7f" strokeWidth="6" strokeLinecap="round" strokeDasharray="289" strokeDashoffset={289 * (1 - left / total)} />
          </svg>
          <span>{Math.ceil(left / 1000)}</span>
        </div>
      )}
    </>
  )
}

// The next song in the top-right corner, on bridges and while a song plays.
function NextList({ snap }: { snap: Snapshot | null }) {
  const next = snap ? snap.upcoming.slice(0, 1) : []
  if (!next.length) return null
  return (
    <div className="absolute top-[4vmin] right-[4vmin] max-w-[40vw] text-right text-[2.2vmin] leading-relaxed [text-shadow:0_.3vmin_2vmin_rgba(0,0,0,.6)]">
      <div className="font-mono text-[1.6vmin] uppercase tracking-[.3em] opacity-60">{t('upNext')}</div>
      {next.map((it, i) => (
        <div key={i} className="truncate">
          {it.singer && <span className="mr-[.5em] text-amber-300">{it.singer}</span>}{it.title}
        </div>
      ))}
    </div>
  )
}
