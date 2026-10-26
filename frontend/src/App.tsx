import { AnswerCard } from './components/AnswerCard'
import { MethodologyDrawer } from './components/MethodologyDrawer'
import { DegradedBanner, ErrorState, Skeleton } from './components/States'
import { TopBar } from './components/TopBar'
import { type AnalysisParams, useMeta, useReplay } from './hooks/queries'
import { cutoffParam, DEFAULTS, riskR, useUrlState } from './hooks/useUrlState'
import { Accuracy } from './sections/Accuracy'
import { Firm } from './sections/Firm'
import { Live } from './sections/Live'
import { Replay } from './sections/Replay'
import { Waiting } from './sections/Waiting'
import './styles/app.css'

export default function App() {
  const [state, set] = useUrlState()
  const meta = useMeta()
  const m = meta.data
  const params: AnalysisParams = { cutoff: cutoffParam(state), margin: state.margin, calib: state.calib }
  const r = riskR(state)
  // A shared link may name a day outside the pilot; fall back rather than request a 422.
  const day = !m || m.days.includes(state.day) ? state.day : m.days.includes(DEFAULTS.day) ? DEFAULTS.day : m.days[0]!
  const replay = useReplay(m ? day : undefined, params)
  const onDay = (d: string) => set({ day: d })

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <TopBar state={state} r={r} meta={m} apiDown={meta.isError} set={set} />
      <main id="main" className="page">
        <DegradedBanner meta={meta} />
        {m ? (
          <>
            {replay.data ? (
              <div className={replay.isPlaceholderData ? 'is-stale' : undefined}>
                <AnswerCard replay={replay.data} r={r} />
              </div>
            ) : replay.isError ? (
              <ErrorState error={replay.error} onRetry={() => void replay.refetch()} />
            ) : (
              <Skeleton height={132} label="Loading the answer" />
            )}
            <Replay
              meta={m}
              day={day}
              params={params}
              r={r}
              reveal={state.reveal}
              onDay={onDay}
              onReveal={(reveal) => set({ reveal })}
            />
            <Accuracy meta={m} day={day} params={params} onDay={onDay} />
            <Firm
              meta={m}
              params={params}
              r={r}
              ex28={state.ex28}
              onEx28={(ex28) => set({ ex28 })}
              onCalib={(calib) => set({ calib })}
            />
            <Waiting auction={state.auction === 'n2ex' ? 'n2ex' : 'epex'} />
            <Live cutoff={params.cutoff} margin={params.margin} r={r} />
          </>
        ) : meta.isError ? (
          <ErrorState error={meta.error} onRetry={() => void meta.refetch()} />
        ) : (
          <>
            <Skeleton height={132} label="Loading" />
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
      <MethodologyDrawer open={state.drawer} onClose={() => set({ drawer: false })} meta={m} day={day} params={params} r={r} />
    </>
  )
}
