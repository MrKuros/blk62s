import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import type { components } from '../lib/api-types'
import { biasGw, delta, gw, gwRange, mwRange } from '../lib/format'
import { ChartFrame, gwTick, Key, TipRow } from './ChartFrame'

type WaitingSlot = components['schemas']['WaitingSlot']
type Gate = components['schemas']['Gate']
type Gain = components['schemas']['Gain']

interface Props {
  slots: WaitingSlot[]
  gates: Gate[]
  gain?: Gain
}

const DAY = 1440
const GATE_LABEL: Record<Gate['auction'], string> = { epex: 'EPEX', n2ex: 'N2EX' }

/** Minutes from D-2 00:00 local, so slots and gates share one honest time axis. */
const minutes = (dayOffset: -2 | -1, hhmm: string) =>
  (dayOffset + 2) * DAY + Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const slotName = (s: WaitingSlot) => `D-${-s.day_offset} ${s.local_time}`
const unavailable = (s: WaitingSlot) => s.post_gate.epex && s.post_gate.n2ex

const axisTicks = (_: unknown, width: number) => {
  const step = width < 480 ? 720 : 360
  return Array.from({ length: (2 * DAY) / step + 1 }, (_, i) => {
    const m = i * step
    const label = m % DAY ? `${String((m % DAY) / 60).padStart(2, '0')}:00` : ['D-2', 'D-1', 'D'][m / DAY]
    return { value: m, label: label ?? '', anchor: m === 2 * DAY ? ('end' as const) : undefined }
  })
}

export function WaitingCurve({ slots, gates, gain }: Props) {
  const pts = slots.map((s) => ({ s, m: minutes(s.day_offset, s.local_time) })).sort((a, b) => a.m - b.m)
  const gateAt = gates.map((g) => ({ g, m: minutes(-1, g.local_time) })).sort((a, b) => a.m - b.m)
  const lastGate = gateAt.at(-1)?.m ?? 2 * DAY
  const firstGate = gateAt[0]
  const yMax = scaleLinear()
    .domain([0, Math.max(1000, ...pts.map((p) => p.s.mae.hi))])
    .nice()
    .domain()[1] ?? 1000
  const highlight = new Set(gain ? [gain.from_slot, gain.to_slot] : [])
  const best = pts.filter((p) => !unavailable(p.s)).reduce<(typeof pts)[number] | undefined>(
    (b, p) => (!b || p.s.mae.value < b.s.mae.value ? p : b),
    undefined,
  )

  const tooltip = (i: number) => {
    const p = pts[i]
    if (!p) return null
    const { mae, bias } = p.s
    return (
      <>
        <div className="chart-tip-title">{slotName(p.s)} run</div>
        <TipRow className="s-waiting" label={`mean absolute error (${gwRange(mae.lo, mae.hi)})`} value={gw(mae.value)} />
        <TipRow label="forecast bias (+ = too high)" value={biasGw(bias)} />
        {unavailable(p.s) && <div className="tip-note">Not available day-ahead</div>}
      </>
    )
  }

  const fromSlot = pts.find((p) => p.s.id === gain?.from_slot)?.s
  const toSlot = pts.find((p) => p.s.id === gain?.to_slot)?.s

  return (
    <ChartFrame
      ariaLabel={`Mean absolute error of each forecast run from D-2 to D-1 on the same delivery hours, with gate closures marked.${
        best ? ` The best run available day-ahead is ${slotName(best.s)}, with a mean absolute error of ${gw(best.s.mae.value)}.` : ''
      }`}
      xDomain={[0, 2 * DAY]}
      yDomain={[0, yMax]}
      xTicks={axisTicks}
      yFormat={(v) => gwTick(v)}
      yLabel="Mean absolute error, GW"
      snap={pts.map((p) => p.m)}
      tooltip={tooltip}
      legend={
        <>
          <Key mark="dot" className="dot s-waiting" label="Mean absolute error, with 90% range" />
          {gain && <Key mark="dot" className="dot s-waiting ring" label="Compared runs" />}
          <Key mark="area" className="post-gate" label="Not available day-ahead" />
          {gain && fromSlot && toSlot && (
            <span className="legend-note">
              Waiting from {slotName(fromSlot)} to {slotName(toSlot)} ({GATE_LABEL[gain.auction]}): error{' '}
              {delta(gain.diff.value)} {gain.diff.value <= 0 ? 'smaller' : 'larger'} (saving 90% range {mwRange(-gain.diff.hi, -gain.diff.lo)})
            </span>
          )}
        </>
      }
    >
      {({ x, y, height }) => {
        const path = line<(typeof pts)[number]>()
          .x((p) => x(p.m))
          .y((p) => y(p.s.mae.value))
        return (
          <>
            <rect className="post-gate" x={x(lastGate)} width={x(2 * DAY) - x(lastGate)} height={height} />
            {/* Narrow: the legend names the shading; in the plot it would collide with the gate labels. */}
            {x(2 * DAY) - x(lastGate) > 170 && (
              <text className="direct-label" x={x(2 * DAY) - 6} y={42} textAnchor="end">
                Not available day-ahead
              </text>
            )}
            {/* The two gates sit 30 min apart: one band, one stacked label, so the names never collide. */}
            {firstGate && (
              <>
                <rect className="gate-band" x={x(firstGate.m)} width={Math.max(2, x(lastGate) - x(firstGate.m))} height={height} />
                {gateAt.map(({ g, m }) => (
                  <line key={g.auction} className="gate" x1={x(m)} x2={x(m)} y2={height} />
                ))}
                <text className="direct-label" x={x(firstGate.m) - 6} y={12} textAnchor="end">
                  {gateAt.map(({ g }, i) => (
                    <tspan key={g.auction} x={x(firstGate.m) - 6} dy={i ? 15 : 0}>
                      {GATE_LABEL[g.auction]} {g.local_time}
                    </tspan>
                  ))}
                </text>
              </>
            )}
            <path className="line s-waiting-line" d={path(pts) ?? ''} />
            {pts.map(({ s, m }) => (
              <g key={s.id} className={unavailable(s) ? 'faded' : undefined}>
                <line className="whisker" x1={x(m)} x2={x(m)} y1={y(s.mae.lo)} y2={y(s.mae.hi)} />
                <line className="whisker" x1={x(m) - 3} x2={x(m) + 3} y1={y(s.mae.lo)} y2={y(s.mae.lo)} />
                <line className="whisker" x1={x(m) - 3} x2={x(m) + 3} y1={y(s.mae.hi)} y2={y(s.mae.hi)} />
                <circle className={`dot s-waiting${highlight.has(s.id) ? ' ring' : ''}`} cx={x(m)} cy={y(s.mae.value)} r={4.5} />
              </g>
            ))}
          </>
        )
      }}
    </ChartFrame>
  )
}
