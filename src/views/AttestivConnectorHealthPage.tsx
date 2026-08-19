'use client';
// Connectors / Health.
//
// Per-connector latency, error-rate, and throughput. The Connector
// registry shows binary up/down at a glance; this page is the next
// click for someone debugging "why is acme-fw-01 retrying?". It
// pairs each connector with its rolling p95 latency, recent error
// rate, last successful poll timestamp, and the tail of its error
// log so the operator can decide whether to bump backoff, fix
// credentials, or escalate.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Card,
  CardTitle,
  GhostButton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { isDemoMode } from '../lib/demoMode'

import { useI18n } from '../lib/i18n';

type ConnectorHealth = {
  name: string
  kind: string
  status: 'live' | 'ok' | 'retrying' | 'stale' | 'error'
  last_success?: string
  // Backend stores last_error as { message, timestamp } (see
  // connectors_routes.go:1005). Older builds + the DEMO data use a
  // bare string. Normalised at parse time so the render path can
  // always assume string.
  last_error?: string
  last_error_at?: string
  p95_latency_ms?: number
  error_rate_pct?: number
  events_per_min?: number
  poll_interval_s?: number
  // Items collected on the last poll, keyed by ingestion section
  // ("assets", "security_events", "vulnerabilities", ...). Tells the
  // operator the connector is producing the kind of data they expect,
  // not just polling successfully. Missing or empty => the row falls
  // back to "—" so we don't imply the connector is broken when it's
  // simply not reporting per-section counts (older telemetry).
  last_items_collected?: Record<string, number>
  last_items_at?: string
}

const DEMO: ConnectorHealth[] = [
  {
    name: 'panorama-prod',
    kind: 'palo_alto_panorama',
    status: 'live',
    last_success: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
    p95_latency_ms: 220,
    error_rate_pct: 0.1,
    events_per_min: 14.2,
    poll_interval_s: 600,
  },
  {
    name: 'datadomain-az1',
    kind: 'dell_datadomain',
    status: 'retrying',
    last_success: new Date(Date.now() - 1000 * 60 * 18).toISOString(),
    last_error: 'connection refused',
    last_error_at: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    p95_latency_ms: 4400,
    error_rate_pct: 12.0,
    events_per_min: 0,
    poll_interval_s: 1800,
  },
  {
    name: 'vcenter-mgmt',
    kind: 'vmware_vcenter',
    status: 'ok',
    last_success: new Date(Date.now() - 1000 * 60 * 8).toISOString(),
    p95_latency_ms: 880,
    error_rate_pct: 0.4,
    events_per_min: 6.1,
    poll_interval_s: 900,
  },
  {
    name: 'glpi-itsm',
    kind: 'glpi',
    status: 'stale',
    last_success: new Date(Date.now() - 1000 * 60 * 60 * 14).toISOString(),
    last_error: 'app token rejected',
    last_error_at: new Date(Date.now() - 1000 * 60 * 60 * 14).toISOString(),
    p95_latency_ms: 0,
    error_rate_pct: 100,
    events_per_min: 0,
    poll_interval_s: 1800,
  },
]

const STATUS_TONE: Record<ConnectorHealth['status'], 'green' | 'amber' | 'red' | 'gray' | 'navy'> = {
  live: 'green',
  ok: 'green',
  retrying: 'amber',
  stale: 'red',
  error: 'red',
}

