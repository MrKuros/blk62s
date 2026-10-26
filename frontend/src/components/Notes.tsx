import type { ReactNode } from 'react'

export interface Note {
  title?: string
  text: ReactNode
}

/** At most three short bullets beside or below a chart: the reasons, not a second report. */
export function Notes({ title = 'Why', items, row = false }: { title?: string; items: Note[]; row?: boolean }) {
  if (!items.length) return null
  return (
    <aside className={row ? 'notes notes-row' : 'notes'} aria-label={title}>
      <h3 className="notes-title">{title}</h3>
      <ul>
        {items.slice(0, 3).map((n, i) => (
          <li key={i}>
            {n.title && <strong>{n.title}</strong>}
            <span>{n.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  )
}
