import type { ReactNode } from 'react'

export function WatchList({ items }: { items: ReactNode[] }) {
  if (!items.length) return null
  return (
    <div className="watch">
      <p className="eyebrow eyebrow-brand">Watch list</p>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
