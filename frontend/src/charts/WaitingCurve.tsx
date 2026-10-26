import { scaleLinear } from 'd3-scale'
import { line } from 'd3-shape'
import type { components } from '../lib/api-types'
import { gw, gwRange, mwRange, signedMw } from '../lib/format'
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
    return { value: m, label: label ?? '' }
  })
}

export function WaitingCurve({ slots, gates, gain }: Props) {
  const pts = slots.map((s) => ({ s, m: minutes(s.day_offset, s.local_time) })).sort((a, b) => a.m - b.m)
  const gateAt = gates.map((g) => ({ g, m: minutes(-1, g.local_time) })).sort((a, b) => a.m - b.m)
  const lastGate = gateAt.at(-1)?.m ?? 2 * DAY
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
        <TipRow className="s-waiting" label={`typical miss (${gwRange(mae.lo, mae.hi)})`} value={gw(mae.value)} />
        <TipRow label={bias < 0 ? 'usually over' : 'usually under'} value={gw(Math.abs(bias))} />
        {unavailable(p.s) && <div className="tip-note">Not available day-ahead</div>}
      </>
    )
  }

  const fromSlot = pts.find((p) => p.s.id === gain?.from_slot)?.s
  const toSlot = pts.find((p) => p.s.id === gain?.to_slot)?.s

  return (
    <ChartFrame
      ariaLabel={`Typical forecast miss for each run from D-2 to D-1 on the same delivery hours, with gate closures marked.${
        best ? ` The best run available day-ahead is ${slotName(best.s)}, missing by ${gw(best.s.mae.value)} in a typical hour.` : ''
      }`}
      xDomain={[0, 2 * DAY]}
      yDomain={[0, yMax]}
      xTicks={axisTicks}
      yFormat={(v) => gwTick(v)}
      yLabel="Typical miss, GW"
      snap={pts.map((p) => p.m)}
      tooltip={tooltip}
      legend={
        <>
          <Key mark="dot" className="dot s-waiting" label="Typical miss, with 90% interval" />
          <Key mark="area" className="post-gate" label="Not available day-ahead" />
          {gain && fromSlot && toSlot && (
            <span className="legend-item">
              Waiting from {slotName(fromSlot)} to {slotName(toSlot)} ({GATE_LABEL[gain.auction]}):{' '}
              <span className="num">{signedMw(gain.diff.value)}</span> ({mwRange(gain.diff.lo, gain.diff.hi)})
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
            <text className="direct-label" x={x(2 * DAY) - 6} y={26} textAnchor="end">
              Not available day-ahead
            </text>
            {gateAt.map(({ g, m }, i) => (
              <g key={g.auction}>
                <line className="gate" x1={x(m)} x2={x(m)} y2={height} />
                {/* Gates sit 30 min apart, so labels go either side of their lines. */}
                <text className="direct-label" x={x(m) + (i ? 4 : -4)} y={10} textAnchor={i ? 'start' : 'end'}>
                  {GATE_LABEL[g.auction]} {g.local_time}
                </text>
              </g>
            ))}
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
