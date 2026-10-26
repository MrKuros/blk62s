import type { ReactNode } from 'react'

interface Props {
  id: string
  letter: string
  eyebrow: string
  title: string
  lede?: ReactNode
  aside?: ReactNode
  children: ReactNode
}

export function Section({ id, letter, eyebrow, title, lede, aside, children }: Props) {
  return (
    <section className="section" id={id} aria-labelledby={`${id}-title`}>
      <header className="section-head">
        <div>
          <p className="eyebrow eyebrow-brand">
            <span className="section-letter">{letter}</span> {eyebrow}
          </p>
          <h2 id={`${id}-title`}>{title}</h2>
          {lede && <p className="lede">{lede}</p>}
        </div>
        {aside && <div className="section-aside">{aside}</div>}
      </header>
      {children}
    </section>
  )
}

/** Main chart column plus the Signal / Watch list rail. */
export function Split({ main, rail }: { main: ReactNode; rail: ReactNode }) {
  return (
    <div className="split">
      <div className="split-main">{main}</div>
      <aside className="rail">{rail}</aside>
    </div>
  )
}

export function Panel({
  eyebrow,
  title,
  actions,
  children,
  foot,
}: {
  eyebrow: string
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  foot?: ReactNode
}) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          {title && <h3 className="panel-title">{title}</h3>}
        </div>
        {actions && <div className="panel-actions">{actions}</div>}
      </div>
      {children}
      {foot && <p className="caption">{foot}</p>}
    </div>
  )
}
