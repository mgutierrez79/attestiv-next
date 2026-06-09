'use client'
// Record of Processing Activities (GDPR Art.30) — list + editor.
//
// Backed by /v1/ropa (GAP-012). Operators maintain the Article-30
// register from this page; one click on Download exports the
// supervisor-ready CSV. The editor enforces the 7 mandatory Art.30
// fields client-side and surfaces server-side warnings inline.

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PrimaryButton,
  Select,
  Skeleton,
  TextInput,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type LegalBasis =
  | 'consent'
  | 'contract'
  | 'legal_obligation'
  | 'vital_interests'
  | 'public_task'
  | 'legitimate_interest'

type InternationalTransfer = {
  country: string
  recipient?: string
  safeguard_type: string
  safeguard_ref?: string
  derogation_ground?: string
}

type Activity = {
  id: string
  tenant_id: string
  name: string
  description?: string
  controller_name: string
  controller_contact?: string
  dpo_name?: string
  dpo_contact?: string
  processor_role?: string
  purposes: string[]
  legal_bases: LegalBasis[]
  legal_notes?: string
  data_subject_categories: string[]
  data_categories: string[]
  special_categories?: string[]
  internal_recipients?: string[]
  third_party_recipients?: string[]
  international_transfers?: InternationalTransfer[]
  retention_policy: string
  retention_days?: number
  security_measures: string[]
  application_id?: string
  third_party_ids?: string[]
  created_by: string
  created_at: string
  updated_by?: string
  updated_at: string
  reviewed_by?: string
  reviewed_at?: string
}

const EMPTY_ACTIVITY: Activity = {
  id: '',
  tenant_id: '',
  name: '',
  controller_name: '',
  purposes: [],
  legal_bases: [],
  data_subject_categories: [],
  data_categories: [],
  retention_policy: '',
  security_measures: [],
  created_by: '',
  created_at: '',
  updated_at: '',
}

const LEGAL_BASIS_OPTIONS: { value: LegalBasis; label: string }[] = [
  { value: 'consent', label: 'Consent (Art.6(1)(a))' },
  { value: 'contract', label: 'Contract (Art.6(1)(b))' },
  { value: 'legal_obligation', label: 'Legal obligation (Art.6(1)(c))' },
  { value: 'vital_interests', label: 'Vital interests (Art.6(1)(d))' },
  { value: 'public_task', label: 'Public task (Art.6(1)(e))' },
  { value: 'legitimate_interest', label: 'Legitimate interest (Art.6(1)(f))' },
]

const SAFEGUARD_OPTIONS = [
  'sccs',
  'bcrs',
  'adequacy_decision',
  'derogation_art49',
  'none',
]

