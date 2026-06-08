'use client';
// Issues inbox — mockup 08.
//
// One screen, three tabs, every gap surfaced:
//   1. Dead-letter queue   — failed jobs that didn't process. Each
//      row shows attempt history (Phase 3.5 audit log) so an
//      operator can see what failed and how many times.
//   2. Stale connectors    — connectors that haven't reported within
//      2× their declared poll interval. Computed client-side from
//      /v1/connectors so the threshold logic stays consistent with
//      the dashboard freshness banner.
//   3. Failing controls    — controls that are failing or under
//      review. Sourced from the dashboard summary's framework data;
//      until the framework engine fully reports per-control status
//      we render whatever's in summary.framework_scores.
//
// The tab counts feed the nav badge. The page auto-refreshes every
// 30 seconds and after every retry.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ApiError, apiFetch, apiJson } from '../lib/api'
import { Badge, Card, GhostButton, PrimaryButton, Topbar } from '../components/AttestivUi'
import { formatTimestamp } from '../lib/time'

import { useI18n } from '../lib/i18n';

type Tab = 'dlq' | 'stale' | 'controls' | 'risks' | 'expiring'

type RiskRow = {
  risk_id: string
  title: string
  category?: string
  likelihood?: string
  impact?: string
  score?: number
  status?: string
  source?: string
  source_framework_id?: string
  source_control_id?: string
}

type ExpiringExceptionRow = {
  id: string
  title: string
  framework_id: string
  control_id: string
  severity?: string
  expires_at?: string
  accepted_by_user_id?: string
}

type DLQAttempt = {
  attempt: number
  started_at: string
  ended_at?: string
  retried_by?: string
  previous_error?: string
  outcome?: string
}
type DLQRecord = {
  queue_id: string
  envelope_id?: string
  queue?: string
  status?: string
  stage?: string
  run_id?: string
  tenant_id?: string
  error?: string | null
  attempts?: number
  created_at?: string
  updated_at?: string
  failed_at?: string
  envelope?: { source?: string; section?: string; tenant_id?: string }
  dlq_attempts?: DLQAttempt[]
}
type IngestQueueResponse = { items: DLQRecord[]; count: number }

type ConnectorStatus = {
  name: string
  label?: string
  status?: string
  delivery_mode?: string
  last_run?: string | null
  last_success?: string | null
  poll_interval_seconds?: number
  failure_count?: number
}
type ConnectorsResponse = { connectors: ConnectorStatus[] }

type ControlIssue = {
  framework: string
  control: string
  status: 'failing' | 'review'
  detail: string
  framework_id?: string
  control_id?: string
}

const STALE_FALLBACK_SECONDS = 24 * 3600

function lastSeenMs(connector: ConnectorStatus): number | null {
  const candidate = connector.last_success || connector.last_run
  if (!candidate) return null
  const ms = new Date(candidate).getTime()
  return Number.isFinite(ms) ? ms : null
}

function staleAfterMs(connector: ConnectorStatus): number {
  const interval = connector.poll_interval_seconds ||
    (connector.delivery_mode === 'stream' ? 60 : STALE_FALLBACK_SECONDS)
  return interval * 2 * 1000
}

