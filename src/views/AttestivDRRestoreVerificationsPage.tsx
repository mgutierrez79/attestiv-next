'use client'
// W1-4 Restore-verification log.
//
// What this answers, for an auditor reading against DORA Art.12(3)
// and ISO 8.13: "for THIS specific system, when was the last restore
// verified, what was the verdict, what integrity checks did we run,
// did we meet the RTO target?". Separate from the platform-wide DR
// drill status because auditors need per-asset traceability — "the
// quarterly drill passed" doesn't answer "does THIS app's backup
// actually restore".

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  HeroBand,
  PaginatedList,
  PrimaryButton,
  Skeleton,
  StatPill,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useRoles } from '../lib/roles'

type IntegrityCheck = {
  check: string
  expected?: string
  actual?: string
  ok: boolean
  note?: string
}

type Verification = {
  timestamp: string
  kind: string
  success: boolean
  duration_seconds?: number
  backup_id?: string
  restored_asset_id: string
  restored_application_id?: string
  integrity_checks?: IntegrityCheck[]
  manifest_signature_verified?: boolean
  manifest_key_id?: string
  rto_target_minutes?: number
  rto_met?: boolean
  notes?: string
  failure_reason?: string
  operator_subject?: string
}

type Summary = {
  verifications_total: number
  verifications_last_30d: number
  verifications_last_90d: number
  verifications_last_365d: number
}

type Response = {
  items: Verification[]
  count: number
  summary: Summary
}

function fmtDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—'
  if (seconds < 60) return `${seconds}s`
  const mins = Math.round(seconds / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const rem = mins % 60
  return rem === 0 ? `${hours}h` : `${hours}h${rem}m`
}

