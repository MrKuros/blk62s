import { LineBand, type Series } from '../charts/LineBand'
import { Kpi, KpiStrip } from '../components/Kpi'
import { Panel, Section, Split } from '../components/Section'
import { SignalCard } from '../components/SignalCard'
import { Await } from '../components/States'
import { useLive } from '../hooks/queries'
import type { Live as LiveData } from '../lib/api'
import { band, firmHours, mean } from '../lib/firm'
import { dayLabel, dayShort, gateLabel, gw, leadRange, riskLabel, ukDateTime, ukTime } from '../lib/format'

function Unavailable({ d }: { d: LiveData }) {
  return (
    <div className="unavailable" role="status">
      <p className="eyebrow">Live preview unavailable</p>
      <p>{d.message ?? "Elexon couldn't be reached just now."} The January pilot above is unaffected.</p>
      <p className="muted">It retries every minute.</p>
    </div>
  )
}

function Body({ d, r }: { d: LiveData; r: number }) {
  if (d.status === 'unavailable') return <Unavailable d={d} />
  const t = d.hours.map((h) => Date.parse(h.t))
  const points = (ys: (number | null)[]) => ys.map((y, i) => ({ t: t[i]!, y }))
  const q = d.calibration?.q
  const corrected = d.hours.map((h) => h.corrected)
  const firm = q ? firmHours(corrected, q, r) : null
  const series: Series[] = [{ id: 'raw', style: 'raw', points: points(d.hours.map((h) => h.raw)) }]
  if (q) series.push({ id: 'corrected', style: 'corrected', points: points(corrected) })
  const bandPts = q
    ? band(corrected, q, r).flatMap((b, i) => (b.lo == null || b.hi == null ? [] : [{ t: t[i]!, lo: b.lo, hi: b.hi }]))
    : undefined
  const run = d.decision_run
  const cal = d.calibration
  const gate = gateLabel(d.params.cutoff, d.params.cutoff_local)

  return (
    <>
      <KpiStrip>
        <Kpi label="Delivery day" value={dayShort(d.target_day)} sub={dayLabel(d.target_day)} />
        <Kpi
          label={d.gate_passed ? 'Run used' : 'Latest run so far'}
          value={run ? ukTime(run.publish_time) : '–'}
          sub={run ? leadRange(run.hours_ahead_min, run.hours_ahead_max) : 'no run yet'}
        />
        <Kpi label="Forecast" value={gw(mean(d.hours.map((h) => h.raw)))} sub="average" />
        <Kpi label="Count on" value={firm ? gw(mean(firm)) : '–'} sub={firm ? `short in ${riskLabel(r)} hours` : 'not calibrated'} />
      </KpiStrip>
      <Split
        main={
          <Panel
            eyebrow={`Tomorrow at the ${gate} gate`}
            title={
              d.gate_passed
                ? `The gate closed at ${ukTime(d.cutoff_utc)}; this is the run it used`
                : `Gate closes at ${ukTime(d.cutoff_utc)}; later runs may still replace this one`
            }
            foot={`Hours in UK time. Fetched ${ukDateTime(d.fetched_at)}${d.latest_publish_time ? `; latest run published ${ukDateTime(d.latest_publish_time)}` : ''}.`}
          >
            <LineBand series={series} band={bandPts} ariaLabel={`Live wind forecast for ${dayShort(d.target_day)}`} />
          </Panel>
        }
        rail={
          <SignalCard eyebrow="Live preview" title="Beyond the January pilot">
            <p>
              The same pipeline on live Elexon data. The correction and band are calibrated on the trailing 30 days
              {cal?.train_window ? ` (${dayShort(cal.train_window[0])} to ${dayShort(cal.train_window[1])})` : ''}, not
              January: seasons and curtailment differ.
            </p>
            <p className="muted">Refreshed about every 30 minutes.</p>
          </SignalCard>
        }
      />
    </>
  )
}

export function Live({ cutoff, margin, r }: { cutoff: string; margin: number; r: number }) {
  const live = useLive(cutoff, margin)
  return (
    <Section
      id="live"
      letter="E"
      eyebrow="Tomorrow, live"
      title="Tomorrow, live (beyond the January pilot)"
      lede="Proof the method isn't hard-wired to January: tomorrow's latest forecast, corrected and banded the same way."
    >
      <Await query={live} height={440}>
        {(d) => <Body d={d} r={r} />}
      </Await>
    </Section>
  )
}
