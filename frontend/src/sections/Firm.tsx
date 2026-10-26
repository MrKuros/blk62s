import { Reliability } from '../charts/Reliability'
import { Kpi, KpiStrip } from '../components/Kpi'
import { Panel, Section, Split } from '../components/Section'
import { SignalCard } from '../components/SignalCard'
import { Await } from '../components/States'
import { WatchList } from '../components/WatchList'
import { type AnalysisParams, useFirm } from '../hooks/queries'
import type { Firm as FirmData, Meta } from '../lib/api'
import { coverage, reliabilityCurve } from '../lib/firm'
import { dayShort, gwh, pct, riskLabel } from '../lib/format'

interface Props {
  meta: Meta
  params: AnalysisParams
  r: number
  ex28: boolean
  onEx28: (v: boolean) => void
  onCalib: (calib: AnalysisParams['calib']) => void
}

function Body({ f, meta, r, ex28 }: { f: FirmData; meta: Meta; r: number; ex28: boolean }) {
  const exclude = ex28 ? [meta.excluded_day] : []
  const c = coverage(f.days, r, { exclude })
  const other = coverage(f.days, r, { exclude: ex28 ? [] : [meta.excluded_day] })
  const curve = reliabilityCurve(f.days, { exclude }) // 50 coverage passes over ~750 hours: cheap enough per render
  const calibrating = f.days.filter((d) => d.calibrating)
  const target = 1 - r / 100
  const ex = dayShort(meta.excluded_day)

  return (
    <>
      <KpiStrip>
        <Kpi label="Count on" value={pct(c.firmPct)} sub={`of the forecast, short in ${riskLabel(r)} hours`} />
        <Kpi label="Hours covered" value={pct(c.hourCov)} sub={`target ${pct(target)} · ${c.nHours} hours`} />
        <Kpi label="Whole days covered" value={pct(c.dayCov)} sub={`${c.nDays - c.shortfallDays} of ${c.nDays} days, every hour`} />
        <Kpi label="Shortfall days" value={String(c.shortfallDays)} sub="days with at least one hour short" />
      </KpiStrip>
      <Split
        main={
          <Panel
            eyebrow="Reliability, tested on unseen days"
            title="Hours land near target; whole days fall short of it"
            foot={`Each day's rule was fitted only on days at least two days earlier, then scored on that day. ${calibrating.length} warm-up days are left out${ex28 ? `, and so is ${ex}` : ''}. n = ${c.nDays} days.`}
          >
            <Reliability hour={curve.hour} day={curve.day} marker={target} />
            <p className="outcome">
              National wind shortfall vs plan: <strong className="num">{gwh(c.shortfallGWh)}</strong> over {c.nDays} days.
              Your exposure scales with your share of the market.
            </p>
          </Panel>
        }
        rail={
          <>
            <SignalCard title="Bad days are bad all day">
              <p>
                The count-on level held in {pct(c.hourCov)} of hours but only {pct(c.dayCov)} of whole days. Misses come in
                runs, so plan for a whole bad day, not scattered bad hours.
              </p>
            </SignalCard>
            <WatchList
              items={[
                `${ex28 ? `With ${ex} back in` : `Without ${ex} (NESO IT failure)`}: ${pct(other.hourCov)} of hours and ${pct(other.dayCov)} of days covered.`,
                calibrating.length
                  ? `The first ${calibrating.length} days show the raw forecast while the rule calibrates (5 past days needed).`
                  : 'With December history every January day is calibrated from the start.',
                'Rule chosen before looking at January: corrected forecast × a past percentile of delivered/corrected. Alternatives are compared in the methodology.',
              ]}
            />
          </>
        }
      />
    </>
  )
}

export function Firm({ meta, params, r, ex28, onEx28, onCalib }: Props) {
  const firm = useFirm(params)
  return (
    <Section
      id="firm"
      letter="C"
      eyebrow="Firm wind"
      title="How much can I count on?"
      lede="The forecast error turned into one number: the wind you can count on at the shortfall risk you choose, checked on days the rule hadn't seen."
      aside={
        <div className="toggles">
          <label className="check">
            <input type="checkbox" checked={ex28} onChange={(e) => onEx28(e.target.checked)} />
            Leave out {dayShort(meta.excluded_day)} (NESO IT failure)
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={params.calib === 'dec'}
              onChange={(e) => onCalib(e.target.checked ? 'dec' : 'jan')}
            />
            <span>
              Include December 2025 history
              <span className="hint">history a trader held at the time; Elexon data only</span>
            </span>
          </label>
        </div>
      }
    >
      <Await query={firm} height={520}>
        {(f) => <Body f={f} meta={meta} r={r} ex28={ex28} />}
      </Await>
    </Section>
  )
}
