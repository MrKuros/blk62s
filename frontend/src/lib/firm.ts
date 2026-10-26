// Firm wind from the walk-forward ratio grid, computed client-side so the risk control needs no refetch.
// Mirrors backend `analysis.firm` / `analysis.coverage`; parity is checked against Python in firm.test.ts.

export const RISK_PRESETS = { '1in10': 10, '1in20': 5, balanced: 50 } as const
export const R_MIN = 1
export const R_MAX = 50

type MaybeMW = number | null

/** The per-day shape shared by the Firm view and the parity fixture. */
export interface FirmDayInput {
  day: string
  calibrating: boolean
  raw: MaybeMW[]
  corrected: MaybeMW[]
  actual: MaybeMW[]
  q?: number[] | null
}

export interface Coverage {
  hourCov: number
  dayCov: number
  nHours: number
  nDays: number
  shortfallGWh: number
  shortfallDays: number
  firmPct: number
}

export interface CurvePoint {
  target: number
  achieved: number
}

const quantile = (q: readonly number[], i: number): number => {
  const v = q[i]
  if (v === undefined) throw new RangeError(`quantile index ${i} outside the ${q.length}-point grid`)
  return v
}

/** Firm wind per hour: the corrected forecast scaled by the r-th percentile ratio, floored at zero. */
export function firmHours(corrected: readonly MaybeMW[], q: readonly number[], r: number): MaybeMW[] {
  const k = quantile(q, r - 1)
  return corrected.map((c) => (c == null ? null : Math.max(0, c * k)))
}

/** Central band between the r-th and (100 - r)-th percentile; it collapses to the median at r = 50. */
export function band(
  corrected: readonly MaybeMW[],
  q: readonly number[],
  r: number,
): { lo: MaybeMW; hi: MaybeMW }[] {
  const lo = quantile(q, r - 1)
  const hi = quantile(q, 99 - r)
  return corrected.map((c) => (c == null ? { lo: null, hi: null } : { lo: c * lo, hi: c * hi }))
}

/**
 * Achieved coverage of the firm level at shortfall risk r.
 * Calibrating days (no grid yet) and excluded days are left out; hours missing a forecast or actual are skipped.
 * A day counts as covered only when every one of its hours is.
 */
export function coverage(
  days: readonly FirmDayInput[],
  r: number,
  { exclude = [] }: { exclude?: Iterable<string> } = {},
): Coverage {
  const skip = new Set(exclude)
  let nHours = 0
  let covered = 0
  let nDays = 0
  let daysCovered = 0
  let shortMW = 0
  let firmSum = 0
  let rawSum = 0
  for (const d of days) {
    if (d.calibrating || !d.q || skip.has(d.day)) continue
    const firm = firmHours(d.corrected, d.q, r)
    let hours = 0
    let allCovered = true
    firm.forEach((f, i) => {
      const a = d.actual[i]
      const raw = d.raw[i]
      if (f == null || a == null || raw == null) return
      hours++
      firmSum += f
      rawSum += raw
      if (a >= f) covered++
      else {
        allCovered = false
        shortMW += f - a
      }
    })
    if (!hours) continue
    nHours += hours
    nDays++
    if (allCovered) daysCovered++
  }
  return {
    hourCov: nHours ? covered / nHours : NaN,
    dayCov: nDays ? daysCovered / nDays : NaN,
    nHours,
    nDays,
    shortfallGWh: shortMW / 1000, // hourly MW summed over hours = MWh
    shortfallDays: nDays - daysCovered,
    firmPct: rawSum ? firmSum / rawSum : NaN,
  }
}

/** Target vs achieved coverage for every r on the grid, hourly and whole-day. */
export function reliabilityCurve(
  days: readonly FirmDayInput[],
  opts: { exclude?: Iterable<string> } = {},
): { hour: CurvePoint[]; day: CurvePoint[] } {
  const exclude = [...(opts.exclude ?? [])]
  const hour: CurvePoint[] = []
  const day: CurvePoint[] = []
  for (let r = R_MAX; r >= R_MIN; r--) {
    const c = coverage(days, r, { exclude })
    const target = 1 - r / 100
    hour.push({ target, achieved: c.hourCov })
    day.push({ target, achieved: c.dayCov })
  }
  return { hour, day }
}

/**
 * Newsvendor rule: accept being short in surplus / (short + surplus) of hours.
 * Expensive shortfalls push r down (firm lower, safer). Degenerate input falls back to balanced.
 */
export function riskFromCosts(short: number, surplus: number): number {
  const r = Math.round((100 * surplus) / (short + surplus))
  if (!Number.isFinite(r) || short < 0 || surplus < 0) return RISK_PRESETS.balanced
  return Math.min(R_MAX, Math.max(R_MIN, r))
}

/** GWh to secure beyond wind: the forecast you can't count on, summed over the day's hours. */
export function planGWh(raw: readonly MaybeMW[], firm: readonly MaybeMW[]): number {
  let mwh = 0
  raw.forEach((v, i) => {
    const f = firm[i]
    if (v != null && f != null) mwh += v - f
  })
  return mwh / 1000
}

export const mean = (xs: readonly MaybeMW[]): number | null => {
  let s = 0
  let n = 0
  for (const x of xs) {
    if (x == null) continue
    s += x
    n++
  }
  return n ? s / n : null
}
