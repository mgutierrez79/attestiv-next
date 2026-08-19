'use client';
// DR / Runs history.
//
// Append-only list of every DR test execution: which schedule, who
// started it, when it ran, the phase outcomes, the measured RTO,
// and pass/fail. The compliance manager's audit answer to "show me
// you actually exercised your DR plan this quarter."

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Card,
  CardTitle,
  RTODisplay,
  TestTimeline,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n';

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
  approval_id?: string
}

type Schedule = {
  id: string
  name: string
  rto_target_minutes?: number
}

export function AttestivDRRunsPage() {
  const {
    t
  } = useI18n();

  const [runs, setRuns] = useState<Run[]>([])
  const [schedules, setSchedules] = useState<Record<string, Schedule>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterSchedule, setFilterSchedule] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [runRes, schedRes] = await Promise.all([
          apiFetch('/dr/runs'),
          apiFetch('/dr/schedules'),
        ])
        const runBody = runRes.ok ? await runRes.json().catch(() => ({})) : { items: [] }
        const schedBody = schedRes.ok ? await schedRes.json().catch(() => ({})) : { items: [] }
        if (!cancelled) {
          setRuns(Array.isArray(runBody.items) ? runBody.items : [])
          const map: Record<string, Schedule> = {}
          for (const item of Array.isArray(schedBody.items) ? schedBody.items : []) {
            map[item.id] = item
          }
          setSchedules(map)
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load runs')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = filterSchedule
    ? runs.filter((run) => run.schedule_id === filterSchedule)
    : runs

  const totals = useMemo(() => {
    const pass = filtered.filter((run) => run.verdict === 'pass').length
    const fail = filtered.filter((run) => run.verdict === 'fail').length
    const inflight = filtered.filter((run) => run.status === 'running').length
    return { pass, fail, inflight }
  }, [filtered])

  return (
    <>
      <Topbar
        title={t('DR test runs', 'DR test runs')}
        right={
          <select
            value={filterSchedule}
            onChange={(event) => setFilterSchedule(event.target.value)}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-background-primary)',
              fontFamily: 'inherit',
            }}
          >
            <option value="">{t('All schedules', 'All schedules')}</option>
            {Object.values(schedules).map((schedule) => (
              <option key={schedule.id} value={schedule.id}>
                {schedule.name}
              </option>
            ))}
          </select>
        }
      />
      <div className="attestiv-content">
        {error ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-status-red-deep)',
              background: 'var(--color-status-red-bg)',
              padding: '8px 12px',
              borderRadius: 'var(--border-radius-md)',
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        ) : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
            marginBottom: 14,
          }}
        >
          <SummaryTile label={t('Pass', 'Pass')} value={totals.pass} tone="green" />
          <SummaryTile label={t('Fail', 'Fail')} value={totals.fail} tone="red" />
          <SummaryTile label={t('In flight', 'In flight')} value={totals.inflight} tone="amber" />
          <SummaryTile label={t('Total', 'Total')} value={filtered.length} tone="navy" />
        </div>

        <Card>
          <CardTitle>{t('Run history', 'Run history')}</CardTitle>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Loading…', 'Loading…')}</div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t(
                'No runs yet. Runs appear here once a schedule is executed against a granted approval.',
                'No runs yet. Runs appear here once a schedule is executed against a granted approval.'
              )}
            </div>
          ) : (
            <div>
              {filtered.map((run) => (
                <RunRow
                  key={run.id}
                  run={run}
                  scheduleName={schedules[run.schedule_id]?.name ?? run.schedule_id}
                  scheduleTarget={schedules[run.schedule_id]?.rto_target_minutes}
                />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'amber' | 'navy' }) {
  return (
    <div
      style={{
        background: 'var(--color-background-secondary)',
        borderRadius: 'var(--border-radius-md)',
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <Badge tone={tone}>{label}</Badge>
      <div style={{ marginLeft: 'auto', fontSize: 18, fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function RunRow({
  run,
  scheduleName,
  scheduleTarget,
}: {
  run: Run
  scheduleName: string
  scheduleTarget?: number
}) {
  const {
    t
  } = useI18n();

  const target = run.rto_target_minutes ?? scheduleTarget
  return (
    <div
      style={{
        padding: '14px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) auto',
        gap: 16,
        alignItems: 'flex-start',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{scheduleName}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>run <code>{run.id.slice(0, 12)}</code> {t('· started by', '· started by')} {run.started_by ?? '—'}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
          {run.started_at ? `started ${formatTimestamp(run.started_at)}` : ''}
          {run.completed_at ? ` · completed ${formatTimestamp(run.completed_at)}` : ''}
        </div>
      </div>
      <div>
        {run.rto_minutes !== undefined ? (
          <RTODisplay
            value={run.rto_minutes}
            unit="min"
            target={target}
            met={run.rto_met ?? false}
            caption={(run.verdict ?? run.status ?? 'pending').toUpperCase()}
          />
        ) : (
          <Badge tone={run.status === 'running' ? 'amber' : 'gray'}>{run.status ?? 'pending'}</Badge>
        )}
      </div>
      <div style={{ minWidth: 0, gridColumn: '1 / -1' }}>
        {run.phases && run.phases.length > 0 ? <TestTimeline phases={run.phases} /> : null}
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

