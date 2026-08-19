'use client';
// DR schedules page — wired to /v1/dr/schedules + /v1/dr/approvals
// + /v1/dr/runs.
//
// The approval gate is enforced server-side (see internal/store/
// dr_store.go.StartRun): a granted approval is consumed on Run, the
// 24h TTL is checked at run-time, and a closed maintenance window
// blocks even a freshly-granted approval. The page treats the server
// as authoritative — it does not hide or pre-validate the Run button
// based on local state, because doing so would let a stale UI cache
// say "go" when the server says "no".

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  RTODisplay,
  TestTimeline,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n';

type Schedule = {
  id: string
  name: string
  rule?: string
  cadence?: string
  next_run?: string
  rto_target_minutes?: number
  maintenance_window_open?: boolean
  phases?: Array<{ name: string }>
}

type Approval = {
  id: string
  schedule_id: string
  status: 'pending' | 'granted' | 'denied' | 'expired' | 'consumed'
  approver?: string
  granted_at?: string
  expires_at?: string
  consumed_at?: string
  consumed_by_run?: string
}

type Run = {
  id: string
  schedule_id: string
  status?: string
  started_at?: string
  completed_at?: string
  rto_minutes?: number
  rto_target_minutes?: number
  rto_met?: boolean
  verdict?: 'pass' | 'fail'
  phases?: Array<{ name: string; state: 'pending' | 'running' | 'pass' | 'fail' | 'skipped' }>
  started_by?: string
}

