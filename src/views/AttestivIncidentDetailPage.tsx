'use client';
// Incident detail page — full Article 23 workflow.
//
// Three blocks:
//   1. Summary + countdown to next deadline.
//   2. Classification panel — mark NIS2 significant or not, set
//      category + impact sectors + affected services.
//   3. Notification ladder — three drafts (24h early warning, 72h
//      initial, 30d final). Each draft has a JSON content preview
//      and a "submit + record reference number" form once submitted.

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
import { useRoles } from '../lib/roles'

type Incident = {
  id: string
  title: string
  nis2_significant?: boolean
  nis2_category?: string
  nis2_impact_sectors?: string[]
  affected_services?: string[]
  affected_users_count?: number
  detected_at?: string
  detected_by?: string
  detection_method?: string
  trigger_evidence_ids?: string[]
  trigger_code?: string
  status: string
  early_warning_sent_at?: string
  initial_notification_sent_at?: string
  final_report_sent_at?: string
  resolved_at?: string
}

type Notification = {
  id: string
  incident_id: string
  notification_type: string
  target_authority: string
  content: Record<string, unknown>
  status: string
  submitted_at?: string
  submitted_by?: string
  reference_number?: string
  created_at?: string
}

type Deadline = {
  type: string
  due: string
  met: boolean
  minutes_until: number
}

type DetailResponse = {
  incident: Incident
  notifications: Notification[]
  deadlines: Deadline[]
}

const CATEGORIES = ['outage', 'breach', 'ddos', 'ransomware', 'supply_chain', 'other'] as const
const NOTIFICATION_TYPES: Array<{ key: string; label: string; subtitle: string }> = [
  { key: 'early_warning',        label: 'Early warning',         subtitle: '24h after detection' },
  { key: 'initial_notification', label: 'Initial notification',  subtitle: '72h after detection' },
  { key: 'final_report',         label: 'Final report',          subtitle: '1 month after detection' },
]

