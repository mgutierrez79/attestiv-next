'use client';
// Policy detail page — single policy + linked controls + approval.
//
// Three blocks:
//   1. Policy summary (title, version, category, status, document URL).
//   2. Approval — single button that records who approved + when.
//   3. Control links — list of (framework, control) pairs covered by
//      this policy + a small form to add a new link.

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

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
import { PolicyDocUploadWidget } from '../components/PolicyDocUploadWidget'
import { PolicyValidationPanel } from '../components/PolicyValidationPanel'
import { apiFetch } from '../lib/api'
import { loadSettings } from '../lib/settings'
import { useRoles } from '../lib/roles'

// Policy categories offered in the Edit card. Framework-scoring categories +
// the content-validation rubric doc-types (so a mis-categorised policy can be
// fixed in place — e.g. set it to business_continuity_plan to enable the
// content check). Kept in sync with the create form in AttestivPoliciesPage.
const POLICY_CATEGORIES = [
  'ict_risk_management', 'ict_continuity', 'incident_classification', 'incident_response',
  'risk_management', 'access_control', 'patch_management', 'backup', 'encryption', 'system_validation',
  'business_continuity_plan', 'incident_response_plan', 'internal_audit', 'tlpt_result',
  'firewall_rule_review', 'management_review', 'security_training', 'policy_acknowledgement',
]

// resolveDocHref routes the document link correctly. The backend stamps an
// internal blob path on upload ("/v1/policy-docs/{id}/blob"); the browser only
// reaches the API through the proxy prefix (apiBaseUrl, default "/api"), so a
// raw "/v1/..." href hits the Next app and 404s. Prefix internal paths with the
// API base; leave external URL bookmarks untouched.
function resolveDocHref(documentUrl: string): string {
  if (!documentUrl) return ''
  if (documentUrl.startsWith('/v1/')) {
    return `${loadSettings().apiBaseUrl.replace(/\/+$/, '')}${documentUrl}`
  }
  return documentUrl
}

import { useI18n } from '../lib/i18n';

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

type ControlLink = {
  id: string
  policy_id: string
  framework_id: string
  control_id: string
  linked_at?: string
  linked_by?: string
}

