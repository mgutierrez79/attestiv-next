'use client';
// Connectors / Dead-letter queue.
//
// Failed ingestion attempts that weren't retried successfully. The
// page lets an operator inspect the failure (stage, message, attempt
// history) and trigger a retry. Retries flow back through the same
// processor pipeline so a successful retry is indistinguishable from
// a fresh ingestion in the audit trail.
//
// This is distinct from the Issues triage on the dashboard: that's a
// curated cross-source inbox; this is the raw DLQ for the connector
// pipeline only.

import { useEffect, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PrimaryButton,
  SignatureBox,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { isDemoMode } from '../lib/demoMode'

import { useI18n } from '../lib/i18n';
import { useRoles } from '../lib/roles'

type DLQEntry = {
  queue_id: string
  source?: string
  stage: string
  status: string
  tenant_id?: string
  run_id?: string
  message?: string
  attempts?: number
  first_seen_at?: string
  last_seen_at?: string
}

const DEMO_DLQ: DLQEntry[] = [
  {
    queue_id: 'q-9f1e0d2a',
    source: 'palo_alto',
    stage: 'router',
    status: 'dead_letter',
    tenant_id: 'acme',
    run_id: 'run-2026-05-08T14-22',
    message: 'panorama timeout: context deadline exceeded after 30s',
    attempts: 3,
    first_seen_at: '2026-05-08T13:42:00Z',
    last_seen_at: '2026-05-08T14:11:32Z',
  },
  {
    queue_id: 'q-7b2d4c8e',
    source: 'veeam_em',
    stage: 'normalizer',
    status: 'dead_letter',
    tenant_id: 'acme',
    message: 'unexpected response shape: missing field "backupSession.id"',
    attempts: 2,
    first_seen_at: '2026-05-08T12:18:11Z',
    last_seen_at: '2026-05-08T12:22:43Z',
  },
]

export function AttestivDLQInboxPage() {
  const {
    t
  } = useI18n();

  const [entries, setEntries] = useState<DLQEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [usingDemo, setUsingDemo] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Demo-mode gate: only fabricate DEMO_DLQ rows when the tenant
    // profile is explicitly 'demo'. Pilot + production show a real
    // empty state instead of fake "dead-letter" entries.
    const allowDemo = isDemoMode()
    async function load() {
      try {
        const response = await apiFetch('/ingest?status=dead_letter&limit=200')
        if (!response.ok) throw new Error(`${response.status}`)
        const body = await response.json().catch(() => ({}))
        const items: any[] = Array.isArray(body?.items) ? body.items : []
        const mapped: DLQEntry[] = items.map((item) => ({
          queue_id: String(item?.queue_id ?? item?.id ?? ''),
          source: item?.source,
          stage: String(item?.stage ?? 'router'),
          status: String(item?.status ?? 'dead_letter'),
          tenant_id: item?.tenant_id,
          run_id: item?.run_id,
          message: typeof item?.message === 'string' ? item.message : item?.error,
          attempts: typeof item?.attempts === 'number' ? item.attempts : item?.dlq_attempts?.length,
          first_seen_at: item?.first_seen_at ?? item?.created_at,
          last_seen_at: item?.last_seen_at ?? item?.updated_at,
        }))
        if (!cancelled) {
          if (mapped.length > 0) {
            setEntries(mapped)
            setUsingDemo(false)
          } else if (allowDemo) {
            setEntries(DEMO_DLQ)
            setUsingDemo(true)
          } else {
            setEntries([])
            setUsingDemo(false)
          }
        }
      } catch {
        if (!cancelled) {
          if (allowDemo) {
            setEntries(DEMO_DLQ)
            setUsingDemo(true)
          } else {
            setEntries([])
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

  async function retry(queueId: string) {
    setRetrying(queueId)
    setInfo(null)
    setError(null)
    try {
      const response = await apiFetch(`/ingest/${encodeURIComponent(queueId)}/retry`, { method: 'POST' })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      setInfo(`Queued retry for ${queueId}. Result lands in audit trail under retry_executed.`)
      setEntries((current) => current.filter((entry) => entry.queue_id !== queueId))
    } catch (err: any) {
      setError(err?.message ?? 'Retry failed')
    } finally {
      setRetrying(null)
    }
  }

  return (
    <>
      <Topbar
        title={t('Dead-letter queue', 'Dead-letter queue')}
        left={usingDemo ? <Badge tone="amber">{t('Demo data — no real DLQ entries', 'Demo data — no real DLQ entries')}</Badge> : null}
        right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{entries.length} entries</span>}
      />
      <div className="attestiv-content">
        {info ? <Banner tone="info">{info}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Card>
          <CardTitle>{t('Failed ingestion attempts', 'Failed ingestion attempts')}</CardTitle>
          {loading ? (
            <Skeleton lines={3} height={48} />
          ) : entries.length === 0 ? (
            <EmptyState
              icon="ti-circle-check"
              title={t('Queue is empty', 'Queue is empty')}
              description={t(
                'Failed ingestions appear here when the worker exhausts retries.',
                'Failed ingestions appear here when the worker exhausts retries.'
              )}
            />
          ) : (
            <div>
              {entries.map((entry) => (
                <DLQRow
                  key={entry.queue_id}
                  entry={entry}
                  retrying={retrying === entry.queue_id}
                  onRetry={() => retry(entry.queue_id)}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function DLQRow({
  entry,
  retrying,
  onRetry,
}: {
  entry: DLQEntry
  retrying: boolean
  onRetry: () => void
}) {
  const {
    t
  } = useI18n();
  const { canWrite } = useRoles()

  return (
    <div
      style={{
        padding: '12px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500 }}>
          {entry.queue_id}
        </span>
        <Badge tone="red">{entry.stage}</Badge>
        {entry.source ? <Badge tone="navy">{entry.source}</Badge> : null}
        {entry.tenant_id ? <Badge tone="gray">tenant {entry.tenant_id}</Badge> : null}
        {entry.attempts !== undefined ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {entry.attempts} attempts
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <GhostButton onClick={() => undefined}>
            <i className="ti ti-eye" aria-hidden="true" />
            {t('View', 'View')}
          </GhostButton>
          {canWrite ? (
            <PrimaryButton onClick={onRetry} disabled={retrying}>
              <i className="ti ti-refresh" aria-hidden="true" />
              {retrying ? 'Retrying…' : 'Retry'}
            </PrimaryButton>
          ) : null}
        </span>
      </div>
      {entry.message ? <SignatureBox label={t('Error', 'Error')} value={entry.message} mono={false} /> : null}
      <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        {entry.run_id ? <span>{t('run:', 'run:')} {entry.run_id}</span> : null}
        {entry.first_seen_at ? <span>{t('first:', 'first:')} {formatTimestamp(entry.first_seen_at)}</span> : null}
        {entry.last_seen_at ? <span>{t('last:', 'last:')} {formatTimestamp(entry.last_seen_at)}</span> : null}
      </div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}
