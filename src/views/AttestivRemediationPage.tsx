'use client';
// Remediation tasks page (Phase-2 GRC, chunk 4).
//
// What's on screen:
//   - Banner alert when there are overdue tasks.
//   - 4 summary cards: open, in-progress, overdue, resolved.
//   - Filters (status, priority, framework, assignee).
//   - List rows with control, priority, assignee, due-in days.
//   - Inline status pickers (open → in_progress → resolved/wont_fix).
//   - "Add task" modal for manual remediation entries.
//
// Auto-tasks are tagged so an operator can tell at a glance which
// rows came from the scoring engine vs human entry.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

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

type Task = {
  id: string
  framework_id: string
  control_id: string
  control_name?: string
  title: string
  description?: string
  status: string
  priority: string
  source: string
  source_finding_code?: string
  assigned_to_user_id?: string
  due_date?: string
  resolved_at?: string
  resolution_notes?: string
  created_at?: string
  updated_at?: string
  related_risks?: RelatedRisk[]
}

type RelatedRisk = {
  risk_id: string
  title?: string
  framework_name?: string
  score: number
  likelihood?: string
  impact?: string
  status?: string
}

type RemediationSummary = {
  total: number
  by_status: Record<string, number>
  by_priority: Record<string, number>
  aging_buckets: Record<string, number>
  open_count: number
  in_progress_count: number
  resolved_count: number
  overdue_count: number
  mean_age_open_days: number
  oldest_open_task_id?: string
  oldest_open_age_days: number
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'gray' | 'navy'> = {
  open: 'amber',
  in_progress: 'navy',
  resolved: 'green',
  wont_fix: 'gray',
}

const PRIORITY_TONE: Record<string, 'red' | 'amber' | 'navy' | 'gray'> = {
  critical: 'red',
  high: 'amber',
  medium: 'navy',
  low: 'gray',
}

const PRIORITIES = ['critical', 'high', 'medium', 'low'] as const
const STATUSES = ['open', 'in_progress', 'resolved', 'wont_fix'] as const

export function AttestivRemediationPage() {
  const {
    t
  } = useI18n();

  const [tasks, setTasks] = useState<Task[]>([])
  const [overdue, setOverdue] = useState<Task[]>([])
  const [summaryStats, setSummaryStats] = useState<RemediationSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const { canWrite } = useRoles()
  const [filter, setFilter] = useState<{ status?: string; priority?: string; framework_id?: string; assigned_to?: string }>({})

  async function refresh() {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter.status) params.set('status', filter.status)
      if (filter.priority) params.set('priority', filter.priority)
      if (filter.framework_id) params.set('framework_id', filter.framework_id)
      if (filter.assigned_to) params.set('assigned_to', filter.assigned_to)
      params.set('limit', '500')
      const [listRes, overdueRes, summaryRes] = await Promise.all([
        apiFetch(`/remediation?${params.toString()}`),
        apiFetch('/remediation/overdue'),
        apiFetch('/remediation/summary'),
      ])
      if (!listRes.ok) throw new Error(`${listRes.status} ${listRes.statusText}`)
      const listBody = await listRes.json()
      setTasks(Array.isArray(listBody?.items) ? listBody.items : [])
      if (overdueRes.ok) {
        const overdueBody = await overdueRes.json()
        setOverdue(Array.isArray(overdueBody?.items) ? overdueBody.items : [])
      }
      if (summaryRes.ok) {
        setSummaryStats(await summaryRes.json())
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load remediation'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.status, filter.priority, filter.framework_id, filter.assigned_to])

  async function patchTask(id: string, updates: Record<string, unknown>) {
    setError(null)
    try {
      const response = await apiFetch(`/remediation/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update task'
      setError(message)
    }
  }

  async function createTask(payload: Record<string, unknown>) {
    setCreateBusy(true)
    try {
      const response = await apiFetch('/remediation', {
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
      const message = err instanceof Error ? err.message : 'Failed to create task'
      setError(message)
    } finally {
      setCreateBusy(false)
    }
  }

  const summary = useMemo(() => {
    const totals = { open: 0, in_progress: 0, resolved: 0, wont_fix: 0 }
    for (const t of tasks) {
      const status = (t.status || 'open').toLowerCase() as keyof typeof totals
      if (status in totals) totals[status]++
    }
    return totals
  }, [tasks])

  return (
    <>
      <Topbar
        title={t('Remediation', 'Remediation')}
        left={<Badge tone="navy">{tasks.length} tasks</Badge>}
        right={
          canWrite ? (
            <PrimaryButton onClick={() => setShowCreate(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Add task', 'Add task')}
            </PrimaryButton>
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {overdue.length > 0 ? (
          <Banner tone="warning" title={`${overdue.length} task${overdue.length === 1 ? '' : 's'} overdue`}>
            {t(
              'Overdue remediation work signals control failures that aren\'t being addressed within the\n            agreed grace period. Reassign or extend the due date if the constraint has changed.',
              'Overdue remediation work signals control failures that aren\'t being addressed within the\n            agreed grace period. Reassign or extend the due date if the constraint has changed.'
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
          <SummaryCard label={t('Open', 'Open')} value={summaryStats?.open_count ?? summary.open} icon="ti-circle-dot" tone="amber" />
          <SummaryCard label={t('In progress', 'In progress')} value={summaryStats?.in_progress_count ?? summary.in_progress} icon="ti-tools" tone="navy" />
          <SummaryCard label={t('Overdue', 'Overdue')} value={summaryStats?.overdue_count ?? overdue.length} icon="ti-clock-exclamation" tone="red" />
          <SummaryCard label={t('Resolved', 'Resolved')} value={summaryStats?.resolved_count ?? summary.resolved} icon="ti-circle-check" tone="green" />
        </div>

        {summaryStats && summaryStats.open_count + summaryStats.in_progress_count > 0 ? (
          <Card style={{ marginTop: 10 }}>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 600, listStyle: 'revert' }}>
                {t('Aging buckets (open tasks)', 'Aging buckets (open tasks)')}
                <span style={{ fontWeight: 400, fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 8 }}>
                  {t('mean', 'mean')} {summaryStats.mean_age_open_days.toFixed(1)}d
                </span>
              </summary>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  gap: 10,
                  marginTop: 10,
                }}
              >
                {(['0-7d', '8-30d', '31-60d', '60+d'] as const).map((bucket) => {
                  const count = summaryStats.aging_buckets?.[bucket] ?? 0
                  const tone = bucket === '60+d' ? 'red' : bucket === '31-60d' ? 'amber' : 'navy'
                  return <SummaryCard key={bucket} label={t(`Open ${bucket}`, `Open ${bucket}`)} value={count} icon="ti-hourglass-low" tone={tone} />
                })}
              </div>
              <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                <span>
                  {t('Mean open age', 'Mean open age')}: <strong style={{ color: 'var(--color-text-primary)' }}>{summaryStats.mean_age_open_days.toFixed(1)}d</strong>
                </span>
                {summaryStats.oldest_open_task_id ? (
                  <span>
                    {t('Oldest open', 'Oldest open')}: <code>{summaryStats.oldest_open_task_id.slice(0, 8)}</code> ({summaryStats.oldest_open_age_days}d)
                  </span>
                ) : null}
              </div>
            </details>
          </Card>
        ) : null}

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<FilterBar value={filter} onChange={setFilter} />}>{t('Tasks', 'Tasks')}</CardTitle>
          {loading ? (
            <Skeleton lines={5} height={42} />
          ) : tasks.length === 0 ? (
            <EmptyState
              icon="ti-checklist"
              title={t('No remediation tasks', 'No remediation tasks')}
              description={t(
                'Auto-tasks appear when scoring detects a control dropping to REVIEW/WARN/FAIL. Add one manually for any work the engine can\'t see.',
                'Auto-tasks appear when scoring detects a control dropping to REVIEW/WARN/FAIL. Add one manually for any work the engine can\'t see.'
              )}
              action={
                <PrimaryButton onClick={() => setShowCreate(true)}>
                  <i className="ti ti-plus" aria-hidden="true" /> {t('Add task', 'Add task')}
                </PrimaryButton>
              }
            />
          ) : (
            <PaginatedList
              items={tasks}
              itemKey={(task) => task.id}
              renderItem={(task) => (
                <TaskRow task={task} onPatch={(updates) => patchTask(task.id, updates)} />
              )}
              label={t('Tasks', 'Tasks')}
            />
          )}
        </Card>
      </div>
      {showCreate ? (
        <CreateTaskModal busy={createBusy} onCancel={() => setShowCreate(false)} onSubmit={createTask} />
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
  value: { status?: string; priority?: string; framework_id?: string; assigned_to?: string }
  onChange: (next: { status?: string; priority?: string; framework_id?: string; assigned_to?: string }) => void
}) {
  const {
    t
  } = useI18n();

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
      <SelectChip
        label={t('Status', 'Status')}
        value={value.status}
        options={STATUSES.slice()}
        onChange={(v) => onChange({ ...value, status: v })}
      />
      <SelectChip
        label={t('Priority', 'Priority')}
        value={value.priority}
        options={PRIORITIES.slice()}
        onChange={(v) => onChange({ ...value, priority: v })}
      />
      <input
        type="text"
        value={value.assigned_to ?? ''}
        onChange={(e) => onChange({ ...value, assigned_to: e.target.value || undefined })}
        placeholder="assignee"
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
          {label}: {opt.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

function TaskRow({ task, onPatch }: { task: Task; onPatch: (updates: Record<string, unknown>) => void }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const status = (task.status || 'open').toLowerCase()
  const priority = (task.priority || 'medium').toLowerCase()
  const statusTone = STATUS_TONE[status] ?? 'gray'
  const priorityTone = PRIORITY_TONE[priority] ?? 'gray'
  const isAuto = (task.source || 'manual').toLowerCase() === 'auto'
  const hasDue = hasRealDay(task.due_date)
  const days = hasDue ? daysUntil(task.due_date) : null
  const isOverdue = days !== null && days < 0 && (status === 'open' || status === 'in_progress')
  const daysLabel = days !== null ? (days < 0 ? `${Math.abs(days)}d past` : `${days}d left`) : ''

  return (
    <div style={{ padding: '10px 0', borderBottom: '0.5px solid var(--color-border-tertiary)', fontSize: 12 }}>
      {/* Header: title gets the room it needs; the meta block wraps to its
          own line on narrow widths instead of crushing the title. Clicking
          the header (but not the interactive controls) expands the detail. */}
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 8, rowGap: 6, cursor: 'pointer' }}
      >
        <i
          className={`ti ti-chevron-${open ? 'down' : 'right'}`}
          aria-hidden="true"
          style={{ marginTop: 3, color: 'var(--color-text-tertiary)', flex: '0 0 auto' }}
        />
        <div style={{ flex: '1 1 280px', minWidth: 220 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 500 }}>{task.title}</span>
            {isAuto ? <Badge tone="navy" icon="ti-rocket">auto</Badge> : null}
            {isOverdue ? <Badge tone="red" icon="ti-clock-exclamation">overdue</Badge> : null}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
            <code>{task.framework_id}/{task.control_id}</code>
            {task.control_name ? ` · ${task.control_name}` : ''}
            {task.source_finding_code ? ` · ${task.source_finding_code}` : ''}
          </div>
        </div>
        {/* Inline controls — stopPropagation so changing status doesn't toggle. */}
        <div
          onClick={(e) => e.stopPropagation()}
          style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: '0 0 auto', justifyContent: 'flex-end' }}
        >
          <Badge tone={priorityTone}>{priority}</Badge>
          <select
            value={status}
            onChange={(e) => onPatch({ status: e.target.value })}
            style={inlineSelectStyle(statusTone)}
          >
            {STATUSES.map((opt) => (
              <option key={opt} value={opt}>{opt.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <span style={{ fontSize: 11, color: isOverdue ? 'var(--color-status-red-mid)' : 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
            {fmtDay(task.due_date)}{daysLabel ? ` · ${daysLabel}` : ''}
          </span>
        </div>
      </div>

      {open ? (
        <div
          style={{
            marginTop: 8,
            marginLeft: 22,
            padding: '12px 14px',
            background: 'var(--color-background-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 'var(--border-radius-md)',
            display: 'grid',
            gap: 10,
          }}
        >
          {task.description ? <DetailField label={t('Description', 'Description')}>{task.description}</DetailField> : null}
          <DetailField label={t('Control', 'Control')}>
            <code>{task.framework_id}/{task.control_id}</code>
            {task.control_name ? ` — ${task.control_name}` : ''}
          </DetailField>
          {task.source_finding_code ? (
            <DetailField label={t('Finding', 'Finding')}><code>{task.source_finding_code}</code></DetailField>
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <DetailField label={t('Priority', 'Priority')}>{priority}</DetailField>
            <DetailField label={t('Status', 'Status')}>{status.replace(/_/g, ' ')}</DetailField>
            <DetailField label={t('Source', 'Source')}>{(task.source || 'manual').toLowerCase()}</DetailField>
            <DetailField label={t('Assignee', 'Assignee')}>{task.assigned_to_user_id || t('unassigned', 'unassigned')}</DetailField>
            <DetailField label={t('Due date', 'Due date')}>{fmtDay(task.due_date)}</DetailField>
            <DetailField label={t('Created', 'Created')}>{fmtDay(task.created_at)}</DetailField>
            <DetailField label={t('Updated', 'Updated')}>{fmtDay(task.updated_at)}</DetailField>
            {hasRealDay(task.resolved_at) ? <DetailField label={t('Resolved', 'Resolved')}>{fmtDay(task.resolved_at)}</DetailField> : null}
          </div>
          {task.resolution_notes ? (
            <DetailField label={t('Resolution notes', 'Resolution notes')}>{task.resolution_notes}</DetailField>
          ) : null}
          {task.related_risks && task.related_risks.length > 0 ? (
            <DetailField label={t('Related risk', 'Related risk')}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {task.related_risks.map((rk) => (
                  <Link
                    key={rk.risk_id}
                    href={`/risks/${encodeURIComponent(rk.risk_id)}`}
                    style={{ color: 'var(--color-brand-blue)', display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                  >
                    <i className="ti ti-alert-triangle" aria-hidden="true" />
                    <span>{rk.title || rk.risk_id}</span>
                    <Badge tone={rk.score >= 12 ? 'red' : rk.score >= 6 ? 'amber' : 'gray'}>
                      {t('score', 'score')} {rk.score}
                    </Badge>
                  </Link>
                ))}
              </div>
            </DetailField>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 2 }}>
        {label}
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-primary)', overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  )
}

function CreateTaskModal({
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
  const [priority, setPriority] = useState<typeof PRIORITIES[number]>('high')
  const [assignedTo, setAssignedTo] = useState('')
  const [dueDate, setDueDate] = useState(defaultDue(priority))

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
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15, fontWeight: 500 }}>{t('Add remediation task', 'Add remediation task')}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
          {t('Manual tasks are tagged', 'Manual tasks are tagged')} <code>manual</code> {t(
            'and don\'t auto-close when the control\n          recovers. Auto-tasks are created by the scoring engine and resolve themselves.',
            'and don\'t auto-close when the control\n          recovers. Auto-tasks are created by the scoring engine and resolve themselves.'
          )}
        </p>
        <FormRow label={t('Title', 'Title')}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t(
            'e.g. Refresh access reviews for vCenter',
            'e.g. Refresh access reviews for vCenter'
          )} style={inputStyle} />
        </FormRow>
        <FormRow label={t('Description', 'Description')}>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormRow label={t('Framework', 'Framework')}>
            <input value={framework} onChange={(e) => setFramework(e.target.value)} placeholder="iso27001" style={inputStyle} />
          </FormRow>
          <FormRow label={t('Control', 'Control')}>
            <input value={control} onChange={(e) => setControl(e.target.value)} placeholder={t('A.9.2.5', 'A.9.2.5')} style={inputStyle} />
          </FormRow>
          <FormRow label={t('Priority', 'Priority')}>
            <select
              value={priority}
              onChange={(e) => {
                const next = e.target.value as typeof PRIORITIES[number]
                setPriority(next)
                setDueDate(defaultDue(next))
              }}
              style={inputStyle}
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label={t('Due date', 'Due date')}>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={inputStyle} />
          </FormRow>
        </div>
        <FormRow label={t(
          'Assignee (defaults to control owner)',
          'Assignee (defaults to control owner)'
        )}>
          <input value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} placeholder="alice@acme" style={inputStyle} />
        </FormRow>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <GhostButton onClick={onCancel} disabled={busy}>{t('Cancel', 'Cancel')}</GhostButton>
          <PrimaryButton
            onClick={() =>
              onSubmit({
                title,
                description: description || undefined,
                framework_id: framework,
                control_id: control,
                priority,
                assigned_to_user_id: assignedTo || undefined,
                due_date: dueDate || undefined,
              })
            }
            disabled={busy || !title.trim() || !framework.trim() || !control.trim()}
          >
            {busy ? 'Saving…' : 'Add task'}
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

function inlineSelectStyle(tone: 'amber' | 'green' | 'gray' | 'navy'): React.CSSProperties {
  const palette: Record<typeof tone, string> = {
    amber: 'var(--color-status-amber-mid)',
    green: 'var(--color-status-green-mid)',
    navy: 'var(--color-brand-blue)',
    gray: 'var(--color-text-tertiary)',
  }
  return {
    fontSize: 11,
    padding: '4px 8px',
    border: `0.5px solid ${palette[tone]}`,
    borderRadius: 'var(--border-radius-md)',
    background: 'var(--color-background-primary)',
    color: palette[tone],
    fontFamily: 'inherit',
    fontWeight: 500,
  }
}

function defaultDue(priority: string): string {
  const grace: Record<string, number> = { critical: 14, high: 30, medium: 60, low: 90 }
  const days = grace[priority] ?? 30
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function daysUntil(iso?: string): number | null {
  if (!iso) return null
  const target = new Date(iso).getTime()
  if (!Number.isFinite(target)) return null
  return Math.floor((target - Date.now()) / (24 * 60 * 60 * 1000))
}

// fmtDay renders an ISO date as YYYY-MM-DD, treating an empty value or Go's
// zero time ("0001-01-01T00:00:00Z", which time.Time marshals for an unset
// field even with omitempty) as "no date". Without this an unresolved task
// showed "Resolved: 0001-01-01".
function fmtDay(iso?: string): string {
  if (!iso) return '—'
  const day = iso.slice(0, 10)
  return day.startsWith('0001-') ? '—' : day
}

function hasRealDay(iso?: string): boolean {
  return fmtDay(iso) !== '—'
}