export function AttestivIncidentDetailPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id

  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { canWrite } = useRoles()

  const [classifySig, setClassifySig] = useState<'true' | 'false'>('true')
  const [category, setCategory] = useState<typeof CATEGORIES[number]>('outage')

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/incidents/${encodeURIComponent(id)}`)
      if (!response.ok) {
        if (response.status === 404) throw new Error('Incident not found')
        throw new Error(`${response.status} ${response.statusText}`)
      }
      const body: DetailResponse = await response.json()
      setData(body)
      if (body.incident.nis2_category && CATEGORIES.includes(body.incident.nis2_category as typeof CATEGORIES[number])) {
        setCategory(body.incident.nis2_category as typeof CATEGORIES[number])
      }
      if (body.incident.nis2_significant === false) setClassifySig('false')
      else setClassifySig('true')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load incident'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function classify() {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/incidents/${encodeURIComponent(id)}/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nis2_significant: classifySig === 'true', nis2_category: category }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to classify'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function buildDraft(notificationType: string) {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/incidents/${encodeURIComponent(id)}/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: notificationType }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to build draft'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function markSubmitted(notificationID: string, referenceNumber: string) {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/incidents/${encodeURIComponent(id)}/notifications/${encodeURIComponent(notificationID)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference_number: referenceNumber }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to mark submitted'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const nextDeadline = useMemo(() => {
    if (!data) return null
    return data.deadlines.find((d) => !d.met) ?? null
  }, [data])

  if (loading) {
    return (
      <>
        <Topbar
          title={t('Incident', 'Incident')}
          left={
            <GhostButton onClick={() => router.push('/incidents')}>
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

  if (!data) {
    return (
      <>
        <Topbar title={t('Incident', 'Incident')} />
        <div className="attestiv-content">
          <EmptyState icon="ti-radar-2" title={t('Incident not found', 'Incident not found')} description={t(
            'The incident may have been deleted or you may not have access.',
            'The incident may have been deleted or you may not have access.'
          )} />
        </div>
      </>
    );
  }

  const { incident, notifications } = data
  const status = (incident.status || 'detected').toLowerCase()
  const sigSet = incident.nis2_significant !== undefined && incident.nis2_significant !== null

  return (
    <>
      <Topbar
        title={incident.title || 'Incident'}
        left={
          <GhostButton onClick={() => router.push('/incidents')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
          </GhostButton>
        }
        right={
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            <code>{incident.id.slice(0, 12)}…</code>
          </span>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {nextDeadline ? <DeadlineBanner deadline={nextDeadline} /> : null}

        <Card>
          <CardTitle right={<Badge tone="navy">{status.replace(/_/g, ' ')}</Badge>}>{t('Summary', 'Summary')}</CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Field label={t('Detected', 'Detected')}>
              {incident.detected_at ? incident.detected_at.slice(0, 16).replace('T', ' ') + ' UTC' : '—'}
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>by {incident.detected_by || '—'}</div>
            </Field>
            <Field label={t('NIS2 significant', 'NIS2 significant')}>
              {incident.nis2_significant === true ? <Badge tone="red">yes</Badge>
                : incident.nis2_significant === false ? <Badge tone="gray">no</Badge>
                : <Badge tone="amber">{t('awaiting class.', 'awaiting class.')}</Badge>}
            </Field>
            <Field label={t('Category', 'Category')}>{incident.nis2_category ?? '—'}</Field>
            <Field label={t('Affected users', 'Affected users')}>{String(incident.affected_users_count ?? 0)}</Field>
            <Field label={t('Affected services', 'Affected services')}>
              {(incident.affected_services && incident.affected_services.length > 0)
                ? incident.affected_services.join(', ')
                : '—'}
            </Field>
            {incident.trigger_code ? <Field label={t('Detector trigger', 'Detector trigger')}><code>{incident.trigger_code}</code></Field> : null}
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Classification', 'Classification')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
            {t(
              'NIS2 Article 23 only requires reporting',
              'NIS2 Article 23 only requires reporting'
            )} <strong>significant</strong> {t(
              'incidents. Mark\n            this one accurately — non-significant incidents skip the notification ladder.',
              'incidents. Mark\n            this one accurately — non-significant incidents skip the notification ladder.'
            )}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <FormRow label={t('NIS2 significant?', 'NIS2 significant?')}>
              <select value={classifySig} onChange={(e) => setClassifySig(e.target.value as 'true' | 'false')} style={inputStyle}>
                <option value="true">{t('Yes — significant', 'Yes — significant')}</option>
                <option value="false">{t('No — not reportable', 'No — not reportable')}</option>
              </select>
            </FormRow>
            <FormRow label={t('Category', 'Category')}>
              <select value={category} onChange={(e) => setCategory(e.target.value as typeof CATEGORIES[number])} style={inputStyle}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </FormRow>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {canWrite ? (
              <PrimaryButton onClick={classify} disabled={busy}>
                {busy ? 'Saving…' : sigSet ? 'Update classification' : 'Classify'}
              </PrimaryButton>
            ) : null}
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Notification ladder (Article 23)', 'Notification ladder (Article 23)')}</CardTitle>
          {!sigSet || incident.nis2_significant === false ? (
            <EmptyState
              icon="ti-mailbox-off"
              title={t('Notification ladder skipped', 'Notification ladder skipped')}
              description={t(
                'Notifications only apply to NIS2-significant incidents. Classify the incident as significant to unlock the 24h / 72h / 1-month drafts.',
                'Notifications only apply to NIS2-significant incidents. Classify the incident as significant to unlock the 24h / 72h / 1-month drafts.'
              )}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {NOTIFICATION_TYPES.map((nt) => {
                const existing = notifications.find((n) => n.notification_type === nt.key)
                return (
                  <NotificationBlock
                    key={nt.key}
                    label={nt.label}
                    subtitle={nt.subtitle}
                    notification={existing}
                    incidentID={id}
                    busy={busy}
                    canWrite={canWrite}
                    onBuildDraft={() => buildDraft(nt.key)}
                    onMarkSubmitted={(refNum) => existing && markSubmitted(existing.id, refNum)}
                  />
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function NotificationBlock({
  label,
  subtitle,
  notification,
  incidentID,
  busy,
  canWrite,
  onBuildDraft,
  onMarkSubmitted,
}: {
  label: string
  subtitle: string
  notification?: Notification
  incidentID: string
  busy: boolean
  canWrite: boolean
  onBuildDraft: () => void
  onMarkSubmitted: (referenceNumber: string) => void
}) {
  const {
    t
  } = useI18n();

  const [refNumber, setRefNumber] = useState('')
  const [showJSON, setShowJSON] = useState(false)

  // downloadPDF fetches the rendered notification PDF (NIS2 default
  // or DORA Art.17) and triggers a browser save. The blob path goes
  // through apiFetch so the session cookie is included.
  async function downloadPDF(format: 'nis2_art23' | 'dora_art17') {
    if (!notification) return
    const path = `/incidents/${encodeURIComponent(incidentID)}/notifications/${encodeURIComponent(notification.id)}/pdf?format=${format}`
    const r = await apiFetch(path)
    if (!r.ok) return
    const blob = await r.blob()
    const cd = r.headers.get('Content-Disposition') || ''
    const match = cd.match(/filename="?([^"]+)"?/)
    const filename = match?.[1] || `${format}-${incidentID}-${notification.id}.pdf`
    const objectUrl = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = objectUrl
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(objectUrl)
  }
  const submitted = notification?.status === 'submitted'

  return (
    <div
      style={{
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-md)',
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{subtitle}</div>
        </div>
        {notification ? (
          submitted ? <Badge tone="green">submitted</Badge>
          : <Badge tone="amber">draft</Badge>
        ) : (
          <Badge tone="gray">{t('not started', 'not started')}</Badge>
        )}
      </div>
      {notification ? (
        <>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
            {t('Authority:', 'Authority:')} <strong>{notification.target_authority}</strong>
            {notification.submitted_at ? (
              <> {t('· submitted', '· submitted')} {notification.submitted_at.slice(0, 16).replace('T', ' ')}Z</>
            ) : null}
            {notification.reference_number ? (
              <> {t('· ref', '· ref')} <code>{notification.reference_number}</code></>
            ) : null}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <GhostButton onClick={() => setShowJSON((v) => !v)}>
              <i className="ti ti-code" aria-hidden="true" /> {showJSON ? 'Hide' : 'View'} content
            </GhostButton>
            <GhostButton onClick={() => { void downloadPDF('nis2_art23') }}>
              <i className="ti ti-file-download" aria-hidden="true" /> {t('NIS2 PDF', 'NIS2 PDF')}
            </GhostButton>
            <GhostButton onClick={() => { void downloadPDF('dora_art17') }}>
              <i className="ti ti-file-download" aria-hidden="true" /> {t('DORA PDF', 'DORA PDF')}
            </GhostButton>
            {!submitted ? (
              <>
                <input
                  type="text"
                  value={refNumber}
                  onChange={(e) => setRefNumber(e.target.value)}
                  placeholder={t('ref number from authority', 'ref number from authority')}
                  style={{
                    flex: 1,
                    fontSize: 11,
                    padding: '4px 8px',
                    border: '0.5px solid var(--color-border-secondary)',
                    borderRadius: 'var(--border-radius-md)',
                    background: 'var(--color-background-primary)',
                    color: 'var(--color-text-primary)',
                    fontFamily: 'inherit',
                  }}
                />
                {canWrite ? (
                  <PrimaryButton onClick={() => onMarkSubmitted(refNumber)} disabled={busy || !refNumber.trim()}>
                    <i className="ti ti-check" aria-hidden="true" /> {t('Mark submitted', 'Mark submitted')}
                  </PrimaryButton>
                ) : null}
              </>
            ) : null}
          </div>
          {showJSON ? (
            <pre
              style={{
                marginTop: 8,
                background: 'var(--color-background-secondary)',
                padding: 10,
                borderRadius: 'var(--border-radius-md)',
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
                overflow: 'auto',
                maxHeight: 320,
              }}
            >
              {JSON.stringify(notification.content, null, 2)}
            </pre>
          ) : null}
        </>
      ) : (
        canWrite ? (
        <PrimaryButton onClick={onBuildDraft} disabled={busy}>
          <i className="ti ti-file-export" aria-hidden="true" /> {t('Build draft', 'Build draft')}
        </PrimaryButton>
        ) : null
      )}
    </div>
  );
}

function DeadlineBanner({ deadline }: { deadline: Deadline }) {
  const {
    t
  } = useI18n();

  const isOverdue = deadline.minutes_until < 0
  const tone = isOverdue ? 'error' : deadline.minutes_until < 60 ? 'warning' : 'info'
  const label = LABEL_FOR_DEADLINE[deadline.type] ?? deadline.type
  const countdown = isOverdue
    ? `${humanMinutes(-deadline.minutes_until)} overdue`
    : `${humanMinutes(deadline.minutes_until)} remaining`
  return (
    <Banner tone={tone} title={`${label} — ${countdown}`}>
      {t('Target submission:', 'Target submission:')} {deadline.due.slice(0, 16).replace('T', ' ')} {t('UTC.', 'UTC.')}
    </Banner>
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

const LABEL_FOR_DEADLINE: Record<string, string> = {
  early_warning: 'Early warning (24h)',
  initial_notification: 'Initial notification (72h)',
  final_report: 'Final report (1 month)',
}

function humanMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}
