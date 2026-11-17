import { useRef, useState, type ReactNode } from 'react'
import { ListStart, X, GripVertical, RotateCcw, UserRound, Tv, FileAudio, FileVideo, Image, Play } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { QueueItem, BridgeItem } from '@/lib/dj'
import { t } from '@/lib/i18n'

// Shared drag-to-reorder behaviour for a list of rows.
function reorderKey(e: React.KeyboardEvent, index: number, count: number, onMove: (from: number, to: number) => void) {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
  e.preventDefault()
  const to = index + (e.key === 'ArrowUp' ? -1 : 1)
  if (to < 0 || to >= count) return
  const list = e.currentTarget.closest('ol')
  onMove(index, to)
  requestAnimationFrame(() => (list?.children[to]?.querySelector('[data-play]') as HTMLElement | null)?.focus())
}

function useDragSort(onMove: (from: number, to: number) => void) {
  const dragFrom = useRef<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const props = (i: number) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-sidestage', 'row') },
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dragOver !== i) setDragOver(i) },
    onDragLeave: () => setDragOver(null),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); if (dragFrom.current != null && dragFrom.current !== i) onMove(dragFrom.current, i); dragFrom.current = null; setDragOver(null) },
    onDragEnd: () => { dragFrom.current = null; setDragOver(null) },
  })
  return { props, dragOver }
}

const rowCls = (compact?: boolean) => cn(
  'group mb-0.5 grid cursor-grab items-center gap-1.5 rounded-lg border border-transparent px-1.5 hover:border-border hover:bg-card active:cursor-grabbing',
  compact ? 'grid-cols-[16px_1fr_auto] py-1' : 'grid-cols-[24px_1fr_auto] py-1.5',
)

type UpcomingProps = {
  items: QueueItem[]
  compact?: boolean
  onPlay: (i: number) => void
  onMove: (from: number, to: number) => void
  onPlayNextUp: (i: number) => void
  onRemove: (i: number) => void
  onSinger?: (i: number, name: string) => void
}

// Upcoming songs: double-click or activate the title by keyboard to play; drag or Alt+Arrow to reorder.
export function UpcomingList({ items, compact, onPlay, onMove, onPlayNextUp, onRemove, onSinger }: UpcomingProps) {
  const { props, dragOver } = useDragSort(onMove)
  const [editing, setEditing] = useState<number | null>(null)

  if (!items.length) return <Empty>{t('emptyUpcoming1')}</Empty>
  return (
    <ol className="pb-1">
      {items.map((it, i) => (
        <li key={`${it.id}-${i}`} {...props(i)} className={cn(rowCls(compact), dragOver === i && 'shadow-[inset_0_2px_0_0_var(--color-highlight)]')}>
          <span className="relative text-center font-mono text-[11px] text-muted-foreground">
            <span className="group-hover:invisible">{i + 1}</span>
            <GripVertical className="invisible absolute inset-0 m-auto size-3.5 group-hover:visible" />
          </span>
          {editing === i ? (
            <input
              aria-label={t('whoSinging')}
              autoFocus
              defaultValue={it.singer || ''}
              placeholder={t('whoSinging')}
              className="h-6 min-w-0 rounded-md border border-primary/60 bg-background px-2 text-[12px] outline-none"
              onBlur={(e) => { onSinger?.(i, e.target.value); setEditing(null) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') { setEditing(null) }
              }}
            />
          ) : (
            <button type="button" data-play aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              aria-label={`${t('play')}: ${it.title}. ${t('reorderHint')}`}
              onKeyDown={(e) => reorderKey(e, i, items.length, onMove)}
              className={cn('min-w-0 text-left truncate font-medium select-none focus-visible:outline-2 focus-visible:outline-primary', compact ? 'text-[12px]' : 'text-[13px]')}
              title={`${it.title}\n${t('dblClickPlay')}`}
              onClick={(e) => { if (e.detail === 0) onPlay(i) }}
              onDoubleClick={() => onPlay(i)}
            >
              {it.singer && <span className="mr-1.5 text-highlight">{it.singer}</span>}
              <FileMark it={it} />{it.title}
            </button>
          )}
          <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            {onSinger && <Op label={it.singer ? t('changeSinger') : t('whoSings')} onClick={() => setEditing(i)}><UserRound className="size-3" /></Op>}
            <Op label={t('nextUp')} disabled={i === 0} onClick={() => onPlayNextUp(i)}><ListStart className="size-3" /></Op>
            <Op label={t('remove')} className="hover:text-destructive" onClick={() => onRemove(i)}><X className="size-3" /></Op>
          </span>
        </li>
      ))}
    </ol>
  )
}

