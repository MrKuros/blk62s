import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { components } from '../lib/api-types'
import { DayStrip } from './DayStrip'
import { LevelBias } from './LevelBias'
import { LineBand, withCrossings } from './LineBand'
import { Reliability } from './Reliability'
import { WaitingCurve } from './WaitingCurve'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
const render = (ui: ReactNode) => {
  host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() => root.render(ui))
  return root
}
afterEach(() => host.remove())
/** The chart svg itself, excluding legend swatches. */
const plot = () => host.querySelector('svg[role="img"]')!

const H = 3_600_000
const t0 = Date.UTC(2026, 0, 12)
const hours = Array.from({ length: 24 }, (_, i) => t0 + i * H)
const raw = hours.map((t, i) => ({ t, y: 15000 + 200 * i }))
const actual = hours.map((t, i) => ({ t, y: i === 5 ? null : 12000 + 300 * i }))

// Inline samples rather than the backend contract fixtures: the frontend build context excludes backend/.
const bin = (label: string, lo: number, hi: number | null, over: number) => ({
  label,
  lo_mw: lo,
  hi_mw: hi,
  n: 100,
  raw_p10: -over - 1500,
  raw_p50: -over,
  raw_p90: -over + 1500,
  corr_p10: -1500,
  corr_p50: 0,
  corr_p90: 1500,
})
const bins: components['schemas']['LevelBin'][] = [
  bin('<5 GW', 0, 5000, 300),
  bin('5–10 GW', 5000, 10000, 1000),
  bin('10–15 GW', 10000, 15000, 1800),
  bin('15–20 GW', 15000, 20000, 2400),
  bin('>20 GW', 20000, null, 4600),
]
const times: [-2 | -1, string][] = [-2, -1].flatMap((d) =>
  ['02:30', '07:30', '09:30', '15:30', '22:30'].map((t): [-2 | -1, string] => [d as -2 | -1, t]),
)
const slots: components['schemas']['WaitingSlot'][] = times.map(([d, t], i) => {
  const after = d === -1 && t > '09:50'
  return {
    id: `d${-d}_${t.replace(':', '')}`,
    day_offset: d,
    local_time: t,
    mae: { value: 2500 - 60 * i, lo: 2000 - 60 * i, hi: 3000 - 60 * i },
    bias: -1700,
    rmse: 3000,
    n_hours: 682,
    post_gate: { epex: d === -1 && t > '09:20', n2ex: after },
  }
})
const gates: components['schemas']['Gate'][] = [
  { auction: 'epex', local_time: '09:20', last_slot_id: 'd1_0730' },
  { auction: 'n2ex', local_time: '09:50', last_slot_id: 'd1_0930' },
]
const gain: components['schemas']['Gain'] = {
  auction: 'epex',
  from_slot: 'd2_0730',
  to_slot: 'd1_0730',
  diff: { value: -392, lo: -732, hi: -84 },
}

const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })))

