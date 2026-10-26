import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Meta } from '../lib/api'
import { dayLabel, ukDateTime } from '../lib/format'

export function Skeleton({ height = 240, label = 'Loading' }: { height?: number; label?: string }) {
  return <div className="skeleton" style={{ height }} role="status" aria-label={label} />
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.'
  return (
    <div className="error-state" role="alert">
      <p className="eyebrow">Couldn't load this view</p>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/**
 * Skeleton until the first result, an error with retry, then the content. While new parameters load the
 * previous result stays visible but dimmed, so controls never blank the page.
 */
export function Await<T>({
  query,
  height,
  children,
}: {
  query: UseQueryResult<T>
  height?: number
  children: (data: T) => ReactNode
}) {
  if (query.data !== undefined)
    return (
      <div className={query.isPlaceholderData ? 'stack is-stale' : 'stack'} aria-busy={query.isFetching}>
        {children(query.data)}
      </div>
    )
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />
  return <Skeleton height={height} />
}

export function DegradedBanner({ meta }: { meta: UseQueryResult<Meta> }) {
  if (meta.isError)
    return (
      <div className="banner banner-error" role="alert">
        <strong>The API isn't responding.</strong> The pilot needs it to refresh.{' '}
        <button type="button" className="link" onClick={() => void meta.refetch()}>
          Retry
        </button>
      </div>
    )
  const m = meta.data
  if (!m) return null
  const { state } = m.source
  if (state !== 'changed' && state !== 'unreachable') return null
  return (
    <div className="banner" role="status">
      {state === 'changed' ? (
        <>
          <strong>Elexon's data has changed since the snapshot.</strong> Every figure here still comes from
          the snapshot taken {ukDateTime(m.snapshot_fetched_at)} (hash <code>{m.data_hash}</code>), so all
          views stay consistent with each other.
        </>
      ) : (
        <>
          <strong>Elexon is unreachable right now.</strong> The January pilot runs on the saved Elexon
          snapshot taken {dayLabel(m.snapshot_fetched_at.slice(0, 10))}; only the live preview needs Elexon.
        </>
      )}
    </div>
  )
}