export function AttestivDRSchedulesPage() {
  const {
    t
  } = useI18n();
  const router = useRouter()

  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [runs, setRuns] = useState<Run[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  async function refresh() {
    setError(null)
    try {
      const [schedRes, apprRes, runRes] = await Promise.all([
        apiFetch('/dr/schedules'),
        apiFetch('/dr/approvals'),
        apiFetch('/dr/runs'),
      ])
      const schedBody = schedRes.ok ? await schedRes.json().catch(() => ({})) : { items: [] }
      const apprBody = apprRes.ok ? await apprRes.json().catch(() => ({})) : { items: [] }
      const runBody = runRes.ok ? await runRes.json().catch(() => ({})) : { items: [] }
      setSchedules(Array.isArray(schedBody.items) ? schedBody.items : [])
      setApprovals(Array.isArray(apprBody.items) ? apprBody.items : [])
      setRuns(Array.isArray(runBody.items) ? runBody.items : [])
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load DR data')
    }
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      await refresh()
      if (!cancelled) setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  async function requestApproval(scheduleId: string) {
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch(`/dr/schedules/${encodeURIComponent(scheduleId)}/approve`, {
        method: 'POST',
      })
      if (!response.ok) throw new Error(await response.text())
      setInfo('Approval requested. An admin must grant it; once granted it is single-use and expires after 24 hours.')
      await refresh()
    } catch (err: any) {
      setError(err?.message ?? 'Failed to request approval')
    }
  }

  async function runTest(scheduleId: string) {
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch(`/dr/schedules/${encodeURIComponent(scheduleId)}/run`, {
        method: 'POST',
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(text || `${response.status} ${response.statusText}`)
      }
      setInfo('Run started. Approval consumed; submit a new request before the next execution.')
      await refresh()
    } catch (err: any) {
      setError(err?.message ?? 'Run blocked by approval gate')
    }
  }

  return (
    <>
      <Topbar
        title={t('DR test schedules', 'DR test schedules')}
        right={
          <GhostButton onClick={() => router.push('/dr/runs')}>
            <i className="ti ti-history" aria-hidden="true" />
            {t('Test history', 'Test history')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {info ? <Banner tone="info">{info}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}

        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Loading…', 'Loading…')}</div>
        ) : schedules.length === 0 ? (
          <Card>
            <CardTitle>{t('No schedules configured', 'No schedules configured')}</CardTitle>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              <p style={{ margin: 0 }}>
                {t('An admin can create a schedule via', 'An admin can create a schedule via')} <code>{t('POST /v1/dr/schedules', 'POST /v1/dr/schedules')}</code> {t(
                  'with a name,\n                cadence rule, RTO target, and maintenance window flag. The pilot DR module accepts\n                ad-hoc schedules; pre-canned templates ship with the framework YAML follow-up.',
                  'with a name,\n                cadence rule, RTO target, and maintenance window flag. The pilot DR module accepts\n                ad-hoc schedules; pre-canned templates ship with the framework YAML follow-up.'
                )}
              </p>
            </div>
          </Card>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
              gap: 12,
            }}
          >
            {schedules.map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                schedule={schedule}
                approvals={approvals.filter((approval) => approval.schedule_id === schedule.id)}
                runs={runs.filter((run) => run.schedule_id === schedule.id)}
                onRequestApproval={() => requestApproval(schedule.id)}
                onRun={() => runTest(schedule.id)}
              />
            ))}
          </div>
        )}

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t(
            'Approval gate rules (server-enforced)',
            'Approval gate rules (server-enforced)'
          )}</CardTitle>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              lineHeight: 1.7,
            }}
          >
            <li>{t('Run requires an approval in', 'Run requires an approval in')} <code>granted</code> {t(
                'state. Pending, denied, expired, or consumed approvals are not honored.',
                'state. Pending, denied, expired, or consumed approvals are not honored.'
              )}</li>
            <li>{t('Approvals are', 'Approvals are')} <strong>single-use</strong>{t(
                '. Running consumes the approval; the next run requires a fresh request.',
                '. Running consumes the approval; the next run requires a fresh request.'
              )}</li>
            <li>{t('Approvals expire', 'Approvals expire')} <strong>{t('24 hours after grant', '24 hours after grant')}</strong>{t('. Stale grants transition to', '. Stale grants transition to')} <code>expired</code> {t('on the next list call.', 'on the next list call.')}</li>
            <li>{t('The schedule\'s', 'The schedule\'s')} <strong>{t('maintenance window must be open', 'maintenance window must be open')}</strong>{t(
                '. A closed window blocks the run without consuming the approval.',
                '. A closed window blocks the run without consuming the approval.'
              )}</li>
            <li>{t(
              'Every approval, run start, and run completion writes to the audit trail with the actor\'s principal.',
              'Every approval, run start, and run completion writes to the audit trail with the actor\'s principal.'
            )}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function ScheduleCard({
  schedule,
  approvals,
  runs,
  onRequestApproval,
  onRun,
}: {
  schedule: Schedule
  approvals: Approval[]
  runs: Run[]
  onRequestApproval: () => void
  onRun: () => void
}) {
  const {
    t
  } = useI18n();

  const latestApproval = approvals[0] // already sorted desc by store
  const latestRun = runs[0]
  const canRun = latestApproval?.status === 'granted' && schedule.maintenance_window_open === true

  return (
    <Card>
      <CardTitle right={<Badge tone={badgeForNextRun(schedule.next_run)}>{schedule.next_run ? `Next ${formatRelative(schedule.next_run)}` : 'Ad-hoc'}</Badge>}>
        {schedule.name}
      </CardTitle>
      {schedule.rule ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 10 }}>{schedule.rule}</div>
      ) : null}
      {latestRun ? (
        <>
          <div style={{ marginBottom: 10 }}>
            <RTODisplay
              value={latestRun.rto_minutes ?? '—'}
              unit="min"
              target={latestRun.rto_target_minutes ?? schedule.rto_target_minutes}
              met={latestRun.rto_met ?? false}
              caption={`Last run ${latestRun.completed_at ? formatRelative(latestRun.completed_at) : '—'} · ${(latestRun.verdict ?? latestRun.status ?? 'pending').toUpperCase()}`}
            />
          </div>
          {latestRun.phases && latestRun.phases.length > 0 ? (
            <div style={{ marginBottom: 12 }}>
              <TestTimeline phases={latestRun.phases} />
            </div>
          ) : null}
        </>
      ) : (
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-text-tertiary)',
            padding: '12px 0',
            borderTop: '0.5px solid var(--color-border-tertiary)',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            marginBottom: 12,
          }}
        >
          {t(
            'No prior run. First execution will establish the baseline.',
            'No prior run. First execution will establish the baseline.'
          )}
        </div>
      )}
      <ApprovalRow approval={latestApproval} windowOpen={schedule.maintenance_window_open === true} />
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 10 }}>
        <GhostButton
          onClick={onRequestApproval}
          disabled={latestApproval?.status === 'pending' || latestApproval?.status === 'granted'}
        >
          <i className="ti ti-stamp" aria-hidden="true" />
          {latestApproval?.status === 'granted'
            ? 'Approval granted'
            : latestApproval?.status === 'pending'
              ? 'Approval pending'
              : 'Submit approval'}
        </GhostButton>
        <PrimaryButton onClick={onRun} disabled={!canRun}>
          <i className="ti ti-player-play" aria-hidden="true" />
          {t('Run test', 'Run test')}
        </PrimaryButton>
      </div>
    </Card>
  );
}

