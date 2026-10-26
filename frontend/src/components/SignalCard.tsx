import type { ReactNode } from 'react'

export function SignalCard({ eyebrow = 'Signal', title, children }: { eyebrow?: string; title: string; children: ReactNode }) {
  return (
    <div className="signal">
      <p className="eyebrow eyebrow-brand">{eyebrow}</p>
      <h3 className="signal-title">{title}</h3>
      <div className="signal-body">{children}</div>
    </div>
  )
}
