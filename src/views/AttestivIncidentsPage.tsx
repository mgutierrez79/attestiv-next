'use client';
// NIS2 incidents register (Phase-2 GRC, chunk 5).
//
// What's on screen:
//   - Deadline countdown banner — most urgent upcoming NIS2 notification
//     deadline across all open incidents.
//   - 4 summary cards: detected, classified, notified, closed.
//   - Filters (status, NIS2 significant).
//   - Incident list rows with classification, status, time-since-detection.
//   - "Log incident" modal for manual entries the detector can't see.
//
// Detection from evidence runs server-side; this page is for the
// classify → notify → close workflow.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PaginatedList,
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

type Deadline = {
  incident_id: string
  incident_title: string
  type: string
  due: string
  met: boolean
  minutes_until: number
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'gray' | 'navy' | 'red'> = {
  detected: 'amber',
  classified: 'navy',
  early_warning_sent: 'navy',
  notified: 'navy',
  closed: 'green',
}

const CATEGORY_LABEL: Record<string, string> = {
  outage: 'Outage',
  breach: 'Breach',
  ddos: 'DDoS',
  ransomware: 'Ransomware',
  supply_chain: 'Supply chain',
  other: 'Other',
}

export function AttestivIncidentsPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [deadlines, setDeadlines] = useState<Deadline[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const { canWrite } = useRoles()
  const [filter, setFilter] = useState<{ status?: string; nis2_significant?: string }>({})

  async function refresh() {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter.status) params.set('status', filter.status)
      if (filter.nis2_significant) params.set('nis2_significant', filter.nis2_significant)
      params.set('limit', '500')
      const [listRes, deadlinesRes] = await Promise.all([
        apiFetch(`/incidents?${params.toString()}`),
        apiFetch('/incidents/deadlines'),
      ])
      if (!listRes.ok) throw new Error(`${listRes.status} ${listRes.statusText}`)
      const listBody = await listRes.json()
      setIncidents(Array.isArray(listBody?.items) ? listBody.items : [])
      if (deadlinesRes.ok) {
        const deadlineBody = await deadlinesRes.json()
        setDeadlines(Array.isArray(deadlineBody?.items) ? deadlineBody.items : [])
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load incidents'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.status, filter.nis2_significant])

  async function createIncident(payload: Record<string, unknown>) {
    setCreateBusy(true)
    try {
      const response = await apiFetch('/incidents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      setShowCreate(false)
      await refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to log incident'
      setError(message)
    } finally {
      setCreateBusy(false)
    }
  }

  const summary = useMemo(() => {
    const totals = { detected: 0, classified: 0, notified: 0, closed: 0 }
    for (const i of incidents) {
      const s = (i.status || 'detected').toLowerCase()
      if (s === 'detected') totals.detected++
      else if (s === 'classified') totals.classified++
      else if (s === 'closed') totals.closed++
      else totals.notified++ // early_warning_sent + notified
    }
    return totals
  }, [incidents])

  const mostUrgent = deadlines[0] ?? null

  return (
    <>
      <Topbar
        title={t('Incidents', 'Incidents')}
        left={<Badge tone="navy">{incidents.length} entries</Badge>}
        right={
          canWrite ? (
            <PrimaryButton onClick={() => setShowCreate(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Log incident', 'Log incident')}
            </PrimaryButton>
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {mostUrgent ? <DeadlineBanner deadline={mostUrgent} /> : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
          }}
        >
          <SummaryCard label={t('Detected', 'Detected')} value={summary.detected} icon="ti-radar-2" tone="amber" />
          <SummaryCard label={t('Classified', 'Classified')} value={summary.classified} icon="ti-tag" tone="navy" />
          <SummaryCard label={t('Notified', 'Notified')} value={summary.notified} icon="ti-mailbox" tone="navy" />
          <SummaryCard label={t('Closed', 'Closed')} value={summary.closed} icon="ti-circle-check" tone="green" />
        </div>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<FilterBar value={filter} onChange={setFilter} />}>{t('Incidents', 'Incidents')}</CardTitle>
          {loading ? (
            <Skeleton lines={5} height={42} />
          ) : incidents.length === 0 ? (
            <EmptyState
              icon="ti-radar-2"
              title={t('No incidents', 'No incidents')}
              description={t(
                'Auto-detection runs against the evidence stream. Log an incident manually for events the detector can\'t see.',
                'Auto-detection runs against the evidence stream. Log an incident manually for events the detector can\'t see.'
              )}
              action={
                <PrimaryButton onClick={() => setShowCreate(true)}>
                  <i className="ti ti-plus" aria-hidden="true" /> {t('Log incident', 'Log incident')}
                </PrimaryButton>
              }
            />
          ) : (
            <PaginatedList
              items={incidents}
              itemKey={(i) => i.id}
              renderItem={(i) => (
                <IncidentRow
                  incident={i}
                  onOpen={() => router.push(`/incidents/${encodeURIComponent(i.id)}`)}
                />
              )}
              label={t('Incidents', 'Incidents')}
            />
          )}
        </Card>

        {deadlines.length > 1 ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle>{t('All upcoming NIS2 deadlines', 'All upcoming NIS2 deadlines')}</CardTitle>
            <div>
              {deadlines.map((d, idx) => (
                <DeadlineRow key={`${d.incident_id}-${d.type}-${idx}`} deadline={d} />
              ))}
            </div>
          </Card>
        ) : null}
      </div>
      {showCreate ? (
        <CreateIncidentModal busy={createBusy} onCancel={() => setShowCreate(false)} onSubmit={createIncident} />
      ) : null}
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: number
  tone: 'red' | 'amber' | 'navy' | 'green'
  icon: string
}) {
  const palette: Record<typeof tone, string> = {
    red: 'var(--color-status-red-mid)',
    amber: 'var(--color-status-amber-mid)',
    navy: 'var(--color-brand-blue)',
    green: 'var(--color-status-green-mid)',
  }
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: `${palette[tone]}1A`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: palette[tone],
          }}
        >
          <i className={`ti ${icon}`} aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
        </div>
      </div>
    </Card>
  )
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
    <Banner tone={tone} title={`${label} due — ${countdown}`}>
      {t('Incident:', 'Incident:')} <strong>{deadline.incident_title}</strong> {t('· target:', '· target:')} {deadline.due.slice(0, 16).replace('T', ' ')} {t(
        'UTC.\n      Open the detail page to draft the notification.',
        'UTC.\n      Open the detail page to draft the notification.'
      )}
    </Banner>
  );
}

