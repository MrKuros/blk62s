import type { KeyboardEvent } from 'react'
import { dayLabel, gw } from '../lib/format'
import './charts.css'

export interface StripDay {
  day: string // YYYY-MM-DD delivery day
  value: number | null // level: mean forecast MW; error: mean actual − forecast MW (negative = over-forecast)
}

interface Props {
  days: StripDay[]
  mode: 'level' | 'error'
  selected: string
  pins: string[]
  onSelect: (day: string) => void
}

const describe = (mode: Props['mode'], v: number | null) => {
  if (v == null) return 'no data'
  if (mode === 'level') return `forecast average ${gw(v)}`
  return `${v < 0 ? 'over' : 'under'}-forecast by ${gw(Math.abs(v))}`
}

export function DayStrip({ days, mode, selected, pins, onSelect }: Props) {
  const extent = Math.max(1, ...days.map((d) => Math.abs(d.value ?? 0)))
  // Level is sequential (neutral → blue) so it doesn't hint at error; error diverges red (over) / blue (under).
  // Ramp ends are light enough that ink day numbers stay at WCAG AA on every cell (charts.css).
  const fill = (v: number) => {
    const pct = Math.round(100 * Math.min(1, Math.abs(v) / extent))
    const end = mode === 'error' && v < 0 ? '--ramp-over' : '--ramp-under'
    return `color-mix(in srgb, var(${end}) ${pct}%, var(--ramp-neutral))`
  }
  const index = days.findIndex((d) => d.day === selected)
  const focusIndex = index === -1 ? 0 : index

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = days.length - 1
    const step: Record<string, number> = {
      ArrowRight: Math.min(last, focusIndex + 1),
      ArrowDown: Math.min(last, focusIndex + 1),
      ArrowLeft: Math.max(0, focusIndex - 1),
      ArrowUp: Math.max(0, focusIndex - 1),
      Home: 0,
      End: last,
    }
    const next = step[e.key]
    const day = next === undefined ? undefined : days[next]
    if (!day) return
    e.preventDefault()
    onSelect(day.day)
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next ?? 0]?.focus()
  }

  return (
    <div className="daystrip-wrap">
      <div
        className="daystrip"
        role="radiogroup"
        aria-label={mode === 'level' ? 'Delivery day, shaded by forecast level' : 'Delivery day, shaded by forecast error'}
        onKeyDown={onKeyDown}
      >
        {days.map((d, i) => {
          const label = `${dayLabel(d.day)}, ${describe(mode, d.value)}`
          const pinned = pins.includes(d.day)
          return (
            <button
              key={d.day}
              type="button"
              role="radio"
              aria-checked={d.day === selected}
              aria-label={pinned ? `${label}, showcase day` : label}
              title={label}
              tabIndex={i === focusIndex ? 0 : -1}
              className={`day${pinned ? ' day-pin' : ''}`}
              style={{
                background: d.value == null ? 'var(--panel)' : fill(d.value),
              }}
              onClick={() => onSelect(d.day)}
            >
              {Number(d.day.slice(8))}
            </button>
          )
        })}
      </div>
      <div className="chart-legend" aria-hidden="true">
        <span className="legend-item">
          {mode === 'level' ? 'Lower' : 'Over-forecast'}
          <span className={`ramp ramp-${mode}`} />
          {mode === 'level' ? 'Higher forecast' : 'Under-forecast'}
        </span>
        {pins.length > 0 && (
          <span className="legend-item">
            <span className="pin-key" />
            Showcase day
          </span>
        )}
      </div>
    </div>
  )
}
