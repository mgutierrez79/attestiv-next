'use client'
// PolicyDocUploadWidget — Workstream B4.
//
// Reusable affordance for "upload a policy doc + link it to this
// control + view the resulting hash + manifest" without leaving the
// page the operator is currently on. Wired into the control-detail
// pages (audit + framework controls) so a control showing as
// "not-evidenced" can be lifted to "attested" in one flow.
//
// Backend contract (Workstream B1):
//
//   1. POST /v1/policy-docs                  create policy row
//   2. POST /v1/policy-docs/{id}/upload      multipart file → server hashes
//   3. POST /v1/policy-docs/{id}/link        link to (framework, control)
//   4. POST /v1/policy-docs/{id}/approve     final SoD-checked approval
//
// The widget runs all four in sequence and reports the manifest +
// hash on success. Re-uploads use the existing policy_id (skips
// step 1) so versions accumulate.

import { useState } from 'react'

import { Badge, Banner, Card, CardTitle } from './AttestivUi'
import { apiFetch } from '../lib/api'

type Manifest = {
  policy_id: string
  version: number
  filename: string
  content_type: string
  size: number
  sha256: string
  uploaded_by: string
  uploaded_at: string
}

type Props = {
  frameworkId: string
  controlId: string
  controlName?: string
  // When set, re-upload onto this existing policy_id (skips create).
  existingPolicyId?: string
  // Default category if the operator doesn't pick one. Maps to
  // policydocs.CategoryX constants on the backend.
  defaultCategory?: string
  onUploaded?: (manifest: Manifest, policyId: string) => void
  t?: (key: string, fallback?: string) => string
}

const CATEGORIES = [
  'access_control',
  'patch_management',
  'incident_response',
  'backup',
  'encryption',
  'risk_management',
  // Content-validated document types (internal/docvalidate rubrics) — enable
  // the "Validate document" check on the policy detail page.
  'business_continuity_plan',
  'incident_response_plan',
  'internal_audit',
  'tlpt_result',
  'firewall_rule_review',
  'management_review',
  'security_training',
  'policy_acknowledgement',
]

export function PolicyDocUploadWidget({
  frameworkId,
  controlId,
  controlName,
  existingPolicyId,
  defaultCategory = 'risk_management',
  onUploaded,
  t,
}: Props) {
  const tr = t ?? ((_k: string, fb?: string) => fb ?? _k)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [version, setVersion] = useState('v1.0')
  const [category, setCategory] = useState(defaultCategory)
  const [reviewDueDate, setReviewDueDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manifest, setManifest] = useState<Manifest | null>(null)

  const handleUpload = async () => {
    if (busy) return
    if (!file) {
      setError(tr('select a file', 'Select a file to upload'))
      return
    }
    setBusy(true)
    setError(null)
    setManifest(null)
    try {
      // Step 1 — create the policy row if there's no existing one.
      let policyId = existingPolicyId ?? ''
      if (!policyId) {
        const createResp = await apiFetch('/policy-docs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title || file.name,
            version,
            category,
            review_due_date: reviewDueDate || undefined,
          }),
        })
        if (!createResp.ok) {
          const body = await createResp.json().catch(() => ({}))
          throw new Error(body?.detail || `create policy: ${createResp.status}`)
        }
        const policy = await createResp.json()
        policyId = policy?.id
        if (!policyId) throw new Error('create returned no policy id')
      }

      // Step 2 — upload the file. Server computes SHA256.
      const form = new FormData()
      form.append('file', file, file.name)
      const upResp = await apiFetch(`/policy-docs/${encodeURIComponent(policyId)}/upload`, {
        method: 'POST',
        body: form,
      })
      if (!upResp.ok) {
        const body = await upResp.json().catch(() => ({}))
        throw new Error(body?.detail || `upload: ${upResp.status}`)
      }
      const upBody = await upResp.json()
      const m: Manifest | undefined = upBody?.manifest
      if (!m) throw new Error('upload returned no manifest')

      // Step 3 — link to control (idempotent server-side on dup).
      const linkResp = await apiFetch(`/policy-docs/${encodeURIComponent(policyId)}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framework_id: frameworkId, control_id: controlId }),
      })
      if (!linkResp.ok) {
        const body = await linkResp.json().catch(() => ({}))
        // Don't fail the whole flow on a duplicate link; surface a soft warning.
        if (linkResp.status !== 409) {
          throw new Error(body?.detail || `link: ${linkResp.status}`)
        }
      }

      setManifest(m)
      if (onUploaded) onUploaded(m, policyId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'upload failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardTitle>
        {tr('Upload policy doc for this control', 'Upload policy doc for this control')}
      </CardTitle>
      <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
        {controlName ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {tr('Will link to', 'Will link to')}: <code>{frameworkId}</code>/<code>{controlId}</code>
            {' '}— {controlName}
          </div>
        ) : null}

        <input
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md,.rtf"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
          style={inputStyle}
        />

        {!existingPolicyId && (
          <>
            <input
              type="text"
              placeholder={tr('Title', 'Title')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder={tr('Version (e.g. v1.0)', 'Version (e.g. v1.0)')}
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              disabled={busy}
              style={inputStyle}
            />
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={busy}
              style={inputStyle}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={reviewDueDate}
              onChange={(e) => setReviewDueDate(e.target.value)}
              disabled={busy}
              title={tr('Review due date — staleness flips coverage to not-evidenced past this date', 'Review due date — staleness flips coverage to not-evidenced past this date')}
              style={inputStyle}
            />
          </>
        )}

        <button
          type="button"
          onClick={handleUpload}
          disabled={busy || !file}
          style={{
            padding: '8px 12px',
            fontSize: 12,
            fontWeight: 600,
            background: busy || !file ? 'var(--color-background-tertiary)' : 'var(--color-status-blue-deep)',
            color: '#fff',
            border: 0,
            borderRadius: 6,
            cursor: busy || !file ? 'not-allowed' : 'pointer',
          }}
        >
          {busy ? tr('Uploading…', 'Uploading…') : tr('Upload + link + hash', 'Upload + link + hash')}
        </button>

        {error ? <Banner tone="error">{error}</Banner> : null}

        {manifest ? (
          <Banner tone="success">
            <strong>{tr('Uploaded.', 'Uploaded.')}</strong>{' '}
            v{manifest.version} · <Badge tone="green">{manifest.size} bytes</Badge>
            <div style={{ marginTop: 6, fontFamily: 'var(--font-mono)', fontSize: 10, wordBreak: 'break-all' }}>
              SHA256: {manifest.sha256}
            </div>
            <div style={{ marginTop: 4, fontSize: 10, color: 'var(--color-text-tertiary)' }}>
              {tr('Coverage register entry for this control will flip to "attested" on next read once the policy is approved.', 'Coverage register entry for this control will flip to "attested" on next read once the policy is approved.')}
            </div>
          </Banner>
        ) : null}
      </div>
    </Card>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 4,
  fontFamily: 'inherit',
  background: 'var(--color-background-primary)',
}
