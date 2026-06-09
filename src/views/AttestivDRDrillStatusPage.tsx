'use client';
// Settings ▸ DR drill — proves Attestiv eats its own dog food.
//
// Auditors who scrutinize compliance platforms ask early: "you
// orchestrate our DR, but what's YOUR backup-restore story?" This
// page answers it directly:
//   - Healthy gate: backup in last 48h AND restore drill in last 90d.
//   - Counts: backups (30d window), restore drills (90d window),
//     mean restore duration (the platform's actual RTO).
//   - Trailing 30-record table for spot-checking.
//
// Admins can also POST a manual drill record (for drills run by hand
// outside the scripted path) — the audit log captures both the
// operator subject and the manual flag.

import { useEffect, useState } from 'react'
import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n'

type Record = {
  timestamp: string
  kind: string
  success: boolean
  duration_seconds: number
  backup_id?: string
  postgres_bytes?: number
  history_archive_bytes?: number
  failure_reason?: string
  operator_subject?: string
  notes?: string
}

type TriggerJob = {
  job_id: string
  status: 'running' | 'completed' | 'failed'
  started_at: string
  completed_at?: string
  started_by?: string
  result?: {
    timestamp?: string
    backup_id?: string
    sub_dir?: string
    postgres_dump_bytes?: number
    history_archive_bytes?: number
    signing_key_copied?: boolean
    duration_seconds?: number
    warnings?: string[]
  }
  error?: string
}

type Summary = {
  total: number
  last_backup_at?: string
  last_backup_success: boolean
  last_restore_drill_at?: string
  last_restore_drill_success: boolean
  backups_last_30d: number
  restore_drills_last_90d: number
  mean_restore_duration_seconds?: number
  healthy: boolean
  unhealthy_reason?: string
  records?: Record[]
}