export function AttestivConnectorHealthPage() {
  const {
    t
  } = useI18n();
  const router = useRouter()

  const [items, setItems] = useState<ConnectorHealth[]>([])
  const [loading, setLoading] = useState(true)
  const [usingDemo, setUsingDemo] = useState(false)

  useEffect(() => {
    let cancelled = false
    const allowDemo = isDemoMode()
    async function load() {
      try {
        const response = await apiFetch('/connectors')
        if (!response.ok) throw new Error(`${response.status}`)
        const body = await response.json().catch(() => ({}))
        // Backend returns `{ connectors: [...] }` (same key as the
        // registry page). Rows include catalog fields + telemetry
        // fields (last_run/last_success/last_error/...). A connector
        // that is enabled but has never been polled comes back with
        // status="configured" and no last_success — surface those as
        // "stale" so the operator sees them in the health table.
        const rows: any[] = Array.isArray(body?.connectors)
          ? body.connectors
          : Array.isArray(body?.sources)
            ? body.sources
            : Array.isArray(body?.items)
              ? body.items
              : []
        const mapped = rows
          .map((row) => {
            const rawStatus = String(row?.status ?? '').toLowerCase()
            const lastSuccess = row?.last_success ?? row?.last_event_at
            let status: ConnectorHealth['status']
            if (['live', 'ok', 'retrying', 'stale', 'error'].includes(rawStatus)) {
              status = rawStatus as ConnectorHealth['status']
            } else if (rawStatus === 'configured') {
              status = lastSuccess ? 'ok' : 'stale'
            } else {
              status = 'ok'
            }
            const lastErrorRaw = row?.last_error
          const lastError =
            typeof lastErrorRaw === 'string'
              ? lastErrorRaw
              : lastErrorRaw && typeof lastErrorRaw === 'object'
                ? String((lastErrorRaw as { message?: unknown }).message ?? '')
                : undefined
          const lastErrorAt =
            row?.last_error_at ??
            (lastErrorRaw && typeof lastErrorRaw === 'object'
              ? String((lastErrorRaw as { timestamp?: unknown }).timestamp ?? '')
              : undefined)
          return {
              name: String(row?.name ?? row?.id ?? ''),
              kind: String(row?.kind ?? row?.type ?? row?.collector_type ?? ''),
              status,
              raw_status: rawStatus,
              last_success: lastSuccess,
              last_error: lastError || undefined,
              last_error_at: lastErrorAt || undefined,
              p95_latency_ms: typeof row?.p95_latency_ms === 'number' ? row.p95_latency_ms : undefined,
              error_rate_pct: typeof row?.error_rate_pct === 'number' ? row.error_rate_pct : undefined,
              events_per_min: typeof row?.events_per_min === 'number' ? row.events_per_min : undefined,
              poll_interval_s: typeof row?.poll_interval_s === 'number' ? row.poll_interval_s : undefined,
              last_items_collected:
                row?.last_items_collected && typeof row.last_items_collected === 'object'
                  ? Object.fromEntries(
                      Object.entries(row.last_items_collected as Record<string, unknown>)
                        .filter(([, v]) => typeof v === 'number' && (v as number) > 0)
                        .map(([k, v]) => [k, v as number]),
                    )
                  : undefined,
              last_items_at: typeof row?.last_items_at === 'string' ? row.last_items_at : undefined,
            } as ConnectorHealth & { raw_status: string }
          })
          .filter((item) => item.name && item.raw_status !== 'disabled')
        if (!cancelled) {
          if (mapped.length > 0) {
            setItems(mapped)
            setUsingDemo(false)
          } else if (allowDemo) {
            setItems(DEMO)
            setUsingDemo(true)
          } else {
            setItems([])
            setUsingDemo(false)
          }
        }
      } catch {
        if (!cancelled) {
          if (allowDemo) {
            setItems(DEMO)
            setUsingDemo(true)
          } else {
            setItems([])
            setUsingDemo(false)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Topbar
        title={t('Connector health', 'Connector health')}
        left={usingDemo ? <Badge tone="amber">{t('Demo data — no live connectors', 'Demo data — no live connectors')}</Badge> : null}
        right={
          <GhostButton onClick={() => router.push('/connectors')}>
            <i className="ti ti-list" aria-hidden="true" />
            {t('Connector registry', 'Connector registry')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        <Card>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{items.length} connectors</span>}>
            {t('Live health', 'Live health')}
          </CardTitle>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Loading…', 'Loading…')}</div>
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-tertiary)',
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: '6px 10px 6px 0' }}>{t('Connector', 'Connector')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Status', 'Status')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Last success', 'Last success')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Items (last poll)', 'Items (last poll)')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('p95 latency', 'p95 latency')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('Error rate', 'Error rate')}</th>
                  <th style={{ padding: '6px 0 6px 10px' }}>{t('Last error', 'Last error')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.name} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                    <td style={{ padding: '10px 10px 10px 0' }}>
                      <div style={{ fontWeight: 500 }}>{item.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{item.kind}</div>
                    </td>
                    <td style={{ padding: '10px' }}>
                      <Badge tone={STATUS_TONE[item.status]}>{item.status}</Badge>
                    </td>
                    <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                      {item.last_success ? formatRelative(item.last_success) : '—'}
                    </td>
                    <td style={{ padding: '10px' }}>
                      <ItemsCell counts={item.last_items_collected} />
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: tonedNumber(item.p95_latency_ms, 1000, 3000) }}>
                      {item.p95_latency_ms !== undefined ? `${item.p95_latency_ms} ms` : '—'}
                    </td>
                    <td style={{ padding: '10px', textAlign: 'right', color: tonedNumber(item.error_rate_pct, 1, 5) }}>
                      {item.error_rate_pct !== undefined ? `${item.error_rate_pct.toFixed(1)}%` : '—'}
                    </td>
                    <td style={{ padding: '10px 0 10px 10px', color: 'var(--color-text-tertiary)' }}>
                      {item.last_error ? (
                        <span title={item.last_error}>
                          {item.last_error.length > 36 ? `${item.last_error.slice(0, 36)}…` : item.last_error}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

function tonedNumber(value: number | undefined, warnAt: number, errorAt: number): string {
  if (value === undefined) return 'var(--color-text-secondary)'
  if (value >= errorAt) return 'var(--color-status-red-deep)'
  if (value >= warnAt) return 'var(--color-status-amber-text)'
  return 'var(--color-text-secondary)'
}

// ItemsCell renders per-section item counts as compact chips. Shows
// the top three sections by count plus a "+N more" tail when there
// are more, with a hover-tooltip listing everything. Empty / missing
// counts fall back to "—" so we don't imply the connector failed
// when it simply hasn't been polled yet under the new telemetry.
function ItemsCell({ counts }: { counts?: Record<string, number> }) {
  if (!counts) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
  const top = entries.slice(0, 3)
  const rest = entries.slice(3)
  const tooltip = entries.map(([k, v]) => `${k}: ${v}`).join('\n')
  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }} title={tooltip}>
      {top.map(([section, count]) => (
        <span
          key={section}
          style={{
            display: 'inline-flex',
            gap: 4,
            padding: '2px 6px',
            background: 'var(--color-background-secondary)',
            borderRadius: 'var(--border-radius-sm)',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
          }}
        >
          <span style={{ color: 'var(--color-text-tertiary)' }}>{section}</span>
          <span style={{ fontWeight: 500 }}>{count}</span>
        </span>
      ))}
      {rest.length > 0 ? (
        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
          +{rest.length} more
        </span>
      ) : null}
    </span>
  )
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const delta = Date.now() - ts
  if (delta < 0) return new Date(iso).toLocaleString()
  const minutes = Math.floor(delta / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
