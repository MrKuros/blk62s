import type { Meta } from '../lib/api'
import { ukDateTime, ukTime } from '../lib/format'

const TEXT = {
  checking: () => 'Snapshot · checking Elexon…',
  verified: (at: string | null) => `Verified against Elexon${at ? ` · ${ukTime(at)}` : ''}`,
  changed: () => 'Elexon data changed since snapshot',
  unreachable: () => 'Snapshot · Elexon unreachable',
}

export function SourceBadge({ meta, down }: { meta: Meta | undefined; down: boolean }) {
  if (!meta)
    return down ? (
      <span className="badge badge-unreachable" role="status">
        <span className="badge-dot" aria-hidden="true" />
        API unavailable
      </span>
    ) : (
      <span className="badge badge-checking">Connecting…</span>
    )
  const { state, checked_at } = meta.source
  const title = `Bundled snapshot fetched ${ukDateTime(meta.snapshot_fetched_at)}, data hash ${meta.data_hash}${
    checked_at ? `. Last checked against Elexon ${ukDateTime(checked_at)}` : ''
  }.`
  return (
    <span className={`badge badge-${state}`} title={title} role="status">
      <span className="badge-dot" aria-hidden="true" />
      {TEXT[state](checked_at ?? null)}
    </span>
  )
}