describe('charts', () => {
  it('LineBand draws every series and reads values from the keyboard', () => {
    render(
      <LineBand
        ariaLabel="Replay for 12 January."
        series={[
          { id: 'early', style: 'faint', points: raw.map((p) => ({ ...p, y: (p.y ?? 0) + 500 })) },
          { id: 'late', style: 'late', points: raw.map((p) => ({ ...p, y: (p.y ?? 0) - 900 })) },
          { id: 'raw', style: 'raw', points: raw },
          { id: 'corr', style: 'corrected', points: raw.map((p) => ({ ...p, y: (p.y ?? 0) * 0.85 })) },
          { id: 'actual', style: 'actual', points: actual },
        ]}
        band={hours.map((t) => ({ t, lo: 9000, hi: 16000 }))}
        shade={hours.map((t, i) => ({ t, forecast: raw[i]?.y ?? null, actual: actual[i]?.y ?? null }))}
      />,
    )
    const svg = host.querySelector('svg[role="img"]')!
    expect(svg.getAttribute('aria-label')).toContain('Replay for 12 January.')
    expect(plot().querySelectorAll('path.line')).toHaveLength(5)
    expect(host.querySelector('.shade-short')?.getAttribute('d')).toBeTruthy()
    expect(host.textContent).toContain('too late')
    expect(host.textContent).toContain('00:00') // London is on UTC in January

    key(svg, 'ArrowRight')
    const tip = host.querySelector('.chart-tip')!
    expect(tip.textContent).toContain('00:00–01:00')
    expect(tip.textContent).toContain('15.0 GW')
    expect(tip.textContent).toContain('Likely range')
    expect(host.querySelector('[aria-live]')?.textContent).toContain('00:00–01:00')
    key(svg, 'Escape')
    expect(host.querySelector('.chart-tip')).toBeNull()
  })

  it('shading flips colour exactly where delivered crosses forecast', () => {
    const pts = withCrossings([
      { t: 0, forecast: 10, actual: 8 },
      { t: H, forecast: 10, actual: 12 },
      { t: 2 * H, forecast: null, actual: 12 },
    ])
    expect(pts).toHaveLength(4)
    expect(pts[1]).toEqual({ t: H / 2, forecast: 10, actual: 10 })
  })

  it('DayStrip is a radiogroup with arrow-key navigation and pins', () => {
    const onSelect = vi.fn()
    const days = Array.from({ length: 31 }, (_, i) => ({
      day: `2026-01-${String(i + 1).padStart(2, '0')}`,
      value: i === 3 ? null : -1500 + 100 * i,
    }))
    render(<DayStrip days={days} mode="error" selected="2026-01-12" pins={['2026-01-08', '2026-01-12', '2026-01-28']} onSelect={onSelect} />)
    const radios = host.querySelectorAll('[role="radio"]')
    expect(radios).toHaveLength(31)
    expect(host.querySelectorAll('.day-pin')).toHaveLength(3)
    const selected = host.querySelector('[aria-checked="true"]')!
    expect(selected.getAttribute('tabindex')).toBe('0')
    expect(selected.getAttribute('aria-label')).toBe('Mon 12 Jan, over-forecast by 0.4 GW, showcase day')
    key(selected, 'ArrowRight')
    expect(onSelect).toHaveBeenLastCalledWith('2026-01-13')
    key(selected, 'Home')
    expect(onSelect).toHaveBeenLastCalledWith('2026-01-01')
  })

  it('Reliability marks the selected target', () => {
    const curve = (k: number) =>
      Array.from({ length: 50 }, (_, i) => ({ target: 1 - (i + 1) / 100, achieved: Math.max(0, 1 - ((i + 1) / 100) * k) }))
    render(<Reliability hour={curve(1.1)} day={curve(2.4)} marker={0.9} />)
    const label = host.querySelector('svg[role="img"]')!.getAttribute('aria-label')
    expect(label).toContain('At a 90% target, 89% of hours and 76% of whole days were covered.')
    expect(plot().querySelectorAll('circle.dot')).toHaveLength(2)
    expect(host.querySelector('.s-target')).not.toBeNull()
  })

  it('LevelBias draws a raw and corrected range per bin and the ceiling', () => {
    render(<LevelBias bins={bins} ceilingMw={17756} />)
    expect(plot().querySelectorAll('rect.bar-raw')).toHaveLength(bins.length)
    expect(plot().querySelectorAll('rect.bar-corrected')).toHaveLength(bins.length)
    expect(host.textContent).toContain('Highest delivered 17.8 GW')
    for (const b of bins) expect(host.textContent).toContain(b.label)
  })

  it('WaitingCurve marks gates and the post-gate region', () => {
    render(<WaitingCurve slots={slots} gates={gates} gain={gain} />)
    expect(plot().querySelectorAll('circle.dot')).toHaveLength(slots.length)
    expect(host.querySelectorAll('circle.ring')).toHaveLength(2)
    expect(host.textContent).toContain('EPEX 09:20')
    expect(host.textContent).toContain('N2EX 09:50')
    expect(host.textContent).toContain('Not available day-ahead')
    expect(host.textContent).toContain('−392 MW')
    expect(host.querySelectorAll('.faded').length).toBe(2)
  })
})
