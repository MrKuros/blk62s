import { LineBand, type Series } from '../charts/LineBand'
import { AnswerHero } from '../components/AnswerHero'
import { Notes } from '../components/Notes'
import { Panel, Section, Split } from '../components/Section'
import { Await } from '../components/States'
import { useLive } from '../hooks/queries'
import type { Live as LiveData } from '../lib/api'
import { band, firmHours, mean } from '../lib/firm'
import { dayLabel, dayShort, gateLabel, pLabel, ukDateTime } from '../lib/format'

function Unavailable({ d }: { d: LiveData }) {
  return (
    <div className="unavailable" role="status">
      <p className="eyebrow">Live preview unavailable</p>
      <p>{d.message ?? "Elexon couldn't be reached just now."} The January pilot is unaffected.</p>
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
  if (firm) series.push({ id: 'firm', style: 'firm', points: points(firm) })
  const bandPts = q && r < 50
    ? band(corrected, q, r).flatMap((b, i) => (b.lo == null || b.hi == null ? [] : [{ t: t[i]!, lo: b.lo, hi: b.hi }]))
    : undefined
  const run = d.decision_run
  const cal = d.calibration
  const gate = gateLabel(d.params.cutoff, d.params.cutoff_local)

  return (
    <>
      <AnswerHero
        r={r}
        forecastAvg={mean(d.hours.map((h) => h.raw))}
        forecastPeak={Math.max(...d.hours.map((h) => h.raw ?? -Infinity))}
        firm={firm}
        run={run}
        trainDays={cal?.train_days ?? 0}
        gatePassed={d.gate_passed}
      />
      <Split
        main={
          <Panel
            title={
              d.gate_passed
                ? `Gate closure ${gate} has passed: this is the run it used`
                : `Gate closure ${gate} is still ahead: later runs may replace this one`
            }
            hint="Hourly GB wind, GW, UK time."
            foot={`Fetched ${ukDateTime(d.fetched_at)}${d.latest_publish_time ? `; latest run published ${ukDateTime(d.latest_publish_time)}` : ''}.`}
          >
            <LineBand
              series={series}
              band={bandPts}
              height={300}
              labels={{ raw: d.gate_passed ? 'Forecast run used' : 'Latest forecast run', firm: `${pLabel(r)} wind (${r >= 50 ? 'central' : 'count on'})` }}
              bandLabel={`Likely range (lower edge = ${pLabel(r)})`}
              ariaLabel={`Live wind forecast for ${dayShort(d.target_day)}`}
            />
          </Panel>
        }
        rail={
          <Notes
            title="Beyond the January pilot"
            items={[
              { title: 'Same pipeline, live data', text: 'Elexon WINDFOR and FUELHH as published today, using the last run before gate closure, as in January.' },
              {
                title: 'Calibrated on the last 30 days',
                text: `${cal?.train_window ? `${dayShort(cal.train_window[0])} to ${dayShort(cal.train_window[1])}, ` : ''}not January: seasons and curtailment differ.`,
              },
              { title: 'Refreshes itself', text: 'About every 30 minutes, and again at gate closure.' },
            ]}
          />
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
      title={live.data ? `Tomorrow, ${dayLabel(live.data.target_day)}` : 'Tomorrow'}
      lede="Live, beyond the January 2026 pilot: today's latest forecast run for tomorrow, corrected the same way."
    >
      <Await query={live} height={440}>
        {(d) => <Body d={d} r={r} />}
      </Await>
    </Section>
  )
}
