'use client';
// Exception detail page — single record + manual resolve.
//
// Three blocks:
//   1. Summary (control, severity, accepted_by, expiry countdown).
//   2. Justification + mitigating controls (read-only context).
//   3. Resolve panel — captures resolution_notes + resolution_evidence_ids.
//      Visible only while status === active. Auto-resolved exceptions
//      surface their auto-resolution metadata in the summary.

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n';

type Exception = {
  id: string
  title: string
  description?: string
  framework_id: string
  control_id: string
  control_name?: string
  severity: string
  status: string
  detected_at?: string
  detected_by?: string
  detection_method?: string
  accepted_by_user_id?: string
  accepted_at?: string
  acceptance_justification?: string
  mitigating_controls?: string[]
  mitigating_evidence_ids?: string[]
  expires_at?: string
  resolved_at?: string
  resolution_notes?: string
  resolution_evidence_ids?: string[]
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'gray' | 'red'> = {
  active: 'amber',
  expired: 'red',
  resolved: 'green',
  revoked: 'gray',
}

const SEVERITY_TONE: Record<string, 'amber' | 'red' | 'gray' | 'navy'> = {
  critical: 'red',
  high: 'amber',
  medium: 'navy',
  low: 'gray',
}

export function AttestivExceptionDetailPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id

  const [exception, setException] = useState<Exception | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resolveNotes, setResolveNotes] = useState('')
  const [resolveEvidence, setResolveEvidence] = useState('')

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/exceptions/${encodeURIComponent(id)}`)
      if (!response.ok) {
        if (response.status === 404) throw new Error('Exception not found')
        throw new Error(`${response.status} ${response.statusText}`)
      }
      const body: Exception = await response.json()
      setException(body)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load exception'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function resolve() {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const evidenceIDs = resolveEvidence
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const response = await apiFetch(`/exceptions/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_notes: resolveNotes, resolution_evidence_ids: evidenceIDs }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      setResolveNotes('')
      setResolveEvidence('')
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to resolve'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const expiryDays = useMemo(() => {
    if (!exception?.expires_at) return null
    const ms = new Date(exception.expires_at).getTime() - Date.now()
    if (!Number.isFinite(ms)) return null
    return Math.floor(ms / (24 * 60 * 60 * 1000))
  }, [exception])

  if (loading) {
    return (
      <>
        <Topbar
          title={t('Exception', 'Exception')}
          left={
            <GhostButton onClick={() => router.push('/exceptions')}>
              <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
            </GhostButton>
          }
        />
        <div className="attestiv-content">
          <Skeleton lines={5} height={42} />
        </div>
      </>
    );
  }

  if (!exception) {
    return (
      <>
        <Topbar title={t('Exception', 'Exception')} />
        <div className="attestiv-content">
          <EmptyState icon="ti-shield-off" title={t('Exception not found', 'Exception not found')} description={t(
            'The exception may have been deleted or you may not have access.',
            'The exception may have been deleted or you may not have access.'
          )} />
        </div>
      </>
    );
  }

  const status = (exception.status || 'active').toLowerCase()
  const severity = (exception.severity || 'medium').toLowerCase()
  const statusTone = STATUS_TONE[status] ?? 'gray'
  const sevTone = SEVERITY_TONE[severity] ?? 'gray'

  return (
    <>
      <Topbar
        title={exception.title || 'Exception'}
        left={
          <GhostButton onClick={() => router.push('/exceptions')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
          </GhostButton>
        }
        right={
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            <code>{exception.id.slice(0, 12)}…</code>
          </span>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {status === 'active' && expiryDays !== null && expiryDays <= 14 ? (
          <Banner tone="warning" title={expiryDays < 0 ? 'Past expiry' : `Expires in ${expiryDays} day${expiryDays === 1 ? '' : 's'}`}>
            {t(
              'Once expired, the suppression stops applying — the underlying control will fail again\n            on the next evaluation tick.',
              'Once expired, the suppression stops applying — the underlying control will fail again\n            on the next evaluation tick.'
            )}
          </Banner>
        ) : null}

        <Card>
          <CardTitle right={<Badge tone={statusTone}>{status}</Badge>}>{t('Summary', 'Summary')}</CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Field label={t('Control', 'Control')}>
              <code>{exception.framework_id}/{exception.control_id}</code>
              {exception.control_name ? <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{exception.control_name}</div> : null}
            </Field>
            <Field label={t('Severity', 'Severity')}>
              <Badge tone={sevTone}>{severity}</Badge>
            </Field>
            <Field label={t('Accepted by', 'Accepted by')}>
              {exception.accepted_by_user_id || '—'}
              {exception.accepted_at ? (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  on {exception.accepted_at.slice(0, 10)}
                </div>
              ) : null}
            </Field>
            <Field label={t('Detection', 'Detection')}>
              {exception.detection_method || 'manual'}
              {exception.detected_at ? (
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  detected {exception.detected_at.slice(0, 10)}
                </div>
              ) : null}
            </Field>
            <Field label={t('Expires', 'Expires')}>
              {exception.expires_at ? exception.expires_at.slice(0, 10) : '—'}
              {expiryDays !== null ? (
                <div style={{ fontSize: 11, color: expiryDays < 0 ? 'var(--color-status-red-mid)' : 'var(--color-text-tertiary)' }}>
                  {expiryDays < 0 ? `${Math.abs(expiryDays)}d past` : `${expiryDays}d remaining`}
                </div>
              ) : null}
            </Field>
            {exception.resolved_at ? (
              <Field label={t('Resolved', 'Resolved')}>
                {exception.resolved_at.slice(0, 10)}
                {exception.resolution_notes ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                    {exception.resolution_notes}
                  </div>
                ) : null}
              </Field>
            ) : null}
          </div>
          {exception.description ? (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 12, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {exception.description}
            </p>
          ) : null}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t(
            'Justification & mitigating controls',
            'Justification & mitigating controls'
          )}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0, whiteSpace: 'pre-wrap' }}>
            {exception.acceptance_justification || '(none recorded)'}
          </p>
          {exception.mitigating_controls && exception.mitigating_controls.length > 0 ? (
            <ul style={{ fontSize: 12, color: 'var(--color-text-secondary)', paddingLeft: 18, marginBottom: 0 }}>
              {exception.mitigating_controls.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          ) : null}
        </Card>

        {status === 'active' ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle>{t('Resolve manually', 'Resolve manually')}</CardTitle>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
              {t(
                'If the underlying control passes (or you\'ve decided to remove the acceptance), record\n              the resolution. Auto-resolution happens whenever the control transitions back to PASS\n              on its own.',
                'If the underlying control passes (or you\'ve decided to remove the acceptance), record\n              the resolution. Auto-resolution happens whenever the control transitions back to PASS\n              on its own.'
              )}
            </p>
            <FormRow label={t('Resolution notes', 'Resolution notes')}>
              <textarea
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
                rows={3}
                style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
              />
            </FormRow>
            <FormRow label={t(
              'Resolution evidence IDs (one per line)',
              'Resolution evidence IDs (one per line)'
            )}>
              <textarea
                value={resolveEvidence}
                onChange={(e) => setResolveEvidence(e.target.value)}
                rows={2}
                placeholder="evd_abc123…"
                style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
              />
            </FormRow>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <PrimaryButton onClick={resolve} disabled={busy || !resolveNotes.trim()}>
                {busy ? 'Resolving…' : 'Mark resolved'}
              </PrimaryButton>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{children}</div>
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 3 }}>
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 12,
  padding: '6px 8px',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--border-radius-md)',
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  fontFamily: 'inherit',
}
