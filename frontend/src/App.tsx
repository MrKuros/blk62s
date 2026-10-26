import { MethodologyDrawer } from './components/MethodologyDrawer'
import { DegradedBanner, ErrorState, Skeleton } from './components/States'
import { panelId, tabId, Tabs } from './components/Tabs'
import { type BarMeta, ControlBar, Masthead } from './components/TopBar'
import { type AnalysisParams, useMeta } from './hooks/queries'
import { cutoffParam, DEFAULTS, riskR, type Tab, useUrlState } from './hooks/useUrlState'
import { pLabel } from './lib/format'
import { Accuracy } from './sections/Accuracy'
import { Decision } from './sections/Decision'
import { Firm } from './sections/Firm'
import { Live } from './sections/Live'
import { Timing } from './sections/Timing'
import './styles/app.css'

// Mirrors the API's meta so the bar renders at its final size before meta lands (no layout shift).
const PENDING_BAR: BarMeta = {
  days: [],
  auctions: [
    { id: 'epex', label: 'EPEX 09:20', local_time: '09:20' },
    { id: 'n2ex', label: 'N2EX 09:50', local_time: '09:50' },
  ],
  margins: [0, 10, 20, 60],
}

export default function App() {
  const [state, set] = useUrlState()
  const meta = useMeta()
  const m = meta.data
  const params: AnalysisParams = { cutoff: cutoffParam(state), margin: state.margin, calib: state.calib }
  const r = riskR(state)
  // A shared link may name a day outside the pilot; fall back rather than request a 422.
  const day =
    !m || m.days.includes(state.day) ? state.day : m.days.includes(DEFAULTS.day) ? DEFAULTS.day : m.days[0]!
  const tabs: { id: Tab; label: string; short: string }[] = [
    { id: 'decision', label: 'Decision', short: 'Decision' },
    { id: 'accuracy', label: 'Forecast accuracy', short: 'Accuracy' },
    { id: 'firm', label: `Firm wind (${pLabel(r)})`, short: pLabel(r) },
    { id: 'timing', label: 'Timing', short: 'Timing' },
    { id: 'live', label: 'Tomorrow (live)', short: 'Live' },
  ]

  const view = (tab: Tab, meta: NonNullable<typeof m>) => {
    switch (tab) {
      case 'decision':
        return (
          <Decision
            meta={meta}
            day={day}
            params={params}
            r={r}
            reveal={state.reveal}
            onReveal={(reveal) => set({ reveal })}
          />
        )
      case 'accuracy':
        return (
          <Accuracy meta={meta} day={day} params={params} onDay={(d) => set({ day: d, tab: 'decision' })} />
        )
      case 'firm':
        return (
          <Firm
            meta={meta}
            params={params}
            r={r}
            ex28={state.ex28}
            onEx28={(ex28) => set({ ex28 })}
            onCalib={(calib) => set({ calib })}
          />
        )
      case 'timing':
        return <Timing auction={state.auction === 'n2ex' ? 'n2ex' : 'epex'} />
      case 'live':
        return <Live cutoff={params.cutoff} margin={params.margin} r={r} />
    }
  }

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <Masthead meta={m} apiDown={meta.isError && !m} live={state.tab === 'live'} set={set} />
      {/* Tabs never wait for the API, and the control bar renders inert until meta lands, so nothing jumps. */}
      <div className="sticky">
        {m ? (
          <ControlBar state={state} r={r} meta={m} day={day} set={set} />
        ) : (
          <div className="controlbar-pending" inert>
            <ControlBar state={state} r={r} meta={PENDING_BAR} day={day} set={set} />
          </div>
        )}
        <Tabs tabs={tabs} value={state.tab} onChange={(tab) => set({ tab })} />
      </div>
      <main id="main" className="page">
        {m && <DegradedBanner meta={meta} />}
        {m ? (
          <div
            key={state.tab}
            className="tabpanel"
            role="tabpanel"
            id={panelId(state.tab)}
            aria-labelledby={tabId(state.tab)}
          >
            {view(state.tab, m)}
          </div>
        ) : meta.isError ? (
          <ErrorState error={meta.error} onRetry={() => void meta.refetch()} />
        ) : (
          <>
            <Skeleton height={180} label="Loading" />
            <Skeleton height={560} label="Loading" />
          </>
        )}
      </main>
      <footer className="footer">
        <p>
          Firm Wind · national GB wind, Elexon BMRS WINDFOR and FUELHH only · January 2026 pilot
          {m && (
            <>
              {' '}
              · data <span className="num">{m.data_hash}</span> · v{m.version}
            </>
          )}{' '}
          ·{' '}
          <button type="button" className="link" onClick={() => set({ drawer: true })}>
            Methodology
          </button>
        </p>
      </footer>
      <MethodologyDrawer
        open={state.drawer}
        onClose={() => set({ drawer: false })}
        meta={m}
        day={day}
        params={params}
        r={r}
      />
    </>
  )
}
