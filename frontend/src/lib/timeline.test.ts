import { describe, expect, it } from 'vitest'
import type { Replay } from './api'
import { beatLabel, pLabel, ukWallTime } from './format'
import { gateTimeline } from './timeline'

const hours = ['2026-01-12T00:00:00Z', '2026-01-12T01:00:00Z', '2026-01-12T02:00:00Z'].map((t) => ({
  t,
  raw: 1,
  corrected: 1,
  actual: 1,
}))
const replay = (margin = 0) =>
  ({
    params: { cutoff: 'epex', cutoff_local: '09:20', margin, calib: 'jan', day: '2026-01-12' },
    decision_run: {
      publish_time: '2026-01-11T07:30:00Z',
      hours_ahead_min: 16.5,
      hours_ahead_max: 18.5,
      n_hours: 3,
    },
    hours,
    // Out of order on purpose: revisions are against the previous run by publish time.
    runs: [
      { publish_time: '2026-01-11T09:30:00Z', too_late: true, values: [1500, 2500, 3500] },
      { publish_time: '2026-01-10T02:30:00Z', too_late: false, values: [1000, 2000, null] },
      { publish_time: '2026-01-11T07:30:00Z', too_late: false, values: [1200, 1800, 3000] },
    ],
  }) as unknown as Replay

describe('gateTimeline', () => {
  it('spans D-2 00:00 to D 24:00 with the gate on D-1, minus the margin', () => {
    const t = gateTimeline(replay())
    expect(t.start).toBe(Date.UTC(2026, 0, 10))
    expect(t.end).toBe(Date.UTC(2026, 0, 13))
    expect(t.deliveryStart).toBe(Date.UTC(2026, 0, 12))
    expect(t.gate).toBe(Date.UTC(2026, 0, 11, 9, 20))
    expect(gateTimeline(replay(10)).gate).toBe(Date.UTC(2026, 0, 11, 9, 10))
  })

  it('sorts runs, flags the one used, and measures revisions and lead on shared hours', () => {
    const [first, used, late] = gateTimeline(replay()).runs
    expect(first).toMatchObject({ publish: Date.UTC(2026, 0, 10, 2, 30), used: false, revisionMw: null })
    expect(first?.leadMin).toBe(45.5)
    expect(first?.leadMax).toBe(46.5) // last non-null hour
    expect(used).toMatchObject({ used: true, tooLate: false, revisionMw: 0, leadMin: 16.5, leadMax: 18.5 })
    expect(late).toMatchObject({ tooLate: true, revisionMw: 500 })
  })
})

describe('UK wall time and risk labels', () => {
  it('converts UK wall-clock times across the clock change', () => {
    expect(ukWallTime('2026-01-11', '09:20')).toBe(Date.UTC(2026, 0, 11, 9, 20))
    expect(ukWallTime('2026-03-29', '09:20')).toBe(Date.UTC(2026, 2, 29, 8, 20)) // BST from 01:00 UTC
    expect(ukWallTime('2025-10-26', '09:20')).toBe(Date.UTC(2025, 9, 26, 9, 20)) // back to GMT
  })

  it('names the firm level and how often actual beat it', () => {
    expect(pLabel(10)).toBe('P90')
    expect(beatLabel(10)).toBe('9 of 10')
    expect(beatLabel(5)).toBe('19 of 20')
    expect(beatLabel(50)).toBe('half the')
    expect(beatLabel(30)).toBe('70 of 100')
  })
})
