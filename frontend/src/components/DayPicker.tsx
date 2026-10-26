import { type KeyboardEvent, useEffect, useRef } from 'react'
import { dayLabel, dayShort, weekdayIndex } from '../lib/format'

export const SHOWCASE = [
  { day: '2026-01-12', note: 'forecast above 20 GW' },
  { day: '2026-01-08', note: 'calmest day, late ramp' },
  { day: '2026-01-28', note: 'NESO IT failure' },
]
const PINS = new Set(SHOWCASE.map((s) => s.day))
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const STEP: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 }

const close = (el: HTMLDetailsElement | null, refocus: boolean) => {
  if (!el?.open) return
  el.open = false
  if (refocus) el.querySelector('summary')?.focus()
}

/** Prev/next plus a calendar popover of the pilot's delivery days, with the notable days marked. Escape or a click
 * outside closes it; arrows move a day, up/down a week; focus returns to the trigger after a pick. */
export function DayPicker({
  days,
  value,
  onChange,
}: {
  days: string[]
  value: string
  onChange: (d: string) => void
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  const i = days.indexOf(value)
  const prev = i > 0 ? days[i - 1] : undefined
  const next = i === -1 ? undefined : days[i + 1]
  const pick = (d: string) => {
    onChange(d)
    close(ref.current, true)
  }

  // Always listening, and reading the element's own state, so a quick close-then-reopen can't leave it stuck open.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close(ref.current, false)
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close(ref.current, true)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.dp-day')]
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (at === -1) return
    const step = STEP[e.key]
    const target =
      e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : step === undefined ? null : at + step
    if (target == null) return
    e.preventDefault()
    buttons[Math.min(buttons.length - 1, Math.max(0, target))]?.focus()
  }

  const lead = days[0] ? weekdayIndex(days[0]) : 0
  const focusDay = i === -1 ? days[0] : value
  return (
    <div className="daypicker">
      <button
        type="button"
        className="icon-btn"
        aria-label="Previous delivery day"
        disabled={!prev}
        onClick={() => prev && onChange(prev)}
      >
        ‹
      </button>
      <details
        className="dp"
        ref={ref}
        onToggle={(e) => {
          // Opening moves focus to the selected day, so arrow keys work at once.
          if (e.currentTarget.open)
            e.currentTarget.querySelector<HTMLButtonElement>('.dp-day[tabindex="0"]')?.focus()
        }}
      >
        <summary className="dp-summary" aria-label={`Delivery day ${dayLabel(value)}. Choose another`}>
          <span>{dayLabel(value)}</span>
          {PINS.has(value) && <span className="dp-pin" aria-hidden="true" />}
        </summary>
        <div className="popover dp-pop">
          <p className="eyebrow dp-title" id="dp-title">
            January 2026 pilot · {dayShort(days[0])} to {dayShort(days.at(-1))}
          </p>
          <div className="dp-grid" role="group" aria-labelledby="dp-title" onKeyDown={onGridKey}>
            {WEEKDAYS.map((w, k) => (
              <span key={k} className="dp-wd" aria-hidden="true">
                {w}
              </span>
            ))}
            {Array.from({ length: lead }, (_, k) => (
              <span key={`pad-${k}`} aria-hidden="true" />
            ))}
            {days.map((d) => (
              <button
                key={d}
                type="button"
                className={`dp-day num${PINS.has(d) ? ' is-pin' : ''}`}
                aria-pressed={d === value}
                aria-label={`${dayLabel(d)}${PINS.has(d) ? ', notable day' : ''}`}
                tabIndex={d === focusDay ? 0 : -1}
                onClick={() => pick(d)}
              >
                {d.endsWith('-01') ? dayShort(d) : Number(d.slice(8))}
              </button>
            ))}
          </div>
          <p className="eyebrow">Notable days</p>
          <ul className="dp-showcase">
            {SHOWCASE.map((s) => (
              <li key={s.day}>
                <button
                  type="button"
                  className="dp-show"
                  aria-pressed={s.day === value}
                  onClick={() => pick(s.day)}
                >
                  <span className="dp-pin" aria-hidden="true" />
                  <span className="dp-show-day">{dayLabel(s.day)}</span>
                  <span className="muted">{s.note}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </details>
      <button
        type="button"
        className="icon-btn"
        aria-label="Next delivery day"
        disabled={!next}
        onClick={() => next && onChange(next)}
      >
        ›
      </button>
    </div>
  )
}
