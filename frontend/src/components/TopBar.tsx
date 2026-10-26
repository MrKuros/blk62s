import { type ReactNode, useState } from 'react'
import type { UrlState } from '../hooks/useUrlState'
import type { Meta } from '../lib/api'
import { riskFromCosts } from '../lib/firm'
import { addDays, dayLabel, riskLabel } from '../lib/format'
import { DayPicker } from './DayPicker'
import { SourceBadge } from './SourceBadge'

type Set = (patch: Partial<UrlState>) => void

const Label = ({ text, hint }: { text: string; hint: string }) => (
  <span className="control-label" title={`${text}: ${hint}`}>
    {text}
    <span className="control-hint">{hint}</span>
  </span>
)

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const N2EX_NOTE = 'The 09:30 run arrives 20 min before this gate; this assumes it can be downloaded in time.'

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: ReactNode; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Edits a local draft and commits on blur or Enter: every new gate cold-starts four analysis requests, so the
 * intermediate values typed segment by segment must not reach the URL. */
function GateTime({ t, set }: { t: string; set: Set }) {
  const [draft, setDraft] = useState(t)
  const [synced, setSynced] = useState(t)
  if (synced !== t) {
    // URL changed elsewhere (back/forward, reset): adopt it. Adjusting state during render avoids an effect pass.
    setSynced(t)
    setDraft(t)
  }
  const commit = () => (HHMM.test(draft) ? draft !== t && set({ t: draft }) : setDraft(t))
  return (
    <input
      type="time"
      className="time-input num"
      aria-label="Custom gate time on D-1, UK local"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

function AuctionControl({ state, meta, set }: { state: UrlState; meta: Meta; set: Set }) {
  const options = [
    ...meta.auctions.map((a) => ({ value: a.id, label: a.label, title: a.id === 'n2ex' ? N2EX_NOTE : undefined })),
    { value: 'custom' as const, label: 'Custom' },
  ]
  return (
    <div className="control">
      <Label text="Gate closure" hint="last moment to submit day-ahead bids, D-1 UK time" />
      <div className="control-row">
        <Segmented label="Gate closure" value={state.auction} options={options} onChange={(auction) => set({ auction })} />
        {state.auction === 'custom' && <GateTime t={state.t} set={set} />}
      </div>
    </div>
  )
}

function RiskControl({ state, r, meta, set }: { state: UrlState; r: number; meta: Meta; set: Set }) {
  // Costs only derive r; they are inputs to a calculator, not view state, so they stay out of the URL.
  const [short, setShort] = useState(90)
  const [surplus, setSurplus] = useState(10)
  const applyCosts = (sh: number, su: number) => {
    setShort(sh)
    setSurplus(su)
    if (sh > 0 && su > 0) set({ risk: 'custom', r: riskFromCosts(sh, su) })
  }
  const options = [
    { value: '1in10' as const, label: <>1 in 10 h <span className="seg-sub">P90</span></>, title: 'Accept a shortfall in 1 in 10 hours' },
    { value: '1in20' as const, label: <>1 in 20 h <span className="seg-sub">P95</span></>, title: 'Accept a shortfall in 1 in 20 hours' },
    { value: 'balanced' as const, label: <>Balanced <span className="seg-sub">P50</span></>, title: 'Short as often as long: the median outcome' },
  ]
  return (
    <div className="control">
      <Label text="Risk appetite" hint="accept a shortfall in…" />
      <div className="control-row">
        <Segmented
          label="Risk appetite: accept a shortfall in"
          value={state.risk}
          options={options}
          onChange={(risk) => set({ risk })}
        />
        {state.risk === 'custom' && <span className="chip num">{riskLabel(r)} h · P{100 - r}</span>}
        <details className="advanced">
          <summary>Advanced</summary>
          <div className="popover">
            <fieldset>
              <legend className="eyebrow">Cost of a miss (£/MWh)</legend>
              <label>
                Being short
                <input
                  type="number"
                  min={1}
                  value={Number.isNaN(short) ? '' : short}
                  className="num"
                  onChange={(e) => applyCosts(e.target.valueAsNumber, surplus)}
                />
              </label>
              <label>
                Being long (surplus)
                <input
                  type="number"
                  min={1}
                  value={Number.isNaN(surplus) ? '' : surplus}
                  className="num"
                  onChange={(e) => applyCosts(short, e.target.valueAsNumber)}
                />
              </label>
              <p className="hint">
                {short > 0 && surplus > 0 ? (
                  <>
                    Accept being short in <strong className="num">{riskFromCosts(short, surplus)}%</strong> of hours (
                    {riskLabel(riskFromCosts(short, surplus))}). The cheaper a shortfall is relative to a surplus, the
                    more wind you can count on.
                  </>
                ) : (
                  'Enter two positive costs.'
                )}
              </p>
            </fieldset>
            <fieldset>
              <legend className="eyebrow">Download delay</legend>
              <Segmented
                label="Download delay"
                value={state.margin}
                options={meta.margins.map((m) => ({ value: m as UrlState['margin'], label: `${m} min` }))}
                onChange={(margin) => set({ margin })}
              />
              <p className="hint">
                Ignore runs published less than this many minutes before gate closure. Choose 60 min to match the
                availability times on Elexon's page.
              </p>
            </fieldset>
          </div>
        </details>
      </div>
    </div>
  )
}

export function Masthead({ meta, apiDown, live, set }: { meta: Meta | undefined; apiDown: boolean; live: boolean; set: Set }) {
  const openDrawer = (anchor?: string) => {
    set({ drawer: true })
    if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }))
  }
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <p className="brand-name">Firm Wind</p>
          <p className="brand-sub">
            GB day-ahead wind position · {live ? 'Live, tomorrow' : 'January 2026 pilot'} ·{' '}
            <button type="button" className="link" onClick={() => openDrawer('m-sources')}>
              Elexon data
            </button>
          </p>
        </div>
        <div className="brand-end">
          <SourceBadge meta={meta} down={apiDown} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => openDrawer()}>
            Methodology
          </button>
        </div>
      </div>
    </header>
  )
}

/** The three inputs every view answers to: which day, which gate, how much risk. */
const tomorrowUk = () => addDays(new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/London' }), 1)

export function ControlBar({ state, r, meta, day, set }: { state: UrlState; r: number; meta: Meta; day: string; set: Set }) {
  return (
    <div className="controlbar" role="group" aria-label="Decision inputs">
      <div className="controlbar-inner">
        <div className="control">
          <Label text="Delivery day" hint="the day the power is delivered" />
          {/* The live view is always tomorrow; a pilot day picker there would put two delivery days on screen. */}
          {state.tab === 'live' ? (
            <span className="day-chip">
              Tomorrow · <strong>{dayLabel(tomorrowUk())}</strong>
            </span>
          ) : (
            <DayPicker days={meta.days} value={day} onChange={(d) => set({ day: d })} />
          )}
        </div>
        <AuctionControl state={state} meta={meta} set={set} />
        <RiskControl state={state} r={r} meta={meta} set={set} />
      </div>
    </div>
  )
}