export function AttestivROPAPage() {
  const { t } = useI18n()
  const [items, setItems] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<Activity | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const resp = await apiFetch('/ropa')
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      const data = (await resp.json()) as { items: Activity[] }
      setItems(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load register')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function newActivity() {
    setEditor({ ...EMPTY_ACTIVITY })
    setWarnings([])
  }

  function edit(activity: Activity) {
    setEditor(JSON.parse(JSON.stringify(activity)))
    setWarnings([])
  }

  async function save() {
    if (!editor) return
    setSaving(true)
    setError(null)
    setWarnings([])
    try {
      const method = editor.id ? 'PUT' : 'POST'
      const path = editor.id ? `/ropa/${encodeURIComponent(editor.id)}` : '/ropa'
      const body = JSON.stringify({
        ...editor,
        retention_days: Number(editor.retention_days) || 0,
      })
      const resp = await apiFetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      if (!resp.ok) {
        let detail = `${resp.status} ${resp.statusText}`
        try {
          const data = await resp.json()
          if (data?.detail) detail = data.detail
        } catch {
          /* ignore */
        }
        throw new Error(detail)
      }
      const data = await resp.json()
      if (data.warnings) setWarnings(data.warnings)
      setEditor(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function markReviewed(id: string) {
    try {
      const resp = await apiFetch(`/ropa/${encodeURIComponent(id)}/review`, {
        method: 'POST',
      })
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Review failed')
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('Delete this activity? This cannot be undone.', 'Delete this activity? This cannot be undone.'))) return
    try {
      const resp = await apiFetch(`/ropa/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  async function downloadCSV() {
    try {
      const resp = await apiFetch('/ropa/export.csv')
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `ropa-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed')
    }
  }

  const overdueReviewCount = useMemo(() => {
    const cutoff = Date.now() - 365 * 86400 * 1000
    return items.filter((a) => {
      if (!a.reviewed_at) return true
      return new Date(a.reviewed_at).getTime() < cutoff
    }).length
  }, [items])

  return (
    <>
      <Topbar
        title={t('GDPR Article 30 register', 'GDPR Article 30 register')}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Badge tone="navy">
              {t('{n} activities', '{n} activities', { n: items.length })}
            </Badge>
            {overdueReviewCount > 0 ? (
              <Badge tone="amber">
                {t('{n} due review', '{n} due review', { n: overdueReviewCount })}
              </Badge>
            ) : null}
            <GhostButton onClick={() => void downloadCSV()}>
              <i className="ti ti-download" aria-hidden="true" /> CSV
            </GhostButton>
            <PrimaryButton onClick={() => newActivity()}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('New activity', 'New activity')}
            </PrimaryButton>
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {warnings.length > 0 ? (
          <Banner tone="warning">
            <div>
              <strong>{t('Saved with Art.30 warnings:', 'Saved with Art.30 warnings:')}</strong>
              <ul style={{ margin: '4px 0 0 20px', padding: 0 }}>
                {warnings.map((w, i) => (
                  <li key={i} style={{ fontSize: 12 }}>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </Banner>
        ) : null}

        <Card>
          <CardTitle>{t('Register', 'Register')}</CardTitle>
          {loading ? (
            <Skeleton lines={4} height={28} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="ti-folder-off"
              title={t('Register is empty', 'Register is empty')}
              description={t(
                'Article 30 requires a controller to keep a record of every processing activity. Click "New activity" to add the first one.',
                'Article 30 requires a controller to keep a record of every processing activity. Click "New activity" to add the first one.',
              )}
              action={
                <PrimaryButton onClick={() => newActivity()}>
                  <i className="ti ti-plus" aria-hidden="true" /> {t('New activity', 'New activity')}
                </PrimaryButton>
              }
            />
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={headerRowStyle}>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Activity', 'Activity')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Controller', 'Controller')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Purposes', 'Purposes')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Retention', 'Retention')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Reviewed', 'Reviewed')}</th>
                  <th style={{ padding: '6px 10px' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const overdue = !a.reviewed_at || new Date(a.reviewed_at).getTime() < Date.now() - 365 * 86400 * 1000
                  return (
                    <tr key={a.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={{ padding: '6px 10px' }}>
                        <button type="button" onClick={() => edit(a)} style={linkButtonStyle}>
                          {a.name}
                        </button>
                        {a.special_categories && a.special_categories.length > 0 ? (
                          <span style={{ marginLeft: 6 }}>
                            <Badge tone="amber" icon="ti-shield-lock">Art.9</Badge>
                          </span>
                        ) : null}
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--color-text-secondary)' }}>
                        {a.controller_name}
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {a.purposes.join(' · ')}
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {a.retention_policy.slice(0, 50)}
                        {a.retention_policy.length > 50 ? '…' : ''}
                      </td>
                      <td style={{ padding: '6px 10px', fontSize: 11 }}>
                        {a.reviewed_at ? (
                          <span style={{ color: overdue ? 'var(--color-status-amber-text)' : 'var(--color-text-tertiary)' }}>
                            {a.reviewed_at.slice(0, 10)}
                          </span>
                        ) : (
                          <Badge tone="amber">{t('never', 'never')}</Badge>
                        )}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        <GhostButton onClick={() => void markReviewed(a.id)}>
                          <i className="ti ti-check" aria-hidden="true" />
                        </GhostButton>{' '}
                        <GhostButton onClick={() => edit(a)}>
                          <i className="ti ti-edit" aria-hidden="true" />
                        </GhostButton>{' '}
                        <GhostButton onClick={() => void remove(a.id)}>
                          <i className="ti ti-trash" aria-hidden="true" />
                        </GhostButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>

        {editor ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle
              right={
                <GhostButton onClick={() => setEditor(null)} disabled={saving}>
                  <i className="ti ti-x" aria-hidden="true" /> {t('Cancel', 'Cancel')}
                </GhostButton>
              }
            >
              {editor.id ? t('Edit activity', 'Edit activity') : t('New activity', 'New activity')}
            </CardTitle>

            <Section title={t('Identity (Art.30(1)(a))', 'Identity (Art.30(1)(a))')}>
              <FormRow label={t('Name *', 'Name *')}>
                <TextInput value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} />
              </FormRow>
              <FormRow label={t('Description', 'Description')}>
                <TextInput value={editor.description || ''} onChange={(e) => setEditor({ ...editor, description: e.target.value })} />
              </FormRow>
              <FormRow label={t('Controller name *', 'Controller name *')}>
                <TextInput value={editor.controller_name} onChange={(e) => setEditor({ ...editor, controller_name: e.target.value })} />
              </FormRow>
              <FormRow label={t('Controller contact', 'Controller contact')}>
                <TextInput value={editor.controller_contact || ''} onChange={(e) => setEditor({ ...editor, controller_contact: e.target.value })} placeholder="privacy@acme.example" />
              </FormRow>
              <FormRow label={t('DPO name', 'DPO name')}>
                <TextInput value={editor.dpo_name || ''} onChange={(e) => setEditor({ ...editor, dpo_name: e.target.value })} />
              </FormRow>
              <FormRow label={t('DPO contact', 'DPO contact')}>
                <TextInput value={editor.dpo_contact || ''} onChange={(e) => setEditor({ ...editor, dpo_contact: e.target.value })} placeholder="dpo@acme.example" />
              </FormRow>
              <FormRow label={t('Processor role', 'Processor role')}>
                <Select value={editor.processor_role || 'controller'} onChange={(e) => setEditor({ ...editor, processor_role: e.target.value })}>
                  <option value="controller">controller</option>
                  <option value="processor">processor</option>
                  <option value="joint_controller">joint_controller</option>
                </Select>
              </FormRow>
            </Section>

            <Section title={t('Purpose + lawful basis (Art.30(1)(b))', 'Purpose + lawful basis (Art.30(1)(b))')}>
              <FormRow label={t('Purposes * (one per line)', 'Purposes * (one per line)')}>
                <TextArea
                  value={editor.purposes.join('\n')}
                  onChange={(v) => setEditor({ ...editor, purposes: linesToArray(v) })}
                  placeholder="Respond to customer enquiries"
                />
              </FormRow>
              <FormRow label={t('Legal bases *', 'Legal bases *')}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11 }}>
                  {LEGAL_BASIS_OPTIONS.map((opt) => (
                    <label key={opt.value} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={editor.legal_bases.includes(opt.value)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...editor.legal_bases, opt.value]
                            : editor.legal_bases.filter((b) => b !== opt.value)
                          setEditor({ ...editor, legal_bases: next })
                        }}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </FormRow>
              <FormRow label={t('Legal notes', 'Legal notes')}>
                <TextArea
                  value={editor.legal_notes || ''}
                  onChange={(v) => setEditor({ ...editor, legal_notes: v })}
                  placeholder="Document Art.9(2) exception when special categories present"
                />
              </FormRow>
            </Section>

            <Section title={t('Subjects + data (Art.30(1)(c))', 'Subjects + data (Art.30(1)(c))')}>
              <FormRow label={t('Data subject categories * (one per line)', 'Data subject categories * (one per line)')}>
                <TextArea
                  value={editor.data_subject_categories.join('\n')}
                  onChange={(v) => setEditor({ ...editor, data_subject_categories: linesToArray(v) })}
                  placeholder="Customers"
                />
              </FormRow>
              <FormRow label={t('Data categories * (one per line)', 'Data categories * (one per line)')}>
                <TextArea
                  value={editor.data_categories.join('\n')}
                  onChange={(v) => setEditor({ ...editor, data_categories: linesToArray(v) })}
                  placeholder="contact details"
                />
              </FormRow>
              <FormRow label={t('Special categories (Art.9)', 'Special categories (Art.9)')}>
                <TextArea
                  value={(editor.special_categories || []).join('\n')}
                  onChange={(v) => setEditor({ ...editor, special_categories: linesToArray(v) })}
                  placeholder="health data, biometric data, …"
                />
              </FormRow>
            </Section>

            <Section title={t('Recipients (Art.30(1)(d))', 'Recipients (Art.30(1)(d))')}>
              <FormRow label={t('Internal recipients (one per line)', 'Internal recipients (one per line)')}>
                <TextArea
                  value={(editor.internal_recipients || []).join('\n')}
                  onChange={(v) => setEditor({ ...editor, internal_recipients: linesToArray(v) })}
                  placeholder="Support team"
                />
              </FormRow>
              <FormRow label={t('Third-party recipients (one per line)', 'Third-party recipients (one per line)')}>
                <TextArea
                  value={(editor.third_party_recipients || []).join('\n')}
                  onChange={(v) => setEditor({ ...editor, third_party_recipients: linesToArray(v) })}
                  placeholder="AWS, Zendesk"
                />
              </FormRow>
            </Section>

            <Section title={t('International transfers (Art.30(1)(e))', 'International transfers (Art.30(1)(e))')}>
              {(editor.international_transfers || []).map((tr, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: 6, marginBottom: 6 }}>
                  <TextInput
                    value={tr.country}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        international_transfers: (editor.international_transfers || []).map((x, j) =>
                          j === i ? { ...x, country: e.target.value } : x,
                        ),
                      })
                    }
                    placeholder="Country"
                  />
                  <TextInput
                    value={tr.recipient || ''}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        international_transfers: (editor.international_transfers || []).map((x, j) =>
                          j === i ? { ...x, recipient: e.target.value } : x,
                        ),
                      })
                    }
                    placeholder="Recipient"
                  />
                  <Select
                    value={tr.safeguard_type}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        international_transfers: (editor.international_transfers || []).map((x, j) =>
                          j === i ? { ...x, safeguard_type: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    {SAFEGUARD_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                  <TextInput
                    value={tr.safeguard_ref || ''}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        international_transfers: (editor.international_transfers || []).map((x, j) =>
                          j === i ? { ...x, safeguard_ref: e.target.value } : x,
                        ),
                      })
                    }
                    placeholder="Safeguard ref"
                  />
                  <GhostButton
                    onClick={() =>
                      setEditor({
                        ...editor,
                        international_transfers: (editor.international_transfers || []).filter((_, j) => j !== i),
                      })
                    }
                  >
                    <i className="ti ti-x" aria-hidden="true" />
                  </GhostButton>
                </div>
              ))}
              <GhostButton
                onClick={() =>
                  setEditor({
                    ...editor,
                    international_transfers: [
                      ...(editor.international_transfers || []),
                      { country: '', safeguard_type: 'sccs' },
                    ],
                  })
                }
              >
                <i className="ti ti-plus" aria-hidden="true" /> {t('Add transfer', 'Add transfer')}
              </GhostButton>
            </Section>

            <Section title={t('Retention + security (Art.30(1)(f)+(g))', 'Retention + security (Art.30(1)(f)+(g))')}>
              <FormRow label={t('Retention policy *', 'Retention policy *')}>
                <TextArea
                  value={editor.retention_policy}
                  onChange={(v) => setEditor({ ...editor, retention_policy: v })}
                  placeholder="Tickets retained 5 years from closure (statutory limitation)"
                />
              </FormRow>
              <FormRow label={t('Retention days (numeric)', 'Retention days (numeric)')}>
                <TextInput
                  type="number"
                  value={editor.retention_days?.toString() || ''}
                  onChange={(e) => setEditor({ ...editor, retention_days: Number(e.target.value) || 0 })}
                />
              </FormRow>
              <FormRow label={t('Security measures (one per line)', 'Security measures (one per line)')}>
                <TextArea
                  value={editor.security_measures.join('\n')}
                  onChange={(v) => setEditor({ ...editor, security_measures: linesToArray(v) })}
                  placeholder={'TLS 1.2+\nAES-256 at-rest\nRBAC + SoD'}
                />
              </FormRow>
            </Section>

            <Section title={t('Linkage', 'Linkage')}>
              <FormRow label={t('Application ID', 'Application ID')}>
                <TextInput
                  value={editor.application_id || ''}
                  onChange={(e) => setEditor({ ...editor, application_id: e.target.value })}
                  placeholder="auxia-portal"
                />
              </FormRow>
              <FormRow label={t('Third-party IDs (one per line)', 'Third-party IDs (one per line)')}>
                <TextArea
                  value={(editor.third_party_ids || []).join('\n')}
                  onChange={(v) => setEditor({ ...editor, third_party_ids: linesToArray(v) })}
                  placeholder="tpr-aws-2024"
                />
              </FormRow>
            </Section>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 14 }}>
              <GhostButton onClick={() => setEditor(null)} disabled={saving}>
                {t('Cancel', 'Cancel')}
              </GhostButton>
              <PrimaryButton onClick={() => void save()} disabled={saving}>
                <i className={saving ? 'ti ti-loader' : 'ti ti-device-floppy'} aria-hidden="true" />{' '}
                {saving ? t('Saving…', 'Saving…') : t('Save activity', 'Save activity')}
              </PrimaryButton>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  )
}

function linesToArray(value: string): string[] {
  return value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <h4
        style={{
          fontSize: 10,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          color: 'var(--color-text-tertiary)',
          marginBottom: 8,
          marginTop: 0,
        }}
      >
        {title}
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  )
}

function TextArea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      style={{
        width: '100%',
        padding: 8,
        fontSize: 12,
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--border-radius-md)',
        fontFamily: 'inherit',
      }}
    />
  )
}

const headerRowStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
  background: 'var(--color-background-secondary)',
}

const linkButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--color-brand-blue)',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 500,
}
