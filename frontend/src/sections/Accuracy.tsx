import { DayStrip } from '../charts/DayStrip'
import { LevelBias } from '../charts/LevelBias'
import { Kpi, KpiStrip } from '../components/Kpi'
import { Panel, Section, Split } from '../components/Section'
import { SignalCard } from '../components/SignalCard'
import { Await } from '../components/States'
import { WatchList } from '../components/WatchList'
import { type AnalysisParams, useAccuracy } from '../hooks/queries'
import type { Accuracy as AccuracyData, Meta } from '../lib/api'
import { mean } from '../lib/firm'
import { dayShort, gw, gwRange, pct } from '../lib/format'
import { SHOWCASE } from './Replay'

const ciPct = (lo: number, hi: number) => `${pct(lo)}–${pct(hi)}`

function Body({ a, meta, day, onDay }: { a: AccuracyData; meta: Meta; day: string; onDay: (d: string) => void }) {
  const over = -a.bias.value
  const meanForecast = mean(a.days.map((d) => d.mean_forecast_mw))
  const top = a.by_level.at(-1)
  const levelHours = a.by_level.reduce((n, b) => n + b.n, 0)
  const worst = a.days.reduce((w, d) => (d.raw_mae > w.raw_mae ? d : w), a.days[0]!)
  const c = a.corrected
  const cut = -c.gain.value / c.raw_mae.value

  return (
    <>
      <KpiStrip>
        <Kpi label="Typical miss" value={gw(a.mae.value)} sub={`90% CI ${gwRange(a.mae.lo, a.mae.hi)}`} />
        <Kpi
          label="Usually over by"
          value={gw(over)}
          sub={`90% CI ${gwRange(-a.bias.hi, -a.bias.lo)} · ${pct(a.over_share)} of hours`}
        />
        <Kpi
          label="Corrected typical miss"
          value={gw(c.corrected_mae.value)}
          sub={`vs ${gw(c.raw_mae.value)} raw on the same ${c.n_days} days · CI ${gwRange(c.corrected_mae.lo, c.corrected_mae.hi)}`}
        />
        <Kpi
          label="Miss as % of delivered"
          value={pct(a.wape.value, 1)}
          sub={`90% CI ${ciPct(a.wape.lo, a.wape.hi)}`}
        />
      </KpiStrip>
      <Split
        main={
          <>
            <Panel
              eyebrow="Over-forecast by forecast level"
              title="The windier the forecast, the further it overshoots"
              foot={`Forecast minus delivered, for the run used at the gate, on the ${levelHours} hours with a correction (after the warm-up), so raw and corrected compare the same hours. Line: median; bar: 10th–90th percentile. Dashed: the highest delivered hour in the pilot, ${gw(a.ceiling_mw)}.`}
            >
              <LevelBias bins={a.by_level} ceilingMw={a.ceiling_mw} />
            </Panel>
            <Panel
              eyebrow="Daily error"
              title="Most days were over-forecast"
              foot="Average delivered minus forecast per delivery day. Select a day to replay it."
            >
              <DayStrip
                days={a.days.map((d) => ({ day: d.day, value: d.raw_bias }))}
                mode="error"
                selected={day}
                pins={SHOWCASE.map((s) => s.day)}
                onSelect={onDay}
              />
            </Panel>
          </>
        }
        rail={
          <>
            <SignalCard title="The forecast over-states delivered wind">
              <p>
                Over by {gw(over)} on average
                {meanForecast ? `, about ${pct(over / meanForecast)} of the forecast` : ''}, and over in{' '}
                {pct(a.over_share)} of hours. {top?.raw_p50 != null && `Above ${gw(top.lo_mw, 0)} it overshoots by ${gw(-top.raw_p50)}. `}
                Delivered wind never went above {gw(a.ceiling_mw)}.
              </p>
              <p className="muted">Likely cause: curtailment and/or a coverage difference between forecast and metered output.</p>
            </SignalCard>
            <WatchList
              items={[
                `A correction learned only from earlier days cuts typical miss by ${pct(cut)}: ${gw(c.raw_mae.value)} to ${gw(c.corrected_mae.value)} (90% CI of the gain ${gwRange(-c.gain.hi, -c.gain.lo)}).`,
                `Shape right, level wrong: forecast and delivered move together (correlation ${a.corr.toFixed(2)}).`,
                `Worst day ${dayShort(worst.day)}: typical miss ${gw(worst.raw_mae)}${worst.day === meta.excluded_day ? ', the NESO IT failure' : ''}.`,
              ]}
            />
          </>
        }
      />
      <p className="caption">
        Approx. 90% ranges from resampling the month in 3-day blocks, n = {a.n_days} days (see Methodology). Corrected figures use the{' '}
        {c.n_days} days with enough history to calibrate.
      </p>
    </>
  )
}

export function Accuracy({
  meta,
  day,
  params,
  onDay,
}: {
  meta: Meta
  day: string
  params: AnalysisParams
  onDay: (d: string) => void
}) {
  const accuracy = useAccuracy(params)
  return (
    <Section
      id="accuracy"
      letter="B"
      eyebrow="Accuracy"
      title="How good is the forecast?"
      lede="Every January decision scored against what the wind delivered. The forecast's shape is good; its level runs high."
    >
      <Await query={accuracy} height={560}>
        {(a) => <Body a={a} meta={meta} day={day} onDay={onDay} />}
      </Await>
    </Section>
  )
}
