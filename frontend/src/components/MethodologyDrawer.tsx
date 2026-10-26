import { Fragment, type ReactNode, useEffect, useRef } from 'react'
import { type AnalysisParams, useAccuracy, useFirm, useReplay } from '../hooks/queries'
import { type Accuracy, type ExportView, exportUrl, type Firm, type Meta } from '../lib/api'
import { coverage } from '../lib/firm'
import { biasGw, dayShort, gateLabel, gw, pct, riskLabel, ukDateTime } from '../lib/format'

interface Props {
  open: boolean
  onClose: () => void
  meta: Meta | undefined
  day: string
  params: AnalysisParams
  r: number
}

const ALIGNMENT: Record<Accuracy['sensitivity'][number]['alignment'], string> = {
  hour_mean: 'Mean of the two half-hours in the hour (used)',
  hh_start: 'Half-hour starting on the hour',
  centred: 'Half-hours either side of the hour start',
}
const METHOD: Record<Firm['methods'][number]['method'], string> = {
  ratio: 'Ratio (used)',
  additive: 'Additive',
  per_level: 'Additive per forecast level',
}

const GLOSSARY: [string, string][] = [
  ['Delivery day (D)', 'The day the power is delivered. D-1 is the day before, when the day-ahead auctions run.'],
  ['Gate closure', 'Last moment to submit day-ahead bids: EPEX 09:20 and N2EX 09:50, D-1 UK time.'],
  ['Forecast run', 'One publication of the NESO national wind forecast (Elexon WINDFOR), about 8 times a day.'],
  ['Hours ahead', 'Time from a run’s publish time to the delivery hour it forecasts.'],
  ['Actual generation (outturn)', 'Metered wind output, Elexon FUELHH, after any balancing turn-down.'],
  ['Settlement period', 'The 30-minute trading unit; two make each delivery hour here.'],
  ['Mean absolute error (MAE)', 'Average size of the miss, either direction.'],
  ['Forecast bias', 'Average of forecast minus actual, with its sign; positive means the forecast was too high. Used the same way on every screen.'],
  ['Error as a share of generation (WAPE)', 'Total absolute miss divided by total actual energy.'],
  ['Corrected forecast', 'The forecast adjusted by what past days showed (the OLS correction above). Forecast and actual correlate at r = 0.93 hour by hour, which is why a linear correction works.'],
  ['P90 wind / firm wind', 'The level actual wind beat in 9 of 10 hours on past days: the r = 10 quantile rule. P95 is r = 5, P50 (balanced) r = 50. The Decision headline "Count on X GW" is this level.'],
  ['Warm-up', 'The first delivery days, with fewer than 5 past days known at the gate: no correction or likely range yet.'],
  ['Download delay', 'Optional margin: runs published less than this many minutes before gate closure are ignored.'],
  ['Curtailment', 'Wind farms paid to turn down when the grid is constrained; the likely cause of the forecast running high.'],
  ['Walk-forward', 'Each day is predicted using only earlier days, then scored; nothing is fitted on the day it is tested on.'],
  ['Block bootstrap', 'Resampling 3-day blocks of days to see how much a figure could move; blocks keep each storm’s run of bad days together.'],
  ['Quantile (q, r)', 'q is the grid of 99 past actual/corrected ratio percentiles; r picks one, as the accepted shortfall in % of hours.'],
]

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** D-2 → D on one axis: what is known when, and which run the gate rule picks. */
function Timeline({ meta, cutoffLocal, margin }: { meta: Meta; cutoffLocal: string; margin: number }) {
  const W = 720
  const perDay = 220
  const x0 = 60
  const x = (offset: number, minutes: number) => x0 + (offset + 2) * perDay + (minutes / 1440) * perDay
  const gate = toMinutes(cutoffLocal) - margin
  const gx = x(-1, gate)
  const runs = meta.slots.map((s) => ({ ...s, at: x(s.day_offset, toMinutes(s.local_time)) }))
  const before = runs.filter((s) => s.day_offset === -2 || toMinutes(s.local_time) < gate)
  const decision = before.at(-1)
  return (
    <div className="timeline-scroll">
    <svg className="timeline" viewBox={`0 0 ${W} 170`} role="img" aria-labelledby="timeline-title">
      <title id="timeline-title">
        Timeline: training uses delivery days up to D-2; the run used is the last run published before the gate on
        D-1; delivery day D is scored afterwards.
      </title>
      <rect className="tl-train" x={0} y={28} width={x(-2, 1440) - 0} height={14} />
      <text className="tl-label" x={4} y={22}>
        Training: delivery days ≤ D-2, actuals complete
      </text>
      <rect className="tl-delivery" x={x(0, 0)} y={28} width={perDay} height={110} />
      <text className="tl-label" x={x(0, 0) + 8} y={22}>
        Delivery day D, scored afterwards
      </text>
      {[-2, -1, 0].map((d) => (
        <g key={d}>
          <line className="tl-axis" x1={x(d, 0)} x2={x(d, 0)} y1={60} y2={138} />
          <text className="tl-tick" x={x(d, 0) + 4} y={152}>
            {d === 0 ? 'D 00:00' : `D${d} 00:00`}
          </text>
        </g>
      ))}
      <line className="tl-axis" x1={x0} x2={W} y1={110} y2={110} />
      {runs.map((s) => (
        <line
          key={s.id}
          className={s === decision ? 'tl-run tl-decision' : s.at > gx ? 'tl-run tl-late' : 'tl-run'}
          x1={s.at}
          x2={s.at}
          y1={s === decision ? 76 : 92}
          y2={110}
        />
      ))}
      <text className="tl-tick" x={x0 - 6} y={113} textAnchor="end">
        runs
      </text>
      <line className="tl-gate" x1={gx} x2={gx} y1={56} y2={138} />
      <text className="tl-label tl-gate-label" x={gx + 6} y={66}>
        Gate {cutoffLocal}
        {margin ? ` − ${margin} min` : ''}
      </text>
      {decision && (
        <text className="tl-label" x={decision.at - 6} y={72} textAnchor="end">
          Run used
        </text>
      )}
      <text className="tl-tick" x={gx + 6} y={128}>
        later runs: too late
      </text>
    </svg>
    </div>
  )
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className="m-block" id={id} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="eyebrow eyebrow-brand">
        {title}
      </h3>
      {children}
    </section>
  )
}

