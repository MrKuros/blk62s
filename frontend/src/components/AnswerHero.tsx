import type { components } from '../lib/api-types'
import { mean } from '../lib/firm'
import { beatLabel, gw, leadRange, pLabel, ukDateTime, ukDay, ukTime } from '../lib/format'
import { Quantity } from './Kpi'

type RunInfo = components['schemas']['RunInfo']

export interface HeroProps {
  r: number
  forecastAvg: number | null | undefined
  forecastPeak: number | null | undefined
  /** Hourly P(100 − r) wind; null while warming up. */
  firm: (number | null)[] | null
  run: RunInfo | null | undefined
  trainDays: number
  /** The run used repeats earlier runs exactly: NESO's feed had stopped updating. */
  stale?: { since: string; runs: number } | null
  /** Live preview: whether gate closure has passed, so the run is final. */
  gatePassed?: boolean
}

/** The decision first: how much wind to count on, how far to trust it, and what it rests on. */
export function AnswerHero({ r, forecastAvg, forecastPeak, firm, run, trainDays: n, stale, gatePassed }: HeroProps) {
  const level = firm && mean(firm)
  const holdBack = level != null && forecastAvg != null ? forecastAvg - level : null
  const P = pLabel(r)
  const median = r >= 50
  const live = gatePassed !== undefined

  return (
    <section className={stale ? 'hero hero-stale' : 'hero'} aria-labelledby="hero-title">
      <div className="hero-grid">
        <div className="hero-main">
          {firm ? (
            <>
              <h2 id="hero-title" className="hero-head">
                {median ? 'Central estimate:' : 'Count on'}{' '}
                {/* A stale feed keeps the number but drops the "go" colour. */}
                <span className={stale ? 'hero-num hero-num-plain' : 'hero-num'}>
                  <Quantity value={gw(level)} />
                </span>{' '}
                of wind
              </h2>
              <p className="hero-sub">
                {median ? (
                  <>
                    <strong>{P} (balanced)</strong>: actual was above this in half the hours on past days, so short as often
                    as long.
                  </>
                ) : (
                  <>
                    <strong>{P} wind</strong>: actual wind beat this in {beatLabel(r)} hours on past days.
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <h2 id="hero-title" className="hero-head">
                No {P} wind yet: published forecast{' '}
                <span className="hero-num hero-num-plain">
                  <Quantity value={gw(forecastAvg)} />
                </span>
              </h2>
              {!stale && (
                <p className="hero-note" role="status">
                  <strong>Warm-up.</strong>{' '}
                  {n === 0 ? 'No past days were' : `Only ${n} past ${n === 1 ? 'day was' : 'days were'}`} known at the gate (5
                  needed), so this shows the published forecast with no correction or likely range.
                </p>
              )}
            </>
          )}
          {stale && (
            <p className="hero-warn" role="alert">
              <strong>Forecast feed frozen since {ukDateTime(stale.since)}.</strong> The run used repeats the {stale.runs - 1}{' '}
              runs before it exactly, so NESO's forecast had stopped updating. Treat every figure here as stale and check
              for a data fault before trading on it.
            </p>
          )}
        </div>
        <dl className="hero-facts">
          <div>
            <dt>Forecast</dt>
            <dd>
              <Quantity value={gw(forecastAvg)} /> <span className="muted">avg</span>
              <span className="sep">·</span>
              <Quantity value={gw(forecastPeak)} /> <span className="muted">peak</span>
            </dd>
          </div>
          <div>
            <dt>
              {median ? 'Forecast minus P50' : 'Hold back'}{' '}
              {!median && <span className="fact-hint">forecast minus {P}</span>}
            </dt>
            <dd>
              <Quantity value={holdBack == null ? '–' : gw(holdBack)} />
            </dd>
          </div>
          <div>
            <dt>{live && !gatePassed ? 'Latest forecast run' : 'Forecast run used'}</dt>
            <dd>
              {run ? (
                <>
                  <span className="num">{ukTime(run.publish_time)}</span> {ukDay(run.publish_time)}
                  <span className="muted fact-line">
                    {leadRange(run.hours_ahead_min, run.hours_ahead_max)}
                    {live && !gatePassed && ' · a later run may still replace it'}
                  </span>
                </>
              ) : (
                'None before the gate'
              )}
            </dd>
          </div>
          <div>
            <dt>{stale ? 'Status' : 'Correction'}</dt>
            <dd className="fact-text">
              {stale ? (
                <>
                  <span className="status-dot status-changed" aria-hidden="true" />
                  <span className="fact-warn">Stale forecast feed</span>
                </>
              ) : firm ? (
                <>
                  <span className="status-dot status-verified" aria-hidden="true" />
                  Corrected using {n} past days
                </>
              ) : (
                <>
                  <span className="status-dot" aria-hidden="true" />
                  Warm-up ({n} of 5 days)
                </>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
