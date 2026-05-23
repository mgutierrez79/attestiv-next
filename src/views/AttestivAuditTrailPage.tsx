'use client';
// Audit trail page.
//
// The page an auditor opens when they want to walk the chain. Two
// halves: a chronological log on the left, a signed-manifest panel on
// the right. The log is read-heavy — operators don't write here, the
// system does — so the row format prioritises scanning: timestamp,
// actor, action, type. The manifest panel shows the digest+signature
// the auditor can carry to their offline verifier.
//
// Why we bind to /v1/audit/log here rather than the persisted
// /audit_log.jsonl directly: the API endpoint already filters by
// tenant scope, applies pagination, and merges the file-backed log
// with the database-backed log. Reaching past it would skip the
// tenant filter — a footgun.

import { useEffect, useState } from 'react'

import {
  Badge,
  Card,
  CardTitle,
  GhostButton,
  PaginatedList,
  PrimaryButton,
  SignatureBox,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { isDemoMode } from '../lib/demoMode'

import { useI18n } from '../lib/i18n';

type AuditEntry = {
  timestamp: string
  actor: string
  action: string
  details?: Record<string, any>
  tenant_id?: string
}

type ManifestSummary = {
  manifest_id: string
  tenant: string
  evidence_count: number
  frameworks: string[]
  timestamp: string
  signature: string
  public_key_url: string
  algorithm: string
}

const DEMO_MANIFEST: ManifestSummary = {
  manifest_id: 'mf-2026-05-08T14-22-19Z',
  tenant: 'acme',
  evidence_count: 1247,
  frameworks: ['SOC 2', 'ISO 27001', 'CIS Controls v8'],
  timestamp: '2026-05-08T14:22:19.103Z',
  signature: 'kid-7f3a91e45c2b1d:MEYCIQDqK1y3PqT8mVu...truncated',
  public_key_url: '/v1/public/keys',
  algorithm: 'ed25519',
}

const ACTION_TONES: Record<string, 'green' | 'amber' | 'red' | 'blue' | 'gray'> = {
  evidence_signed: 'green',
  evidence_verified: 'green',
  report_generated: 'blue',
  config_frameworks_updated: 'blue',
  worker_job_created: 'gray',
  worker_job_deleted: 'amber',
  dlq_entered: 'red',
  retry_executed: 'amber',
  policy_task_reminder_sent: 'gray',
}

export function AttestivAuditTrailPage() {
  const {
    t
  } = useI18n();

  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [manifest, setManifest] = useState<ManifestSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usingDemo, setUsingDemo] = useState(false)
  const [filter, setFilter] = useState('')

  useEffect(() => {
    let cancelled = false
    // Demo-mode fixtures are off-limits in pilot/production. The
    // gate is checked once at mount because flipping the tenant
    // environment mid-session would be an unusual flow.
    const allowDemo = isDemoMode()
    async function load() {
      try {
        const response = await apiFetch('/audit/log?limit=200')
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`)
        }
        const body = await response.json().catch(() => ({}))
        const items: AuditEntry[] = Array.isArray(body?.items) ? body.items : []
        if (!cancelled) {
          setEntries(items)
          if (items.length === 0 && allowDemo) {
            setEntries(demoEntries())
            setUsingDemo(true)
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          if (allowDemo) {
            setEntries(demoEntries())
            setUsingDemo(true)
          }
          setError(err?.message ?? 'Failed to load audit trail')
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

  useEffect(() => {
    // The signed-manifest summary card is decorative when there's no
    // real run yet — only show the DEMO_MANIFEST in demo mode so
    // pilots don't see a fabricated kid + signature in their audit
    // header (operators have asked us to reproduce them and gotten
    // confused when nothing matched the real run history).
    if (isDemoMode()) {
      setManifest(DEMO_MANIFEST)
    }
  }, [])

  const filtered = filter.trim()
    ? entries.filter((entry) => {
        const needle = filter.trim().toLowerCase()
        return (
          entry.action.toLowerCase().includes(needle) ||
          entry.actor.toLowerCase().includes(needle) ||
          (entry.tenant_id ?? '').toLowerCase().includes(needle)
        )
      })
    : entries

  return (
    <>
      <Topbar
        title={t('Audit trail', 'Audit trail')}
        left={
          usingDemo ? <Badge tone="amber">{t('Demo data — no live audit entries', 'Demo data — no live audit entries')}</Badge> : null
        }
        right={
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('Filter by actor, action, tenant', 'Filter by actor, action, tenant')}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-background-primary)',
              outline: 'none',
              minWidth: 240,
              fontFamily: 'inherit',
            }}
          />
        }
      />
      <div className="attestiv-content">
        {error ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-status-red-deep)',
              background: 'var(--color-status-red-bg)',
              padding: '8px 12px',
              borderRadius: 'var(--border-radius-md)',
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        ) : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 320px',
            gap: 12,
          }}
        >
          <Card>
            <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{filtered.length} entries</span>}>
              {t('Recent activity', 'Recent activity')}
            </CardTitle>
            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '16px 0' }}>
                {t('Loading…', 'Loading…')}
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '16px 0' }}>
                {t('No entries match.', 'No entries match.')}
              </div>
            ) : (
              <PaginatedList
                items={filtered}
                itemKey={(entry, index) => `${entry.timestamp}-${index}`}
                renderItem={(entry) => <AuditRow entry={entry} />}
                label={t('Audit trail', 'Audit trail')}
              />
            )}
          </Card>

          <div>
            <Card>
              <CardTitle>{t('Latest signed manifest', 'Latest signed manifest')}</CardTitle>
              {manifest ? (
                <ManifestPanel manifest={manifest} />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('None yet.', 'None yet.')}</div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const action = entry.action || 'unknown'
  const tone = ACTION_TONES[action] ?? 'gray'
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 140px minmax(0, 1fr) auto',
        gap: 12,
        padding: '8px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 12,
        alignItems: 'baseline',
      }}
    >
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: 'var(--color-text-tertiary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {formatTimestamp(entry.timestamp)}
      </span>
      <span
        style={{
          color: 'var(--color-text-secondary)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {entry.actor || 'system'}
      </span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {humanizeAction(action)}
        {entry.details ? (
          <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 6 }}>
            {summarizeDetails(entry.details)}
          </span>
        ) : null}
      </span>
      <Badge tone={tone}>{action}</Badge>
    </div>
  )
}

function ManifestPanel({ manifest }: { manifest: ManifestSummary }) {
  const {
    t
  } = useI18n();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <KV label={t('Manifest', 'Manifest')} value={manifest.manifest_id} mono />
      <KV label={t('Tenant', 'Tenant')} value={manifest.tenant} />
      <KV label={t('Evidence count', 'Evidence count')} value={String(manifest.evidence_count)} />
      <KV label={t('Frameworks', 'Frameworks')} value={manifest.frameworks.join(', ')} />
      <KV label={t('Signed at', 'Signed at')} value={formatTimestamp(manifest.timestamp)} mono />
      <SignatureBox label={t('Signature', 'Signature')} value={manifest.signature} />
      <SignatureBox label={t('Public key', 'Public key')} value={manifest.public_key_url} mono={false} />
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <PrimaryButton onClick={() => undefined}>
          <i className="ti ti-file-download" aria-hidden="true" />
          {t('Download PDF', 'Download PDF')}
        </PrimaryButton>
        <GhostButton onClick={() => undefined}>
          <i className="ti ti-link" aria-hidden="true" />
          {t('Auditor link', 'Auditor link')}
        </GhostButton>
      </div>
    </div>
  );
}

function KV({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          fontWeight: 500,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  )
}

function formatTimestamp(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

function humanizeAction(action: string): string {
  return action
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function summarizeDetails(details: Record<string, any>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(details)) {
    if (value === null || value === undefined) continue
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    if (text.length > 60) continue
    parts.push(`${key}=${text}`)
    if (parts.length >= 3) break
  }
  return parts.length > 0 ? `· ${parts.join(' · ')}` : ''
}

function demoEntries(): AuditEntry[] {
  const now = Date.now()
  return [
    {
      timestamp: new Date(now - 1000 * 60 * 2).toISOString(),
      actor: 'alice@acme.example',
      action: 'evidence_signed',
      details: { run_id: 'run-2026-05-08-14-22', framework: 'soc2' },
    },
    {
      timestamp: new Date(now - 1000 * 60 * 8).toISOString(),
      actor: 'system',
      action: 'config_frameworks_updated',
      details: { enabled: ['soc2', 'iso27001'], all_enabled: false },
    },
    {
      timestamp: new Date(now - 1000 * 60 * 14).toISOString(),
      actor: 'reporter@acme.example',
      action: 'report_generated',
      details: { report_path: '/reports/2026-05-08/soc2.pdf' },
    },
    {
      timestamp: new Date(now - 1000 * 60 * 22).toISOString(),
      actor: 'system',
      action: 'dlq_entered',
      details: { stage: 'router', message: 'panorama timeout' },
    },
    {
      timestamp: new Date(now - 1000 * 60 * 41).toISOString(),
      actor: 'system',
      action: 'retry_executed',
      details: { queue_id: 'q-9f1e0', attempts: 2 },
    },
  ]
}
