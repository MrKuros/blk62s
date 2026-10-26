import { describe, expect, it } from 'vitest'
import type { Sig } from './api'
import { signalText, staleFeed } from './signals'

const sig = (id: string, params: Sig['params'] = {}) => ({ id, params }) as Sig

describe('signalText', () => {
  it('renders the ceiling rule with its numbers', () => {
    const s = signalText(sig('above_ceiling', { hours: 23, ceiling_mw: 16638 }))
    expect(s?.title).toMatch(/above any wind seen so far/)
    expect(s?.text).toContain('16.6 GW for 23 h')
  })

  it('renders revisions with direction and the previous run time', () => {
    const s = signalText(sig('revision', { delta_mw: -2100, prev_publish: '2026-01-11T04:30:00Z' }))
    expect(s?.title).toBe('Latest run revised down')
    expect(s?.text).toContain('−2.1 GW')
    expect(s?.text).toContain('04:30 run')
    expect(signalText(sig('revision', { delta_mw: 1200 }))?.title).toBe('Latest run revised up')
  })

  it('renders the correction size as a positive amount', () => {
    const s = signalText(sig('correction', { mw: 2411 }))
    expect(s?.title).toBe('Correction lowers the forecast')
    expect(s?.text).toContain('down by 2.4 GW')
  })

  it('renders calibrating and run-jump rules', () => {
    expect(signalText(sig('calibrating', { train_days: 1 }))?.text).toContain('Only 1 past day was')
    expect(signalText(sig('calibrating', { train_days: 3 }))?.text).toContain('Only 3 past days were')
    const s = signalText(sig('run_jump', { runs: 6, since: '2026-01-26T18:30:00Z' }))
    expect(s?.title).toBe('Forecast has stopped updating')
    expect(s?.text).toContain('repeats the 5 runs before it')
    expect(s?.text).toContain('18:30')
    expect(signalText(sig('run_jump'))).toBeNull()
  })

  it('returns null for unknown ids, missing params and no signal', () => {
    expect(signalText(sig('made_up', { x: 1 }))).toBeNull()
    expect(signalText(sig('above_ceiling', { hours: 3 }))).toBeNull()
    expect(signalText(sig('correction', { mw: 'lots' }))).toBeNull()
    expect(signalText(null)).toBeNull()
  })

  it('finds the frozen-feed signal among the headline and the other signals', () => {
    expect(
      staleFeed([sig('correction', { mw: 1 }), sig('run_jump', { runs: 5, since: '2026-01-26T18:30:00Z' })]),
    ).toEqual({
      runs: 5,
      since: '2026-01-26T18:30:00Z',
    })
    expect(staleFeed([null, sig('revision', { delta_mw: 1 })])).toBeNull()
    expect(staleFeed([sig('run_jump', { runs: 5 })])).toBeNull()
  })
})
