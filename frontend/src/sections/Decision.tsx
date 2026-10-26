import { GateTimeline } from '../charts/GateTimeline'
import { LineBand, type Series } from '../charts/LineBand'
import { AnswerHero } from '../components/AnswerHero'
import { Quantity } from '../components/Kpi'
import { type Note, Notes } from '../components/Notes'
import { Panel, Section } from '../components/Section'
import { Await } from '../components/States'
import { type AnalysisParams, useReplay } from '../hooks/queries'
import type { Meta, Replay as ReplayData } from '../lib/api'
import { band, firmHours, mean } from '../lib/firm'
import { dayLabel, dayShort, delta, gateLabel, gw, pLabel, ukTime } from '../lib/format'
import { signalText, staleFeed } from '../lib/signals'
import { gateTimeline } from '../lib/timeline'

const ms = (iso: string) => Date.parse(iso)
const CONTEXT_RUNS = 3

function chartSeries(d: ReplayData, firm: (number | null)[] | null, r: number, reveal: boolean) {
  const t = d.hours.map((h) => ms(h.t))
  const points = (ys: (number | null)[]) => ys.map((y, i) => ({ t: t[i]!, y }))
  const decision = d.decision_run?.publish_time
  // Context: only the few runs just before the one used (they cover the whole day) and the too-late ones. On reveal
  // they step aside so the comparison that matters, actual against the plan, reads cleanly.
  const before = d.runs.filter((run) => !run.too_late && run.publish_time !== decision).slice(-CONTEXT_RUNS)
  const late = d.runs.filter((run) => run.too_late)
  const series: Series[] = reveal
    ? []
    : [
        ...before.map((run): Series => ({ id: run.publish_time, style: 'faint', points: points(run.values) })),
        ...late.map((run): Series => ({ id: run.publish_time, style: 'late', points: points(run.values) })),
      ]
  series.push({ id: 'raw', style: 'raw', points: points(d.hours.map((h) => h.raw)) })
  const q = d.calibration.q
  if (q) series.push({ id: 'corrected', style: 'corrected', points: points(d.hours.map((h) => h.corrected)) })
  if (firm) series.push({ id: 'firm', style: 'firm', points: points(firm) })
  if (reveal) series.push({ id: 'actual', style: 'actual', points: points(d.hours.map((h) => h.actual)) })
  const bandPts =
    q && r < 50
      ? band(
          d.hours.map((h) => h.corrected),
          q,
          r,
        ).flatMap((b, i) => (b.lo == null || b.hi == null ? [] : [{ t: t[i]!, lo: b.lo, hi: b.hi }]))
      : undefined
  // Shortfall is actual below the plan: the firm level when there is one, else the published forecast.
  const plan = firm ?? d.hours.map((h) => h.raw)
  const shade = reveal ? d.hours.map((h, i) => ({ t: t[i]!, forecast: plan[i] ?? null, actual: h.actual })) : undefined
  return { series, band: bandPts, shade, nBefore: before.length, nLate: late.length }
}

function Outcome({ d, firm, r }: { d: ReplayData; firm: (number | null)[] | null; r: number }) {
  const actual = d.hours.map((h) => h.actual)
  const over = mean(d.hours.map((h) => (h.raw == null || h.actual == null ? null : h.raw - h.actual)))
  let scored = 0
  let covered = 0
  firm?.forEach((f, i) => {
    const a = actual[i]
    if (f == null || a == null) return
    scored++
    if (a >= f) covered++
  })
  return (
    <dl className="outcome" role="status">
      <div>
        <dt>Actual generation</dt>
        <dd>
          <Quantity value={gw(mean(actual))} /> <span className="muted">avg</span> <span className="sep">·</span>{' '}
          <Quantity value={gw(Math.max(...actual.map((a) => a ?? -Infinity)))} /> <span className="muted">peak</span>
        </dd>
      </div>
      {over != null && (
        <div>
          <dt>Published forecast</dt>
          <dd>
            too {over > 0 ? 'high' : 'low'} by <Quantity value={gw(Math.abs(over))} />
          </dd>
        </div>
      )}
      {firm && scored > 0 && (
        <div>
          <dt>{pLabel(r)} wind held</dt>
          <dd>
            <span className="num">{covered}</span> of <span className="num">{scored}</span> hours
          </dd>
        </div>
      )}
    </dl>
  )
}

