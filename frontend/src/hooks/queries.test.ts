import { describe, expect, it } from 'vitest'
import type { Live } from '../lib/api'
import { liveTtl } from './queries'

const MIN = 60_000
const live = (patch: Partial<Live>) =>
  ({
    status: 'ok',
    target_day: '2026-01-13',
    cutoff_utc: '2026-01-12T09:20:00Z',
    gate_passed: false,
    ...patch,
  }) as Live
const at = (iso: string) => Date.parse(iso)

describe('liveTtl', () => {
  it('holds a live answer until it can next change, at most 30 min', () => {
    expect(liveTtl(live({}), at('2026-01-12T08:00:00Z'))).toBe(30 * MIN)
    expect(liveTtl(live({}), at('2026-01-12T09:10:00Z'))).toBe(10 * MIN + 5_000) // the gate
    expect(liveTtl(live({ gate_passed: true }), at('2026-01-12T23:50:00Z'))).toBe(10 * MIN + 5_000) // UK midnight
    expect(liveTtl(live({ status: 'unavailable' }), at('2026-01-12T08:00:00Z'))).toBe(MIN)
  })
})