function ApprovalRow({
  approval,
  windowOpen,
}: {
  approval: Approval | undefined
  windowOpen: boolean
}) {
  const {
    t
  } = useI18n();

  const status: Approval['status'] | 'none' = approval?.status ?? 'none'
  const statusBadge =
    status === 'granted' ? (
      <Badge tone="green">{t('Approval granted', 'Approval granted')}{approval?.approver ? ` · ${approval.approver}` : ''}</Badge>
    ) : status === 'pending' ? (
      <Badge tone="amber">{t('Approval pending', 'Approval pending')}</Badge>
    ) : status === 'expired' ? (
      <Badge tone="red">{t('Approval expired', 'Approval expired')}</Badge>
    ) : status === 'denied' ? (
      <Badge tone="red">{t('Approval denied', 'Approval denied')}</Badge>
    ) : status === 'consumed' ? (
      <Badge tone="gray">{t('Approval consumed', 'Approval consumed')}</Badge>
    ) : (
      <Badge tone="gray">{t('No approval', 'No approval')}</Badge>
    )
  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        alignItems: 'center',
        background: 'var(--color-background-secondary)',
        borderRadius: 'var(--border-radius-md)',
        padding: '8px 10px',
        fontSize: 12,
        flexWrap: 'wrap',
      }}
    >
      {statusBadge}
      <Badge tone={windowOpen ? 'green' : 'gray'}>
        {t('Maintenance window', 'Maintenance window')} {windowOpen ? 'open' : 'closed'}
      </Badge>
      {approval?.expires_at ? (
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          expires {formatRelative(approval.expires_at)}
        </span>
      ) : null}
    </div>
  );
}

// Local Banner removed in favour of the shared one from AttestivUi.

function badgeForNextRun(next?: string): 'blue' | 'amber' | 'gray' {
  if (!next) return 'gray'
  const ts = new Date(next).getTime()
  if (Number.isNaN(ts)) return 'gray'
  const delta = ts - Date.now()
  if (delta <= 1000 * 60 * 60 * 48) return 'amber'
  if (delta <= 1000 * 60 * 60 * 24 * 14) return 'blue'
  return 'gray'
}

function formatRelative(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const delta = ts - Date.now()
  const absMinutes = Math.abs(Math.floor(delta / 60000))
  if (absMinutes < 1) return delta >= 0 ? 'now' : 'just now'
  if (absMinutes < 60) return delta >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`
  const hours = Math.floor(absMinutes / 60)
  if (hours < 24) return delta >= 0 ? `in ${hours}h` : `${hours}h ago`
  const days = Math.floor(hours / 24)
  return delta >= 0 ? `in ${days}d` : `${days}d ago`
}
