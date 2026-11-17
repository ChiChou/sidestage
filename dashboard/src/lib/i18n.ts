// Runtime translations for the extension pages, laid out the way Chrome's i18n docs describe:
// the strings live in extension/_locales/<locale>/messages.json, the manifest names the
// default_locale and uses __MSG_key__, and lookups go through chrome.i18n.getMessage, which
// follows the browser's UI language. When the DJ picked a language explicitly (storage `lang`)
// that locale's file is fetched instead, the same way background.js serves the content script.
//
// The JSON files are also the type source. MsgKey is the English key set, and the other
// locales must carry exactly the same keys: `typeof import()` is a type-only query, so the
// check costs nothing at runtime and a missing or stale key fails `tsc` naming the key.

type En = typeof import('../../../extension/_locales/en/messages.json')
export type MsgKey = keyof En

type KeyDiff<L> = Exclude<MsgKey, keyof L> | Exclude<keyof L, MsgKey>
type Complete<L> = [KeyDiff<L>] extends [never] ? true : KeyDiff<L>
type Assert<T extends true> = T
export type LocalesComplete = [
  Assert<Complete<typeof import('../../../extension/_locales/zh_CN/messages.json')>>,
  Assert<Complete<typeof import('../../../extension/_locales/it/messages.json')>>,
  Assert<Complete<typeof import('../../../extension/_locales/es/messages.json')>>,
]

export const LOCALES = ['en', 'zh_CN', 'it', 'es'] as const
export type Locale = (typeof LOCALES)[number]
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', zh_CN: '简体中文', it: 'Italiano', es: 'Español' }
export const LOCALE_FLAGS: Record<Locale, string> = { en: '🇬🇧', zh_CN: '🇨🇳', it: '🇮🇹', es: '🇪🇸' }

type Messages = Partial<Record<string, { message: string }>>

let locale: Locale = 'en'
let pref: Locale | 'auto' = 'auto'
let override: Messages | null = null // the chosen locale's file, only when it is not the browser's

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALES as readonly string[]).includes(v)

export function resolveLocale(p: string | undefined | null, ui: string): Locale {
  if (isLocale(p)) return p
  const u = (ui || '').toLowerCase().replace('_', '-')
  if (u.startsWith('zh')) return 'zh_CN'
  if (u.startsWith('it')) return 'it'
  if (u.startsWith('es')) return 'es'
  return 'en'
}

const hasChrome = () => typeof chrome !== 'undefined' && !!chrome.i18n

export async function initI18n() {
  let stored: string | undefined
  try { stored = (await chrome.storage.local.get('lang')).lang as string | undefined } catch { /* not in an extension page */ }
  pref = isLocale(stored) ? stored : 'auto'
  const ui = hasChrome() ? chrome.i18n.getUILanguage() : navigator.language
  locale = resolveLocale(pref, ui)
  override = null
  if (pref !== 'auto' && locale !== resolveLocale(null, ui)) {
    try { override = await (await fetch(chrome.runtime.getURL(`_locales/${locale}/messages.json`))).json() } catch { /* keep the browser language */ }
  }
  document.documentElement.lang = locale.replace('_', '-')
}

export const getLocale = () => locale
export const getLangPref = () => pref

// Persist the choice and reload: every page re-renders from scratch with the new strings.
export async function setLangPref(p: Locale | 'auto') {
  await chrome.storage.local.set({ lang: p })
  location.reload()
}

// `$1`, `$2`, ... are positional substitutions, as in chrome.i18n.getMessage.
export function t(key: MsgKey, ...args: (string | number)[]): string {
  const subs = args.map(String)
  const own = override?.[key]?.message
  if (own != null) return subs.reduce((s, a, i) => s.split(`$${i + 1}`).join(a), own)
  return (hasChrome() && chrome.i18n.getMessage(key, subs)) || key
}
