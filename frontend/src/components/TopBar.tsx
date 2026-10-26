import { useState } from 'react'
import type { UrlState } from '../hooks/useUrlState'
import type { Meta } from '../lib/api'
import { riskFromCosts } from '../lib/firm'
import { riskLabel } from '../lib/format'
import { SourceBadge } from './SourceBadge'

type Set = (patch: Partial<UrlState>) => void

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
  options: { value: T; label: string; title?: string }[]
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
      <span className="eyebrow" id="auction-label">
        Auction gate (D-1, UK time)
      </span>
      <div className="control-row">
        <Segmented label="Auction gate" value={state.auction} options={options} onChange={(auction) => set({ auction })} />
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
    { value: '1in10' as const, label: '1 in 10' },
    { value: '1in20' as const, label: '1 in 20' },
    { value: 'balanced' as const, label: 'Balanced', title: 'Short as often as long: the median outcome' },
  ]
  return (
    <div className="control">
      <span className="eyebrow">How often can you accept being short?</span>
      <div className="control-row">
        <Segmented
          label="Accepted shortfall"
          value={state.risk}
          options={options}
          onChange={(risk) => set({ risk })}
        />
        {state.risk === 'custom' && <span className="chip num">{riskLabel(r)} hours</span>}
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
              <legend className="eyebrow">Data latency margin</legend>
              <Segmented
                label="Data latency margin"
                value={state.margin}
                options={meta.margins.map((m) => ({ value: m as UrlState['margin'], label: `${m} min` }))}
                onChange={(margin) => set({ margin })}
              />
              <p className="hint">
                Treat runs published within this many minutes of the gate as not yet downloaded. 60 min tests runs only
                becoming usable at the times Elexon's page lists, an hour after their publish time.
              </p>
            </fieldset>
          </div>
        </details>
      </div>
    </div>
  )
}

export function TopBar({
  state,
  r,
  meta,
  apiDown,
  set,
}: {
  state: UrlState
  r: number
  meta: Meta | undefined
  apiDown: boolean
  set: Set
}) {
  const openDrawer = (anchor?: string) => {
    set({ drawer: true })
    if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }))
  }
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <p className="brand-name">Firm Wind</p>
            <p className="brand-sub">
              January 2026 replay · Elexon data ·{' '}
              <button type="button" className="link" onClick={() => openDrawer('m-sources')}>
                Sources
              </button>
            </p>
          </div>
        </div>
        {meta && (
          <div className="controls">
            <AuctionControl state={state} meta={meta} set={set} />
            <RiskControl state={state} r={r} meta={meta} set={set} />
          </div>
        )}
        <div className="topbar-end">
          <SourceBadge meta={meta} down={apiDown} />
          <button type="button" className="btn btn-ghost" onClick={() => openDrawer()}>
            Methodology
          </button>
        </div>
      </div>
    </header>
  )
}
