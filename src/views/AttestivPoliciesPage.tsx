'use client';
// Policy register page (Phase-2 GRC, chunk 2).
//
// What's on screen:
//   - Banner alert if any policy is overdue for review.
//   - Filters (status, category, overdue-only).
//   - List of policies with version, category, approval state, links count.
//   - "Add policy" button → modal with title/version/category/document URL/review_due_date.
//
// Approval, control linking, and edit happen on the detail page.

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

type Policy = {
  id: string
  title: string
  description?: string
  version: string
  category: string
  status: string
  document_url?: string
  document_hash?: string
  approved_by_user_id?: string
  approved_at?: string
  review_due_date?: string
  applies_to?: string[]
  created_at?: string
  updated_at?: string
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'gray' | 'red'> = {
  draft: 'amber',
  active: 'green',
  retired: 'gray',
}

const CATEGORIES = [
  'ict_risk_management',
  'ict_continuity',
  'incident_classification',
  'incident_response',
  'risk_management',
  'access_control',
  'patch_management',
  'backup',
  'encryption',
  'system_validation',
] as const

export function AttestivPoliciesPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const [policies, setPolicies] = useState<Policy[]>([])
  const [overdue, setOverdue] = useState<Policy[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const { canWrite } = useRoles()
  const [filter, setFilter] = useState<{ status?: string; category?: string; overdueOnly?: boolean }>({})

  async function refresh() {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter.status) params.set('status', filter.status)
      if (filter.category) params.set('category', filter.category)
      if (filter.overdueOnly) params.set('overdue_only', 'true')
      params.set('limit', '500')
      const [listRes, overdueRes] = await Promise.all([
        apiFetch(`/policy-docs?${params.toString()}`),
        apiFetch('/policy-docs/overdue'),
      ])
      if (!listRes.ok) throw new Error(`${listRes.status} ${listRes.statusText}`)
      const listBody = await listRes.json()
      setPolicies(Array.isArray(listBody?.items) ? listBody.items : [])
      if (overdueRes.ok) {
        const overdueBody = await overdueRes.json()
        setOverdue(Array.isArray(overdueBody?.items) ? overdueBody.items : [])
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load policies'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.status, filter.category, filter.overdueOnly])

  async function createPolicy(payload: Record<string, unknown>) {
    setCreateBusy(true)
    try {
      const response = await apiFetch('/policy-docs', {
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
      const message = err instanceof Error ? err.message : 'Failed to create policy'
      setError(message)
    } finally {
      setCreateBusy(false)
    }
  }

  const overdueCount = overdue.length
  const summary = useMemo(() => {
    const totals = { total: policies.length, draft: 0, active: 0, retired: 0 }
    for (const p of policies) {
      const status = (p.status || 'draft').toLowerCase() as keyof typeof totals
      if (status in totals) {
        totals[status]++
      }
    }
    return totals
  }, [policies])

  return (
    <>
      <Topbar
        title={t('Policy register', 'Policy register')}
        left={<Badge tone="navy">{policies.length} policies</Badge>}
        right={
          canWrite ? (
            <PrimaryButton onClick={() => setShowCreate(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Add policy', 'Add policy')}
            </PrimaryButton>
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {overdueCount > 0 ? (
          <Banner
            tone="warning"
            title={`${overdueCount} policy${overdueCount === 1 ? '' : 'ies'} overdue for review`}
          >
            {t(
              'Each overdue policy reduces the score of every linked control by 10%. Review and refresh\n            to restore the score.',
              'Each overdue policy reduces the score of every linked control by 10%. Review and refresh\n            to restore the score.'
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
          <SummaryCard label={t('Total', 'Total')} value={summary.total} icon="ti-file-text" tone="navy" />
          <SummaryCard label={t('Active', 'Active')} value={summary.active} icon="ti-circle-check" tone="green" />
          <SummaryCard label={t('Draft', 'Draft')} value={summary.draft} icon="ti-pencil" tone="amber" />
          <SummaryCard label={t('Overdue', 'Overdue')} value={overdueCount} icon="ti-clock-exclamation" tone="red" />
        </div>

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <FilterBar value={filter} onChange={setFilter} />
            }
          >
            {t('Policies', 'Policies')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={5} height={42} />
          ) : policies.length === 0 ? (
            <EmptyState
              icon="ti-file-text"
              title={t('No policies yet', 'No policies yet')}
              description={t(
                'Add your first policy to start linking controls. The scoring engine penalises controls whose linked policies are stale, unapproved, or overdue for review.',
                'Add your first policy to start linking controls. The scoring engine penalises controls whose linked policies are stale, unapproved, or overdue for review.'
              )}
              action={
                <PrimaryButton onClick={() => setShowCreate(true)}>
                  <i className="ti ti-plus" aria-hidden="true" /> {t('Add policy', 'Add policy')}
                </PrimaryButton>
              }
            />
          ) : (
            <PaginatedList
              items={policies}
              itemKey={(p) => p.id}
              renderItem={(p) => (
                <PolicyRow
                  policy={p}
                  onOpen={() => router.push(`/policies/${encodeURIComponent(p.id)}`)}
                />
              )}
              label={t('Policies', 'Policies')}
            />
          )}
        </Card>
      </div>
      {showCreate ? (
        <CreatePolicyModal busy={createBusy} onCancel={() => setShowCreate(false)} onSubmit={createPolicy} />
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

function FilterBar({
  value,
  onChange,
}: {
  value: { status?: string; category?: string; overdueOnly?: boolean }
  onChange: (next: { status?: string; category?: string; overdueOnly?: boolean }) => void
}) {
  const {
    t
  } = useI18n();

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
      <SelectChip
        label={t('Status', 'Status')}
        value={value.status}
        options={['draft', 'active', 'retired']}
        onChange={(v) => onChange({ ...value, status: v })}
      />
      <SelectChip
        label={t('Category', 'Category')}
        value={value.category}
        options={CATEGORIES.slice()}
        onChange={(v) => onChange({ ...value, category: v })}
      />
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={value.overdueOnly ?? false}
          onChange={(e) => onChange({ ...value, overdueOnly: e.target.checked })}
        />
        <span>{t('Overdue only', 'Overdue only')}</span>
      </label>
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

function PolicyRow({ policy, onOpen }: { policy: Policy; onOpen: () => void }) {
  const status = (policy.status || 'draft').toLowerCase()
  const tone = STATUS_TONE[status] ?? 'gray'
  const reviewOverdue = policy.review_due_date && new Date(policy.review_due_date).getTime() < Date.now()
  const approved = !!policy.approved_by_user_id
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 110px 110px 110px 90px',
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
            {policy.title}
          </span>
          {reviewOverdue ? <Badge tone="red" icon="ti-clock-exclamation">overdue</Badge> : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {(policy.category || '—').replace(/_/g, ' ')}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>v{policy.version}</div>
      <div>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        {approved ? (
          <>
            <i className="ti ti-circle-check" aria-hidden="true" style={{ color: 'var(--color-status-green-mid)' }} /> approved
          </>
        ) : (
          <>
            <i className="ti ti-circle-dashed" aria-hidden="true" /> unapproved
          </>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
        {policy.review_due_date ? policy.review_due_date.slice(0, 10) : '—'}
      </div>
    </button>
  )
}

function CreatePolicyModal({
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
  const [version, setVersion] = useState('v1.0')
  const [category, setCategory] = useState<string>('access_control')
  const [description, setDescription] = useState('')
  const [documentUrl, setDocumentUrl] = useState('')
  const [reviewDueDate, setReviewDueDate] = useState('')

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
          width: 'min(560px, 92vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15, fontWeight: 500 }}>{t('Add policy', 'Add policy')}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
          {t('Policies start in', 'Policies start in')} <code>draft</code>{t(
            '. Approve them on the detail page to make them count\n          toward control scores.',
            '. Approve them on the detail page to make them count\n          toward control scores.'
          )}
        </p>
        <FormRow label={t('Title', 'Title')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('e.g. Information Security Policy', 'e.g. Information Security Policy')} style={inputStyle} />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormRow label={t('Version', 'Version')}>
            <input value={version} onChange={(e) => setVersion(e.target.value)} style={inputStyle} />
          </FormRow>
          <FormRow label={t('Category', 'Category')}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </FormRow>
        </div>
        <FormRow label={t('Description', 'Description')}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
        </FormRow>
        <FormRow label={t('Document URL', 'Document URL')}>
          <input value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} placeholder="https://docs.acme.com/policies/iso27001.pdf" style={inputStyle} />
        </FormRow>
        <FormRow label={t('Review due date', 'Review due date')}>
          <input type="date" value={reviewDueDate} onChange={(e) => setReviewDueDate(e.target.value)} style={inputStyle} />
        </FormRow>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <GhostButton onClick={onCancel} disabled={busy}>{t('Cancel', 'Cancel')}</GhostButton>
          <PrimaryButton
            onClick={() =>
              onSubmit({
                title,
                version,
                category,
                description: description || undefined,
                document_url: documentUrl || undefined,
                review_due_date: reviewDueDate || undefined,
              })
            }
            disabled={busy || !title.trim() || !version.trim() || !category}
          >
            {busy ? 'Saving…' : 'Add policy'}
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
