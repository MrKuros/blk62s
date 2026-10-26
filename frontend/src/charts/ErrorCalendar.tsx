import type { KeyboardEvent } from 'react'
import { dayLabel, dayShort, gw, signedGw } from '../lib/format'
import './charts.css'

export interface CalendarDay {
  day: string // YYYY-MM-DD delivery day
  value: number | null // mean forecast − actual, MW (positive = forecast too high)
}

interface Props {
  days: CalendarDay[]
  selected: string
  pins: string[]
  onSelect: (day: string) => void
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const describe = (v: number | null) => (v == null ? 'no data' : `forecast too ${v > 0 ? 'high' : 'low'} by ${gw(Math.abs(v))}`)

/** Monday-first weekday index of a delivery day. */
const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7

/** One cell per delivery day on a Monday-first calendar, shaded by forecast error: amber where the forecast was too
 * high, blue where too low. A radiogroup: arrows move a day, up/down a week. */
export function ErrorCalendar({ days, selected, pins, onSelect }: Props) {
  const extent = Math.max(1, ...days.map((d) => Math.abs(d.value ?? 0)))
  // Ramp ends are light enough that ink text stays at WCAG AA on every cell (charts.css).
  const fill = (v: number) => {
    // Square root: one symmetric scale, but small misses still get a visible tint on either side.
    const pct = Math.round(100 * Math.sqrt(Math.min(1, Math.abs(v) / extent)))
    return `color-mix(in srgb, var(${v > 0 ? '--ramp-over' : '--ramp-under'}) ${pct}%, var(--ramp-neutral))`
  }
  const index = days.findIndex((d) => d.day === selected)
  const focusIndex = index === -1 ? 0 : index
  const lead = days[0] ? weekday(days[0].day) : 0

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = days.length - 1
    const step: Record<string, number> = {
      ArrowRight: focusIndex + 1,
      ArrowLeft: focusIndex - 1,
      ArrowDown: focusIndex + 7,
      ArrowUp: focusIndex - 7,
      Home: 0,
      End: last,
    }
    const raw = step[e.key]
    if (raw === undefined) return
    const next = Math.min(last, Math.max(0, raw))
    const day = days[next]
    if (!day) return
    e.preventDefault()
    onSelect(day.day)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }

  return (
    <div className="calendar-wrap">
      <div className="calendar-head" aria-hidden="true">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="calendar" role="radiogroup" aria-label="Delivery day, shaded by forecast error" onKeyDown={onKeyDown}>
        {Array.from({ length: lead }, (_, i) => (
          <span key={`pad-${i}`} aria-hidden="true" />
        ))}
        {days.map((d, i) => {
          const label = `${dayLabel(d.day)}, ${describe(d.value)}`
          const pinned = pins.includes(d.day)
          const first = d.day.endsWith('-01')
          return (
            <button
              key={d.day}
              type="button"
              role="radio"
              aria-checked={d.day === selected}
              aria-label={pinned ? `${label}, notable day` : label}
              title={label}
              tabIndex={i === focusIndex ? 0 : -1}
              className={`day${pinned ? ' day-pin' : ''}`}
              style={{ background: d.value == null ? 'var(--panel)' : fill(d.value) }}
              onClick={() => onSelect(d.day)}
            >
              <span className="day-n">
                {first ? dayShort(d.day) : Number(d.day.slice(8))}
                {pinned && <span className="day-pin-dot" aria-hidden="true" />}
              </span>
              <span className="day-v num">{d.value == null ? '–' : signedGw(d.value).replace(' GW', '')}</span>
            </button>
          )
        })}
      </div>
      <div className="chart-legend" aria-hidden="true">
        <span className="legend-item">
          Forecast too high
          <span className="ramp" />
          Forecast too low
        </span>
        {pins.length > 0 && (
          <span className="legend-item">
            <span className="pin-key" />
            Notable day
          </span>
        )}
        <span className="legend-item">Forecast minus actual, GW, daily average (+ = too high)</span>
      </div>
    </div>
  )
}
