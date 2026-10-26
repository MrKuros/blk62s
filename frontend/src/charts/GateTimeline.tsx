import { scaleLinear } from 'd3-scale'
import { type KeyboardEvent, useRef, useState } from 'react'
import { addDays, dayLabel, leadRange, signedDelta, ukDateTime, ukTime } from '../lib/format'
import type { GateTimeline as Layout, TimelineRun } from '../lib/timeline'
import { clock, useWidth } from './ChartFrame'

interface Props {
  layout: Layout
  day: string
  gateLabel: string // "EPEX 09:20"
  margin: number
}

const HOUR = 3_600_000
const TOP = 8 // frame top
const MID = 66 // revision baseline: stems rise for upward revisions, drop for downward ones
const STEM = 30 // longest stem, px
const AXIS = 112
const H = AXIS + 42

/** A run that repeats its predecessor exactly: the feed did not move. */
export const unchanged = (r: TimelineRun) => r.revisionMw != null && Math.abs(r.revisionMw) < 1

const status = (r: TimelineRun) =>
  r.used
    ? 'Run used for this decision'
    : r.tooLate
      ? 'Published after gate closure: too late'
      : 'Published before gate closure'

const revisionText = (r: TimelineRun) =>
  r.revisionMw == null
    ? null
    : unchanged(r)
      ? 'No change from the previous run'
      : `${signedDelta(r.revisionMw)} average revision vs previous run`

const describe = (r: TimelineRun) =>
  `${ukDateTime(new Date(r.publish).toISOString())}. ${status(r)}.${revisionText(r) ? ` ${revisionText(r)}.` : ''}${
    r.leadMin == null ? '' : ` Covers ${leadRange(r.leadMin, r.leadMax)}.`
  }`

/** D-2 00:00 to D 24:00 (UK): every forecast run as a stem sized by how far it moved the forecast, gate closure, and
 * the delivery day. "What did we know at the gate, and was it still moving?" at a glance. One tab stop; arrows move. */