export function AttestivDRDrillStatusPage() {
  const { t } = useI18n()

  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [showRecord, setShowRecord] = useState(false)
  const [recKind, setRecKind] = useState<'restore_drill' | 'backup_verified'>('restore_drill')
  const [recSuccess, setRecSuccess] = useState(true)
  const [recDuration, setRecDuration] = useState(0)
  const [recNotes, setRecNotes] = useState('')
  const [recFailure, setRecFailure] = useState('')
  const [posting, setPosting] = useState(false)

  // W1-6 Phase 2 — operator-triggered backup. Holds the in-flight
  // job_id so the button can poll status without a page reload.
  const [triggerBusy, setTriggerBusy] = useState(false)
  const [triggerJob, setTriggerJob] = useState<TriggerJob | null>(null)

  async function refresh() {
    try {
      const r = await apiFetch('/system/dr-drill-status')
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      setSummary((await r.json()) as Summary)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drill status')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function recordDrill() {
    setPosting(true)
    setError(null)
    setSuccess(null)
    try {
      const r = await apiFetch('/system/dr-drill-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: recKind,
          success: recSuccess,
          duration_seconds: recDuration,
          failure_reason: recFailure,
          notes: recNotes,
        }),
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      setSuccess(t('Drill recorded.', 'Drill recorded.'))
      setShowRecord(false)
      setRecDuration(0)
      setRecNotes('')
      setRecFailure('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Record failed')
    } finally {
      setPosting(false)
    }
  }

  // W1-6 Phase 2: trigger the in-container backup runner. Async job
  // pattern — POST returns immediately with a job_id, we poll the
  // status endpoint at 2s intervals until completion. On success we
  // refresh the drill-status summary so the new backup_verified row
  // (auto-recorded by the backend) shows up in the records table.
  async function triggerBackup() {
    if (triggerBusy) return
    setError(null)
    setSuccess(null)
    setTriggerBusy(true)
    try {
      const r = await apiFetch('/admin/backup/trigger', { method: 'POST' })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      const job = (await r.json()) as TriggerJob
      setTriggerJob(job)
      await pollBackupJob(job.job_id)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Backup trigger failed')
      setTriggerBusy(false)
    }
  }

  async function pollBackupJob(jobID: string) {
    const POLL_MS = 2000
    const MAX_MS = 30 * 60 * 1000 // 30 min cap — bigger DBs take a while
    const startedAt = Date.now()
    while (true) {
      if (Date.now() - startedAt > MAX_MS) {
        setError(t('Backup exceeded 30 min — check /v1/admin/backup/jobs/{id} for state', 'Backup exceeded 30 min — check /v1/admin/backup/jobs/{id} for state'))
        setTriggerBusy(false)
        return
      }
      await new Promise((res) => setTimeout(res, POLL_MS))
      try {
        const r = await apiFetch(`/admin/backup/jobs/${encodeURIComponent(jobID)}`)
        if (!r.ok) {
          throw new Error(`${r.status} ${r.statusText}`)
        }
        const job = (await r.json()) as TriggerJob
        setTriggerJob(job)
        if (job.status === 'completed') {
          const mb = job.result?.postgres_dump_bytes
            ? (job.result.postgres_dump_bytes / 1024 / 1024).toFixed(1)
            : '?'
          setSuccess(t('Backup complete', 'Backup complete') + ' — ' + (job.result?.backup_id || '') + ' (pg ' + mb + ' MB)')
          setTriggerBusy(false)
          await refresh()
          return
        }
        if (job.status === 'failed') {
          setError(t('Backup failed', 'Backup failed') + ': ' + (job.error || ''))
          setTriggerBusy(false)
          await refresh()
          return
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Poll failed')
        setTriggerBusy(false)
        return
      }
    }
  }

  const records = summary?.records ?? []

  return (
    <>
      <Topbar
        title={t('DR drill', 'DR drill')}
        left={
          summary ? (
            summary.healthy ? (
              <Badge tone="green"><i className="ti ti-shield-check" aria-hidden="true" /> {t('Healthy', 'Healthy')}</Badge>
            ) : (
              <Badge tone="red"><i className="ti ti-shield-x" aria-hidden="true" /> {t('Unhealthy', 'Unhealthy')}</Badge>
            )
          ) : null
        }
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <PrimaryButton onClick={triggerBackup} disabled={triggerBusy}>
              {triggerBusy ? (
                <>
                  <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                  {triggerJob?.status === 'running'
                    ? t('Backup running…', 'Backup running…')
                    : t('Starting…', 'Starting…')}
                </>
              ) : (
                <>
                  <i className="ti ti-database-export" aria-hidden="true" /> {t('Run backup now', 'Run backup now')}
                </>
              )}
            </PrimaryButton>
            <GhostButton onClick={() => setShowRecord((v) => !v)} disabled={triggerBusy}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Record drill', 'Record drill')}
            </GhostButton>
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {success ? <Banner tone="success">{success}</Banner> : null}
        {summary && !summary.healthy && summary.unhealthy_reason ? (
          <Banner tone="warning" title={t('Drill posture is unhealthy', 'Drill posture is unhealthy')}>
            {summary.unhealthy_reason}
          </Banner>
        ) : null}

        <Banner tone="info" title={t('Why this exists', 'Why this exists')}>
          {t(
            'Attestiv orchestrates customer DR. Auditors will ask about OURS. This page records every successful backup and every restore drill, and the audit pre-packet carries the same summary so the auditor sees it offline alongside the customer\'s posture.',
            'Attestiv orchestrates customer DR. Auditors will ask about OURS. This page records every successful backup and every restore drill, and the audit pre-packet carries the same summary so the auditor sees it offline alongside the customer\'s posture.',
          )}
        </Banner>

        {showRecord ? (
          <Card style={{ marginTop: 10 }}>
            <CardTitle right={
              <GhostButton onClick={() => setShowRecord(false)} disabled={posting}>
                {t('Cancel', 'Cancel')}
              </GhostButton>
            }>
              {t('Record a drill manually', 'Record a drill manually')}
            </CardTitle>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              {t(
                'Use this only for drills run by hand. Scripted backups + restore drills (scripts/backup.sh and scripts/restore-drill.sh) POST automatically when ATTESTIV_API_URL is set.',
                'Use this only for drills run by hand. Scripted backups + restore drills (scripts/backup.sh and scripts/restore-drill.sh) POST automatically when ATTESTIV_API_URL is set.',
              )}
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
              <div>
                <label style={labelStyle}>{t('Kind', 'Kind')}</label>
                <select value={recKind} onChange={(e) => setRecKind(e.target.value as 'restore_drill' | 'backup_verified')} style={{ ...inputStyle, width: '100%' }}>
                  <option value="restore_drill">{t('Restore drill', 'Restore drill')}</option>
                  <option value="backup_verified">{t('Backup verified', 'Backup verified')}</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('Outcome', 'Outcome')}</label>
                <select value={recSuccess ? '1' : '0'} onChange={(e) => setRecSuccess(e.target.value === '1')} style={{ ...inputStyle, width: '100%' }}>
                  <option value="1">{t('Success', 'Success')}</option>
                  <option value="0">{t('Failure', 'Failure')}</option>
                </select>
              </div>
              <div>
                <label style={labelStyle}>{t('Duration (seconds)', 'Duration (seconds)')}</label>
                <input type="number" min={0} value={recDuration} onChange={(e) => setRecDuration(parseInt(e.target.value, 10) || 0)} style={{ ...inputStyle, width: '100%' }} />
              </div>
            </div>
            {!recSuccess ? (
              <div style={{ marginTop: 8 }}>
                <label style={labelStyle}>{t('Failure reason', 'Failure reason')}</label>
                <input type="text" value={recFailure} onChange={(e) => setRecFailure(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder="e.g. postgres restore failed at index rebuild" />
              </div>
            ) : null}
            <div style={{ marginTop: 8 }}>
              <label style={labelStyle}>{t('Notes', 'Notes')}</label>
              <input type="text" value={recNotes} onChange={(e) => setRecNotes(e.target.value)} style={{ ...inputStyle, width: '100%' }} placeholder={t('e.g. Q2-2026 audit prep manual drill', 'e.g. Q2-2026 audit prep manual drill')} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <PrimaryButton onClick={recordDrill} disabled={posting}>
                {posting ? t('Recording…', 'Recording…') : t('Record', 'Record')}
              </PrimaryButton>
            </div>
          </Card>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
          <Headline label={t('Backups (30d)', 'Backups (30d)')} value={summary?.backups_last_30d} icon="ti-database-export" />
          <Headline label={t('Restore drills (90d)', 'Restore drills (90d)')} value={summary?.restore_drills_last_90d} icon="ti-history" />
          <Headline label={t('Mean RTO', 'Mean RTO')} value={summary?.mean_restore_duration_seconds != null && summary.mean_restore_duration_seconds > 0 ? `${Math.round(summary.mean_restore_duration_seconds)}s` : '—'} icon="ti-clock-bolt" />
          <Headline label={t('Last restore', 'Last restore')} value={summary?.last_restore_drill_at ? summary.last_restore_drill_at.slice(0, 10) : '—'} icon="ti-calendar-check" />
        </div>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<Badge tone="navy">{records.length} {t('shown', 'shown')}</Badge>}>
            {t('Recent drill records', 'Recent drill records')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={6} height={28} />
          ) : records.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t('No drill records yet. Run scripts/backup.sh + scripts/restore-drill.sh with ATTESTIV_API_URL set, or click "Record drill" above.', 'No drill records yet. Run scripts/backup.sh + scripts/restore-drill.sh with ATTESTIV_API_URL set, or click "Record drill" above.')}
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 11 }}>
                  <th style={cellHeaderStyle}>{t('When', 'When')}</th>
                  <th style={cellHeaderStyle}>{t('Kind', 'Kind')}</th>
                  <th style={cellHeaderStyle}>{t('Result', 'Result')}</th>
                  <th style={cellHeaderStyle}>{t('Duration', 'Duration')}</th>
                  <th style={cellHeaderStyle}>{t('Backup ID', 'Backup ID')}</th>
                  <th style={cellHeaderStyle}>{t('Operator / notes', 'Operator / notes')}</th>
                </tr>
              </thead>
              <tbody>
                {records.slice().reverse().map((rec) => (
                  <tr key={rec.timestamp + rec.kind} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                    <td style={cellStyle}>{rec.timestamp.slice(0, 19).replace('T', ' ')}</td>
                    <td style={cellStyle}>
                      <Badge tone={rec.kind === 'restore_drill' ? 'navy' : 'gray'}>{rec.kind}</Badge>
                    </td>
                    <td style={cellStyle}>
                      {rec.success ? <Badge tone="green">OK</Badge> : <Badge tone="red">FAIL</Badge>}
                      {rec.failure_reason ? <div style={{ fontSize: 10, color: 'var(--color-status-red-mid)', marginTop: 2 }}>{rec.failure_reason}</div> : null}
                    </td>
                    <td style={cellStyle}>{rec.duration_seconds > 0 ? rec.duration_seconds + 's' : '—'}</td>
                    <td style={cellStyle}><code style={{ fontSize: 11 }}>{rec.backup_id || '—'}</code></td>
                    <td style={cellStyle}>
                      {rec.operator_subject || '—'}
                      {rec.notes ? <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{rec.notes}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  )
}

function Headline({ label, value, icon }: { label: string; value: number | string | undefined | null; icon: string }) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--color-brand-blue)1A', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-brand-blue)' }}>
          <i className={`ti ${icon}`} aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</div>
          <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.1 }}>{value ?? '—'}</div>
        </div>
      </div>
    </Card>
  )
}

const cellHeaderStyle: React.CSSProperties = { padding: '6px 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.4 }
const cellStyle: React.CSSProperties = { padding: '8px', fontSize: 12, verticalAlign: 'top' }
const inputStyle: React.CSSProperties = { fontSize: 12, padding: '6px 8px', border: '0.5px solid var(--color-border-secondary)', borderRadius: 'var(--border-radius-md)', background: 'var(--color-background-primary)', color: 'var(--color-text-primary)', fontFamily: 'inherit' }
const labelStyle: React.CSSProperties = { display: 'block', fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 3 }
