import { area, line } from 'd3-shape'
import { gw, gwRange } from '../lib/format'
import { ChartFrame, clock, hourTicks, Key, TipRow } from './ChartFrame'

export type SeriesStyle = 'raw' | 'corrected' | 'faint' | 'late' | 'actual'
export interface Point {
  t: number // epoch ms, start of the delivery hour
  y: number | null // MW
}
export interface Series {
  id: string
  style: SeriesStyle
  points: Point[]
}
export interface BandPoint {
  t: number
  lo: number
  hi: number
}
export interface ShadePoint {
  t: number
  forecast: number | null
  actual: number | null
}

interface Props {
  series: Series[]
  band?: BandPoint[]
  shade?: ShadePoint[]
  yMax?: number
  ariaLabel: string
}

const DRAW_ORDER: SeriesStyle[] = ['faint', 'late', 'raw', 'corrected', 'actual']
const TIP_ORDER: SeriesStyle[] = ['actual', 'corrected', 'raw']
const LABEL: Record<SeriesStyle, string> = {
  raw: 'Forecast',
  corrected: 'Corrected',
  faint: 'Earlier runs',
  late: 'Too late for the gate',
  actual: 'Delivered',
}
const HOUR = 3_600_000

const both = (d: ShadePoint) => d.forecast != null && d.actual != null

/** Adds the exact points where delivered crosses forecast (both linear between hours), so each shade flips colour there. */
export const withCrossings = (pts: ShadePoint[]) =>
  pts.flatMap((p, i): ShadePoint[] => {
    const n = pts[i + 1]
    if (!n || p.forecast == null || p.actual == null || n.forecast == null || n.actual == null) return [p]
    const d0 = p.actual - p.forecast
    const d1 = n.actual - n.forecast
    if (d0 * d1 >= 0) return [p]
    const s = d0 / (d0 - d1)
    const f = p.forecast + s * (n.forecast - p.forecast)
    return [p, { t: p.t + s * (n.t - p.t), forecast: f, actual: f }]
  })

/** Breaks the band across missing hours (callers drop hours with no band) so it gaps where the lines do. */
const withGaps = (pts: BandPoint[]) =>
  pts.flatMap((b, i) => {
    const prev = pts[i - 1]
    return prev && b.t - prev.t > HOUR ? [{ t: b.t, lo: NaN, hi: NaN }, b] : [b]
  })

export function LineBand({ series, band, shade, yMax, ariaLabel }: Props) {
  const ts = [...series.flatMap((s) => s.points.map((p) => p.t)), ...(band ?? []).map((b) => b.t)]
  const ys = [...series.flatMap((s) => s.points.map((p) => p.y ?? 0)), ...(band ?? []).map((b) => b.hi)]
  const t0 = ts.length ? Math.min(...ts) : 0
  const t1 = ts.length ? Math.max(...ts) : HOUR
  const top = yMax ?? Math.max(5000, Math.ceil((Math.max(0, ...ys) * 1.05) / 5000) * 5000)

  // Earlier and late runs are context; the readout lists the decision run, its correction and the outcome.
  const readable = series.filter((s) => TIP_ORDER.includes(s.style))
  const snap = [...new Set([...readable.flatMap((s) => s.points.map((p) => p.t)), ...(band ?? []).map((b) => b.t)])].sort(
    (a, b) => a - b,
  )
  const lookup = readable.map((s) => ({ style: s.style, at: new Map(s.points.map((p) => [p.t, p.y])) }))
  const bandAt = new Map((band ?? []).map((b) => [b.t, b]))
  const present = new Set(series.map((s) => s.style))
  const lastLate = series.filter((s) => s.style === 'late').at(-1)
  const shadePts = shade && withCrossings(shade)

  const tooltip = (i: number) => {
    const t = snap[i] ?? 0
    const b = bandAt.get(t)
    return (
      <>
        <div className="chart-tip-title">
          {clock(t)}–{clock(t + HOUR)}
        </div>
        {TIP_ORDER.map((style) => {
          const s = lookup.find((l) => l.style === style)
          return s && s.at.has(t) && <TipRow key={style} className={`s-${style}`} label={LABEL[style]} value={gw(s.at.get(t))} />
        })}
        {b && <TipRow className="band-stroke" label="Likely range" value={gwRange(b.lo, b.hi)} />}
      </>
    )
  }

  const legend = (
    <>
      {DRAW_ORDER.filter((s) => present.has(s)).map((s) => (
        <Key key={s} mark="line" className={`s-${s}`} label={LABEL[s]} />
      ))}
      {band && <Key mark="area" className="band" label="Likely range" />}
      {shade && <Key mark="area" className="shade-short" label="Delivered below forecast" />}
      {shade && <Key mark="area" className="shade-surplus" label="Delivered above forecast" />}
    </>
  )

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      xDomain={[t0, t1 > t0 ? t1 : t0 + HOUR]}
      yDomain={[0, top]}
      xTicks={hourTicks}
      yLabel="GW"
      snap={snap}
      tooltip={tooltip}
      legend={legend}
    >
      {({ x, y }) => {
        const path = line<Point>()
          .defined((p) => p.y != null)
          .x((p) => x(p.t))
          .y((p) => y(p.y ?? 0))
        // Clamping the outcome to the forecast on one side gives one area per colour; crossing points keep it exact.
        const between = (edge: (a: number, f: number) => number) =>
          area<ShadePoint>()
            .defined(both)
            .x((d) => x(d.t))
            .y0((d) => y(d.forecast ?? 0))
            .y1((d) => y(edge(d.actual ?? 0, d.forecast ?? 0)))
        const end = lastLate?.points.filter((p) => p.y != null).at(-1)
        return (
          <>
            {band && (
              <path
                className="band"
                d={
                  area<BandPoint>()
                    .defined((b) => !Number.isNaN(b.lo))
                    .x((b) => x(b.t))
                    .y0((b) => y(b.lo))
                    .y1((b) => y(b.hi))(withGaps(band)) ?? ''
                }
              />
            )}
            {shadePts && (
              <g className="reveal">
                <path className="shade-short" d={between(Math.min)(shadePts) ?? ''} />
                <path className="shade-surplus" d={between(Math.max)(shadePts) ?? ''} />
              </g>
            )}
            {DRAW_ORDER.flatMap((style) =>
              series
                .filter((s) => s.style === style)
                .map((s) => (
                  <path key={s.id} className={`line s-${style}${style === 'actual' ? ' reveal' : ''}`} d={path(s.points) ?? ''} />
                )),
            )}
            {end && (
              <text className="direct-label" x={x(end.t)} y={y(end.y ?? 0) - 6} textAnchor="end">
                too late
              </text>
            )}
          </>
        )
      }}
    </ChartFrame>
  )
}
