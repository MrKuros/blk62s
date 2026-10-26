import { Reliability } from '../charts/Reliability'
import { Kpi, KpiStrip } from '../components/Kpi'
import { Notes } from '../components/Notes'
import { Panel, Section, Split } from '../components/Section'
import { Await } from '../components/States'
import { type AnalysisParams, useFirm } from '../hooks/queries'
import type { Firm as FirmData, Meta } from '../lib/api'
import { coverage, reliabilityCurve } from '../lib/firm'
import { dayShort, gwh, pct, pLabel } from '../lib/format'

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
  const P = pLabel(r)

  return (
    <>
      <KpiStrip>
        <Kpi
          label={`${P} wind as a share of forecast`}
          hint="how much of the published forecast you can count on"
          value={pct(c.firmPct)}
          sub={`on average, ${c.nDays} days`}
        />
        <Kpi label="Hours held" hint={`hours actual beat ${P} wind`} value={pct(c.hourCov)} sub={`target ${pct(target)} · ${c.nHours} hours`} />
        <Kpi
          label="Whole days held"
          hint="days where every hour held"
          value={pct(c.dayCov)}
          sub={`${c.nDays - c.shortfallDays} of ${c.nDays} days · ${c.shortfallDays} with a short hour`}
        />
        <Kpi
          label={`Shortfall energy vs ${P} plan`}
          hint="national; your exposure scales with your share"
          value={gwh(c.shortfallGWh)}
          sub={`over ${c.nDays} days`}
        />
      </KpiStrip>
      <Split
        main={
          <Panel
            title="Tested on unseen days: hours land near target, whole days fall short"
            hint="Each point is a risk setting. On the dashed line, the share of hours held matched what was promised."
            foot={`Each day's ${P} wind is set from days at least two days earlier. ${calibrating.length} warm-up days are left out${ex28 ? `, and so is ${ex}` : ''}; ${c.nDays} days scored.`}
          >
            <Reliability hour={curve.hour} day={curve.day} marker={target} markerLabel={P} />
          </Panel>
        }
        rail={
          <Notes
            title="What it means"
            items={[
              {
                title: 'Bad days are bad all day',
                text: `${P} wind held in ${pct(c.hourCov)} of hours but only ${pct(c.dayCov)} of whole days. Plan for a whole bad day, not scattered bad hours.`,
              },
              {
                title: ex28 ? `With ${ex} back in` : `Without ${ex}`,
                text: `${pct(other.hourCov)} of hours and ${pct(other.dayCov)} of days held${ex28 ? '' : ' (NESO IT failure removed)'}.`,
              },
              calibrating.length
                ? {
                    title: 'Warm-up',
                    text: `The first ${calibrating.length} days show the published forecast during warm-up (5 past days needed).`,
                  }
                : { title: 'No warm-up', text: 'With December history every January day is calibrated from the start.' },
            ]}
          />
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
      title={`Firm wind (${pLabel(r)})`}
      lede="The level actual wind beat in all but your accepted share of hours, tested only on days it was not set from."
      aside={
        <div className="toggles" role="group" aria-label="Scoring options">
          <label className="check">
            <input type="checkbox" checked={ex28} onChange={(e) => onEx28(e.target.checked)} />
            <span>
              Exclude {dayShort(meta.excluded_day)}
              <span className="hint">NESO IT failure</span>
            </span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={params.calib === 'dec'}
              onChange={(e) => onCalib(e.target.checked ? 'dec' : 'jan')}
            />
            <span>
              Include December history
              <span className="hint">what a trader held at the time</span>
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
