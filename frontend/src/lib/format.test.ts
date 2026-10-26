import { describe, expect, it } from 'vitest'
import {
  DASH,
  dayLabel,
  gw,
  gwRange,
  leadRange,
  mw,
  mwRange,
  pct,
  riskLabel,
  signedGw,
  signedMw,
  ukDateTime,
  ukMidnight,
  ukTime,
} from './format'

describe('format', () => {
  it('formats GW to 1 dp and MW with separators', () => {
    expect(gw(20942)).toBe('20.9 GW')
    expect(gw(14032, 0)).toBe('14 GW')
    expect(mw(2039.4)).toBe('2,039 MW')
  })

  it('uses a true minus sign and an explicit plus on signed values', () => {
    expect(signedGw(-1748)).toBe('−1.7 GW')
    expect(signedGw(600)).toBe('+0.6 GW')
    expect(signedMw(-392)).toBe('−392 MW')
    expect(gw(-500)).toBe('−0.5 GW')
  })

  it('drops the sign when rounding reaches zero', () => {
    expect(signedGw(-40)).toBe('0.0 GW')
    expect(signedMw(0.2)).toBe('0 MW')
  })

  it('shows missing values as an en dash', () => {
    for (const f of [gw, signedGw, mw, signedMw, pct]) {
      expect(f(null)).toBe(DASH)
      expect(f(undefined)).toBe(DASH)
      expect(f(NaN)).toBe(DASH)
    }
    expect(ukTime(null)).toBe(DASH)
    expect(dayLabel('not-a-day')).toBe(DASH)
  })

  it('formats ranges, switching to "to" when negative', () => {
    expect(gwRange(1632, 2442)).toBe('1.6–2.4 GW')
    expect(gwRange(-2172, -1302)).toBe('−2.2 to −1.3 GW')
    expect(mwRange(-61, 16)).toBe('−61 to +16 MW')
  })

  it('renders UK local time across the clock change', () => {
    expect(ukTime('2026-01-11T07:30:00Z')).toBe('07:30')
    expect(ukTime('2026-03-29T08:20:00Z')).toBe('09:20') // BST
    expect(ukDateTime('2026-01-11T07:30:00Z')).toBe('Sun 11 Jan, 07:30')
  })

  it('labels delivery days without shifting the date', () => {
    expect(dayLabel('2026-01-12')).toBe('Mon 12 Jan')
    expect(dayLabel('2026-03-29')).toBe('Sun 29 Mar')
  })

  it('formats percentages, leads and risk', () => {
    expect(pct(0.8495)).toBe('85%')
    expect(pct(0.1807, 1)).toBe('18.1%')
    expect(leadRange(16.5, 39.5)).toBe('17–40 h ahead')
    expect(riskLabel(10)).toBe('1 in 10')
    expect(riskLabel(5)).toBe('1 in 20')
    expect(riskLabel(50)).toBe('1 in 2')
    expect(riskLabel(3)).toBe('3 in 100')
    expect(riskLabel(30)).toBe('30 in 100')
  })

  it('finds UK midnight in GMT, BST and on both clock-change days', () => {
    expect(new Date(ukMidnight('2026-01-13')).toISOString()).toBe('2026-01-13T00:00:00.000Z')
    expect(new Date(ukMidnight('2026-07-13')).toISOString()).toBe('2026-07-12T23:00:00.000Z')
    expect(new Date(ukMidnight('2026-03-29')).toISOString()).toBe('2026-03-29T00:00:00.000Z')
    expect(new Date(ukMidnight('2026-10-25')).toISOString()).toBe('2026-10-24T23:00:00.000Z')
  })
})