function humanDuration(ms: number): string {
  if (ms <= 0) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  if (hours < 24) return `${hours}h ${remainder}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

export function AttestivIssuesPage() {
  const {
    t
  } = useI18n();

  const searchParams = useSearchParams()
  const initialTab = (searchParams?.get('tab') as Tab | null) ?? 'dlq'
  const [tab, setTab] = useState<Tab>(initialTab)
  const [dlq, setDlq] = useState<DLQRecord[]>([])
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [risks, setRisks] = useState<RiskRow[]>([])
  const [expiring, setExpiring] = useState<ExpiringExceptionRow[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState<string | null>(null)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  // Real failing controls from the scoring engine (replaces the old
  // connector-derived synthetic stand-in).
  const [failing, setFailing] = useState<any[]>([])
  const [assigningKey, setAssigningKey] = useState<string | null>(null)
  const [assignResult, setAssignResult] = useState<{ text: string; ok: boolean } | null>(null)
  const router = useRouter()

  const reload = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      // Each endpoint is independent; allSettled keeps a 500 on the
      // GRC endpoints from blanking out the DLQ tab the operator
      // came here to triage.
      const [dlqRes, connectorsRes, risksRes, expiringRes, failingRes] = await Promise.allSettled([
        apiJson<IngestQueueResponse>('/ingest/queue?queue=dead_letter&status=dead_letter&limit=200'),
        apiJson<ConnectorsResponse>('/connectors'),
        apiJson<{ items?: RiskRow[] }>('/risks?status=open&limit=200'),
        apiJson<{ items?: ExpiringExceptionRow[] }>('/exceptions/expiring-soon?within_days=14'),
        apiJson<{ items?: any[] }>('/scoring/failing'),
      ])
      if (dlqRes.status === 'fulfilled') {
        setDlq(dlqRes.value.items || [])
      } else {
        setError(dlqRes.reason as ApiError)
      }
      if (connectorsRes.status === 'fulfilled') {
        setConnectors(connectorsRes.value.connectors || [])
      }
      setRisks(risksRes.status === 'fulfilled' ? risksRes.value.items ?? [] : [])
      setExpiring(expiringRes.status === 'fulfilled' ? expiringRes.value.items ?? [] : [])
      setFailing(failingRes.status === 'fulfilled' ? failingRes.value.items ?? [] : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
    const handle = window.setInterval(() => void reload(), 30_000)
    return () => window.clearInterval(handle)
  }, [reload])

  const stale = useMemo(() => {
    const now = Date.now()
    return connectors.filter((connector) => {
      const seen = lastSeenMs(connector)
      if (seen === null) return true
      return now - seen > staleAfterMs(connector)
    })
  }, [connectors])

  // Failing controls — the REAL per-control status from the scoring
  // engine (/v1/scoring/failing). Each item is a scored ControlResult
  // (PascalCase keys), so we carry framework_id + control_id through to
  // wire "Assign remediation" and "View evidence".
  const controls = useMemo<ControlIssue[]>(() => {
    return failing.map((rec) => {
      const fwId = String(rec?.FrameworkID ?? rec?.framework_id ?? '')
      const ctlId = String(rec?.ControlID ?? rec?.control_id ?? '')
      const ctlName = String(rec?.ControlName ?? rec?.control_name ?? ctlId)
      const rawStatus = String(rec?.Status ?? rec?.status ?? '').toLowerCase()
      const status: 'failing' | 'review' =
        rawStatus === 'fail' || rawStatus === 'failing' ? 'failing' : 'review'
      const findings: any[] = Array.isArray(rec?.Findings)
        ? rec.Findings
        : Array.isArray(rec?.findings)
          ? rec.findings
          : []
      const detail =
        findings.length > 0
          ? String(findings[0]?.Description ?? findings[0]?.description ?? '')
          : `Score ${Math.round(Number(rec?.Score ?? rec?.score ?? 0) * 100)}% — below the passing threshold.`
      return {
        framework: fwId ? fwId.toUpperCase() : 'unknown',
        control: ctlName && ctlName !== ctlId ? `${ctlId} — ${ctlName}` : ctlId,
        status,
        detail,
        framework_id: fwId || undefined,
        control_id: ctlId || undefined,
      }
    })
  }, [failing])

  // assignRemediation creates a real remediation task for a failing
  // control (POST /v1/remediation), wiring the previously-dead button.
  const assignRemediation = async (c: ControlIssue) => {
    if (!c.framework_id || !c.control_id) return
    const key = `${c.framework_id}/${c.control_id}`
    setAssigningKey(key)
    setAssignResult(null)
    try {
      await apiFetch('/remediation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          framework_id: c.framework_id,
          control_id: c.control_id,
          title: `Remediate ${c.control}`,
          description: c.detail,
        }),
      })
      setAssignResult({ text: c.control, ok: true })
    } catch {
      setAssignResult({ text: c.control, ok: false })
    } finally {
      setAssigningKey(null)
    }
  }

  const counts = {
    dlq: dlq.length,
    stale: stale.length,
    controls: controls.length,
    risks: risks.length,
    expiring: expiring.length,
  }

  const retry = async (queueId: string) => {
    setRetrying(queueId)
    setRetryMessage(null)
    try {
      await apiFetch(`/ingest/dlq/${encodeURIComponent(queueId)}/retry`, { method: 'POST' })
      setRetryMessage(`Requeued ${queueId}.`)
      await reload()
    } catch (err) {
      const apiError = err as ApiError
      setRetryMessage(`Retry failed: ${apiError.message}`)
    } finally {
      setRetrying(null)
    }
  }

  const totalIssues = counts.dlq + counts.stale + counts.controls + counts.risks + counts.expiring

  return (
    <>
      <Topbar
        title={t('Issues', 'Issues')}
        left={totalIssues > 0 ? <Badge tone="red">{totalIssues} {t('need attention', 'need attention')}</Badge> : <Badge tone="green">{t('All clear', 'All clear')}</Badge>}
        right={
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {loading ? 'Refreshing…' : 'Updated 12s ago'}
          </span>
        }
      />
      <div className="attestiv-content">
        {error ? (
          <Card>
            <div style={{ color: 'var(--color-status-red-deep)', fontSize: 12 }}>
              {t('Failed to load issues:', 'Failed to load issues:')} {error.message}
            </div>
          </Card>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: 0,
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            paddingBottom: 0,
            marginBottom: 12,
          }}
        >
          <TabButton active={tab === 'dlq'} onClick={() => setTab('dlq')} icon="ti-inbox" tone="red" count={counts.dlq}>
            {t('Dead-letter queue', 'Dead-letter queue')}
          </TabButton>
          <TabButton active={tab === 'stale'} onClick={() => setTab('stale')} icon="ti-clock" tone="amber" count={counts.stale}>
            {t('Stale connectors', 'Stale connectors')}
          </TabButton>
          <TabButton active={tab === 'controls'} onClick={() => setTab('controls')} icon="ti-shield-x" tone="amber" count={counts.controls}>
            {t('Failing controls', 'Failing controls')}
          </TabButton>
          <TabButton active={tab === 'risks'} onClick={() => setTab('risks')} icon="ti-alert-octagon" tone="amber" count={counts.risks}>
            {t('Risks', 'Risks')}
          </TabButton>
          <TabButton active={tab === 'expiring'} onClick={() => setTab('expiring')} icon="ti-clock-exclamation" tone="red" count={counts.expiring}>
            {t('Exceptions expiring', 'Exceptions expiring')}
          </TabButton>
        </div>

        {retryMessage ? (
          <div
            style={{
              border: '0.5px solid var(--color-status-blue-deep)',
              background: 'var(--color-status-blue-bg)',
              color: 'var(--color-status-blue-deep)',
              borderRadius: 'var(--border-radius-md)',
              padding: '8px 12px',
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            {retryMessage}
          </div>
        ) : null}

        {tab === 'dlq' ? <DLQTab items={dlq} retrying={retrying} onRetry={retry} /> : null}
        {tab === 'stale' ? <StaleTab connectors={stale} /> : null}
        {tab === 'controls' ? (
          <ControlsTab
            controls={controls}
            onAssign={assignRemediation}
            onView={(c) => {
              if (c.framework_id && c.control_id) {
                router.push(`/scoring/frameworks/${encodeURIComponent(c.framework_id)}/controls/${encodeURIComponent(c.control_id)}`)
              }
            }}
            onGoToRemediation={() => router.push('/remediation?status=open')}
            assigningKey={assigningKey}
            assignResult={assignResult}
          />
        ) : null}
        {tab === 'risks' ? <RisksTab risks={risks} /> : null}
        {tab === 'expiring' ? <ExpiringExceptionsTab items={expiring} /> : null}
      </div>
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  tone,
  count,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: string
  tone: 'red' | 'amber'
  count: number
  children: React.ReactNode
}) {
  const palette =
    tone === 'red'
      ? { bg: 'var(--color-status-red-bg)', fg: 'var(--color-status-red-deep)' }
      : { bg: 'var(--color-status-amber-bg)', fg: 'var(--color-status-amber-deep)' }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        padding: '10px 14px',
        fontSize: 12,
        background: 'transparent',
        border: 'none',
        borderBottom: active
          ? '2px solid var(--color-brand-blue)'
          : '2px solid transparent',
        color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
        fontWeight: active ? 500 : 400,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: '-0.5px',
        fontFamily: 'inherit',
      }}
    >
      <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 14 }} />
      {children}
      {count > 0 ? (
        <span
          style={{
            fontSize: 10,
            padding: '1px 6px',
            borderRadius: 20,
            fontWeight: 500,
            background: palette.bg,
            color: palette.fg,
          }}
        >
          {count}
        </span>
      ) : null}
    </button>
  )
}

function DLQTab({
  items,
  retrying,
  onRetry,
}: {
  items: DLQRecord[]
  retrying: string | null
  onRetry: (queueId: string) => void
}) {
  const {
    t
  } = useI18n();

  if (!items.length) {
    return (
      <Card>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {t(
            'No dead-letter records. Every signed envelope and processor output reached its destination.',
            'No dead-letter records. Every signed envelope and processor output reached its destination.'
          )}
        </div>
      </Card>
    );
  }
  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        {t(
          'Failed jobs that could not process — each represents potentially missing compliance evidence. Missing evidence\n        is a compliance risk, not just a technical error.',
          'Failed jobs that could not process — each represents potentially missing compliance evidence. Missing evidence\n        is a compliance risk, not just a technical error.'
        )}
      </p>
      {items.map(item => {
        const {
          t
        } = useI18n();

        return (
          <Card key={item.queue_id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--border-radius-md)',
                  background: 'var(--color-status-red-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <i
                  className="ti ti-alert-triangle"
                  aria-hidden="true"
                  style={{ color: 'var(--color-status-red-mid)', fontSize: 15 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, marginBottom: 3, fontSize: 12 }}>
                  {item.envelope?.source || item.stage || 'unknown'} —{' '}
                  <span style={{ color: 'var(--color-status-red-deep)' }}>{item.error || 'unknown failure'}</span>
                </div>
                {item.run_id || item.tenant_id ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
                    {item.envelope?.section ? `section: ${item.envelope.section} · ` : ''}
                    {item.run_id ? `run: ${item.run_id} · ` : ''}
                    {item.tenant_id ? `tenant: ${item.tenant_id}` : ''}
                  </div>
                ) : null}
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                  {item.queue_id} {t('· failed', '· failed')}{' '}
                  {formatTimestamp(item.failed_at || item.updated_at || item.created_at || '')} {t('· attempts:', '· attempts:')}{' '}
                  {item.attempts ?? 0}
                </div>
                {item.dlq_attempts && item.dlq_attempts.length ? (
                  <div
                    style={{
                      marginTop: 6,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--color-text-tertiary)',
                      lineHeight: 1.6,
                    }}
                  >
                    {item.dlq_attempts.map(attempt => {
                      const {
                        t
                      } = useI18n();

                      return (
                        <div key={attempt.attempt}>
                          {t('Attempt', 'Attempt')} {attempt.attempt}: {formatTimestamp(attempt.started_at)}
                          {attempt.retried_by ? ` · by ${attempt.retried_by}` : ''}
                          {attempt.previous_error ? ` — ${attempt.previous_error}` : ''}
                          {attempt.outcome ? ` · ${attempt.outcome}` : ''}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <PrimaryButton
                    onClick={() => onRetry(item.queue_id)}
                    disabled={retrying === item.queue_id}
                  >
                    {retrying === item.queue_id ? 'Retrying…' : 'Retry now'}
                  </PrimaryButton>
                  <GhostButton>{t('Inspect error', 'Inspect error')}</GhostButton>
                </div>
              </div>
              <Badge tone="red">DLQ</Badge>
            </div>
          </Card>
        );
      })}
    </>
  );
}

function StaleTab({ connectors }: { connectors: ConnectorStatus[] }) {
  const {
    t
  } = useI18n();

  if (!connectors.length) {
    return (
      <Card>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {t(
            'All declared connectors reported within their poll cadence. Evidence is fresh.',
            'All declared connectors reported within their poll cadence. Evidence is fresh.'
          )}
        </div>
      </Card>
    );
  }
  const now = Date.now()
  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        {t(
          'Connectors that have not reported within their declared poll interval × 2. A silent connector may mean\n        missing evidence.',
          'Connectors that have not reported within their declared poll interval × 2. A silent connector may mean\n        missing evidence.'
        )}
      </p>
      {connectors.map((connector) => {
        const {
          t
        } = useI18n();

        const seen = lastSeenMs(connector)
        const overdue = seen ? now - seen - staleAfterMs(connector) : null
        const interval = connector.poll_interval_seconds ||
          (connector.delivery_mode === 'stream' ? 60 : STALE_FALLBACK_SECONDS)
        return (
          <Card key={connector.name}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--border-radius-md)',
                  background: 'var(--color-status-amber-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <i
                  className="ti ti-clock"
                  aria-hidden="true"
                  style={{ color: 'var(--color-status-amber-text)', fontSize: 15 }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 3 }}>
                  {connector.label || connector.name} {t('— connector silent for', '— connector silent for')}{' '}
                  {seen ? humanDuration(now - seen) : 'never reported'}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '2px 8px',
                    borderRadius: 20,
                    background: 'var(--color-status-amber-bg)',
                    color: 'var(--color-status-amber-deep)',
                    display: 'inline-block',
                    marginBottom: 6,
                  }}
                >
                  {t('Expected every', 'Expected every')} {interval >= 60 ? `${Math.round(interval / 60)}min` : `${interval}s`}
                  {seen ? ` · last seen ${humanDuration(now - seen)} ago` : ''}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                  {seen
                    ? `Last successful poll: ${formatTimestamp(connector.last_success || connector.last_run || '')}`
                    : 'No successful collection on record.'}
                  {(connector.failure_count || 0) > 0 ? ` · ${connector.failure_count} recent failures.` : ''}
                </div>
                {overdue && overdue > 0 ? (
                  <div style={{ marginTop: 6 }}>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--color-text-tertiary)',
                        marginBottom: 3,
                      }}
                    >
                      {t(
                        'Time since last contact vs expected interval',
                        'Time since last contact vs expected interval'
                      )}
                    </div>
                    <div
                      style={{
                        height: 4,
                        background: 'var(--color-border-tertiary)',
                        borderRadius: 2,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: '100%',
                          borderRadius: 2,
                          background: 'var(--color-status-red-mid)',
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--color-status-red-deep)',
                        marginTop: 3,
                      }}
                    >
                      {Math.floor(overdue / 60_000)} {t('minutes overdue', 'minutes overdue')}
                    </div>
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <PrimaryButton>{t('Test connection', 'Test connection')}</PrimaryButton>
                  <GhostButton>{t('View DLQ entries', 'View DLQ entries')}</GhostButton>
                </div>
              </div>
              <Badge tone="amber">{t('Stale', 'Stale')}</Badge>
            </div>
          </Card>
        );
      })}
    </>
  );
}

function ControlsTab({
  controls,
  onAssign,
  onView,
  onGoToRemediation,
  assigningKey,
  assignResult,
}: {
  controls: ControlIssue[]
  onAssign: (c: ControlIssue) => void
  onView: (c: ControlIssue) => void
  onGoToRemediation: () => void
  assigningKey: string | null
  assignResult: { text: string; ok: boolean } | null
}) {
  const { t } = useI18n()

  if (!controls.length) {
    return (
      <Card>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {t(
            'All controls are passing. The framework engine has not flagged anything for review.',
            'All controls are passing. The framework engine has not flagged anything for review.'
          )}
        </div>
      </Card>
    )
  }
  return (
    <>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
        {t(
          'Controls that are failing or under review. Each requires attention to maintain your compliance posture.',
          'Controls that are failing or under review. Each requires attention to maintain your compliance posture.'
        )}
      </p>
      {assignResult ? (
        <div
          style={{
            fontSize: 12,
            color: assignResult.ok ? 'var(--color-status-green-deep)' : 'var(--color-status-red-deep)',
            background: assignResult.ok ? 'var(--color-status-green-bg)' : 'var(--color-status-red-bg)',
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>
            {assignResult.ok
              ? `${t('Remediation task created for', 'Remediation task created for')} ${assignResult.text}.`
              : `${t('Could not create a remediation task for', 'Could not create a remediation task for')} ${assignResult.text}.`}
          </span>
          {assignResult.ok ? (
            <button
              type="button"
              onClick={onGoToRemediation}
              style={{
                background: 'transparent',
                border: '1px solid var(--color-status-green-deep)',
                borderRadius: 4,
                color: 'var(--color-status-green-deep)',
                fontSize: 11,
                fontWeight: 600,
                padding: '2px 8px',
                cursor: 'pointer',
                fontFamily: 'inherit',
                flexShrink: 0,
              }}
            >
              {t('View in Remediation', 'View in Remediation')} →
            </button>
          ) : null}
        </div>
      ) : null}
      {controls.map((control, index) => {
        return (
          <Card key={`${control.framework}-${control.control}-${index}`}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 'var(--border-radius-md)',
                  background:
                    control.status === 'failing'
                      ? 'var(--color-status-red-bg)'
                      : 'var(--color-status-amber-bg)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginTop: 1,
                }}
              >
                <i
                  className={`ti ${control.status === 'failing' ? 'ti-x' : 'ti-alert-triangle'}`}
                  aria-hidden="true"
                  style={{
                    color:
                      control.status === 'failing'
                        ? 'var(--color-status-red-mid)'
                        : 'var(--color-status-amber-mid)',
                    fontSize: 15,
                  }}
                />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 3 }}>
                  {control.control} — {control.framework}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  {control.detail}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <PrimaryButton
                    onClick={() => onAssign(control)}
                    disabled={!control.control_id || assigningKey === `${control.framework_id}/${control.control_id}`}
                  >
                    {assigningKey === `${control.framework_id}/${control.control_id}`
                      ? t('Assigning…', 'Assigning…')
                      : t('Assign remediation', 'Assign remediation')}
                  </PrimaryButton>
                  <GhostButton onClick={() => onView(control)} disabled={!control.control_id}>
                    {t('View evidence', 'View evidence')}
                  </GhostButton>
                </div>
              </div>
              <Badge tone={control.status === 'failing' ? 'red' : 'amber'}>
                {control.status === 'failing' ? 'Fail' : 'Review'}
              </Badge>
            </div>
          </Card>
        );
      })}
    </>
  );
}

// RisksTab — open risks (Phase-2 chunk 1). Surfaces auto-created
// and manual risks side-by-side; the auto badge tells the operator
// which ones came from the scoring engine.
function RisksTab({ risks }: { risks: RiskRow[] }) {
  const {
    t
  } = useI18n();

  if (risks.length === 0) {
    return (
      <Card>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {t(
            'No open risks. Auto-risks appear here when scoring detects a control transition.',
            'No open risks. Auto-risks appear here when scoring detects a control transition.'
          )}
        </div>
      </Card>
    );
  }
  const sorted = [...risks].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  return (
    <>
      {sorted.map((risk) => {
        const score = risk.score ?? 0
        const tone: 'red' | 'amber' | 'gray' = score >= 12 ? 'red' : score >= 6 ? 'amber' : 'gray'
        const isAuto = (risk.source || '').startsWith('auto_')
        return (
          <Card key={risk.risk_id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <a
                    href={`/risks/${encodeURIComponent(risk.risk_id)}`}
                    style={{ color: 'var(--color-text-primary)', textDecoration: 'none' }}
                  >
                    {risk.title}
                  </a>
                  {isAuto ? <Badge tone="navy">auto</Badge> : null}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {risk.source_control_id ? (
                    <>
                      <code>{risk.source_framework_id}/{risk.source_control_id}</code>
                      {risk.category ? ` · ${risk.category.replace(/_/g, ' ')}` : ''}
                    </>
                  ) : (
                    risk.category ? risk.category.replace(/_/g, ' ') : '—'
                  )}
                  {' · '}
                  {(risk.likelihood ?? '—').toUpperCase()} × {(risk.impact ?? '—').toUpperCase()}
                </div>
              </div>
              <div style={{ fontSize: 12, fontWeight: 500, minWidth: 70, textAlign: 'right' }}>
                score {score}
              </div>
              <Badge tone={tone}>{(risk.status ?? 'open').replace(/_/g, ' ')}</Badge>
            </div>
          </Card>
        )
      })}
    </>
  )
}

// ExpiringExceptionsTab — exceptions whose expires_at is within 14
// days. Once the exception expires, the underlying control failure
// stops being suppressed — the operator either renews acceptance or
// resolves the gap.
function ExpiringExceptionsTab({ items }: { items: ExpiringExceptionRow[] }) {
  const {
    t
  } = useI18n();

  if (items.length === 0) {
    return (
      <Card>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {t(
            'No exceptions expiring in the next 14 days.',
            'No exceptions expiring in the next 14 days.'
          )}
        </div>
      </Card>
    );
  }
  return (
    <>
      {items.map((ex) => {
        const days = ex.expires_at
          ? Math.floor((new Date(ex.expires_at).getTime() - Date.now()) / 86_400_000)
          : null
        const overdue = days !== null && days < 0
        const tone: 'red' | 'amber' = overdue ? 'red' : 'amber'
        return (
          <Card key={ex.id} style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500, marginBottom: 2 }}>
                  <a
                    href={`/exceptions/${encodeURIComponent(ex.id)}`}
                    style={{ color: 'var(--color-text-primary)', textDecoration: 'none' }}
                  >
                    {ex.title}
                  </a>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  <code>{ex.framework_id}/{ex.control_id}</code>
                  {ex.severity ? ` · ${ex.severity}` : ''}
                  {ex.accepted_by_user_id ? ` · accepted by ${ex.accepted_by_user_id}` : ''}
                </div>
              </div>
              <Badge tone={tone}>
                {days === null ? 'unknown' : overdue ? `${Math.abs(days)}d past` : `${days}d left`}
              </Badge>
            </div>
          </Card>
        )
      })}
    </>
  )
}