function whyNotes(d: ReplayData, meta: Meta): Note[] {
  const notes: Note[] = []
  if (d.params.day === meta.excluded_day)
    notes.push({
      title: 'Data fault, not weather',
      text: 'Visible at the gate: the forecast had stopped updating. NESO later confirmed an IT ingestion failure on 27–28 Jan.',
    })
  // The frozen-feed warning is in the hero itself; the rail keeps the other reasons.
  for (const s of [d.signal, ...d.watch]) {
    if (s?.id === 'run_jump') continue
    const t = signalText(s)
    if (t) notes.push({ title: t.title, text: t.text })
  }
  if (d.persistence_mw != null)
    notes.push({
      title: 'Last actual known at the gate',
      text: `${gw(d.persistence_mw)}. The simple alternative to the forecast: assume wind stays at this level all day.`,
    })
  return notes
}

function auctionNote(ac: ReplayData['auction_compare']) {
  if (ac.epex_publish_time === ac.n2ex_publish_time)
    return `Both gates (EPEX 09:20, N2EX 09:50) use the ${ukTime(ac.epex_publish_time)} run for this day.`
  const head = `At N2EX (09:50) the ${ukTime(ac.n2ex_publish_time)} run would apply instead`
  const v = ac.mean_diff_mw
  if (v == null || Math.abs(v) < 0.5) return `${head}: no change on average.`
  return `${head}: ${delta(v)} ${v > 0 ? 'higher' : 'lower'} on average than the ${ukTime(ac.epex_publish_time)} run.`
}

interface Props {
  meta: Meta
  day: string
  params: AnalysisParams
  r: number
  reveal: boolean
  onReveal: (reveal: boolean) => void
}

export function Decision({ meta, day, params, r, reveal, onReveal }: Props) {
  const replay = useReplay(day, params)
  const echo = replay.data?.params
  const gateNow = echo ? gateLabel(echo.cutoff, echo.cutoff_local) : params.cutoff.toUpperCase()
  return (
    <Section
      id="decision"
      title={`Decision for ${dayLabel(day)}`}
      lede={`Day-ahead wind position at gate closure ${gateNow}${params.margin ? ` − ${params.margin} min` : ''}.`}
    >
      <Await query={replay} height={720}>
        {(d) => {
          const q = d.calibration.q
          const firm = q ? firmHours(d.hours.map((h) => h.corrected), q, r) : null
          const run = d.decision_run
          const { series, band: bandPts, shade, nBefore, nLate } = chartSeries(d, firm, r, reveal)
          const gate = gateLabel(d.params.cutoff, d.params.cutoff_local)
          const P = pLabel(r)
          return (
            <>
              <AnswerHero
                r={r}
                forecastAvg={d.kpis.forecast_avg_mw}
                forecastPeak={d.kpis.forecast_peak_mw}
                firm={firm}
                run={run}
                trainDays={d.calibration.train_days}
                stale={staleFeed([d.signal, ...d.watch])}
              />
              <Panel
                title={run ? `Forecast run used: ${ukTime(run.publish_time)}` : 'No forecast run was published before this gate'}
                hint={
                  reveal
                    ? 'Hourly GB wind, GW, UK time. Amber: hours where actual fell short of the plan.'
                    : `Hourly GB wind, GW, UK time.${nBefore ? ` The ${nBefore} runs before it shown faintly` : ''}${nLate ? `; ${nLate} dashed runs came after the gate` : ''}.`
                }
                actions={
                  <button type="button" className={reveal ? 'btn btn-ghost' : 'btn'} aria-pressed={reveal} onClick={() => onReveal(!reveal)}>
                    {reveal ? 'Hide what happened' : 'Show what happened'}
                  </button>
                }
                foot={
                  q && r < 50
                    ? `Likely range: actual landed inside it in about ${100 - 2 * r}% of past hours. Its lower edge is ${P} wind, the level to count on.`
                    : undefined
                }
              >
                <LineBand
                  series={series}
                  band={bandPts}
                  shade={shade}
                  height={300}
                  labels={{ firm: `${P} wind (${r >= 50 ? 'central' : 'count on'})` }}
                  bandLabel={`Likely range (lower edge = ${P})`}
                  shadeLabel={firm && r < 50 ? `Actual below ${P} wind` : 'Actual below forecast'}
                  ariaLabel={`Wind forecast for ${dayShort(day)}${reveal ? ' with actual generation' : ''}`}
                />
                {reveal && <Outcome d={d} firm={firm} r={r} />}
              </Panel>
              <Notes items={whyNotes(d, meta)} row />
              <Panel
                title="Gate timeline: what did we know at the gate?"
                hint="Every NESO wind forecast run from D-2 to delivery; each stem shows how far that run moved the forecast."
                foot={auctionNote(d.auction_compare)}
              >
                <GateTimeline layout={gateTimeline(d)} day={day} gateLabel={gate} margin={d.params.margin} />
              </Panel>
            </>
          )
        }}
      </Await>
    </Section>
  )
}
