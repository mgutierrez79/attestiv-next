'use client';
// DR / Approvals queue.
//
// The admin's approval inbox. Rows are pending approvals waiting for
// a Grant or Deny decision. Lower section shows the recent history
// (granted, denied, expired, consumed) so a compliance officer can
// audit who approved what and how it was used.

import { useEffect, useMemo, useState } from 'react'

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

type Approval = {
  id: string
  schedule_id: string
  status: 'pending' | 'granted' | 'denied' | 'expired' | 'consumed'
  requested_by?: string
  requested_at?: string
  approver?: string
  granted_at?: string
  expires_at?: string
  consumed_at?: string
  consumed_by_run?: string
  denial_reason?: string
}

type Schedule = {
  id: string
  name: string
}

const STATUS_TONE: Record<Approval['status'], 'amber' | 'green' | 'red' | 'gray'> = {
  pending: 'amber',
  granted: 'green',
  denied: 'red',
  expired: 'red',
  consumed: 'gray',
}

export function AttestivDRApprovalsPage() {
  const {
    t
  } = useI18n();

  const [approvals, setApprovals] = useState<Approval[]>([])
  const [schedules, setSchedules] = useState<Record<string, Schedule>>({})
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function refresh() {
    setError(null)
    try {
      const [apprRes, schedRes] = await Promise.all([
        apiFetch('/dr/approvals'),
        apiFetch('/dr/schedules'),
      ])
      const apprBody = apprRes.ok ? await apprRes.json().catch(() => ({})) : { items: [] }
      const schedBody = schedRes.ok ? await schedRes.json().catch(() => ({})) : { items: [] }
      setApprovals(Array.isArray(apprBody.items) ? apprBody.items : [])
      const map: Record<string, Schedule> = {}
      for (const item of Array.isArray(schedBody.items) ? schedBody.items : []) {
        map[item.id] = item
      }
      setSchedules(map)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load approvals')
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

  async function grant(approvalId: string) {
    setWorking(approvalId)
    setError(null)
    try {
      const response = await apiFetch(`/dr/approvals/${encodeURIComponent(approvalId)}/grant`, { method: 'POST' })
      if (!response.ok) throw new Error(await response.text())
      setInfo('Approval granted. Single-use, expires in 24 hours.')
      await refresh()
    } catch (err: any) {
      setError(err?.message ?? 'Grant failed')
    } finally {
      setWorking(null)
    }
  }

  async function deny(approvalId: string) {
    const reason = typeof window !== 'undefined' ? window.prompt('Denial reason (optional):') ?? '' : ''
    setWorking(approvalId)
    setError(null)
    try {
      const response = await apiFetch(`/dr/approvals/${encodeURIComponent(approvalId)}/deny`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!response.ok) throw new Error(await response.text())
      setInfo('Approval denied.')
      await refresh()
    } catch (err: any) {
      setError(err?.message ?? 'Deny failed')
    } finally {
      setWorking(null)
    }
  }

  const pending = useMemo(() => approvals.filter((approval) => approval.status === 'pending'), [approvals])
  const decided = useMemo(() => approvals.filter((approval) => approval.status !== 'pending'), [approvals])

  return (
    <>
      <Topbar
        title={t('DR approvals', 'DR approvals')}
        right={
          <GhostButton onClick={() => undefined}>
            <i className="ti ti-list" aria-hidden="true" />
            {t('DR schedules', 'DR schedules')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {info ? <Banner tone="info">{info}</Banner> : null}
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Card>
          <CardTitle right={<Badge tone="amber">{pending.length} pending</Badge>}>
            {t('Awaiting decision', 'Awaiting decision')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={3} height={42} />
          ) : pending.length === 0 ? (
            <EmptyState
              icon="ti-stamp"
              title={t('No pending approvals', 'No pending approvals')}
              description={t(
                'New requests show up here when an operator submits one from the DR schedules page.',
                'New requests show up here when an operator submits one from the DR schedules page.'
              )}
            />
          ) : (
            <div>
              {pending.map((approval) => (
                <PendingRow
                  key={approval.id}
                  approval={approval}
                  scheduleName={schedules[approval.schedule_id]?.name ?? approval.schedule_id}
                  busy={working === approval.id}
                  onGrant={() => grant(approval.id)}
                  onDeny={() => deny(approval.id)}
                />
              ))}
            </div>
          )}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{decided.length} entries</span>}>
            {t('History', 'History')}
          </CardTitle>
          {decided.length === 0 ? (
            <EmptyState
              icon="ti-history"
              title={t('No decisions yet', 'No decisions yet')}
              description={t(
                'Granted, denied, and consumed approvals will land here once they\'re acted on.',
                'Granted, denied, and consumed approvals will land here once they\'re acted on.'
              )}
            />
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)', textAlign: 'left' }}>
                  <th style={{ padding: '6px 10px 6px 0' }}>{t('Schedule', 'Schedule')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Requested by', 'Requested by')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Status', 'Status')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Approver', 'Approver')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Detail', 'Detail')}</th>
                  <th style={{ padding: '6px 0 6px 10px' }}>{t('When', 'When')}</th>
                </tr>
              </thead>
              <tbody>
                {decided.map(approval => {
                  return (
                    <tr key={approval.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={{ padding: '10px 10px 10px 0', fontWeight: 500 }}>
                        {schedules[approval.schedule_id]?.name ?? approval.schedule_id}
                      </td>
                      <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                        {approval.requested_by ?? '—'}
                      </td>
                      <td style={{ padding: '10px' }}>
                        <Badge tone={STATUS_TONE[approval.status]}>{approval.status}</Badge>
                      </td>
                      <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                        {approval.approver ?? '—'}
                      </td>
                      <td style={{ padding: '10px', color: 'var(--color-text-tertiary)', fontSize: 11 }}>
                        {approval.consumed_by_run ? (
                          <span>{t('consumed by', 'consumed by')} {approval.consumed_by_run.slice(0, 12)}</span>
                        ) : approval.denial_reason ? (
                          <span title={approval.denial_reason}>{truncate(approval.denial_reason, 36)}</span>
                        ) : approval.expires_at ? (
                          <span>expires {formatTimestamp(approval.expires_at)}</span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '10px 0 10px 10px', color: 'var(--color-text-tertiary)' }}>
                        {formatTimestamp(approval.granted_at ?? approval.requested_at ?? '')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

function PendingRow({
  approval,
  scheduleName,
  busy,
  onGrant,
  onDeny,
}: {
  approval: Approval
  scheduleName: string
  busy: boolean
  onGrant: () => void
  onDeny: () => void
}) {
  const {
    t
  } = useI18n();

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        flexWrap: 'wrap',
      }}
    >
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{scheduleName}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
          {t('requested by', 'requested by')} {approval.requested_by ?? '—'}· {formatTimestamp(approval.requested_at ?? '')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <GhostButton onClick={onDeny} disabled={busy}>
          <i className="ti ti-x" aria-hidden="true" />
          {t('Deny', 'Deny')}
        </GhostButton>
        <PrimaryButton onClick={onGrant} disabled={busy}>
          <i className="ti ti-check" aria-hidden="true" />
          {t('Grant', 'Grant')}
        </PrimaryButton>
      </div>
    </div>
  );
}

function formatTimestamp(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return `${value.slice(0, max)}…`
}