type DetailResponse = {
  policy: Policy
  links: ControlLink[]
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'gray' | 'red'> = {
  draft: 'amber',
  active: 'green',
  retired: 'gray',
}

export function AttestivPolicyDetailPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id
  const { isAdmin } = useRoles()

  const [data, setData] = useState<DetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [suggestNote, setSuggestNote] = useState<string | null>(null)

  // Edit form state.
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState('')
  const [status, setStatus] = useState('')
  const [category, setCategory] = useState('')
  const [documentUrl, setDocumentUrl] = useState('')
  const [reviewDueDate, setReviewDueDate] = useState('')

  // Link form state.
  const [linkFramework, setLinkFramework] = useState('')
  const [linkControl, setLinkControl] = useState('')

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/policy-docs/${encodeURIComponent(id)}`)
      if (!response.ok) {
        if (response.status === 404) throw new Error('Policy not found')
        throw new Error(`${response.status} ${response.statusText}`)
      }
      const body: DetailResponse = await response.json()
      setData(body)
      setTitle(body.policy.title)
      setVersion(body.policy.version)
      setStatus(body.policy.status)
      setCategory(body.policy.category || '')
      setDocumentUrl(body.policy.document_url || '')
      setReviewDueDate(body.policy.review_due_date ? body.policy.review_due_date.slice(0, 10) : '')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load policy'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function save() {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const updates: Record<string, unknown> = {
        title,
        version,
        status,
        category: category || undefined,
        document_url: documentUrl || undefined,
        review_due_date: reviewDueDate || undefined,
      }
      const response = await apiFetch(`/policy-docs/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function deletePolicy() {
    if (!id) return
    if (!window.confirm(t('Delete this draft policy and its uploaded document? This cannot be undone.', 'Delete this draft policy and its uploaded document? This cannot be undone.'))) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/policy-docs/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      router.push('/policies')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete')
      setBusy(false)
    }
  }

  async function archivePolicy() {
    if (!id) return
    const reason = window.prompt(t('Reason for archiving (recorded in the audit log):', 'Reason for archiving (recorded in the audit log):'))
    if (reason === null) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/policy-docs/${encodeURIComponent(id)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to archive')
    } finally {
      setBusy(false)
    }
  }

  // AI-assisted: extract metadata from the uploaded document and pre-fill the
  // Edit form. The values are SUGGESTIONS — the user reviews and clicks Save.
  async function suggestFields() {
    if (!id) return
    setBusy(true)
    setError(null)
    setSuggestNote(null)
    try {
      const response = await apiFetch(`/policy-docs/${encodeURIComponent(id)}/suggest-fields`, { method: 'POST' })
      if (!response.ok) {
        const b = await response.json().catch(() => ({}))
        throw new Error(b?.detail || `${response.status} ${response.statusText}`)
      }
      const body = await response.json()
      const sugg = (body?.suggestions ?? {}) as Record<string, string>
      const applied: string[] = []
      if (sugg.title) {
        setTitle(sugg.title)
        applied.push(t('title', 'title'))
      }
      if (sugg.version) {
        setVersion(sugg.version)
        applied.push(t('version', 'version'))
      }
      if (sugg.category) {
        setCategory(sugg.category)
        applied.push(t('category', 'category'))
      }
      if (sugg.review_due_date) {
        setReviewDueDate(sugg.review_due_date)
        applied.push(t('review date', 'review date'))
      }
      if (applied.length > 0) {
        setSuggestNote(
          t('Suggested from the document: ', 'Suggested from the document: ') +
            applied.join(', ') +
            t('. Review and click Save changes to apply.', '. Review and click Save changes to apply.')
        )
      } else {
        setSuggestNote(body?.note || t('No fields could be suggested from the document.', 'No fields could be suggested from the document.'))
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to suggest fields')
    } finally {
      setBusy(false)
    }
  }

  async function approve() {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/policy-docs/${encodeURIComponent(id)}/approve`, { method: 'POST' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to approve'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function addLink() {
    if (!id) return
    if (!linkFramework.trim() || !linkControl.trim()) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/policy-docs/${encodeURIComponent(id)}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framework_id: linkFramework, control_id: linkControl }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      setLinkFramework('')
      setLinkControl('')
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to link control'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  async function unlink(linkID: string) {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/policy-docs/${encodeURIComponent(id)}/link/${encodeURIComponent(linkID)}`, {
        method: 'DELETE',
      })
      if (!response.ok && response.status !== 204) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to unlink'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const reviewOverdue = useMemo(() => {
    if (!data?.policy.review_due_date) return false
    return new Date(data.policy.review_due_date).getTime() < Date.now()
  }, [data])

  if (loading) {
    return (
      <>
        <Topbar
          title={t('Policy', 'Policy')}
          left={
            <GhostButton onClick={() => router.push('/policies')}>
              <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
            </GhostButton>
          }
        />
        <div className="attestiv-content">
          <Skeleton lines={5} height={42} />
        </div>
      </>
    );
  }

  if (!data) {
    return (
      <>
        <Topbar title={t('Policy', 'Policy')} />
        <div className="attestiv-content">
          <EmptyState icon="ti-file-text" title={t('Policy not found', 'Policy not found')} description={t(
            'The policy may have been deleted or you may not have access.',
            'The policy may have been deleted or you may not have access.'
          )} />
        </div>
      </>
    );
  }

  const { policy, links } = data
  const tone = STATUS_TONE[status.toLowerCase()] ?? 'gray'
  const approved = !!policy.approved_by_user_id

  return (
    <>
      <Topbar
        title={policy.title || 'Policy'}
        left={
          <GhostButton onClick={() => router.push('/policies')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
          </GhostButton>
        }
        right={
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            <code>{policy.id.slice(0, 12)}…</code>
          </span>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {reviewOverdue ? (
          <Banner tone="warning" title={t('Overdue for review', 'Overdue for review')}>
            {t(
              'This policy is past its review_due_date. Linked controls are losing 10% of their score\n            until you bump the review date.',
              'This policy is past its review_due_date. Linked controls are losing 10% of their score\n            until you bump the review date.'
            )}
          </Banner>
        ) : null}

        <Card>
          <CardTitle right={<Badge tone={tone}>{status}</Badge>}>{t('Summary', 'Summary')}</CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Field label={t('Category', 'Category')}>{(policy.category || '—').replace(/_/g, ' ')}</Field>
            <Field label={t('Approval', 'Approval')}>
              {approved ? (
                <span style={{ color: 'var(--color-status-green-mid)' }}>
                  <i className="ti ti-circle-check" aria-hidden="true" /> by {policy.approved_by_user_id} on{' '}
                  {policy.approved_at ? policy.approved_at.slice(0, 10) : '—'}
                </span>
              ) : (
                <span style={{ color: 'var(--color-status-amber-text)' }}>
                  <i className="ti ti-alert-triangle" aria-hidden="true" /> {t('awaiting approval', 'awaiting approval')}
                </span>
              )}
            </Field>
            {policy.document_url ? (
              <Field label={t('Document', 'Document')}>
                <a href={resolveDocHref(policy.document_url)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-brand-blue)' }}>
                  {t('open document', 'open document')} <i className="ti ti-external-link" aria-hidden="true" />
                </a>
              </Field>
            ) : null}
          </div>
          {policy.description ? (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 12, marginBottom: 0, whiteSpace: 'pre-wrap' }}>
              {policy.description}
            </p>
          ) : null}
        </Card>

        {/* B4: re-upload a new version of the document attached to
            this policy. Bumps to v<N+1> server-side; original
            versions stay on disk for the auditor history. */}
        <div style={{ marginTop: 12 }} data-tour-id="policy-upload-dropzone">
          <PolicyDocUploadWidget
            frameworkId={data?.links?.[0]?.framework_id ?? ''}
            controlId={data?.links?.[0]?.control_id ?? ''}
            existingPolicyId={policy.id}
            t={t}
          />
        </div>

        <PolicyValidationPanel policyId={policy.id} />

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <span style={{ display: 'flex', gap: 8 }}>
                <GhostButton onClick={suggestFields} disabled={busy}>
                  <i className="ti ti-sparkles" aria-hidden="true" /> {t('Suggest from document', 'Suggest from document')}
                </GhostButton>
                {!approved ? (
                  <PrimaryButton onClick={approve} disabled={busy} data-tour-id="policy-approve-btn">
                    <i className="ti ti-stamp" aria-hidden="true" /> {t('Approve policy', 'Approve policy')}
                  </PrimaryButton>
                ) : null}
              </span>
            }
          >
            {t('Edit', 'Edit')}
          </CardTitle>
          {suggestNote ? (
            <Banner tone="info">{suggestNote}</Banner>
          ) : null}
          <FormGrid>
            <FormRow label={t('Title', 'Title')}>
              <input value={title} onChange={(e) => setTitle(e.target.value)} style={inputStyle} />
            </FormRow>
            <FormRow label={t('Version', 'Version')}>
              <input value={version} onChange={(e) => setVersion(e.target.value)} style={inputStyle} />
            </FormRow>
            <FormRow label={t('Status', 'Status')}>
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
                {['draft', 'active', 'retired', 'archived'].map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </FormRow>
            <FormRow label={t('Category', 'Category')}>
              <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
                {(POLICY_CATEGORIES.includes(category) ? POLICY_CATEGORIES : [category, ...POLICY_CATEGORIES]).map((c) => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </FormRow>
            <FormRow label={t('Review due date', 'Review due date')}>
              <input type="date" value={reviewDueDate} onChange={(e) => setReviewDueDate(e.target.value)} style={inputStyle} />
            </FormRow>
          </FormGrid>
          <FormRow label={t('Document URL', 'Document URL')}>
            <input value={documentUrl} onChange={(e) => setDocumentUrl(e.target.value)} style={inputStyle} />
          </FormRow>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
            <PrimaryButton onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<Badge tone="navy">{links.length} links</Badge>}>{t('Linked controls', 'Linked controls')}</CardTitle>
          <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', marginBottom: 10 }}>
            <FormRow label={t('Framework ID', 'Framework ID')}>
              <input
                value={linkFramework}
                onChange={(e) => setLinkFramework(e.target.value)}
                placeholder="iso27001"
                style={inputStyle}
              />
            </FormRow>
            <FormRow label={t('Control ID', 'Control ID')}>
              <input
                value={linkControl}
                onChange={(e) => setLinkControl(e.target.value)}
                placeholder={t('A.12.3.1', 'A.12.3.1')}
                style={inputStyle}
              />
            </FormRow>
            <PrimaryButton onClick={addLink} disabled={busy || !linkFramework.trim() || !linkControl.trim()}>
              <i className="ti ti-link" aria-hidden="true" /> {t('Link', 'Link')}
            </PrimaryButton>
          </div>
          {links.length === 0 ? (
            <EmptyState
              icon="ti-link-off"
              title={t('No control links yet', 'No control links yet')}
              description={t(
                'Link a (framework, control) pair so this policy contributes to that control\'s evaluation.',
                'Link a (framework, control) pair so this policy contributes to that control\'s evaluation.'
              )}
            />
          ) : (
            <div>
              {links.map(link => {
                return (
                  <div
                    key={link.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '8px 0',
                      borderBottom: '0.5px solid var(--color-border-tertiary)',
                      fontSize: 12,
                    }}
                  >
                    <code style={{ flex: 1 }}>
                      {link.framework_id}/{link.control_id}
                    </code>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                      linked {link.linked_at ? link.linked_at.slice(0, 10) : '—'}
                      {link.linked_by ? ` by ${link.linked_by}` : ''}
                    </span>
                    <GhostButton onClick={() => unlink(link.id)} disabled={busy}>
                      <i className="ti ti-x" aria-hidden="true" /> {t('Unlink', 'Unlink')}
                    </GhostButton>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        {isAdmin ? (
          <Card style={{ marginTop: 12, border: '1px solid var(--color-status-red-bg)' }}>
            <CardTitle>{t('Danger zone', 'Danger zone')}</CardTitle>
            {approved ? (
              <div>
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
                  {t(
                    'This policy is approved — it is signed evidence and cannot be deleted. Archive it to remove it from active use while preserving the document and audit trail.',
                    'This policy is approved — it is signed evidence and cannot be deleted. Archive it to remove it from active use while preserving the document and audit trail.'
                  )}
                </p>
                <button type="button" onClick={archivePolicy} disabled={busy} style={archiveBtnStyle}>
                  <i className="ti ti-archive" aria-hidden="true" /> {t('Archive policy', 'Archive policy')}
                </button>
              </div>
            ) : (
              <div>
                <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
                  {t(
                    'Permanently delete this draft policy, its control links, and its uploaded document. This cannot be undone.',
                    'Permanently delete this draft policy, its control links, and its uploaded document. This cannot be undone.'
                  )}
                </p>
                <button type="button" onClick={deletePolicy} disabled={busy} style={deleteBtnStyle}>
                  <i className="ti ti-trash" aria-hidden="true" /> {t('Delete policy', 'Delete policy')}
                </button>
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{children}</div>
    </div>
  )
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
      {children}
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 8, flex: 1 }}>
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

const dangerBtnBase: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 14px',
  fontSize: 12,
  fontWeight: 600,
  border: '1px solid',
  borderRadius: 'var(--border-radius-md)',
  cursor: 'pointer',
  background: 'transparent',
}

const deleteBtnStyle: React.CSSProperties = {
  ...dangerBtnBase,
  color: 'var(--color-status-red-deep)',
  borderColor: 'var(--color-status-red-mid)',
}

const archiveBtnStyle: React.CSSProperties = {
  ...dangerBtnBase,
  color: 'var(--color-status-amber-text)',
  borderColor: 'var(--color-status-amber-mid)',
}