/** Corrected typical miss over every hour with a correction and a delivered value, leaving out `skip`. */
function correctedMae(days: Firm['days'], skip: ReadonlySet<string>): number {
  let sum = 0
  let n = 0
  for (const d of days) {
    if (d.calibrating || skip.has(d.day)) continue
    d.corrected.forEach((c, i) => {
      const a = d.actual[i]
      if (c == null || a == null) return
      sum += Math.abs(a - c)
      n++
    })
  }
  return n ? sum / n : NaN
}

function JanVsDec({ params, r, meta }: { params: AnalysisParams; r: number; meta: Meta }) {
  const firmJan = useFirm({ ...params, calib: 'jan' }).data
  const firmDec = useFirm({ ...params, calib: 'dec' }).data
  // Both columns are scored on the days January-only calibration covers, so they differ only in history.
  const skip = firmJan && new Set(firmJan.days.filter((d) => d.calibrating).map((d) => d.day))
  const col = (f: Firm | undefined) => {
    if (!f || !skip) return { days: '…', mae: '…', hours: '…', whole: '…' }
    const c = coverage(f.days, r, { exclude: skip })
    return { days: String(c.nDays), mae: gw(correctedMae(f.days, skip), 2), hours: pct(c.hourCov), whole: pct(c.dayCov) }
  }
  const jan = col(firmJan)
  const dec = col(firmDec)
  const rows: [string, keyof typeof jan][] = [
    ['Days scored (after the January warm-up)', 'days'],
    ['Corrected mean absolute error', 'mae'],
    [`Hours held, accepting a shortfall in ${riskLabel(r)}`, 'hours'],
    ['Whole days held', 'whole'],
  ]
  return (
    <table>
      <thead>
        <tr>
          <th scope="col" />
          <th scope="col">January only (default)</th>
          <th scope="col">With December 2025 history</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, k]) => (
          <tr key={k}>
            <th scope="row">{label}</th>
            <td className="num">{jan[k]}</td>
            <td className="num">{dec[k]}</td>
          </tr>
        ))}
      </tbody>
      <caption>
        Both scored on the same days: those where January-only calibration has its 5 past days. December history only
        changes what each day's correction learns from. Coverage here includes {dayShort(meta.excluded_day)}.
      </caption>
    </table>
  )
}