type SungProps = { items: QueueItem[]; onRequeue: (i: number) => void; onRemove: (i: number) => void }

// Already-sung songs, newest first. Hover actions: put it back in the queue, or drop it from the list.
export function SungList({ items, onRequeue, onRemove }: SungProps) {
  if (!items.length) return <Empty>{t('emptySung')}</Empty>
  return (
    <ol className="pb-1">
      {items.map((it, i) => (
        <li key={`${it.id}-${i}`} className="group mb-0.5 grid grid-cols-[1fr_auto] items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 hover:border-border hover:bg-card">
          <span className="truncate text-[13px] font-medium text-muted-foreground group-hover:text-foreground" title={it.title}>
            {it.singer && <span className="mr-1.5 opacity-70">{it.singer}</span>}<FileMark it={it} />{it.title}
          </span>
          <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
            <Op label={t('requeue')} className="hover:text-primary" onClick={() => onRequeue(i)}><RotateCcw className="size-3" /></Op>
            <Op label={t('remove')} className="hover:text-destructive" onClick={() => onRemove(i)}><X className="size-3" /></Op>
          </span>
        </li>
      ))}
    </ol>
  )
}

type BridgeProps = {
  items: BridgeItem[]
  playingKey: string | null
  nextIndex: number
  onPlay: (i: number) => void
  onMove: (from: number, to: number) => void
  onRemove: (i: number) => void
}

const fmtPos = (s: number) => { s = Math.floor(s || 0); const m = Math.floor(s / 60), r = s % 60, h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}` }

// Background mixes: double-click or keyboard activation to play, drag or Alt+Arrow to reorder.
export function BridgeList({ items, playingKey, nextIndex, onPlay, onMove, onRemove }: BridgeProps) {
  const { props, dragOver } = useDragSort(onMove)
  if (!items.length) return <Empty>{t('emptyBridges1')}</Empty>
  return (
    <ol className="pb-1">
      {items.map((it, i) => {
        const playing = it.key === playingKey
        return (
          <li key={it.key} {...props(i)} className={cn(rowCls(), playing && 'border-primary/50 bg-primary/10', dragOver === i && 'shadow-[inset_0_2px_0_0_var(--color-highlight)]')}>
            <span className="relative grid place-items-center text-muted-foreground">
              <span className="group-hover:invisible">{it.kind === 'yt' ? <Tv className="size-3.5" /> : it.media === 'image' ? <Image className="size-3.5" /> : <FileAudio className="size-3.5" />}</span>
              <GripVertical className="invisible absolute inset-0 m-auto size-3.5 group-hover:visible" />
            </span>
            <button type="button" data-play aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
              aria-label={`${t('play')}: ${it.title}. ${t('reorderHint')}`}
              onKeyDown={(e) => reorderKey(e, i, items.length, onMove)}
              className="min-w-0 text-left select-none focus-visible:outline-2 focus-visible:outline-primary" title={`${it.title}\n${t('dblClickBridge')}`}
              onClick={(e) => { if (e.detail === 0) onPlay(i) }} onDoubleClick={() => onPlay(i)}>
              <span className={cn('block truncate text-[13px] font-medium', playing && 'text-primary')}>{it.title}</span>
              <span className="block font-mono text-[10px] text-muted-foreground">
                {it.media === 'image' ? (playing ? t('stPlaying') : i === nextIndex ? t('upNext') : '')
                  : playing ? t('playingAt', fmtPos(it.pos)) : i === nextIndex ? t('upNextAt', fmtPos(it.pos)) : t('resumesAt', fmtPos(it.pos))}
              </span>
            </button>
            <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
              {!playing && <Op label={t('cutToNow')} onClick={() => onPlay(i)}><Play className="size-3" /></Op>}
              <Op label={t('remove')} className="hover:text-destructive" onClick={() => onRemove(i)}><X className="size-3" /></Op>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// Small icon in front of a local file's title.
function FileMark({ it }: { it: QueueItem }) {
  if (it.kind !== 'file') return null
  const I = it.media === 'video' ? FileVideo : FileAudio
  return <I className="mr-1 inline size-3 -translate-y-px text-muted-foreground" />
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-3 py-8 text-center text-xs leading-relaxed text-muted-foreground">{children}</p>
}

function Op({ label, onClick, className, children, disabled }: { disabled?: boolean; label: string; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" aria-label={label} disabled={disabled} className={cn('disabled:opacity-30 focus-visible:outline-2 focus-visible:outline-primary grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground', className)} onClick={(e) => { e.stopPropagation(); onClick() }}>{children}</button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