function DeadlineRow({ deadline }: { deadline: Deadline }) {
  const isOverdue = deadline.minutes_until < 0
  const label = LABEL_FOR_DEADLINE[deadline.type] ?? deadline.type
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 130px 110px',
        gap: 10,
        alignItems: 'center',
        padding: '8px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 12,
      }}
    >
      <div style={{ minWidth: 0, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {deadline.incident_title}
      </div>
      <div>{label}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{deadline.due.slice(0, 16).replace('T', ' ')}Z</div>
      <div style={{ fontSize: 11, color: isOverdue ? 'var(--color-status-red-mid)' : 'var(--color-text-tertiary)', textAlign: 'right' }}>
        {isOverdue ? `${humanMinutes(-deadline.minutes_until)} overdue` : `${humanMinutes(deadline.minutes_until)} left`}
      </div>
    </div>
  )
}

function FilterBar({
  value,
  onChange,
}: {
  value: { status?: string; nis2_significant?: string }
  onChange: (next: { status?: string; nis2_significant?: string }) => void
}) {
  const {
    t
  } = useI18n();

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
      <SelectChip
        label={t('Status', 'Status')}
        value={value.status}
        options={['detected', 'classified', 'early_warning_sent', 'notified', 'closed']}
        onChange={(v) => onChange({ ...value, status: v })}
      />
      <SelectChip
        label="NIS2"
        value={value.nis2_significant}
        options={['true', 'false']}
        onChange={(v) => onChange({ ...value, nis2_significant: v })}
      />
    </div>
  );
}

function SelectChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value?: string
  options: string[]
  onChange: (next: string | undefined) => void
}) {
  const {
    t
  } = useI18n();

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      style={{
        fontSize: 11,
        padding: '4px 8px',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--border-radius-md)',
        background: 'var(--color-background-primary)',
        color: 'var(--color-text-primary)',
        fontFamily: 'inherit',
      }}
    >
      <option value="">{label}{t(': any', ': any')}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {label}: {opt.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

function IncidentRow({ incident, onOpen }: { incident: Incident; onOpen: () => void }) {
  const {
    t
  } = useI18n();

  const status = (incident.status || 'detected').toLowerCase()
  const statusTone = STATUS_TONE[status] ?? 'gray'
  const sinceMins = incident.detected_at
    ? Math.max(0, Math.floor((Date.now() - new Date(incident.detected_at).getTime()) / 60_000))
    : 0
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 130px 130px 110px',
        gap: 10,
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        background: 'transparent',
        border: 'none',
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: 'var(--color-text-primary)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {incident.title}
          </span>
          {incident.detected_by === 'auto' ? <Badge tone="navy" icon="ti-rocket">auto</Badge> : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {incident.detected_at ? incident.detected_at.slice(0, 16).replace('T', ' ') + ' UTC' : '—'}
          {incident.trigger_code ? ` · ${incident.trigger_code}` : ''}
        </div>
      </div>
      <div>
        {incident.nis2_significant === true ? (
          <Badge tone="red">{t('NIS2 significant', 'NIS2 significant')}</Badge>
        ) : incident.nis2_significant === false ? (
          <Badge tone="gray">{t('not NIS2', 'not NIS2')}</Badge>
        ) : (
          <Badge tone="amber">{t('awaiting class.', 'awaiting class.')}</Badge>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
        {incident.nis2_category ? CATEGORY_LABEL[incident.nis2_category] ?? incident.nis2_category : '—'}
      </div>
      <div>
        <Badge tone={statusTone}>{status.replace(/_/g, ' ')}</Badge>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
        {humanMinutes(sinceMins)} ago
      </div>
    </button>
  );
}

function CreateIncidentModal({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const {
    t
  } = useI18n();

  const [title, setTitle] = useState('')
  const [category, setCategory] = useState<string>('outage')
  const [services, setServices] = useState('')
  const [usersCount, setUsersCount] = useState(0)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-background-primary)',
          padding: 18,
          borderRadius: 'var(--border-radius-lg)',
          width: 'min(520px, 92vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15, fontWeight: 500 }}>{t('Log incident', 'Log incident')}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
          {t(
            'Use this for events the detector can\'t see — phone calls from the SOC, customer reports, etc.\n          Auto-detected incidents arrive on their own from the evidence stream.',
            'Use this for events the detector can\'t see — phone calls from the SOC, customer reports, etc.\n          Auto-detected incidents arrive on their own from the evidence stream.'
          )}
        </p>
        <FormRow label={t('Title', 'Title')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(
            'e.g. Suspected data exfiltration via VPN',
            'e.g. Suspected data exfiltration via VPN'
          )} style={inputStyle} />
        </FormRow>
        <FormRow label={t('NIS2 category', 'NIS2 category')}>
          <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
            {Object.entries(CATEGORY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </FormRow>
        <FormRow label={t(
          'Affected services (comma-separated)',
          'Affected services (comma-separated)'
        )}>
          <input value={services} onChange={(e) => setServices(e.target.value)} placeholder={t('e.g. invoicing, payments', 'e.g. invoicing, payments')} style={inputStyle} />
        </FormRow>
        <FormRow label={t('Affected users (estimate)', 'Affected users (estimate)')}>
          <input
            type="number"
            value={usersCount}
            onChange={(e) => setUsersCount(parseInt(e.target.value, 10) || 0)}
            style={inputStyle}
          />
        </FormRow>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <GhostButton onClick={onCancel} disabled={busy}>{t('Cancel', 'Cancel')}</GhostButton>
          <PrimaryButton
            onClick={() =>
              onSubmit({
                title,
                nis2_category: category,
                affected_services: services
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                affected_users_count: usersCount,
              })
            }
            disabled={busy || !title.trim()}
          >
            {busy ? 'Saving…' : 'Log incident'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
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
