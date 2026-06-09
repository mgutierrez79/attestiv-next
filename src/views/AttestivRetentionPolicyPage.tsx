'use client';
// Settings ▸ Retention policy — single page that answers two
// auditor questions in one view:
//
//   1. "What's your retention policy?" → table of per-record-kind
//      windows with a citation (DORA Art.5, GDPR Art.17, etc.) and
//      an edit form for admins.
//   2. "Can you delete a specific record on request?" → unified
//      right-to-erasure form: pick kind + id, give a reason, submit.
//      Result captured in the audit log.

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

type Period = {
  days: number
  reason?: string
}

type Policy = {
  records: Record<string, Period>
  last_updated_at?: string
  updated_by?: string
}

const FORGET_KINDS = [
  { value: 'cve_scan', label: 'CVE scan' },
  { value: 'inventory_asset', label: 'Inventory asset' },
]

export function AttestivRetentionPolicyPage() {
  const { t } = useI18n()

  const [policy, setPolicy] = useState<Policy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [editing, setEditing] = useState<Record<string, Period> | null>(null)
  const [saving, setSaving] = useState(false)

  // Right-to-erasure form state
  const [forgetKind, setForgetKind] = useState(FORGET_KINDS[0].value)
  const [forgetID, setForgetID] = useState('')
  const [forgetReason, setForgetReason] = useState('')
  const [forgetSubject, setForgetSubject] = useState('')
  const [forgetting, setForgetting] = useState(false)

  async function refresh() {
    try {
      const r = await apiFetch('/settings/retention-policy')
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const body = (await r.json()) as Policy
      setPolicy(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policy')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function savePolicy() {
    if (!editing) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const r = await apiFetch('/settings/retention-policy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: editing }),
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      setSuccess(t('Policy saved.', 'Policy saved.'))
      setEditing(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function forget() {
    if (!forgetID.trim()) return
    setForgetting(true)
    setError(null)
    setSuccess(null)
    try {
      const r = await apiFetch('/evidence/forget', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: forgetKind,
          id: forgetID.trim(),
          subject_reason: forgetReason,
          data_subject: forgetSubject,
        }),
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      setSuccess(
        t('Record forgotten. Audit log captured the request.', 'Record forgotten. Audit log captured the request.'),
      )
      setForgetID('')
      setForgetReason('')
      setForgetSubject('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Forget failed')
    } finally {
      setForgetting(false)
    }
  }

  const displayed = editing ?? policy?.records ?? {}
  const sortedKinds = Object.keys(displayed).sort()

  return (
    <>
      <Topbar
        title={t('Retention policy', 'Retention policy')}
        left={
          policy?.last_updated_at ? (
            <Badge tone="navy">
              {t('Updated', 'Updated')} {policy.last_updated_at.slice(0, 10)}
              {policy.updated_by ? ` · ${policy.updated_by}` : ''}
            </Badge>
          ) : (
            <Badge tone="gray">{t('Platform defaults', 'Platform defaults')}</Badge>
          )
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {success ? <Banner tone="success">{success}</Banner> : null}

        <Banner tone="info" title={t('Why this matters', 'Why this matters')}>
          {t(
            'Auditors ask "what\'s your retention?" and "can you delete a specific record on request?" before anything else. This page answers both: the documented per-record-kind window AND a unified right-to-erasure form that fans out to the correct backend. Every deletion is captured in the audit log with the subject reason.',
            'Auditors ask "what\'s your retention?" and "can you delete a specific record on request?" before anything else. This page answers both: the documented per-record-kind window AND a unified right-to-erasure form that fans out to the correct backend. Every deletion is captured in the audit log with the subject reason.',
          )}
        </Banner>

        <Card style={{ marginTop: 10 }}>
          <CardTitle
            right={
              editing ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <GhostButton onClick={() => setEditing(null)} disabled={saving}>
                    {t('Cancel', 'Cancel')}
                  </GhostButton>
                  <PrimaryButton onClick={savePolicy} disabled={saving}>
                    {saving ? t('Saving…', 'Saving…') : t('Save', 'Save')}
                  </PrimaryButton>
                </div>
              ) : (
                <GhostButton onClick={() => setEditing({ ...(policy?.records ?? {}) })}>
                  <i className="ti ti-edit" aria-hidden="true" />
                  {t('Edit', 'Edit')}
                </GhostButton>
              )
            }
          >
            {t('Retention windows by record kind', 'Retention windows by record kind')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={6} height={28} />
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 11 }}>
                  <th style={cellHeaderStyle}>{t('Record kind', 'Record kind')}</th>
                  <th style={cellHeaderStyle}>{t('Retention (days)', 'Retention (days)')}</th>
                  <th style={cellHeaderStyle}>{t('Reason / citation', 'Reason / citation')}</th>
                </tr>
              </thead>
              <tbody>
                {sortedKinds.map((kind) => {
                  const period = displayed[kind]
                  return (
                    <tr key={kind} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={cellStyle}>
                        <code>{kind}</code>
                      </td>
                      <td style={cellStyle}>
                        {editing ? (
                          <input
                            type="number"
                            min={0}
                            value={period.days}
                            onChange={(e) => {
                              const v = parseInt(e.target.value, 10)
                              setEditing({ ...editing, [kind]: { ...period, days: Number.isFinite(v) && v >= 0 ? v : 0 } })
                            }}
                            style={inputStyle}
                          />
                        ) : period.days === 0 ? (
                          <Badge tone="navy">{t('forever', 'forever')}</Badge>
                        ) : (
                          <span style={{ fontWeight: 500 }}>{period.days}</span>
                        )}
                      </td>
                      <td style={{ ...cellStyle, color: 'var(--color-text-secondary)' }}>
                        {editing ? (
                          <input
                            type="text"
                            value={period.reason || ''}
                            onChange={(e) =>
                              setEditing({ ...editing, [kind]: { ...period, reason: e.target.value } })
                            }
                            style={{ ...inputStyle, width: '100%' }}
                            placeholder={t('e.g. DORA Art.5 — 7y minimum', 'e.g. DORA Art.5 — 7y minimum')}
                          />
                        ) : (
                          period.reason || '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<Badge tone="amber">{t('admin only', 'admin only')}</Badge>}>
            {t('Right-to-erasure', 'Right-to-erasure')}
          </CardTitle>
          <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            {t(
              'Delete a specific record on a privacy / regulatory request. The audit log captures the operator, the subject, and the cited reason. Note: evidence_log rows are hash-chained and cannot be retroactively deleted — for those, use the redaction path (future).',
              'Delete a specific record on a privacy / regulatory request. The audit log captures the operator, the subject, and the cited reason. Note: evidence_log rows are hash-chained and cannot be retroactively deleted — for those, use the redaction path (future).',
            )}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 8 }}>
            <div>
              <label style={labelStyle}>{t('Kind', 'Kind')}</label>
              <select
                value={forgetKind}
                onChange={(e) => setForgetKind(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
              >
                {FORGET_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>{t('Record ID', 'Record ID')}</label>
              <input
                type="text"
                value={forgetID}
                onChange={(e) => setForgetID(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
                placeholder="cve-scan-20260519T085504.889Z"
              />
            </div>
            <div>
              <label style={labelStyle}>{t('Data subject (optional)', 'Data subject (optional)')}</label>
              <input
                type="text"
                value={forgetSubject}
                onChange={(e) => setForgetSubject(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
                placeholder="alice@example.com"
              />
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <label style={labelStyle}>{t('Reason / citation', 'Reason / citation')}</label>
            <input
              type="text"
              value={forgetReason}
              onChange={(e) => setForgetReason(e.target.value)}
              style={{ ...inputStyle, width: '100%' }}
              placeholder={t('GDPR Art.17 — subject request 2026-05-19', 'GDPR Art.17 — subject request 2026-05-19')}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <PrimaryButton onClick={forget} disabled={forgetting || !forgetID.trim()}>
              <i className="ti ti-trash" aria-hidden="true" />
              {forgetting ? t('Forgetting…', 'Forgetting…') : t('Forget this record', 'Forget this record')}
            </PrimaryButton>
          </div>
        </Card>
      </div>
    </>
  )
}

const cellHeaderStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
}

const cellStyle: React.CSSProperties = {
  padding: '8px',
  fontSize: 12,
  verticalAlign: 'top',
}

const inputStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '6px 8px',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--border-radius-md)',
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  fontFamily: 'inherit',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: 'var(--color-text-tertiary)',
  marginBottom: 3,
}
