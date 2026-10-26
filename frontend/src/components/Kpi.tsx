import type { ReactNode } from 'react'

/** "12.5 GW" as a mono number with a quieter sans unit; anything else passes through. */
export function Quantity({ value }: { value: ReactNode }) {
  const m = typeof value === 'string' ? /^(.*\d) (GWh|GW|MW)$/.exec(value) : null
  if (!m) return <>{value}</>
  return (
    <>
      <span className="num">{m[1]}</span>
      <span className="unit">{m[2]}</span>
    </>
  )
}

export function KpiStrip({ children }: { children: ReactNode }) {
  return <dl className="kpis">{children}</dl>
}

/** One headline figure: official term as the label, a plain one-line hint, the number, then its detail. */
export function Kpi({
  label,
  hint,
  value,
  sub,
}: {
  label: string
  hint?: string
  value: ReactNode
  sub?: ReactNode
}) {
  return (
    <div className="kpi">
      <dt>
        <span className="kpi-label">{label}</span>
        {hint && <span className="kpi-hint">{hint}</span>}
      </dt>
      <dd className="kpi-value num">
        <Quantity value={value} />
      </dd>
      {sub && <dd className="kpi-sub">{sub}</dd>}
    </div>
  )
}
