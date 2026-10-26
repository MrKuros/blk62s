import { ErrorCalendar } from '../charts/ErrorCalendar'
import { LevelBias } from '../charts/LevelBias'
import { SHOWCASE } from '../components/DayPicker'
import { Kpi, KpiStrip } from '../components/Kpi'
import { Notes } from '../components/Notes'
import { Panel, Section } from '../components/Section'
import { Await } from '../components/States'
import { type AnalysisParams, useAccuracy } from '../hooks/queries'
import type { Accuracy as AccuracyData, Meta } from '../lib/api'
import { mean } from '../lib/firm'
import { biasGw, dayShort, gw, gwRange, overForecast, pct } from '../lib/format'

const ciPct = (lo: number, hi: number) => `${pct(lo)}–${pct(hi)}`

function Body({ a, meta, day, onDay }: { a: AccuracyData; meta: Meta; day: string; onDay: (d: string) => void }) {
  const meanForecast = mean(a.days.map((d) => d.mean_forecast_mw))
  const top = a.by_level.at(-1)
  const levelHours = a.by_level.reduce((n, b) => n + b.n, 0)
  const worst = a.days.reduce((w, d) => (d.raw_mae > w.raw_mae ? d : w), a.days[0]!)
  const c = a.corrected
  const cut = -c.gain.value / c.raw_mae.value

  return (
    <>
      <KpiStrip>
        <Kpi
          label="Mean absolute error"
          hint={`average size of the miss, either direction · all ${a.n_days} days`}
          value={gw(a.mae.value)}
          sub={`90% range ${gwRange(a.mae.lo, a.mae.hi)}`}
        />
        <Kpi
          label="Forecast bias"
          hint="forecast minus actual, averaged; + means forecast too high"
          value={biasGw(a.bias.value)}
          sub={`90% range ${gwRange(-a.bias.hi, -a.bias.lo)} · forecast too high in ${pct(a.over_share)} of hours`}
        />
        <Kpi
          label="Corrected forecast error"
          hint={`mean absolute error after adjusting by past days · ${c.n_days} days after warm-up`}
          value={gw(c.corrected_mae.value)}
          sub={`Published forecast on the same ${c.n_days} days: ${gw(c.raw_mae.value)}. Correction cuts it by ${pct(cut)}.`}
        />
        <Kpi
          label="Error as a share of generation"
          hint="total miss over total actual energy"
          value={pct(a.wape.value, 1)}
          sub={`90% range ${ciPct(a.wape.lo, a.wape.hi)}`}
        />
      </KpiStrip>
      <div className="duo">
        <Panel
          title="Bias by forecast level: the windier the forecast, the further it overshoots"
          hint={`Forecast minus actual for the run used at the gate, on the ${levelHours} hours with a correction, so published and corrected compare the same hours.`}
          foot={`Curtailment (wind farms paid to turn down when the grid is constrained) is the likely cause: actual generation is metered after turn-down, the forecast may not be. Actual wind never went above ${gw(a.ceiling_mw)} in the pilot.`}
        >
          <LevelBias bins={a.by_level} ceilingMw={a.ceiling_mw} />
        </Panel>
        <Panel title="Daily error calendar" hint="Select a day to open it in Decision.">
          <ErrorCalendar
            days={a.days.map((d) => ({ day: d.day, value: overForecast(d.raw_bias) }))}
            selected={day}
            pins={SHOWCASE.map((s) => s.day)}
            onSelect={onDay}
          />
        </Panel>
      </div>
      <Notes
        title="What it means"
        row
        items={[
          {
            title: 'Level runs high',
            text: `Forecast too high by ${gw(overForecast(a.bias.value))} on average${meanForecast ? `, about ${pct(-a.bias.value / meanForecast)} of the forecast` : ''}.${
              top?.raw_p50 != null ? ` Above ${gw(top.lo_mw, 0)} it overshoots by ${gw(-top.raw_p50)}.` : ''
            } Actual never went above ${gw(a.ceiling_mw)}.`,
          },
          {
            title: 'Shape is right',
            text: `Forecast and actual rise and fall together hour by hour, so a correction learned from earlier days cuts the error by ${pct(cut)} (${gwRange(-c.gain.hi, -c.gain.lo)}, 90% range).`,
          },
          {
            title: `Worst day ${dayShort(worst.day)}`,
            text: `Mean absolute error ${gw(worst.raw_mae)}${worst.day === meta.excluded_day ? ': the NESO IT failure, a data fault rather than weather' : ''}.`,
          },
        ]}
      />
      <p className="caption">
        Approximate 90% ranges (see Methodology). Corrected figures use the {c.n_days} days after warm-up.
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
      title="Forecast accuracy"
      lede={`${meta.days.length} delivery days, ${dayShort(meta.days[0])} to ${dayShort(meta.days.at(-1))}, each scored against actual generation (outturn, Elexon FUELHH). The shape is right; the level runs high.`}
    >
      <Await query={accuracy} height={560}>
        {(a) => <Body a={a} meta={meta} day={day} onDay={onDay} />}
      </Await>
    </Section>
  )
}
