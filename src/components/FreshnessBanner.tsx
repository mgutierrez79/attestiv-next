'use client';
// Data-freshness strip for the console shell.
//
// In an air-gapped deployment stale data is the default failure mode and
// the most dangerous one — it looks identical to good data. This strip
// sits above every console page and says, loudly and only when true,
// that some of what is on screen was NOT collected recently:
//   - how many connectors are stale (older than 2× their poll interval,
//     or streaming with no event in 2× the backstop) or currently
//     erroring,
//   - which one is worst and when it last succeeded — absolute first,
//     relative as the hint — and a link to the health page.
// When every connector is fresh it renders nothing: a permanent green
// line is noise, and noise is what trains people to ignore the amber one.
//
// Reads /connectors (same payload the dashboard uses) once a minute.
// Styled with the design tokens only — the earlier version of this file
// used Tailwind dark-theme utilities (emerald-900/20, text-emerald-100)
// that were never reachable on the light palette, and was mounted nowhere.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { apiJson } from '../lib/api'
import { formatAge, formatTimestamp } from '../lib/time'
import { useI18n } from '../lib/i18n'

type ConnectorStatus = {
  name: string
  label?: string
  last_run?: string | null
  last_success?: string | null
  last_status?: string | null
  poll_interval_seconds?: number
  delivery_mode?: string
}

type ConnectorsResponse = { connectors: ConnectorStatus[] }

const FALLBACK_INTERVAL_SECONDS = 24 * 3600

function lastSeenIso(connector: ConnectorStatus): string | null {
  return connector.last_success || connector.last_run || null
}

function staleAfterMs(connector: ConnectorStatus): number {
  const interval = connector.poll_interval_seconds || (
    connector.delivery_mode === 'stream' ? 60 : FALLBACK_INTERVAL_SECONDS
  )
  return interval * 2 * 1000
}

export function FreshnessBanner() {
  const { t } = useI18n()
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await apiJson<ConnectorsResponse>('/connectors')
        if (!cancelled) setConnectors(response.connectors || [])
      } catch {
        // Swallow: pages surface their own connectivity errors; this
        // strip must never add a second error banner on top of them.
      }
    }
    void load()
    const refresh = window.setInterval(load, 60_000)
    const tick = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(refresh)
      window.clearInterval(tick)
    }
  }, [])

  const summary = useMemo(() => {
    if (!connectors.length) return null
    let erroring = 0
    let stale = 0
    let worst: { connector: ConnectorStatus; ageMs: number } | null = null
    for (const connector of connectors) {
      const status = (connector.last_status ?? '').toLowerCase()
      const isErroring = status === 'error' || status === 'failed'
      const seen = lastSeenIso(connector)
      const seenMs = seen ? new Date(seen).getTime() : NaN
      const ageMs = Number.isFinite(seenMs) ? now - seenMs : Number.MAX_SAFE_INTEGER
      const isStale = ageMs > staleAfterMs(connector)
      if (isErroring) erroring += 1
      else if (isStale) stale += 1
      if ((isErroring || isStale) && (!worst || ageMs > worst.ageMs)) {
        worst = { connector, ageMs }
      }
    }
    return { erroring, stale, worst }
  }, [connectors, now])

  if (!summary || (summary.erroring === 0 && summary.stale === 0)) return null

  const { erroring, stale, worst } = summary
  const worstSeen = worst ? lastSeenIso(worst.connector) : null
  const worstLabel = worst ? worst.connector.label || worst.connector.name : ''
  const total = erroring + stale

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '4px 12px',
        padding: '6px 24px',
        fontSize: 11.5,
        lineHeight: 1.4,
        background: 'var(--color-status-amber-bg)',
        color: 'var(--color-status-amber-text)',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        flexShrink: 0,
      }}
    >
      <i className="ti ti-clock-exclamation" aria-hidden="true" style={{ fontSize: 14 }} />
      <strong style={{ fontWeight: 600 }}>
        {t('{n} of {total} sources not fresh', '{n} of {total} sources not fresh', { n: total, total: connectors.length })}
      </strong>
      <span>
        {erroring > 0 ? t('{n} erroring', '{n} erroring', { n: erroring }) : null}
        {erroring > 0 && stale > 0 ? ' · ' : null}
        {stale > 0 ? t('{n} stale', '{n} stale', { n: stale }) : null}
      </span>
      {worst ? (
        <span title={worstSeen ? formatTimestamp(worstSeen) : undefined}>
          {t('Oldest:', 'Oldest:')} {worstLabel}
          {' — '}
          {worstSeen
            ? t('last success {when}', 'last success {when}', { when: formatAge(worstSeen, now) })
            : t('never collected', 'never collected')}
        </span>
      ) : null}
      <Link
        href="/connectors/health"
        style={{ marginLeft: 'auto', color: 'inherit', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}
      >
        {t('Connector health', 'Connector health')} →
      </Link>
    </div>
  )
}