export function GateTimeline({ layout, day, gateLabel, margin }: Props) {
  const [ref, width] = useWidth()
  const svgRef = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState<number | null>(null)
  const usedIndex = Math.max(
    0,
    layout.runs.findIndex((r) => r.used),
  )
  const [focusIndex, setFocusIndex] = useState(usedIndex)
  const roving = Math.min(focusIndex, Math.max(0, layout.runs.length - 1))
  const narrow = width < 560
  const pad = 12
  const x = scaleLinear()
    .domain([layout.start, layout.end])
    .range([pad, width - pad])
  const used = layout.runs.find((r) => r.used)
  const [d2, d1, d0, end] = layout.dayStarts
  const days = [
    { a: d2, b: d1, name: 'D-2' },
    { a: d1, b: d0, name: 'D-1' },
    { a: d0, b: end, name: 'D' },
  ]
  const ticks: number[] = []
  const step = narrow ? 12 : 6
  for (let t = layout.start; t < layout.end; t += HOUR)
    if (Number(clock(t).slice(0, 2)) % step === 0) ticks.push(t)
  const gx = x(layout.gate)
  const act = active == null ? undefined : layout.runs[active]
  const tipX = act ? x(act.publish) : 0
  // Stems scale to the day's largest revision, but never below 0.5 GW, so a calm day reads as calm.
  const maxRev = Math.max(500, ...layout.runs.map((r) => Math.abs(r.revisionMw ?? 0)))
  const stem = (r: TimelineRun) => (r.revisionMw == null || unchanged(r) ? 0 : (STEM * r.revisionMw) / maxRev)
  const gateText = `${narrow ? 'Gate' : 'Gate closure'} ${gateLabel}${margin ? ` − ${margin} min` : ''}`
  const chipW = gateText.length * 6.6 + 16
  // Inside the frame: right of the rule when it fits, else left of it, never past either edge.
  const chipX = Math.max(pad, gx + chipW > width - pad ? gx - chipW : gx)

  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    const last = layout.runs.length - 1
    const next = { ArrowRight: roving + 1, ArrowLeft: roving - 1, Home: 0, End: last }[e.key]
    if (next === undefined) {
      if (e.key === 'Escape') setActive(null)
      return
    }
    e.preventDefault()
    const n = Math.min(last, Math.max(0, next))
    setFocusIndex(n)
    svgRef.current?.querySelectorAll<SVGGElement>('.tl2-run')[n]?.focus()
  }

  return (
    <figure className="timeline-chart">
      <div className="chart-body" ref={ref}>
        <svg
          ref={svgRef}
          width={width}
          height={H}
          role="group"
          aria-label={`Gate timeline from D-2 to the end of delivery day ${dayLabel(day)}: ${layout.runs.length} forecast runs, ${
            layout.runs.filter((r) => r.tooLate).length
          } of them after gate closure at ${gateLabel}.${used ? ` The run used was published ${ukDateTime(new Date(used.publish).toISOString())}.` : ''} Use the arrow keys to move between runs.`}
        >
          {/* delivery day + too-late region */}
          <rect
            className="tl2-delivery"
            x={x(layout.deliveryStart)}
            y={TOP}
            width={x(layout.end) - x(layout.deliveryStart)}
            height={AXIS - TOP}
          />
          {!narrow && (
            <text className="tl2-band-label" x={x(layout.deliveryStart) + 8} y={TOP + 16}>
              Delivery day
            </text>
          )}
          <rect
            className="tl2-late"
            x={gx}
            y={TOP}
            width={Math.max(0, x(layout.deliveryStart) - gx)}
            height={AXIS - TOP}
          />
          {/* day boundaries and hour grid */}
          {ticks.map((t) => (
            <line
              key={t}
              className={clock(t) === '00:00' ? 'tl2-day-rule' : 'tl2-hour-rule'}
              x1={x(t)}
              x2={x(t)}
              y1={TOP}
              y2={AXIS}
            />
          ))}
          <line className="tl2-base" x1={pad} x2={width - pad} y1={MID} y2={MID} />
          <line className="tl2-axis" x1={pad} x2={width - pad} y1={AXIS} y2={AXIS} />
          {ticks
            .filter((t) => !narrow || clock(t) !== '00:00')
            .map((t) => (
              <text
                key={t}
                className="tl2-tick"
                x={x(t)}
                y={AXIS + 14}
                textAnchor={t === layout.start ? 'start' : 'middle'}
              >
                {clock(t)}
              </text>
            ))}
          {days.map((d, i) => (
            <text
              key={d.name}
              className="tl2-day"
              x={(x(d.a) + x(d.b)) / 2}
              y={AXIS + 32}
              textAnchor="middle"
            >
              <tspan className="tl2-day-name">{d.name}</tspan>
              {!narrow && ` · ${dayLabel(addDays(day, i - 2))}`}
            </text>
          ))}
          {/* the run used: how far ahead it reaches into the delivery day */}
          {used && used.leadMin != null && (
            <g className="tl2-lead">
              <line
                className="tl2-lead-dash"
                x1={x(used.publish)}
                x2={x(layout.deliveryStart)}
                y1={AXIS - 10}
                y2={AXIS - 10}
              />
              <line x1={x(layout.deliveryStart)} x2={x(layout.end) - 4} y1={AXIS - 10} y2={AXIS - 10} />
              <line x1={x(layout.deliveryStart)} x2={x(layout.deliveryStart)} y1={AXIS - 14} y2={AXIS - 6} />
              <line x1={x(layout.end) - 4} x2={x(layout.end) - 4} y1={AXIS - 14} y2={AXIS - 6} />
              <text
                className="tl2-lead-label"
                x={(x(layout.deliveryStart) + x(layout.end)) / 2}
                y={AXIS - 16}
                textAnchor="middle"
              >
                {leadRange(used.leadMin, used.leadMax)}
              </text>
            </g>
          )}
          {/* gate closure: a strong rule with its time chip inside the frame */}
          <line className="tl2-gate" x1={gx} x2={gx} y1={TOP} y2={AXIS} />
          <g className="tl2-chip">
            <rect x={chipX} y={TOP} width={chipW} height={20} rx={3} />
            <text x={chipX + 8} y={TOP + 14}>
              {gateText}
            </text>
          </g>
          {/* runs: one tab stop, arrow keys move between them */}
          <g onKeyDown={onKeyDown}>
            {layout.runs.map((r, i) => {
              const cx = x(r.publish)
              const tip = MID - stem(r)
              const flat = unchanged(r)
              return (
                <g
                  key={r.publish}
                  className={`tl2-run${r.used ? ' is-used' : r.tooLate ? ' is-late' : ''}${flat ? ' is-flat' : ''}${
                    active === i ? ' is-active' : ''
                  }`}
                  tabIndex={i === roving ? 0 : -1}
                  role="img"
                  aria-label={describe(r)}
                  onFocus={() => {
                    setActive(i)
                    setFocusIndex(i)
                  }}
                  onBlur={() => setActive(null)}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                >
                  <rect className="tl2-hit" x={cx - 7} y={TOP} width={14} height={AXIS - TOP} />
                  {r.used && <line className="tl2-used-rule" x1={cx} x2={cx} y1={TOP + 4} y2={AXIS} />}
                  <line x1={cx} x2={cx} y1={MID} y2={tip} />
                  <circle cx={cx} cy={tip} r={r.used ? 5.5 : 4} />
                </g>
              )
            })}
          </g>
          {used && !narrow && (
            <text className="tl2-used-label" x={x(used.publish) - 8} y={TOP + 15} textAnchor="end">
              {ukTime(new Date(used.publish).toISOString())} run used
            </text>
          )}
        </svg>
        {act && (
          <div
            className="chart-tip tl2-tip"
            aria-hidden="true"
            style={{
              left: Math.min(Math.max(tipX, 120), width - 120),
              top: 0,
              transform: 'translate(-50%, calc(-100% - 6px))',
            }}
          >
            <div className="chart-tip-title">{ukDateTime(new Date(act.publish).toISOString())}</div>
            <div className={act.tooLate ? 'tip-late' : act.used ? 'tip-used' : undefined}>{status(act)}</div>
            {revisionText(act) && <div className="tip-row">{revisionText(act)}</div>}
            {act.leadMin != null && <div className="tip-note">{leadRange(act.leadMin, act.leadMax)}</div>}
          </div>
        )}
      </div>
      <figcaption className="chart-legend">
        <span className="legend-item">
          <svg width={12} height={16} aria-hidden="true">
            <line className="key-stem" x1={6} x2={6} y1={8} y2={2} />
            <line className="key-stem" x1={6} x2={6} y1={8} y2={14} />
            <circle className="key-run" cx={6} cy={2.5} r={2.5} />
          </svg>
          Forecast run: stem shows its revision, up or down
        </span>
        <span className="legend-item">
          <svg width={12} height={12} aria-hidden="true">
            <circle className="key-used" cx={6} cy={6} r={5} />
          </svg>
          Run used
        </span>
        <span className="legend-item">
          <svg width={12} height={12} aria-hidden="true">
            <circle className="key-flat" cx={6} cy={6} r={4} />
          </svg>
          No change from previous run
        </span>
        <span className="legend-item">
          <svg width={12} height={12} aria-hidden="true">
            <circle className="key-late" cx={6} cy={6} r={4} />
          </svg>
          After gate closure: too late
        </span>
      </figcaption>
    </figure>
  )
}
