import { DayStrip } from '../charts/DayStrip'
import { LineBand, type Series } from '../charts/LineBand'
import { Kpi, KpiStrip } from '../components/Kpi'
import { Panel, Section, Split } from '../components/Section'
import { SignalCard } from '../components/SignalCard'
import { Await } from '../components/States'
import { WatchList } from '../components/WatchList'
import { type AnalysisParams, useAccuracy, useReplay } from '../hooks/queries'
import type { Meta, Replay as ReplayData } from '../lib/api'
import { band, firmHours, mean } from '../lib/firm'
import { dayShort, gateLabel, gw, leadRange, pct, riskLabel, signedGw, ukDay, ukTime } from '../lib/format'
import { signalText } from '../lib/signals'

export const SHOWCASE = [
  { day: '2026-01-12', note: 'forecast above 20 GW' },
  { day: '2026-01-08', note: 'calmest day, late ramp' },
  { day: '2026-01-28', note: 'NESO IT failure' },
]

const ms = (iso: string) => Date.parse(iso)

function chartSeries(d: ReplayData, r: number, reveal: boolean) {
  const t = d.hours.map((h) => ms(h.t))
  const points = (ys: (number | null)[]) => ys.map((y, i) => ({ t: t[i]!, y }))
  const decision = d.decision_run?.publish_time
  const series: Series[] = d.runs
    .filter((run) => run.publish_time !== decision)
    .map((run) => ({ id: run.publish_time, style: run.too_late ? 'late' : 'faint', points: points(run.values) }))
  series.push({ id: 'raw', style: 'raw', points: points(d.hours.map((h) => h.raw)) })
  const q = d.calibration.q
  if (q) series.push({ id: 'corrected', style: 'corrected', points: points(d.hours.map((h) => h.corrected)) })
  if (reveal) series.push({ id: 'actual', style: 'actual', points: points(d.hours.map((h) => h.actual)) })
  const bandPts = q
    ? band(
        d.hours.map((h) => h.corrected),
        q,
        r,
      ).flatMap((b, i) => (b.lo == null || b.hi == null ? [] : [{ t: t[i]!, lo: b.lo, hi: b.hi }]))
    : undefined
  const shade = reveal ? d.hours.map((h, i) => ({ t: t[i]!, forecast: h.raw, actual: h.actual })) : undefined
  return { series, band: bandPts, shade }
}

function Outcome({ d, firm }: { d: ReplayData; firm: (number | null)[] | null }) {
  const actual = d.hours.map((h) => h.actual)
  const delivered = mean(actual)
  const miss = mean(d.hours.map((h) => (h.raw == null || h.actual == null ? null : h.actual - h.raw)))
  let scored = 0
  let covered = 0
  firm?.forEach((f, i) => {
    const a = actual[i]
    if (f == null || a == null) return
    scored++
    if (a >= f) covered++
  })
  return (
    <p className="outcome" role="status">
      Delivered <strong className="num">{gw(delivered)}</strong> on average (peak{' '}
      {gw(Math.max(...actual.map((a) => a ?? -Infinity)))}).{' '}
      {miss != null && (
        <>
          The forecast was <strong className="num">{miss < 0 ? 'over' : 'under'} by {gw(Math.abs(miss))}</strong>.{' '}
        </>
      )}
      {firm && scored > 0 && (
        <>
          The count-on level held in{' '}
          <strong className="num">
            {covered} of {scored}
          </strong>{' '}
          hours.
        </>
      )}
    </p>
  )
}

interface Props {
  meta: Meta
  day: string
  params: AnalysisParams
  r: number
  reveal: boolean
  onDay: (day: string) => void
  onReveal: (reveal: boolean) => void
}

