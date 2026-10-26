import type { ReactNode } from 'react'

interface Props {
  id: string
  title: string
  lede?: ReactNode
  aside?: ReactNode
  children: ReactNode
}

export function Section({ id, title, lede, aside, children }: Props) {
  return (
    <section className="section" aria-labelledby={`${id}-title`}>
      <header className="section-head">
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {aside && <div className="section-aside">{aside}</div>}
      </header>
      {children}
    </section>
  )
}

/** Main chart column plus a notes rail. */
export function Split({ main, rail }: { main: ReactNode; rail: ReactNode }) {
  return (
    <div className="split">
      <div className="split-main">{main}</div>
      <div className="rail">{rail}</div>
    </div>
  )
}

export function Panel({
  title,
  hint,
  actions,
  children,
  foot,
}: {
  title: ReactNode
  hint?: ReactNode
  actions?: ReactNode
  children: ReactNode
  foot?: ReactNode
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">{title}</h3>
          {hint && <p className="panel-hint">{hint}</p>}
        </div>
        {actions && <div className="panel-actions">{actions}</div>}
      </div>
      {children}
      {foot && <p className="caption">{foot}</p>}
    </div>
  )
}
