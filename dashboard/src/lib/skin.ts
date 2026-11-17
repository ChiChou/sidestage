// The panel's look: one of the built-in skins in src/skins.css, picked from the header menu and
// remembered in localStorage. Applying a skin sets `data-skin` on <html> and toggles the `dark`
// class so shadcn's `dark:` variants match. Users cannot edit skins or CSS yet.
import type { MsgKey } from '@/lib/i18n'

export const SKINS = ['stage', 'dark', 'light'] as const
export type Skin = (typeof SKINS)[number]

const DARK: Record<Skin, boolean> = { stage: true, dark: true, light: false }
export const SKIN_LABELS: Record<Skin, MsgKey> = { stage: 'skinStage', dark: 'skinDark', light: 'skinLight' }
const KEY = 'skin'

let skin: Skin = 'stage'
const listeners = new Set<() => void>()

export const isSkin = (v: unknown): v is Skin => typeof v === 'string' && (SKINS as readonly string[]).includes(v)
export const getSkin = () => skin
export const isDarkSkin = (s: Skin = skin) => DARK[s]

function apply(s: Skin) {
  skin = s
  const html = document.documentElement
  html.dataset.skin = s
  html.classList.toggle('dark', DARK[s])
  listeners.forEach((l) => l())
}

// Call before the first render so the page never flashes another skin.
export function initSkin() {
  let stored: string | null = null
  try { stored = localStorage.getItem(KEY) } catch { /* storage unavailable */ }
  apply(isSkin(stored) ? stored : 'stage')
}

export function setSkin(s: Skin) {
  try { localStorage.setItem(KEY, s) } catch { /* storage unavailable */ }
  apply(s)
}

export function subscribeSkin(l: () => void) {
  listeners.add(l)
  return () => { listeners.delete(l) }
}
