import type { ReactNode } from 'react'

export function KpiStrip({ children }: { children: ReactNode }) {
  return <dl className="kpis">{children}</dl>
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <dt className="eyebrow">{label}</dt>
      <dd className="kpi-value num">{value}</dd>
      {sub && <dd className="kpi-sub">{sub}</dd>}
    </div>
  )
}
