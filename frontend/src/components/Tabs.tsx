import { type KeyboardEvent, useEffect, useRef } from 'react'
import type { Tab } from '../hooks/useUrlState'

export const tabId = (t: Tab) => `tab-${t}`
export const panelId = (t: Tab) => `panel-${t}`

/** ARIA tablist: one tab stop, arrows/Home/End move and activate (each tab is a URL, so activation is cheap). */
export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: Tab; label: string; short?: string }[]
  value: Tab
  onChange: (t: Tab) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // On a phone the row can scroll: keep the selected tab in view.
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [value])
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === value)
    const last = tabs.length - 1
    const next = {
      ArrowRight: i === last ? 0 : i + 1,
      ArrowLeft: i === 0 ? last : i - 1,
      Home: 0,
      End: last,
    }[e.key]
    const tab = next === undefined ? undefined : tabs[next]
    if (!tab) return
    e.preventDefault()
    onChange(tab.id)
    document.getElementById(tabId(tab.id))?.focus()
  }
  return (
    <nav className="tabs" aria-label="Views">
      <div className="tabs-inner" role="tablist" aria-label="Views" onKeyDown={onKeyDown} ref={ref}>
        {tabs.map((t) => (
          <button
            key={t.id}
            id={tabId(t.id)}
            type="button"
            role="tab"
            aria-selected={t.id === value}
            aria-controls={panelId(t.id)}
            tabIndex={t.id === value ? 0 : -1}
            className="tab"
            aria-label={t.short && t.short !== t.label ? t.label : undefined}
            onClick={() => onChange(t.id)}
          >
            {t.short && t.short !== t.label ? (
              <>
                <span className="tab-long">{t.label}</span>
                <span className="tab-short" aria-hidden="true">
                  {t.short}
                </span>
              </>
            ) : (
              t.label
            )}
          </button>
        ))}
      </div>
    </nav>
  )
}
