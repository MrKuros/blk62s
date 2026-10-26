import type { Replay } from '../lib/api'
import { firmHours, mean, planGWh } from '../lib/firm'
import { dayLabel, gateLabel, gw, gwh, pct, riskLabel, signedMw, ukTime } from '../lib/format'

/** The answer above the fold: what the forecast said, what to count on, and what to buy beyond it. */
export function AnswerCard({ replay, r }: { replay: Replay; r: number }) {
  const { params, calibration, kpis, auction_compare: ac, hours } = replay
  const raw = hours.map((h) => h.raw)
  const firm = calibration.q ? firmHours(hours.map((h) => h.corrected), calibration.q, r) : null
  const countOn = firm && mean(firm)
  const plan = firm && planGWh(raw, firm)
  const sameRun = ac.epex_publish_time === ac.n2ex_publish_time

  return (
    <section className="answer" aria-label={`Answer for ${dayLabel(params.day)}`}>
      <p className="eyebrow eyebrow-brand">
        The answer for {dayLabel(params.day)} · deciding at the {gateLabel(params.cutoff, params.cutoff_local)} gate
        {params.margin ? ` minus ${params.margin} min` : ''}
      </p>
      <dl className="answer-grid">
        <div>
          <dt>Forecast</dt>
          <dd className="answer-value num">{gw(kpis.forecast_avg_mw)}</dd>
          <dd className="answer-sub">average · peak {gw(kpis.forecast_peak_mw)}</dd>
        </div>
        <div className="answer-key">
          <dt>Count on</dt>
          <dd className="answer-value num">{firm ? gw(countOn) : 'Calibrating'}</dd>
          <dd className="answer-sub">
            {firm
              ? `short in ${riskLabel(r)} hours · ${pct(countOn != null && kpis.forecast_avg_mw ? countOn / kpis.forecast_avg_mw : null)} of forecast`
              : calibration.train_days === 0
                ? 'no past days known yet; needs 5'
                : `only ${calibration.train_days} past ${calibration.train_days === 1 ? 'day' : 'days'} known; needs 5`}
          </dd>
        </div>
        <div>
          <dt>Plan beyond wind</dt>
          <dd className="answer-value num">{plan == null ? '–' : plan > 0 ? gwh(plan, 0) : 'None'}</dd>
          <dd className="answer-sub">
            {plan != null && plan <= 0
              ? 'count-on level is at or above the raw forecast'
              : "forecast you can't count on, national scale"}
          </dd>
        </div>
        <div>
          <dt>EPEX vs N2EX</dt>
          <dd className="answer-value num">{sameRun ? 'Same run' : signedMw(ac.mean_diff_mw)}</dd>
          <dd className="answer-sub">
            {sameRun
              ? `both gates use the ${ukTime(ac.epex_publish_time)} run`
              : `N2EX's ${ukTime(ac.n2ex_publish_time)} run vs EPEX's ${ukTime(ac.epex_publish_time)}, average`}
          </dd>
        </div>
      </dl>
    </section>
  )
}
