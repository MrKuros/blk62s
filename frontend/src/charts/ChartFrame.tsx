import { scaleLinear, type ScaleLinear } from 'd3-scale'
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import './charts.css'

export type Scale = ScaleLinear<number, number>
export interface Tick {
  value: number
  label: string
  anchor?: 'start' | 'middle' | 'end'
}
export interface Plot {
  x: Scale
  y: Scale
  width: number
  height: number
}

const M = { top: 12, right: 16, bottom: 28, left: 44 }
const HOUR = 3_600_000

const gwNumber = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })
const londonHM = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** Axis tick: GW without unit or trailing zeros, true minus, optional explicit plus. */
export const gwTick = (mw: number, signed = false) =>
  (signed && mw > 0 ? '+' : '') + gwNumber.format(mw / 1000).replace('-', '−')
/** UK local clock time of an epoch-ms instant (lib/format's ukTime takes ISO strings). */
export const clock = (ms: number) => londonHM.format(ms)

/** Ticks on Europe/London whole hours (every 3 h, or 6 h when narrow); UK offsets are whole hours. */
export function hourTicks(x: Scale, width: number): Tick[] {
  const [a = 0, b = 0] = x.domain()
  const step = width < 420 ? 6 : 3
  const ticks: Tick[] = []
  for (let t = Math.ceil(a / HOUR) * HOUR; t <= b; t += HOUR) {
    const label = clock(t)
    if (Number(label.slice(0, 2)) % step === 0) ticks.push({ value: t, label })
  }
  return ticks
}

/** Index of the value in `xs` nearest to `v`; `xs` is short (≤ 100), so a scan beats a bisect import. */
const nearest = (xs: number[], v: number) =>
  xs.reduce((best, x, i) => (Math.abs(x - v) < Math.abs((xs[best] ?? x) - v) ? i : best), 0)

export function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(640)
  // Layout effect: measure before first paint so phones never flash a 640 px chart.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(Math.round(el.getBoundingClientRect().width) || 640)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      // Hidden containers report 0; keep the last real width instead of collapsing the chart.
      if (entry && entry.contentRect.width > 0) setWidth(Math.round(entry.contentRect.width))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

interface Props {
  ariaLabel: string
  xDomain: [number, number]
  yDomain: [number, number]
  height?: number
  xTicks?: (x: Scale, width: number) => Tick[]
  yFormat?: (v: number) => string
  yLabel?: string
  /** Axis title under the x ticks. */
  xLabel?: string
  /** X positions the crosshair snaps to; with `tooltip`, enables pointer and arrow-key readout. */
  snap?: number[]
  tooltip?: (i: number) => ReactNode
  legend?: ReactNode
  children: (plot: Plot) => ReactNode
}

