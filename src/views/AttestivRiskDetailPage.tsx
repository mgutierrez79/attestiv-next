'use client';
// Risk detail page — single risk record with timeline + edit panel.
//
// Edit surface lets a user change status, owner, treatment, due date,
// or treatment notes. Auto-risks honour status changes (so an auditor
// can move them through in_treatment → accepted) but title/category/
// likelihood/impact are read-only — those came from the rule engine
// and editing them would defeat the auto-close logic.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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

type Risk = {
  risk_id: string
  title: string
  description?: string
  category?: string
  likelihood?: string
  impact?: string
  score?: number
  status?: string
  source?: string
  source_control_id?: string
  source_framework_id?: string
  source_rule_code?: string
  source_evidence_ids?: string[]
  owner?: string
  treatment?: string
  treatment_notes?: string
  due_date?: string
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
}

type HistoryEntry = {
  risk_id: string
  change_type?: string
  changed_by?: string
  changed_at?: string
  previous_value?: Record<string, unknown>
  new_value?: Record<string, unknown>
}

type Expectation = {
  tag: string
  evidence?: string
  criteria?: string
  freshness?: string
  frequency?: string
  mandatory?: boolean
  sources?: string[]
}

type Guidance = {
  framework_id?: string
  framework_name?: string
  control_id?: string
  control_name?: string
  control_area?: string
  why?: string
  expectations?: Expectation[]
  remediation?: string[]
}

type RelatedRemediation = {
  id: string
  title: string
  status: string
  priority: string
  framework_id?: string
  control_id?: string
  due_date?: string
}