function Content({ meta, day, params, r }: Omit<Props, 'open' | 'onClose'> & { meta: Meta }) {
  const accuracy = useAccuracy(params)
  const firm = useFirm(params)
  const replay = useReplay(day, params)
  const a = accuracy.data
  const presetTime = meta.auctions.find((x) => x.id === params.cutoff)?.local_time
  const p = a?.params ?? { ...params, cutoff_local: presetTime ?? params.cutoff }
  const csv = (view: ExportView) =>
    exportUrl({ view, ...params, day: view === 'replay' ? day : undefined, v: meta.data_hash })

  return (
    <>
      <Block id="m-timeline" title="No lookahead, by construction">
        <Timeline meta={meta} cutoffLocal={p.cutoff_local} margin={p.margin} />
        <p>
          For delivery day D the app uses only the latest forecast run published <em>strictly before</em> the gate on D-1,
          and corrections learned from delivery days up to D-2, whose actuals are complete by then. A property test checks
          this for every day, both auctions, custom gates and every margin, and checks that doubling all data published
          after the gate leaves the replay unchanged.
        </p>
      </Block>

      <Block id="m-assumptions" title="Assumptions, and why">
        <ul className="m-list">
          <li>
            <strong>Gates:</strong> EPEX closes 09:20 and N2EX 09:50 UK time on D-1, converted through Europe/London so the
            clock changes are handled. EPEX is the default because it is the earlier, more conservative one.
          </li>
          <li>
            <strong>Run used:</strong> publish time strictly before the gate, minus the optional download delay. The N2EX 09:30
            run lands 20 minutes before its gate; whether it can always be downloaded in time is not verified. The 60-min
            margin replays January as if each run only became usable an hour after its publish time, as Elexon's page
            implies; N2EX then uses the 07:30 run, and EPEX keeps it.
          </li>
          <li>
            <strong>Hourly alignment:</strong> the hourly forecast is compared with the mean of the two half-hours in that hour,
            the energy of the hourly product. Chosen before looking at results; alternatives are below.
          </li>
          <li>
            <strong>Correction:</strong> actual ≈ a + b × forecast (OLS), refitted for each day on earlier days only
            (walk-forward).
          </li>
          <li>
            <strong>Firm wind rule:</strong> corrected forecast × the r-th quantile of past actual/corrected ratios, where r is
            the accepted shortfall in % of hours (P90 is r = 10). One scale-free parameter, chosen before looking at January.
            The likely range on the replay chart runs from the r-th to the (100 − r)-th quantile; its lower edge is P90 wind
            (generally, P(100 − r) wind).
          </li>
          <li>
            <strong>Warm-up:</strong> with fewer than 5 past days a day shows the published forecast, flagged as warm-up, and is
            left out of coverage figures.
          </li>
          <li>
            <strong>Uncertainty:</strong> block bootstrap, 2,000 resamples of 3-day blocks, fixed seed; comparisons are paired
            on the same resamples. The "90% range" on every screen is this approximate 90% confidence interval.
          </li>
        </ul>
      </Block>

      <Block id="m-sensitivity" title="Alignment sensitivity">
        {a ? (
          <table>
            <thead>
              <tr>
                <th scope="col">Hour alignment</th>
                <th scope="col">Mean absolute error</th>
                <th scope="col">Forecast bias (+ = too high)</th>
              </tr>
            </thead>
            <tbody>
              {a.sensitivity.map((s) => (
                <tr key={s.alignment}>
                  <th scope="row">{ALIGNMENT[s.alignment]}</th>
                  <td className="num">{gw(s.mae, 2)}</td>
                  <td className="num">{biasGw(s.bias, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </Block>

      <Block id="m-methods" title="Firm wind methods compared">
        {firm.data ? (
          <table>
            <thead>
              <tr>
                <th scope="col">Method</th>
                <th scope="col">Accepted shortfall</th>
                <th scope="col">{dayShort(meta.excluded_day)}</th>
                <th scope="col">Hours held</th>
                <th scope="col">Whole days</th>
                <th scope="col">Firm, % of forecast</th>
                <th scope="col">n days</th>
              </tr>
            </thead>
            <tbody>
              {firm.data.methods.map((m) => (
                <tr key={`${m.method}-${m.r}-${m.exclude_28}`}>
                  <th scope="row">
                    {METHOD[m.method]}
                    {m.fallback_bins > 0 && <span className="muted"> · {m.fallback_bins} thin levels pooled</span>}
                  </th>
                  <td className="num">{riskLabel(m.r)}</td>
                  <td>{m.exclude_28 ? 'left out' : 'included'}</td>
                  <td className="num">{pct(m.hour_cov, 1)}</td>
                  <td className="num">{pct(m.day_cov)}</td>
                  <td className="num">{pct(m.firm_pct)}</td>
                  <td className="num">{m.n_days}</td>
                </tr>
              ))}
            </tbody>
            <caption>All walk-forward. Per-level falls back to the pooled figure where a level has under 30 past hours.</caption>
          </table>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </Block>

      <Block id="m-calib" title="January only vs December history">
        <JanVsDec params={params} r={r} meta={meta} />
      </Block>

      <Block id="m-baselines" title="Baselines">
        {a ? (
          <table>
            <tbody>
              <tr>
                <th scope="row">Forecast run used at the gate</th>
                <td className="num">{gw(a.mae.value, 2)}</td>
              </tr>
              <tr>
                <th scope="row">Same run on the {a.baselines.d2_n_hours} hours a D-2 run covers</th>
                <td className="num">{gw(a.baselines.d2_decision_mae, 2)}</td>
              </tr>
              <tr>
                <th scope="row">Same-time D-2 run, those hours</th>
                <td className="num">{gw(a.baselines.d2_mae, 2)}</td>
              </tr>
              <tr>
                <th scope="row">Persistence: last delivered value known at the gate, held flat</th>
                <td className="num">{gw(a.baselines.persistence_mae, 2)}</td>
              </tr>
            </tbody>
            <caption>Mean absolute error of each.</caption>
          </table>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </Block>

      <Block id="m-caveats" title="Data caveats">
        <ul className="m-list">
          <li>
            <strong>Forecast vs metered scope.</strong> FUELHH is metered output after balancing turn-down; the forecast may be
            of unconstrained output or a wider set of farms. Curtailment and/or coverage is the likely cause of the
            over-forecast; neither was checked against balancing data.
          </li>
          <li>
            <strong>28 January.</strong> NESO reported an IT ingestion failure on 27–28 Jan. Coverage is shown with and
            without the day.
          </li>
          <li>
            <strong>Publish times.</strong> Elexon's page lists updates at 03:30, 05:30, 08:30…; observed publish times are an
            hour earlier (02:30, 04:30, 07:30…). The app trusts the API's publish time; the 60-min download delay shows the
            figures if it should not. One run on 15 Jan arrived at 12:25 and
            is treated as the 11:30 run.
          </li>
          <li>
            <strong>Not comparable with NESO's benchmark.</strong> NESO's 4.99% for January 2026 is a % of capacity, per
            half-hour, and excludes curtailed and redeclared sites. These figures are raw, curtailment-inclusive MW.
          </li>
        </ul>
      </Block>

      <Block id="m-glossary" title="Glossary: official terms, and the statistics behind them">
        <dl className="glossary">
          {GLOSSARY.map(([term, text]) => (
            <Fragment key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </Fragment>
          ))}
          <dt>RMSE</dt>
          <dd>Root mean squared error; weights large misses more. {a && `January: ${gw(a.rmse)}.`}</dd>
        </dl>
      </Block>

      <Block id="m-receipt" title="Receipt">
        <dl className="receipt num">
          <dt>Gate</dt>
          <dd>
            {gateLabel(p.cutoff, p.cutoff_local)} Europe/London, D-1{p.margin ? `, minus ${p.margin} min` : ''}
          </dd>
          <dt>Calibration</dt>
          <dd>{p.calib === 'dec' ? 'from 1 Dec 2025' : 'January only'}</dd>
          <dt>Run used ({dayShort(day)})</dt>
          <dd>{replay.data?.decision_run ? ukDateTime(replay.data.decision_run.publish_time) : '–'}</dd>
          <dt>Source</dt>
          <dd>
            {meta.source.state}
            {meta.source.checked_at ? `, checked ${ukDateTime(meta.source.checked_at)}` : ''}
          </dd>
          <dt>Snapshot</dt>
          <dd>{ukDateTime(meta.snapshot_fetched_at)}</dd>
          <dt>Data hash</dt>
          <dd>{meta.data_hash}</dd>
          <dt>Version</dt>
          <dd>{meta.version}</dd>
        </dl>
        <p className="csv-links">
          Download CSV (each starts with this receipt):{' '}
          <a href={csv('replay')} download>
            Replay {dayShort(day)}
          </a>{' '}
          · <a href={csv('accuracy')} download>Accuracy</a> · <a href={csv('firm')} download>Firm wind</a> ·{' '}
          <a href={csv('waiting')} download>Waiting</a> · <a href="/api/docs">API docs</a>
        </p>
      </Block>

      <Block id="m-sources" title="Sources">
        <ul className="m-list">
          <li>
            Forecast: Elexon BMRS{' '}
            <a href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream" target="_blank" rel="noreferrer">
              WINDFOR
            </a>
            , hourly national wind forecast, by publish time.
          </li>
          <li>
            Delivered: Elexon BMRS{' '}
            <a href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream" target="_blank" rel="noreferrer">
              FUELHH
            </a>
            , half-hourly generation, fuel type WIND.
          </li>
          <li>Nothing else: no weather, price or capacity data.</li>
        </ul>
      </Block>
    </>
  )
}

export function MethodologyDrawer({ open, onClose, meta, ...rest }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    else if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="m-title"
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()} // backdrop click
    >
      <div className="drawer-inner">
        <header className="drawer-head">
          <div>
            <p className="eyebrow">Firm Wind</p>
            <h2 id="m-title">Methodology</h2>
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close methodology">
            Close
          </button>
        </header>
        {open && meta && <Content meta={meta} {...rest} />}
      </div>
    </dialog>
  )
}
