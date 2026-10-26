// The URL search string is the single source of truth for view state, so every view is shareable.
import { useMemo, useSyncExternalStore } from 'react'
import { RISK_PRESETS, R_MAX, R_MIN } from '../lib/firm'

type AuctionChoice = 'epex' | 'n2ex' | 'custom'
type RiskChoice = '1in10' | '1in20' | 'balanced' | 'custom'
type Margin = 0 | 10 | 20 | 60
type CalibChoice = 'jan' | 'dec'
const TABS = ['decision', 'accuracy', 'firm', 'timing', 'live'] as const
export type Tab = (typeof TABS)[number]

export interface UrlState {
  tab: Tab
  day: string
  auction: AuctionChoice
  t: string
  margin: Margin
  risk: RiskChoice
  r: number
  calib: CalibChoice
  ex28: boolean
  reveal: boolean
  drawer: boolean
}

export const DEFAULTS: UrlState = {
  tab: 'decision',
  day: '2026-01-12',
  auction: 'epex',
  t: '09:20',
  margin: 0,
  risk: '1in10',
  r: RISK_PRESETS['1in10'],
  calib: 'jan',
  ex28: false,
  reveal: false,
  drawer: false,
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const oneOf = <T extends string | number>(v: T | undefined, allowed: readonly T[], fallback: T): T =>
  v !== undefined && allowed.includes(v) ? v : fallback

// Date.parse rolls 2026-02-30 over to 2 March, so round-trip the string to catch impossible dates.
const isDay = (s: string | null): s is string => {
  if (s === null || !DAY.test(s)) return false
  const t = Date.parse(`${s}T00:00:00Z`)
  return Number.isFinite(t) && new Date(t).toISOString().startsWith(s)
}

const flag = (p: URLSearchParams, k: string): boolean => p.get(k) === '1'

export function parseState(search: string): UrlState {
  const p = new URLSearchParams(search)
  const r = Number(p.get('r'))
  const t = p.get('t')
  const day = p.get('day')
  return {
    tab: oneOf(p.get('tab') as Tab, TABS, DEFAULTS.tab),
    day: isDay(day) ? day : DEFAULTS.day,
    auction: oneOf(p.get('auction') as AuctionChoice, ['epex', 'n2ex', 'custom'], DEFAULTS.auction),
    t: t && HHMM.test(t) ? t : DEFAULTS.t,
    margin: oneOf(Number(p.get('margin') ?? 0) as Margin, [0, 10, 20, 60], DEFAULTS.margin),
    risk: oneOf(p.get('risk') as RiskChoice, ['1in10', '1in20', 'balanced', 'custom'], DEFAULTS.risk),
    r: Number.isInteger(r) && r >= R_MIN && r <= R_MAX ? r : DEFAULTS.r,
    calib: oneOf(p.get('calib') as CalibChoice, ['jan', 'dec'], DEFAULTS.calib),
    ex28: flag(p, 'ex28'),
    reveal: flag(p, 'reveal'),
    drawer: flag(p, 'drawer'),
  }
}

/** Only non-default values go in the URL; `t` and `r` only when their custom mode is on. */
export function serializeState(s: UrlState): string {
  const p = new URLSearchParams()
  if (s.tab !== DEFAULTS.tab) p.set('tab', s.tab)
  if (s.day !== DEFAULTS.day) p.set('day', s.day)
  if (s.auction !== DEFAULTS.auction) p.set('auction', s.auction)
  if (s.auction === 'custom') p.set('t', s.t)
  if (s.margin !== DEFAULTS.margin) p.set('margin', String(s.margin))
  if (s.risk !== DEFAULTS.risk) p.set('risk', s.risk)
  if (s.risk === 'custom') p.set('r', String(s.r))
  if (s.calib !== DEFAULTS.calib) p.set('calib', s.calib)
  for (const k of ['ex28', 'reveal', 'drawer'] as const) if (s[k]) p.set(k, '1')
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

/** The API's `cutoff`: the preset id, or the custom HH:MM. */
export const cutoffParam = (s: UrlState): string => (s.auction === 'custom' ? s.t : s.auction)

/** Accepted shortfall, % of hours. */
export const riskR = (s: UrlState): number => (s.risk === 'custom' ? s.r : RISK_PRESETS[s.risk])

const CHANGE = 'urlstatechange'

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange)
  window.addEventListener(CHANGE, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(CHANGE, onChange)
  }
}

const getSearch = () => window.location.search

/**
 * Apply a patch. A new day or tab is a navigation (pushState, so Back returns to it); a new day also hides the
 * reveal again. Every other control edits the current entry (replaceState).
 */
export function updateUrlState(patch: Partial<UrlState>): void {
  const current = parseState(getSearch())
  const dayChanged = patch.day !== undefined && patch.day !== current.day
  const next = { ...current, ...(dayChanged ? { reveal: false } : {}), ...patch }
  const search = serializeState(next)
  if (search === serializeState(current)) return
  const href = `${window.location.pathname}${search}${window.location.hash}`
  if (dayChanged || next.tab !== current.tab) window.history.pushState(null, '', href)
  else window.history.replaceState(null, '', href)
  window.dispatchEvent(new Event(CHANGE))
}

export function useUrlState(): [UrlState, (patch: Partial<UrlState>) => void] {
  const search = useSyncExternalStore(subscribe, getSearch, () => '')
  const state = useMemo(() => parseState(search), [search])
  return [state, updateUrlState]
}