type DetailResponse = {
  risk: Risk
  history: HistoryEntry[]
  guidance?: Guidance
  related_remediation?: RelatedRemediation[]
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'gray' | 'navy' | 'red'> = {
  open: 'amber',
  in_treatment: 'navy',
  accepted: 'gray',
  closed: 'green',
}

export function AttestivRiskDetailPage() {
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

  // Editable fields snapshot. Reset whenever a fresh fetch arrives so
  // the form mirrors the persisted state until the user changes
  // something.
  const [status, setStatus] = useState('')
  const [owner, setOwner] = useState('')
  const [treatment, setTreatment] = useState('')
  const [treatmentNotes, setTreatmentNotes] = useState('')
  const [dueDate, setDueDate] = useState('')

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/risks/${encodeURIComponent(id)}`)
      if (!response.ok) {
        if (response.status === 404) throw new Error('Risk not found')
        throw new Error(`${response.status} ${response.statusText}`)
      }
      const body: DetailResponse = await response.json()
      setData(body)
      setStatus(body.risk.status || 'open')
      setOwner(body.risk.owner || '')
      setTreatment(body.risk.treatment || '')
      setTreatmentNotes(body.risk.treatment_notes || '')
      setDueDate(body.risk.due_date || '')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load risk'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function save() {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const updates: Record<string, unknown> = {
        status,
        owner_user_id: owner || null,
        treatment: treatment || null,
        treatment_notes: treatmentNotes || null,
        due_date: dueDate || null,
      }
      const response = await apiFetch(`/risks/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const meta = useMemo(() => (data?.risk?.metadata as Record<string, unknown>) || {}, [data])

  if (loading) {
    return (
      <>
        <Topbar title={t('Risk', 'Risk')} left={<GhostButton onClick={() => router.push('/risks')}><i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}</GhostButton>} />
        <div className="attestiv-content">
          <Skeleton lines={5} height={42} />
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <Topbar title={t('Risk', 'Risk')} />
        <div className="attestiv-content">
          <EmptyState icon="ti-alert-octagon" title={t('Risk not found', 'Risk not found')} description={t(
            'The risk may have been deleted or you may not have access.',
            'The risk may have been deleted or you may not have access.'
          )} />
        </div>
      </>
    );
  }

  const { risk } = data
  const guidance = data.guidance
  const isAuto = (risk.source || '').startsWith('auto_')
  const tone = STATUS_TONE[status.toLowerCase()] ?? 'gray'

  return (
    <>
      <Topbar
        title={risk.title || 'Risk'}
        left={
          <GhostButton onClick={() => router.push('/risks')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
          </GhostButton>
        }
        right={
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            <code>{risk.risk_id}</code>
          </span>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Card>
          <CardTitle right={<Badge tone={tone}>{(risk.status || 'open').replace(/_/g, ' ')}</Badge>}>
            {t('Summary', 'Summary')}
          </CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Field label={t('Category', 'Category')}>{(risk.category || '—').replace(/_/g, ' ')}</Field>
            <Field label={t('Source', 'Source')}>
              {isAuto ? <Badge tone="navy" icon="ti-rocket">{risk.source}</Badge> : <Badge tone="gray">manual</Badge>}
            </Field>
            <Field label={t('Likelihood × impact', 'Likelihood × impact')}>
              {(risk.likelihood || '—').toUpperCase()} × {(risk.impact || '—').toUpperCase()}
            </Field>
            <Field label={t('Score', 'Score')}>{String(risk.score ?? 0)}</Field>
            {risk.source_framework_id ? (
              <Field label={t('Linked control', 'Linked control')}>
                <code>{risk.source_framework_id}/{risk.source_control_id}</code>
              </Field>
            ) : null}
            {typeof meta['control_name'] === 'string' ? (
              <Field label={t('Control name', 'Control name')}>{String(meta['control_name'])}</Field>
            ) : null}
            {typeof meta['score_percent'] === 'string' ? (
              <Field label={t('Last evaluation', 'Last evaluation')}>{meta['score_percent'] as string}%</Field>
            ) : null}
            {/* Timeline timestamps — auditor needs to see when the risk
                opened, when it last moved, and when it closed. The data
                was on the wire already; the page just wasn't surfacing it. */}
            {risk.created_at ? (
              <Field label={t('Opened', 'Opened')}>
                <RiskTimestamp iso={risk.created_at} />
              </Field>
            ) : null}
            {risk.updated_at && risk.updated_at !== risk.created_at ? (
              <Field label={t('Last updated', 'Last updated')}>
                <RiskTimestamp iso={risk.updated_at} />
              </Field>
            ) : null}
            {(risk.status || '').toLowerCase() === 'closed' && typeof meta['closed_at'] === 'string' ? (
              <Field label={t('Closed', 'Closed')}>
                <RiskTimestamp iso={meta['closed_at'] as string} />
                {typeof meta['closure_reason'] === 'string' ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                    {t('reason', 'reason')}: {(meta['closure_reason'] as string).replace(/_/g, ' ')}
                  </div>
                ) : null}
              </Field>
            ) : null}
          </div>
          {risk.description ? (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 12, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {risk.description}
            </p>
          ) : null}
        </Card>

        {guidance ? <GuidanceSection guidance={guidance} /> : null}

        {data.related_remediation && data.related_remediation.length > 0 ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle>{t('Remediation tasks', 'Remediation tasks')}</CardTitle>
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 0, marginBottom: 10 }}>
              {t('Open remediation work on this risk’s control.', 'Open remediation work on this risk’s control.')}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.related_remediation.map((tk) => (
                <Link
                  key={tk.id}
                  href="/remediation"
                  style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--color-text-primary)', textDecoration: 'none', fontSize: 12 }}
                >
                  <Badge tone={tk.priority === 'critical' ? 'red' : tk.priority === 'high' ? 'amber' : tk.priority === 'medium' ? 'navy' : 'gray'}>
                    {tk.priority}
                  </Badge>
                  <span style={{ flex: '1 1 240px', minWidth: 200 }}>{tk.title}</span>
                  <Badge tone={tk.status === 'open' ? 'amber' : tk.status === 'in_progress' ? 'navy' : 'gray'}>
                    {tk.status.replace(/_/g, ' ')}
                  </Badge>
                  {tk.due_date ? (
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                      {t('due', 'due')} {tk.due_date.slice(0, 10)}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          </Card>
        ) : null}

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Treatment', 'Treatment')}</CardTitle>
          <FormGrid>
            <FormRow label={t('Status', 'Status')}>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
                {['open', 'in_treatment', 'accepted', 'closed'].map((opt) => (
                  <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </FormRow>
            <FormRow label={t('Owner', 'Owner')}>
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="alice@acme" style={inputStyle} />
            </FormRow>
            <FormRow label={t('Treatment', 'Treatment')}>
              <select value={treatment} onChange={(e) => setTreatment(e.target.value)} style={inputStyle}>
                <option value="">—</option>
                {['accept', 'mitigate', 'transfer', 'avoid'].map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </FormRow>
            <FormRow label={t('Due date', 'Due date')}>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
            </FormRow>
          </FormGrid>
          <FormRow label={t('Notes', 'Notes')}>
            <textarea
              value={treatmentNotes}
              onChange={(e) => setTreatmentNotes(e.target.value)}
              rows={3}
              style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
            />
          </FormRow>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <PrimaryButton onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('History', 'History')}</CardTitle>
          {data.history.length === 0 ? (
            <EmptyState
              icon="ti-history"
              title={t('No history yet', 'No history yet')}
              description={t(
                'Lifecycle changes (status, owner, treatment) will appear here as they happen.',
                'Lifecycle changes (status, owner, treatment) will appear here as they happen.'
              )}
            />
          ) : (
            <div>
              {data.history.map((entry, index) => (
                <HistoryRow key={`${entry.changed_at}-${index}`} entry={entry} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function GuidanceSection({ guidance }: { guidance: Guidance }) {
  const { t } = useI18n()
  const expectations = guidance.expectations ?? []
  const remediation = guidance.remediation ?? []

  return (
    <>
      <Card style={{ marginTop: 12 }}>
        <CardTitle
          right={
            guidance.control_id ? (
              <code style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {guidance.framework_id}/{guidance.control_id}
              </code>
            ) : undefined
          }
        >
          {t('Why this risk is open', 'Why this risk is open')}
        </CardTitle>
        {guidance.why ? (
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, whiteSpace: 'pre-wrap' }}>
            {guidance.why}
          </p>
        ) : null}
      </Card>

      {expectations.length > 0 ? (
        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('What this control expects', 'What this control expects')}</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {expectations.map((exp, index) => (
              <div
                key={`${exp.tag}-${index}`}
                style={{
                  padding: '10px 0',
                  borderBottom: index < expectations.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{exp.evidence || exp.tag}</span>
                  {exp.mandatory ? <Badge tone="red">{t('mandatory', 'mandatory')}</Badge> : <Badge tone="gray">{t('contributes', 'contributes')}</Badge>}
                  <code style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{exp.tag}</code>
                </div>
                {exp.criteria ? (
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                    <i className="ti ti-target-arrow" aria-hidden="true" style={{ marginRight: 4 }} />
                    {t('Passing criteria:', 'Passing criteria:')} <strong>{exp.criteria}</strong>
                  </div>
                ) : null}
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                  {exp.freshness ? <span><i className="ti ti-clock" aria-hidden="true" /> {exp.freshness}</span> : null}
                  {exp.frequency ? <span><i className="ti ti-repeat" aria-hidden="true" /> {exp.frequency}</span> : null}
                  {exp.sources && exp.sources.length > 0 ? (
                    <span><i className="ti ti-plug" aria-hidden="true" /> {exp.sources.join(', ')}</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {remediation.length > 0 ? (
        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('How to remediate', 'How to remediate')}</CardTitle>
          <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {remediation.map((step, index) => (
              <li key={index} style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                {step}
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </>
  )
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

// RiskTimestamp renders an ISO timestamp as both the absolute local
// date+time AND a relative-to-now hint ("3d ago"). Auditors need the
// absolute value (for SLA math); operators glance at the relative
// for at-a-glance "how stale is this".
function RiskTimestamp({ iso }: { iso: string }) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) {
    return <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{iso}</span>
  }
  const delta = Date.now() - d.getTime()
  const relative = formatRelativeMs(delta)
  return (
    <>
      <span>{d.toLocaleString()}</span>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{relative}</div>
    </>
  )
}

function formatRelativeMs(deltaMs: number): string {
  if (deltaMs < 0) return 'in the future'
  const sec = Math.floor(deltaMs / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
      {children}
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

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const ts = entry.changed_at ? new Date(entry.changed_at).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z') : ''
  const next = (entry.new_value as Record<string, unknown>) || {}
  const previous = (entry.previous_value as Record<string, unknown>) || {}
  const changeType = entry.change_type || 'updated'
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '8px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 12,
        alignItems: 'flex-start',
      }}
    >
      <i
        className={`ti ${iconForChange(changeType)}`}
        aria-hidden="true"
        style={{ color: 'var(--color-text-tertiary)', marginTop: 2 }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500 }}>
          {labelForChange(changeType)}
          {entry.changed_by ? <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}> · {entry.changed_by}</span> : null}
        </div>
        {changeType === 'status_changed' ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            {previous['status'] ? `${String(previous['status'])} → ` : ''}
            <strong>{String(next['status'] || '—')}</strong>
          </div>
        ) : null}
      </div>
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>{ts}</span>
    </div>
  )
}

function iconForChange(type: string): string {
  switch (type) {
    case 'created':         return 'ti-circle-plus'
    case 'status_changed':  return 'ti-arrow-bar-up'
    case 'owner_changed':   return 'ti-user'
    case 'treatment_added': return 'ti-tools'
    case 'auto_closed':     return 'ti-circle-check'
    default:                return 'ti-pencil'
  }
}

function labelForChange(type: string): string {
  switch (type) {
    case 'created':         return 'Risk created'
    case 'status_changed':  return 'Status changed'
    case 'owner_changed':   return 'Owner changed'
    case 'treatment_added': return 'Treatment added'
    case 'auto_closed':     return 'Auto-closed'
    case 'updated':         return 'Updated'
    default:                return type
  }
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
