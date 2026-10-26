// Display formatting. Every formatter shows null/undefined/NaN as an en dash and uses a true minus sign.

export const DASH = '–'
const MINUS = '−'
const TZ = 'Europe/London'

type Num = number | null | undefined

const ok = (v: Num): v is number => v != null && Number.isFinite(v)

const fixed = (v: number, dp: number): string =>
  v.toLocaleString('en-GB', { minimumFractionDigits: dp, maximumFractionDigits: dp }).replace('-', MINUS)

// Rounding can turn -0.04 into "-0.0"; a signed zero reads as a direction that isn't there.
const signed = (v: number, dp: number): string => {
  const s = fixed(Math.abs(v), dp)
  if (Number(s.replace(/,/g, '')) === 0) return s
  return (v < 0 ? MINUS : '+') + s
}

export const gw = (mw: Num, dp = 1): string => (ok(mw) ? `${fixed(mw / 1000, dp)} GW` : DASH)
export const signedGw = (mw: Num, dp = 1): string => (ok(mw) ? `${signed(mw / 1000, dp)} GW` : DASH)
export const mw = (v: Num): string => (ok(v) ? `${fixed(v, 0)} MW` : DASH)
export const signedMw = (v: Num): string => (ok(v) ? `${signed(v, 0)} MW` : DASH)
export const pct = (frac: Num, dp = 0): string => (ok(frac) ? `${fixed(frac * 100, dp)}%` : DASH)
export const signedPct = (frac: Num, dp = 0): string => (ok(frac) ? `${signed(frac * 100, dp)}%` : DASH)
export const gwh = (v: Num, dp = 1): string => (ok(v) ? `${fixed(v, dp)} GWh` : DASH)

/** A change between two levels: MW integers under 1 GW, GW at 1 dp above, always signed. */
export const signedDelta = (v: Num): string => (ok(v) && Math.abs(v) >= 999.5 ? signedGw(v) : signedMw(v))
/** The same, unsigned, for sentences that carry the direction in words ("error 392 MW smaller"). */
export const delta = (v: Num): string =>
  ok(v) && Math.abs(v) >= 999.5 ? gw(Math.abs(v)) : mw(ok(v) ? Math.abs(v) : v)

/** The one user-facing error convention: forecast minus actual, so + means the forecast was too high. The API sends
 * errors as actual minus forecast; every screen goes through this. */
export const overForecast = (actualMinusForecast: Num): number | null =>
  ok(actualMinusForecast) ? -actualMinusForecast : null
export const biasGw = (actualMinusForecast: Num, dp = 1): string =>
  signedGw(overForecast(actualMinusForecast), dp)

/** "1.6–2.4 GW" for a CI given in MW; the en dash makes negative ranges read "−2.2 to −1.3 GW". */
export function gwRange(lo: Num, hi: Num, dp = 1): string {
  if (!ok(lo) || !ok(hi)) return DASH
  const a = fixed(lo / 1000, dp)
  const b = fixed(hi / 1000, dp)
  return lo < 0 || hi < 0 ? `${a} to ${b} GW` : `${a}–${b} GW`
}

export function mwRange(lo: Num, hi: Num): string {
  if (!ok(lo) || !ok(hi)) return DASH
  const sep = lo < 0 || hi < 0 ? ' to ' : '–'
  return `${fixed(lo, 0)}${sep}${fixed(hi, 0)} MW`
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })
const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
})
const ukDayFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
// Delivery days are calendar dates, not instants: format them in UTC so no zone can shift the date.
const dayFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})
const dayShortFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' })

const instant = (iso: string | null | undefined): Date | null => {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}
const calendar = (day: string | null | undefined): Date | null => instant(day ? `${day}T00:00:00Z` : null)

/** UK local clock time of a UTC instant, e.g. "07:30". */
export const ukTime = (iso: string | null | undefined): string => {
  const d = instant(iso)
  return d ? timeFmt.format(d) : DASH
}
/** "Sun 11 Jan, 07:30" in UK local time. */
export const ukDateTime = (iso: string | null | undefined): string => {
  const d = instant(iso)
  return d ? dateTimeFmt.format(d) : DASH
}
/** "Sun 11 Jan": the UK local date of a UTC instant. */
export const ukDay = (iso: string | null | undefined): string => {
  const d = instant(iso)
  return d ? ukDayFmt.format(d) : DASH
}
/** "Mon 12 Jan" for a YYYY-MM-DD delivery day. */
export const dayLabel = (day: string | null | undefined): string => {
  const d = calendar(day)
  return d ? dayFmt.format(d) : DASH
}
/** "12 Jan". */
export const dayShort = (day: string | null | undefined): string => {
  const d = calendar(day)
  return d ? dayShortFmt.format(d) : DASH
}

/** UTC epoch ms of a UK wall-clock time (HH:MM) on a YYYY-MM-DD day: guess the instant as if UTC, then remove the UK
 * offset in force at the guess. Exact except inside the hour the clocks skip in spring. */
export function ukWallTime(day: string, hhmm: string): number {
  const guess = Date.parse(`${day}T${hhmm}:00Z`)
  const wall = Date.parse(`${new Date(guess).toLocaleString('sv-SE', { timeZone: TZ }).replace(' ', 'T')}Z`)
  return guess - (wall - guess)
}

/** UTC epoch ms of 00:00 UK time on a YYYY-MM-DD day. The clocks change at 01:00 UTC, so the offset at the guess is the
 * one in force at UK midnight. */
export const ukMidnight = (day: string): number => ukWallTime(day, '00:00')

/** The YYYY-MM-DD calendar day `n` days from `day`. */
export const addDays = (day: string, n: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

export const leadRange = (min: Num, max: Num): string =>
  ok(min) && ok(max) ? `${Math.round(min)}–${Math.round(max)} h ahead` : DASH

/** "P90" for a 10% accepted shortfall: the level actual wind beat in 90% of past hours. */
export const pLabel = (r: number): string => `P${100 - r}`

/** "9 of 10" hours beat the firm level at 10% shortfall; "half the" at 50%. Callers append "hours". */
export function beatLabel(r: number): string {
  if (r === 50) return 'half the'
  const n = 100 / r
  return Number.isInteger(n) ? `${n - 1} of ${n}` : `${100 - r} of 100`
}

/** "1 in 10" for 10%, "1 in 2" for 50%, "30 in 100" for 30%; callers append the noun ("hours"). */
export function riskLabel(r: number): string {
  const n = 100 / r
  return Number.isInteger(n) ? `1 in ${n}` : `${r} in 100`
}

/** "EPEX 09:20", "N2EX 09:50" or "08:45 (custom)" from the API's echoed params. */
export function gateLabel(cutoff: string, cutoffLocal: string): string {
  if (cutoff === 'epex') return `EPEX ${cutoffLocal}`
  if (cutoff === 'n2ex') return `N2EX ${cutoffLocal}`
  return `${cutoffLocal} (custom)`
}
