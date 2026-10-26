import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cutoffParam,
  DEFAULTS,
  parseState,
  riskR,
  serializeState,
  updateUrlState,
  type UrlState,
  useUrlState,
} from './useUrlState'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}

describe('parseState / serializeState', () => {
  it('gives defaults for an empty or garbage query', () => {
    expect(parseState('')).toEqual(DEFAULTS)
    expect(
      parseState('?tab=charts&day=2026-13-45&auction=x&t=25:00&margin=15&risk=often&r=99&calib=nov&ex28=yes&reveal=true'),
    ).toEqual(DEFAULTS)
  })

  it('reads every field', () => {
    const s = parseState(
      '?tab=firm&day=2026-01-28&auction=custom&t=08:45&margin=60&risk=custom&r=7&calib=dec&ex28=1&reveal=1&drawer=1',
    )
    expect(s).toEqual<UrlState>({
      tab: 'firm',
      day: '2026-01-28',
      auction: 'custom',
      t: '08:45',
      margin: 60,
      risk: 'custom',
      r: 7,
      calib: 'dec',
      ex28: true,
      reveal: true,
      drawer: true,
    })
    expect(cutoffParam(s)).toBe('08:45')
    expect(riskR(s)).toBe(7)
  })

  it('rejects impossible dates and non-integer r', () => {
    expect(parseState('?day=2026-02-30').day).toBe(DEFAULTS.day)
    expect(parseState('?risk=custom&r=2.5').r).toBe(DEFAULTS.r)
  })

  it('maps presets to the API cutoff and r', () => {
    expect(cutoffParam(parseState('?auction=n2ex&t=08:00'))).toBe('n2ex')
    expect(riskR(parseState('?risk=1in20&r=33'))).toBe(5)
    expect(riskR(parseState('?risk=balanced'))).toBe(50)
  })

  it('round-trips and keeps the URL short', () => {
    expect(serializeState(DEFAULTS)).toBe('')
    expect(serializeState({ ...DEFAULTS, t: '07:00', r: 3 })).toBe('') // inactive custom values stay out
    const s: UrlState = { ...DEFAULTS, tab: 'timing', day: '2026-01-08', auction: 'custom', t: '07:00', margin: 10, ex28: true }
    expect(parseState(serializeState(s))).toEqual(s)
  })
})

describe('updateUrlState', () => {
  beforeEach(() => window.history.replaceState(null, '', '/'))

  it('pushes a history entry for a new day and hides the reveal', () => {
    window.history.replaceState(null, '', '/?reveal=1')
    const push = vi.spyOn(window.history, 'pushState')
    updateUrlState({ day: '2026-01-08' })
    expect(push).toHaveBeenCalledOnce()
    expect(window.location.search).toBe('?day=2026-01-08')
    push.mockRestore()
  })

  it('replaces the entry for control changes and skips no-ops', () => {
    const push = vi.spyOn(window.history, 'pushState')
    const replace = vi.spyOn(window.history, 'replaceState')
    updateUrlState({ auction: 'n2ex' })
    updateUrlState({ auction: 'n2ex' })
    updateUrlState({ day: DEFAULTS.day })
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledOnce()
    expect(window.location.search).toBe('?auction=n2ex')
    push.mockRestore()
    replace.mockRestore()
  })

  it('pushes a history entry for a new tab and opens a day on Decision in one step', () => {
    const push = vi.spyOn(window.history, 'pushState')
    updateUrlState({ tab: 'accuracy' })
    expect(window.location.search).toBe('?tab=accuracy')
    updateUrlState({ tab: 'decision', day: '2026-01-28' })
    expect(window.location.search).toBe('?day=2026-01-28')
    expect(push).toHaveBeenCalledTimes(2)
    push.mockRestore()
  })
})

describe('useUrlState', () => {
  let host: HTMLDivElement
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    window.history.replaceState(null, '', '/')
    host = document.createElement('div')
  })
  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
  })

  it('re-renders on updates and on Back/Forward', () => {
    const seen: UrlState[] = []
    let set!: (p: Partial<UrlState>) => void
    function Probe() {
      const [state, update] = useUrlState()
      seen.push(state)
      set = update
      return null
    }
    const root = createRoot(host)
    act(() => root.render(createElement(Probe)))
    expect(seen.at(-1)!.day).toBe(DEFAULTS.day)

    act(() => set({ risk: '1in20' }))
    expect(seen.at(-1)!.risk).toBe('1in20')

    act(() => {
      window.history.replaceState(null, '', '/?day=2026-01-20')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect(seen.at(-1)!.day).toBe('2026-01-20')
    expect(seen.at(-1)!.risk).toBe(DEFAULTS.risk)
    act(() => root.unmount())
  })
})