export function AttestivDRRestoreVerificationsPage() {
  const { t } = useI18n()
  const { canWrite } = useRoles()
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch('/dr/restore-verifications')
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const body = (await r.json()) as Response
      setData({
        items: Array.isArray(body?.items) ? body.items : [],
        count: typeof body?.count === 'number' ? body.count : 0,
        summary: body?.summary ?? { verifications_total: 0, verifications_last_30d: 0, verifications_last_90d: 0, verifications_last_365d: 0 },
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load restore verifications')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const items = data?.items ?? []
  const summary = data?.summary

  const lastSuccess = useMemo(() => items.find((v) => v.success), [items])
  const successPct = useMemo(() => {
    if (items.length === 0) return 0
    return Math.round((items.filter((v) => v.success).length / items.length) * 100)
  }, [items])

  return (
    <>
      <Topbar
        title={t('Restore verifications', 'Restore verifications')}
        left={<Badge tone="navy">{items.length} {t('verifications', 'verifications')}</Badge>}
        right={
          canWrite ? (
            <PrimaryButton onClick={() => setShowCreate(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Record verification', 'Record verification')}
            </PrimaryButton>
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        {!loading ? (
          <HeroBand
            label={t('Verification success rate', 'Verification success rate')}
            value={items.length > 0 ? `${successPct}%` : '—'}
            percent={successPct}
            caption={
              lastSuccess
                ? `${t('Last successful verification', 'Last successful verification')}: ${lastSuccess.restored_asset_id || t('(platform-wide)', '(platform-wide)')} · ${new Date(lastSuccess.timestamp).toLocaleString()}`
                : t('No successful verifications recorded yet', 'No successful verifications recorded yet')
            }
            pills={
              <>
                <StatPill label={t('Last 30 days', 'Last 30 days')} value={String(summary?.verifications_last_30d ?? 0)} />
                <StatPill label={t('Last 90 days', 'Last 90 days')} value={String(summary?.verifications_last_90d ?? 0)} />
                <StatPill label={t('Last year', 'Last year')} value={String(summary?.verifications_last_365d ?? 0)} />
                <StatPill label={t('Total', 'Total')} value={String(summary?.verifications_total ?? 0)} />
              </>
            }
          />
        ) : null}

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('newest first', 'newest first')}</span>}>
            {t('Recorded verifications', 'Recorded verifications')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={6} height={56} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="ti-database-off"
              title={t('No verifications yet', 'No verifications yet')}
              description={t(
                'Restore verifications prove a backup can actually be restored — DORA Art.12(3) / ISO 8.13. Record one after the next restore drill or sandbox test.',
                'Restore verifications prove a backup can actually be restored — DORA Art.12(3) / ISO 8.13. Record one after the next restore drill or sandbox test.',
              )}
            />
          ) : (
            <PaginatedList
              items={items}
              itemKey={(v) => `${v.timestamp}|${v.restored_asset_id}`}
              renderItem={(v) => (
                <VerificationRow
                  v={v}
                  expanded={expanded === `${v.timestamp}|${v.restored_asset_id}`}
                  onToggle={() => {
                    const k = `${v.timestamp}|${v.restored_asset_id}`
                    setExpanded(expanded === k ? null : k)
                  }}
                />
              )}
            />
          )}
        </Card>
      </div>

      {showCreate ? (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            void load()
          }}
        />
      ) : null}
    </>
  )
}

function VerificationRow({ v, expanded, onToggle }: { v: Verification; expanded: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  const tone = v.success ? 'green' : 'red'
  const rtoTone = v.rto_met === true ? 'green' : v.rto_met === false ? 'red' : 'gray'
  return (
    <div
      style={{
        background: 'var(--color-background-secondary)',
        borderRadius: 'var(--border-radius-sm)',
        padding: '10px 12px',
        marginBottom: 6,
      }}
    >
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onToggle()
        }}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) auto auto auto',
          gap: 12,
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {v.restored_asset_id
              ? v.restored_asset_id
              : t('(platform-wide drill)', '(platform-wide drill)')}
            {v.restored_application_id ? ` · ${v.restored_application_id}` : ''}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {new Date(v.timestamp).toLocaleString()}
            {v.operator_subject ? ` · ${v.operator_subject}` : ''}
            {v.backup_id ? ` · ${t('backup', 'backup')} ${v.backup_id}` : ''}
          </div>
        </div>
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {t('Duration', 'Duration')}: <strong>{fmtDuration(v.duration_seconds)}</strong>
          {v.rto_target_minutes ? ` / ${v.rto_target_minutes}m ${t('target', 'target')}` : ''}
        </span>
        <Badge tone={tone}>{v.success ? t('PASS', 'PASS') : t('FAIL', 'FAIL')}</Badge>
        {v.rto_target_minutes ? (
          <Badge tone={rtoTone}>{v.rto_met === true ? t('RTO met', 'RTO met') : v.rto_met === false ? t('RTO breach', 'RTO breach') : t('RTO n/a', 'RTO n/a')}</Badge>
        ) : <span />}
        <i className={`ti ${expanded ? 'ti-chevron-up' : 'ti-chevron-down'}`} aria-hidden="true" style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }} />
      </div>
      {expanded ? (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border-secondary)', fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {v.manifest_signature_verified ? (
            <div style={{ marginBottom: 4 }}>
              <Badge tone="green">{t('manifest signature verified', 'manifest signature verified')}</Badge>
              {v.manifest_key_id ? <span style={{ marginLeft: 8, color: 'var(--color-text-tertiary)' }}>{v.manifest_key_id}</span> : null}
            </div>
          ) : null}
          {v.failure_reason ? (
            <div style={{ color: 'var(--color-status-red-deep)', marginBottom: 4 }}>
              <strong>{t('Failure', 'Failure')}:</strong> {v.failure_reason}
            </div>
          ) : null}
          {v.integrity_checks && v.integrity_checks.length > 0 ? (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('Integrity checks', 'Integrity checks')}</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {v.integrity_checks.map((c, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    <code style={{ fontSize: 11 }}>{c.check}</code> —{' '}
                    {c.ok ? <Badge tone="green">ok</Badge> : <Badge tone="red">fail</Badge>}
                    {c.expected || c.actual ? (
                      <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 6 }}>
                        {c.expected ? `exp=${c.expected}` : ''}
                        {c.actual ? ` got=${c.actual}` : ''}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {v.notes ? (
            <div style={{ marginTop: 4 }}><strong>{t('Notes', 'Notes')}:</strong> {v.notes}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    restored_asset_id: '',
    restored_application_id: '',
    backup_id: '',
    success: true,
    duration_seconds: '',
    rto_target_minutes: '',
    manifest_signature_verified: false,
    notes: '',
    failure_reason: '',
  })

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        restored_asset_id: form.restored_asset_id.trim(),
        restored_application_id: form.restored_application_id.trim() || undefined,
        backup_id: form.backup_id.trim() || undefined,
        success: form.success,
        manifest_signature_verified: form.manifest_signature_verified,
        notes: form.notes.trim() || undefined,
      }
      if (form.duration_seconds) body.duration_seconds = Number(form.duration_seconds)
      if (form.rto_target_minutes) body.rto_target_minutes = Number(form.rto_target_minutes)
      if (!form.success && form.failure_reason) body.failure_reason = form.failure_reason.trim()

      const r = await apiFetch('/dr/restore-verifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to record verification')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-background-primary)',
          borderRadius: 'var(--border-radius-md)',
          padding: 20,
          width: 'min(560px, 92vw)',
          maxHeight: '85vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 12px', color: 'var(--color-text-primary)' }}>{t('Record restore verification', 'Record restore verification')}</h3>
        {error ? <Banner tone="error">{error}</Banner> : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Field label={t('Restored asset ID *', 'Restored asset ID *')}>
            <input value={form.restored_asset_id} onChange={(e) => setForm({ ...form, restored_asset_id: e.target.value })} style={inputStyle} placeholder="e.g. veeam-job-prod-app-1" />
          </Field>
          <Field label={t('Application ID', 'Application ID')}>
            <input value={form.restored_application_id} onChange={(e) => setForm({ ...form, restored_application_id: e.target.value })} style={inputStyle} placeholder="e.g. app-1" />
          </Field>
          <Field label={t('Backup ID', 'Backup ID')}>
            <input value={form.backup_id} onChange={(e) => setForm({ ...form, backup_id: e.target.value })} style={inputStyle} placeholder="e.g. 2026-05-25T22:00:00Z" />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label={t('Duration (seconds)', 'Duration (seconds)')}>
              <input type="number" value={form.duration_seconds} onChange={(e) => setForm({ ...form, duration_seconds: e.target.value })} style={inputStyle} />
            </Field>
            <Field label={t('RTO target (minutes)', 'RTO target (minutes)')}>
              <input type="number" value={form.rto_target_minutes} onChange={(e) => setForm({ ...form, rto_target_minutes: e.target.value })} style={inputStyle} />
            </Field>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={form.success} onChange={(e) => setForm({ ...form, success: e.target.checked })} />
            {t('Restore succeeded', 'Restore succeeded')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={form.manifest_signature_verified} onChange={(e) => setForm({ ...form, manifest_signature_verified: e.target.checked })} />
            {t('Manifest signature verified', 'Manifest signature verified')}
          </label>
          {!form.success ? (
            <Field label={t('Failure reason', 'Failure reason')}>
              <input value={form.failure_reason} onChange={(e) => setForm({ ...form, failure_reason: e.target.value })} style={inputStyle} />
            </Field>
          ) : null}
          <Field label={t('Notes', 'Notes')}>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ ...inputStyle, minHeight: 60, fontFamily: 'inherit' }} />
          </Field>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <GhostButton onClick={onClose}>{t('Cancel', 'Cancel')}</GhostButton>
          <PrimaryButton onClick={submit} disabled={busy || !form.restored_asset_id.trim()}>
            {busy ? t('Recording…', 'Recording…') : t('Record', 'Record')}
          </PrimaryButton>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>
      {label}
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 'var(--border-radius-sm)',
  border: '1px solid var(--color-border-secondary)',
  background: 'var(--color-background-secondary)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
}
