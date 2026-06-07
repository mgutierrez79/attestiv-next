'use client';
// Exceptions register page (Phase-2 GRC, chunk 3).
//
// What's on screen:
//   - Banner alert if any exception expires in next 14 days.
//   - 4 summary cards: active, expiring soon, expired, resolved.
//   - Filters (status, severity, framework).
//   - List rows with control, severity, accepted by, expiry countdown.
//   - "Add exception" modal that captures the prompt's required fields.
//
// Reminder: an exception is a formal record that a control failure has
// been ACCEPTED. The auditor sees every active one in the manifest;
// the scoring engine flips the control's status to PASS but leaves the
// numeric score untouched.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

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
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'gray' | 'red' | 'navy'> = {
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

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

export function AttestivExceptionsPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const [items, setItems] = useState<Exception[]>([])
  const [expiring, setExpiring] = useState<Exception[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const { canWrite } = useRoles()
  const [filter, setFilter] = useState<{ status?: string; severity?: string; framework_id?: string }>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const exportCSV = useCallback((rows: Exception[]) => {
    const targets = selected.size > 0 ? rows.filter((e) => selected.has(e.id)) : rows
    const header = ['id', 'title', 'framework_id', 'control_id', 'severity', 'status', 'accepted_by_user_id', 'expires_at', 'created_at']
    const csv = [
      header.join(','),
      ...targets.map((e) =>
        header.map((k) => {
          const v = (e as Record<string, unknown>)[k] ?? ''
          const s = String(v)
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
        }).join(',')
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `exceptions-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [selected])

  async function refresh() {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter.status) params.set('status', filter.status)
      if (filter.severity) params.set('severity', filter.severity)
      if (filter.framework_id) params.set('framework_id', filter.framework_id)
      params.set('limit', '500')
      const [listRes, expiringRes] = await Promise.all([
        apiFetch(`/exceptions?${params.toString()}`),
        apiFetch('/exceptions/expiring-soon?within_days=14'),
      ])
      if (!listRes.ok) throw new Error(`${listRes.status} ${listRes.statusText}`)
      const listBody = await listRes.json()
      setItems(Array.isArray(listBody?.items) ? listBody.items : [])
      if (expiringRes.ok) {
        const expiringBody = await expiringRes.json()
        setExpiring(Array.isArray(expiringBody?.items) ? expiringBody.items : [])
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load exceptions'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.status, filter.severity, filter.framework_id])

  async function createException(payload: Record<string, unknown>) {
    setCreateBusy(true)
    try {
      const response = await apiFetch('/exceptions', {
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
      const message = err instanceof Error ? err.message : 'Failed to create exception'
      setError(message)
    } finally {
      setCreateBusy(false)
    }
  }

  const summary = useMemo(() => {
    const totals = { active: 0, expired: 0, resolved: 0, revoked: 0 }
    for (const e of items) {
      const status = (e.status || 'active').toLowerCase() as keyof typeof totals
      if (status in totals) totals[status]++
    }
    return totals
  }, [items])

  return (
    <>
      <Topbar
        title={t('Exceptions register', 'Exceptions register')}
        left={<Badge tone="navy">{items.length} entries</Badge>}
        right={
          canWrite ? (
            <PrimaryButton onClick={() => setShowCreate(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Add exception', 'Add exception')}
            </PrimaryButton>
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error" onRetry={refresh}>{error}</Banner> : null}
        {expiring.length > 0 ? (
          <Banner tone="warning" title={`${expiring.length} exception${expiring.length === 1 ? '' : 's'} expiring in 14 days`}>
            {t(
              'When an exception expires the underlying control failure becomes visible again. Plan\n            the renewal or remediation now.',
              'When an exception expires the underlying control failure becomes visible again. Plan\n            the renewal or remediation now.'
            )}
          </Banner>
        ) : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
          }}
        >
          <SummaryCard label={t('Active', 'Active')} value={summary.active} tone="amber" icon="ti-shield-off" />
          <SummaryCard label={t('Expiring ≤ 14d', 'Expiring ≤ 14d')} value={expiring.length} tone="red" icon="ti-clock-exclamation" />
          <SummaryCard label={t('Expired', 'Expired')} value={summary.expired} tone="red" icon="ti-circle-x" />
          <SummaryCard label={t('Resolved', 'Resolved')} value={summary.resolved} tone="green" icon="ti-circle-check" />
        </div>

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {selected.size > 0 && (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                      {selected.size} {t('selected', 'selected')}
                    </span>
                    <GhostButton onClick={() => exportCSV(items)}>
                      <i className="ti ti-download" aria-hidden="true" style={{ fontSize: 12 }} /> {t('Export CSV', 'Export CSV')}
                    </GhostButton>
                    <GhostButton onClick={() => setSelected(new Set())}>
                      {t('Clear', 'Clear')}
                    </GhostButton>
                  </>
                )}
                {selected.size === 0 && (
                  <GhostButton onClick={() => exportCSV(items)}>
                    <i className="ti ti-download" aria-hidden="true" style={{ fontSize: 12 }} /> {t('Export CSV', 'Export CSV')}
                  </GhostButton>
                )}
                <FilterBar value={filter} onChange={setFilter} />
              </div>
            }
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                aria-label={t('Select all exceptions', 'Select all exceptions')}
                checked={items.length > 0 && selected.size === items.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(items.map((ex) => ex.id)) : new Set())}
                style={{ cursor: 'pointer' }}
              />
              {t('Exceptions', 'Exceptions')}
            </div>
          </CardTitle>
          {loading ? (
            <Skeleton lines={5} height={42} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="ti-shield-off"
              title={t('No exceptions', 'No exceptions')}
              description={t(
                'Create an exception when a control is failing and the risk has been formally accepted. Every exception requires an expiry date — no indefinite acceptances.',
                'Create an exception when a control is failing and the risk has been formally accepted. Every exception requires an expiry date — no indefinite acceptances.'
              )}
              action={
                <PrimaryButton onClick={() => setShowCreate(true)}>
                  <i className="ti ti-plus" aria-hidden="true" /> {t('Add exception', 'Add exception')}
                </PrimaryButton>
              }
            />
          ) : (
            <div>
              {items.map((e) => (
                <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={() => toggleSelected(e.id)}
                    onClick={(ev) => ev.stopPropagation()}
                    aria-label={`Select ${e.title}`}
                    style={{ cursor: 'pointer', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <ExceptionRow
                      exception={e}
                      onOpen={() => router.push(`/exceptions/${encodeURIComponent(e.id)}`)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {showCreate ? (
        <CreateExceptionModal busy={createBusy} onCancel={() => setShowCreate(false)} onSubmit={createException} />
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
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{value}</div>
        </div>
      </div>
    </Card>
  )
}

function FilterBar({
  value,
  onChange,
}: {
  value: { status?: string; severity?: string; framework_id?: string }
  onChange: (next: { status?: string; severity?: string; framework_id?: string }) => void
}) {
  const {
    t
  } = useI18n();

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
      <SelectChip
        label={t('Status', 'Status')}
        value={value.status}
        options={['active', 'expired', 'resolved', 'revoked']}
        onChange={(v) => onChange({ ...value, status: v })}
      />
      <SelectChip
        label={t('Severity', 'Severity')}
        value={value.severity}
        options={SEVERITIES.slice()}
        onChange={(v) => onChange({ ...value, severity: v })}
      />
      <input
        type="text"
        value={value.framework_id ?? ''}
        onChange={(e) => onChange({ ...value, framework_id: e.target.value || undefined })}
        placeholder={t('framework id', 'framework id')}
        style={{
          fontSize: 11,
          padding: '4px 8px',
          width: 110,
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--border-radius-md)',
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
          fontFamily: 'inherit',
        }}
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
          {label}: {opt}
        </option>
      ))}
    </select>
  );
}

function ExceptionRow({ exception, onOpen }: { exception: Exception; onOpen: () => void }) {
  const status = (exception.status || 'active').toLowerCase()
  const severity = (exception.severity || 'medium').toLowerCase()
  const tone = STATUS_TONE[status] ?? 'gray'
  const sevTone = SEVERITY_TONE[severity] ?? 'gray'
  const days = daysUntil(exception.expires_at)
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 110px 110px 100px',
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
            {exception.title}
          </span>
          {status === 'active' && days !== null && days <= 14 ? (
            <Badge tone="red" icon="ti-clock-exclamation">
              {days < 0 ? 'expired' : `${days}d left`}
            </Badge>
          ) : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          <code>{exception.framework_id}/{exception.control_id}</code>
          {exception.control_name ? ` · ${exception.control_name}` : ''}
        </div>
      </div>
      <div>
        <Badge tone={sevTone}>{severity}</Badge>
      </div>
      <div>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        {exception.accepted_by_user_id || '—'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
        {exception.expires_at ? exception.expires_at.slice(0, 10) : '—'}
      </div>
    </button>
  )
}

function CreateExceptionModal({
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
  const [description, setDescription] = useState('')
  const [framework, setFramework] = useState('iso27001')
  const [control, setControl] = useState('')
  const [controlName, setControlName] = useState('')
  const [severity, setSeverity] = useState<typeof SEVERITIES[number]>('high')
  const [justification, setJustification] = useState('')
  const [expiresAt, setExpiresAt] = useState(defaultExpiry())
  const [mitigating, setMitigating] = useState('')

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
          width: 'min(620px, 92vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15, fontWeight: 500 }}>{t('Add exception', 'Add exception')}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
          {t(
            'An exception suppresses a failing control\'s status (the score stays — auditors still see\n          the underlying gap). Required: framework + control + severity + a justification + a hard\n          expiry date.',
            'An exception suppresses a failing control\'s status (the score stays — auditors still see\n          the underlying gap). Required: framework + control + severity + a justification + a hard\n          expiry date.'
          )}
        </p>
        <FormRow label={t('Title', 'Title')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Q4 user-access review backlog', 'e.g. Q4 user-access review backlog')} style={inputStyle} />
        </FormRow>
        <FormRow label={t('Description', 'Description')}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormRow label={t('Framework ID', 'Framework ID')}>
            <input value={framework} onChange={(e) => setFramework(e.target.value)} placeholder="iso27001" style={inputStyle} />
          </FormRow>
          <FormRow label={t('Control ID', 'Control ID')}>
            <input value={control} onChange={(e) => setControl(e.target.value)} placeholder={t('A.9.2.5', 'A.9.2.5')} style={inputStyle} />
          </FormRow>
        </div>
        <FormRow label={t('Control name (optional)', 'Control name (optional)')}>
          <input value={controlName} onChange={(e) => setControlName(e.target.value)} placeholder={t('Review of user access rights', 'Review of user access rights')} style={inputStyle} />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormRow label={t('Severity', 'Severity')}>
            <select value={severity} onChange={(e) => setSeverity(e.target.value as typeof SEVERITIES[number])} style={inputStyle}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label={t('Expires on', 'Expires on')}>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} style={inputStyle} />
          </FormRow>
        </div>
        <FormRow label={t('Acceptance justification', 'Acceptance justification')}>
          <textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            rows={3}
            placeholder={t(
              'Why is the risk being accepted and what compensating controls are in place?',
              'Why is the risk being accepted and what compensating controls are in place?'
            )}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </FormRow>
        <FormRow label={t('Mitigating controls (one per line)', 'Mitigating controls (one per line)')}>
          <textarea
            value={mitigating}
            onChange={(e) => setMitigating(e.target.value)}
            rows={2}
            placeholder={t(
              'e.g. MFA enforced via vCenter SSO\nDaily log review by security ops',
              'e.g. MFA enforced via vCenter SSO\nDaily log review by security ops'
            )}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </FormRow>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <GhostButton onClick={onCancel} disabled={busy}>{t('Cancel', 'Cancel')}</GhostButton>
          <PrimaryButton
            onClick={() =>
              onSubmit({
                title,
                description,
                framework_id: framework,
                control_id: control,
                control_name: controlName || undefined,
                severity,
                acceptance_justification: justification,
                expires_at: expiresAt,
                mitigating_controls: mitigating
                  .split('\n')
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            disabled={
              busy ||
              !title.trim() ||
              !description.trim() ||
              !framework.trim() ||
              !control.trim() ||
              !justification.trim() ||
              !expiresAt
            }
          >
            {busy ? 'Saving…' : 'Add exception'}
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

function defaultExpiry(): string {
  const d = new Date()
  d.setDate(d.getDate() + 90)
  return d.toISOString().slice(0, 10)
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null
  const target = new Date(iso).getTime()
  if (!Number.isFinite(target)) return null
  return Math.floor((target - Date.now()) / (24 * 60 * 60 * 1000))
}