export function ChartFrame({
  ariaLabel,
  xDomain,
  yDomain,
  height = 280,
  xTicks,
  yFormat = (v) => gwTick(v),
  yLabel,
  xLabel,
  snap = [],
  tooltip,
  legend,
  children,
}: Props) {
  const [ref, outerWidth] = useWidth()
  const [active, setActive] = useState<number | null>(null)
  const width = Math.max(0, outerWidth - M.left - M.right)
  const innerHeight = height - M.top - M.bottom
  const [x0, x1] = xDomain
  const [y0, y1] = yDomain
  const x = useMemo(() => scaleLinear().domain([x0, x1]).range([0, width]), [x0, x1, width])
  const y = useMemo(() => scaleLinear().domain([y0, y1]).range([innerHeight, 0]), [y0, y1, innerHeight])
  // Hover only moves the crosshair and tip; the plot layer (many paths in Replay) re-renders only on new data or size.
  const layer = useMemo(() => children({ x, y, width, height: innerHeight }), [children, x, y, width, innerHeight])
  const interactive = !!tooltip && snap.length > 0
  const xt: Tick[] = xTicks ? xTicks(x, width) : x.ticks(Math.max(2, width / 90)).map((v) => ({ value: v, label: String(v) }))
  const yt = y.ticks(5).map((v) => ({ value: v, label: yFormat(v) }))
  const at = active == null ? undefined : snap[active]

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left - M.left
    setActive(nearest(snap, x.invert(px)))
  }
  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    const last = snap.length - 1
    const cur = active ?? -1
    const next = { ArrowRight: Math.min(last, cur + 1), ArrowLeft: Math.max(0, cur - 1), Home: 0, End: last }[e.key]
    if (next !== undefined) {
      e.preventDefault()
      setActive(next)
    } else if (e.key === 'Escape') setActive(null)
  }
  const tipLeft = at === undefined ? 0 : M.left + x(at)
  // On narrow charts a tip beside the crosshair can run off-screen, so dock it across the top instead.
  const docked = outerWidth < 480

  return (
    <figure className="chart">
      {yLabel && <div className="chart-ylabel">{yLabel}</div>}
      <div className="chart-body" ref={ref}>
        <svg
          width={outerWidth}
          height={height}
          role="img"
          aria-label={interactive ? `${ariaLabel} Use the arrow keys to read values.` : ariaLabel}
          tabIndex={interactive ? 0 : undefined}
          onPointerMove={interactive ? onPointerMove : undefined}
          onPointerLeave={interactive ? () => setActive(null) : undefined}
          onKeyDown={interactive ? onKeyDown : undefined}
          onBlur={interactive ? () => setActive(null) : undefined}
        >
          <g transform={`translate(${M.left},${M.top})`}>
            <g className="grid axis">
              {yt.map((t) => (
                <g key={t.value} transform={`translate(0,${y(t.value)})`}>
                  <line x2={width} />
                  <text x={-8} dy="0.32em" textAnchor="end">
                    {t.label}
                  </text>
                </g>
              ))}
            </g>
            <line className="axis-line" y1={innerHeight} y2={innerHeight} x2={width} />
            <g className="axis" transform={`translate(0,${innerHeight})`}>
              {xt.map((t) => (
                <text key={t.value} x={x(t.value)} y={18} textAnchor={t.anchor ?? 'middle'}>
                  {t.label}
                </text>
              ))}
            </g>
            {layer}
            {at !== undefined && <line className="crosshair" x1={x(at)} x2={x(at)} y2={innerHeight} />}
          </g>
        </svg>
        {interactive && (
          // Always mounted: screen readers skip live regions that arrive already filled.
          <div className="sr-only" aria-live="polite">
            {active != null && tooltip(active)}
          </div>
        )}
        {active != null && tooltip && (
          <div
            className={docked ? 'chart-tip chart-tip-docked' : 'chart-tip'}
            aria-hidden="true"
            style={
              docked
                ? { left: 0, right: 0, top: M.top }
                : {
                    left: tipLeft,
                    top: M.top,
                    transform: tipLeft > outerWidth / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
                  }
            }
          >
            {tooltip(active)}
          </div>
        )}
      </div>
      {xLabel && <div className="chart-xlabel">{xLabel}</div>}
      {legend && <figcaption className="chart-legend">{legend}</figcaption>}
    </figure>
  )
}

/** Legend key that mirrors the mark: a stroke for lines, a block for areas. Uses the series' own class. */
export function Key({ mark, className, label }: { mark: 'line' | 'area' | 'dot'; className: string; label: string }) {
  return (
    <span className="legend-item">
      <svg width={18} height={10} aria-hidden="true">
        {mark === 'line' && <line className={className} x1={1} x2={17} y1={5} y2={5} />}
        {mark === 'area' && <rect className={className} width={18} height={10} rx={2} />}
        {mark === 'dot' && <circle className={className} cx={9} cy={5} r={4} />}
      </svg>
      {label}
    </span>
  )
}

export function TipRow({ className, label, value }: { className?: string; label: string; value: string }) {
  return (
    <div className="tip-row">
      {className && (
        <svg width={12} height={8} aria-hidden="true">
          <line className={className} x1={0} x2={12} y1={4} y2={4} />
        </svg>
      )}
      <span className="num">{value}</span>
      <span>{label}</span>
    </div>
  )
}
