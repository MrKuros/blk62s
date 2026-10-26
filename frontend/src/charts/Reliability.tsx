import { line } from 'd3-shape'
import type { CurvePoint as ReliabilityPoint } from '../lib/firm'
import { pct } from '../lib/format'
import { ChartFrame, Key, TipRow } from './ChartFrame'

interface Props {
  hour: ReliabilityPoint[] // fractions, as lib/firm reliabilityCurve returns them
  day: ReliabilityPoint[]
  marker?: number // selected target fraction
}

const byTarget = (a: ReliabilityPoint, b: ReliabilityPoint) => a.target - b.target

export function Reliability({ hour, day, marker }: Props) {
  const hours = [...hour].sort(byTarget)
  const days = [...day].sort(byTarget)
  const all = [...hours, ...days]
  // One shared domain on both axes keeps the target diagonal at 45°, so miscalibration reads as distance from it.
  const lo = Math.min(0.5, Math.floor(Math.min(...all.flatMap((p) => [p.target, p.achieved])) * 10) / 10)
  const snap = hours.map((p) => p.target)
  const nearestTo = (pts: ReliabilityPoint[], t: number) =>
    pts.reduce<ReliabilityPoint | undefined>((b, p) => (!b || Math.abs(p.target - t) < Math.abs(b.target - t) ? p : b), undefined)
  const hourAt = marker == null ? undefined : nearestTo(hours, marker)
  const dayAt = marker == null ? undefined : nearestTo(days, marker)

  const summary =
    hourAt && dayAt
      ? ` At a ${pct(hourAt.target)} target, ${pct(hourAt.achieved)} of hours and ${pct(dayAt.achieved)} of whole days were covered.`
      : ''

  const tooltip = (i: number) => {
    const t = snap[i] ?? 0
    const d = nearestTo(days, t)
    return (
      <>
        <div className="chart-tip-title">Target {pct(t)}</div>
        <TipRow className="s-hour" label="of hours covered" value={pct(hours[i]?.achieved ?? 0)} />
        {d && <TipRow className="s-day" label="of whole days covered" value={pct(d.achieved)} />}
      </>
    )
  }

  return (
    <ChartFrame
      ariaLabel={`Reliability: target coverage against achieved coverage, for single hours and whole days.${summary}`}
      xDomain={[lo, 1]}
      yDomain={[lo, 1]}
      xTicks={(x) => x.ticks(5).map((v) => ({ value: v, label: pct(v) }))}
      yFormat={(v) => pct(v)}
      yLabel="Achieved coverage"
      snap={snap}
      tooltip={tooltip}
      legend={
        <>
          <Key mark="line" className="s-hour" label="Hours covered" />
          <Key mark="line" className="s-day" label="Whole days covered" />
          <Key mark="line" className="s-target" label="Target (perfect calibration)" />
        </>
      }
    >
      {({ x, y }) => {
        const path = line<ReliabilityPoint>()
          .x((p) => x(p.target))
          .y((p) => y(p.achieved))
        // Label each line at its low-target end, where hourly and whole-day coverage sit furthest apart.
        const starts = [
          { cls: 's-hour', p: hours[0], label: 'Hours' },
          { cls: 's-day', p: days[0], label: 'Whole days' },
        ]
        return (
          <>
            <line className="line s-target" x1={x(lo)} y1={y(lo)} x2={x(1)} y2={y(1)} />
            {hourAt && <line className="marker-rule" x1={x(hourAt.target)} x2={x(hourAt.target)} y1={y(lo)} y2={y(1)} />}
            <path className="line s-day" d={path(days) ?? ''} />
            <path className="line s-hour" d={path(hours) ?? ''} />
            {[
              { cls: 's-hour', p: hourAt },
              { cls: 's-day', p: dayAt },
            ].map(
              ({ cls, p }) => p && <circle key={cls} className={`dot ${cls}`} cx={x(p.target)} cy={y(p.achieved)} r={4.5} />,
            )}
            {starts.map(
              ({ cls, p, label }) =>
                p && (
                  <text key={cls} className="direct-label" x={x(p.target) + 4} y={y(p.achieved) - 8}>
                    {label}
                  </text>
                ),
            )}
          </>
        )
      }}
    </ChartFrame>
  )
}