export function Replay({ meta, day, params, r, reveal, onDay, onReveal }: Props) {
  const replay = useReplay(day, params)
  const accuracy = useAccuracy(params)
  const level = new Map(accuracy.data?.days.map((d) => [d.day, d.mean_forecast_mw]))

  return (
    <Section
      id="replay"
      letter="A"
      eyebrow="Replay"
      title="What did we know at the gate?"
      lede="Each January decision, replayed with only the forecast runs published before the auction closed. Pick a day, read the forecast, then reveal what the wind actually did."
    >
      <div className="strip-block">
        <DayStrip
          days={meta.days.map((d) => ({ day: d, value: level.get(d) ?? null }))}
          mode="level"
          selected={day}
          pins={SHOWCASE.map((s) => s.day)}
          onSelect={onDay}
        />
        <p className="showcase">
          <span className="eyebrow">Showcase days</span>
          {SHOWCASE.map((s) => (
            <button
              key={s.day}
              type="button"
              className="link"
              aria-current={s.day === day ? 'date' : undefined}
              onClick={() => onDay(s.day)}
            >
              {dayShort(s.day)} <span className="muted">· {s.note}</span>
            </button>
          ))}
        </p>
      </div>

      <Await query={replay} height={520}>
        {(d) => {
          const q = d.calibration.q
          const firm = q ? firmHours(d.hours.map((h) => h.corrected), q, r) : null
          const run = d.decision_run
          const { series, band: bandPts, shade } = chartSeries(d, r, reveal)
          const sig = signalText(d.signal)
          const watch = d.watch.flatMap((w) => signalText(w)?.text ?? [])
          if (d.persistence_mw != null)
            watch.push(
              `Last delivered wind known at the gate: ${gw(d.persistence_mw)}. Holding it flat is the naive alternative to the forecast.`,
            )
          if (day === meta.excluded_day)
            watch.push(
              'NESO reported an IT ingestion failure on 27–28 Jan. Treat this day as a data fault, not a weather miss.',
            )
          const lateRuns = d.runs.filter((x) => x.too_late).length
          return (
            <>
              <KpiStrip>
                <Kpi
                  label="Run used"
                  value={run ? ukTime(run.publish_time) : 'None'}
                  sub={run ? `${ukDay(run.publish_time)} · ${leadRange(run.hours_ahead_min, run.hours_ahead_max)}` : 'no run before the gate'}
                />
                <Kpi label="Forecast peak" value={gw(d.kpis.forecast_peak_mw)} sub={`average ${gw(d.kpis.forecast_avg_mw)}`} />
                <Kpi
                  label="Count on"
                  value={firm ? gw(mean(firm)) : 'Calibrating'}
                  sub={firm ? `short in ${riskLabel(r)} hours` : `${d.calibration.train_days} of 5 past days known`}
                />
                <Kpi
                  label="Correction applied"
                  value={q ? signedGw(d.kpis.correction_avg_mw) : 'None yet'}
                  sub={q ? `learned from ${d.calibration.train_days} past days` : 'raw forecast shown'}
                />
              </KpiStrip>
              <Split
                main={
                  <Panel
                    eyebrow={`Forecast at the ${gateLabel(d.params.cutoff, d.params.cutoff_local)} gate`}
                    title={
                      run
                        ? `The ${ukTime(run.publish_time)} run, with ${d.runs.length - 1} other runs for context`
                        : 'No run was published before this gate'
                    }
                    actions={
                      <button
                        type="button"
                        className={reveal ? 'btn btn-ghost' : 'btn'}
                        onClick={() => onReveal(!reveal)}
                      >
                        {reveal ? 'Hide what happened' : 'Reveal what happened'}
                      </button>
                    }
                    foot={
                      <>
                        Hours in UK time. {q ? `Band: the ${r}th to ${100 - r}th percentile of past delivered/corrected ratios. ` : ''}
                        {lateRuns > 0 &&
                          `${lateRuns} runs published after the gate${d.params.margin ? ` minus the ${d.params.margin}-min margin` : ''} are dashed: too late for this auction. `}
                        {reveal && 'Red shading: delivered below forecast; blue: above.'}
                      </>
                    }
                  >
                    <LineBand
                      series={series}
                      band={bandPts}
                      shade={shade}
                      ariaLabel={`Wind forecast for ${dayShort(day)}${reveal ? ' with delivered wind' : ''}`}
                    />
                    {reveal && <Outcome d={d} firm={firm} />}
                  </Panel>
                }
                rail={
                  <>
                    <SignalCard title={sig?.title ?? 'No warning signs'}>
                      <p>{sig?.text ?? 'None of the warning rules fired for this day. The corrected forecast is the best guide.'}</p>
                    </SignalCard>
                    <WatchList items={watch} />
                    {q && (
                      <p className="rail-note">
                        Count-on level is the corrected forecast × the {r}th percentile ratio, so it should be short in about{' '}
                        {pct(r / 100)} of hours.
                      </p>
                    )}
                  </>
                }
              />
            </>
          )
        }}
      </Await>
    </Section>
  )
}
