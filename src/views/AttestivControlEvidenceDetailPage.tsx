'use client';
// Audit ▸ Per-control evidence detail.
//
// The page an auditor opens when they want to spot-check a control:
// "evidence_count says 3, prove it". Lists every evidence record the
// engine used to score this control — source, timestamp, type, the
// requirement tag it satisfied, and a 5-field payload preview. Plus
// the per-requirement breakdown so the auditor sees which axis of
// the requirement failed (presence vs freshness vs frequency vs
// threshold vs field-match) — not just an aggregate score.
//
// Backed by /v1/scoring/frameworks/{id}/controls/{cid}/evidence.

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  Pagination,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { ControlBreakdownPanels } from '../components/ControlBreakdownPanels'
import { PolicyDocUploadWidget } from '../components/PolicyDocUploadWidget'
import { apiFetch } from '../lib/api'
import type { ControlBreakdown } from '../lib/controlBreakdown'
import { useI18n } from '../lib/i18n'

type EvidenceRecord = {
  evidence_id: string
  type: string
  timestamp: string
  source?: string
  satisfies_tags?: string[]
  payload_preview?: Record<string, string>
}

type RequirementRow = {
  tag: string
  type: string
  combined_score: number
  presence_score: number
  freshness_score: number
  frequency_score: number
  threshold_score: number
  field_match_score: number
  gate_failed: boolean
  evidence_ids?: string[]
  // Threshold the engine graded records against + how many met it.
  threshold_field?: string
  threshold_op?: string
  threshold_value?: number
  has_threshold?: boolean
  passed_count?: number
  total_count?: number
}

type ExplanationRequirement = {
  tag: string
  type: string
  status: string
  combined_score: number
  evidence_count: number
  sample_evidence_ids?: string[]
  why: string
}

type ControlExplanation = {
  citation?: string
  citation_status?: string
  citation_verified?: boolean
  explanation?: string
  rationale?: string
  remediation?: string
  summary?: string
  requirements?: ExplanationRequirement[]
  findings?: { severity: string; code: string; description: string; remediation: string; tag: string }[]
}

// WireResponse mirrors what the backend actually sends: records and
// requirements come back as `null` for controls with no_data. Don't
// let the rest of the component see these nullables — normalise once
// at the fetch boundary into Response (non-null arrays) so .length /
// .map / .filter can't TypeError and crash the whole page (the bug
// that took control-detail pages out for every CIS / NIST / GxP /
// PCI control on the pilot).
type WireResponse = {
  tenant_id: string
  framework_id: string
  control_id: string
  control_name: string
  status: string
  score: number
  evidence_count: number
  weight?: number
  contribution_pct?: number
  records: EvidenceRecord[] | null
  requirements: RequirementRow[] | null
  explanation?: ControlExplanation
  // W2-1 per-control replay fields, populated only when ?at= was set
  as_of?: string
  is_replay?: boolean
  framework_evaluated_at?: string
  reason?: string
}

type Response = Omit<WireResponse, 'records' | 'requirements'> & {
  records: EvidenceRecord[]
  requirements: RequirementRow[]
}

export function AttestivControlEvidenceDetailPage({
  frameworkId,
  controlId,
}: {
  frameworkId: string
  controlId: string
}) {
  const { t } = useI18n()
  const [data, setData] = useState<Response | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // "How did I pass?" drill-down. Fetched from the breakdown endpoint
  // independently of the evidence response — if the (parallel) backend
  // route isn't live yet, the page still renders the existing evidence
  // detail and just omits the explainability panels.
  const [breakdown, setBreakdown] = useState<ControlBreakdown | null>(null)
  // W2-1 per-control replay: when set, the page queries the
  // historical state. Empty = live latest evaluation.
  const [asOfInput, setAsOfInput] = useState<string>('')
  const [activeAsOf, setActiveAsOf] = useState<string>('')
  // Evidence records pagination — 199+ rows on a healthy pilot, list
  // primitive without a page-size selector pushed the rest of the page
  // off-screen. Shared platform primitive (10/20/50/100), default 20.
  const [evidencePage, setEvidencePage] = useState(0)
  const [evidencePageSize, setEvidencePageSize] = useState(20)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const base = `/scoring/frameworks/${encodeURIComponent(frameworkId)}/controls/${encodeURIComponent(controlId)}/evidence`
        const url = activeAsOf ? `${base}?at=${encodeURIComponent(activeAsOf)}` : base
        const r = await apiFetch(url)
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        const wire = (await r.json()) as WireResponse
        // Boundary normalisation — backend returns null for these on
        // no_data controls; the component assumes arrays everywhere.
        const body: Response = {
          ...wire,
          records: wire.records ?? [],
          requirements: wire.requirements ?? [],
        }
        if (!cancelled) setData(body)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load evidence detail')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [frameworkId, controlId, activeAsOf])

  // Breakdown fetch — kept separate from the evidence load so a missing
  // endpoint (backend route landing later) never blocks the existing page.
  // Replay (activeAsOf) intentionally does not re-fetch the breakdown; the
  // drill-down is a live "how did I pass" view.
  useEffect(() => {
    let cancelled = false
    async function loadBreakdown() {
      try {
        const r = await apiFetch(
          `/scoring/frameworks/${encodeURIComponent(frameworkId)}/controls/${encodeURIComponent(controlId)}/breakdown`,
        )
        if (!r.ok) return
        const body = (await r.json()) as ControlBreakdown
        if (!cancelled) setBreakdown(body)
      } catch {
        // Soft-fail: breakdown is additive. The evidence detail stands alone.
      }
    }
    void loadBreakdown()
    return () => { cancelled = true }
  }, [frameworkId, controlId])

  // createRemediation pre-fills framework_id + control_id from the page
  // context. The dedup-against-existing-linkage warning is handled in the
  // modal (ControlBreakdownPanels) before this fires.
  async function createRemediation(payload: Record<string, unknown>) {
    const r = await apiFetch('/remediation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error(body?.detail || `${r.status} ${r.statusText}`)
    }
  }

  function applyReplay() {
    if (!asOfInput) return
    // datetime-local emits "2026-04-15T12:00" (no tz). Convert via Date
    // to a real UTC ISO so the backend's RFC3339 parser accepts it.
    const parsed = new Date(asOfInput)
    if (Number.isNaN(parsed.getTime())) {
      setError(t('Enter a valid date and time', 'Enter a valid date and time'))
      return
    }
    setActiveAsOf(parsed.toISOString())
  }

  function exitReplay() {
    setActiveAsOf('')
    setAsOfInput('')
  }

  const statusTone = (status: string): 'green' | 'amber' | 'red' | 'gray' => {
    switch ((status || '').toLowerCase()) {
      case 'pass': return 'green'
      case 'review': return 'amber'
      case 'warn': return 'amber'
      case 'fail': return 'red'
      default: return 'gray'
    }
  }

  const scoreTone = (score: number): 'green' | 'amber' | 'red' | 'gray' => {
    if (score >= 0.95) return 'green'
    if (score >= 0.7) return 'amber'
    if (score > 0) return 'red'
    return 'gray'
  }

  return (
    <>
      <Topbar
        title={`${frameworkId.toUpperCase()} · ${controlId}`}
        left={data ? (
          <>
            <Badge tone={statusTone(data.status)}>{(data.status || '—').toUpperCase()}</Badge>
            {data.is_replay ? <Badge tone="navy">{t('historical replay', 'historical replay')}</Badge> : null}
          </>
        ) : null}
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        {/* W2-1 per-control replay control. Empty datetime = live
            latest. When set, the page re-fetches against ?at= and
            renders the historical state. */}
        <Card>
          <CardTitle right={data?.is_replay ? (
            <Badge tone="navy">{t('as of', 'as of')} {new Date(data.as_of || '').toLocaleString()}</Badge>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('live latest', 'live latest')}</span>
          )}>
            {t('Point-in-time replay', 'Point-in-time replay')}
          </CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
            {t(
              "Pick a past timestamp to see this control's status, score, and requirement breakdown as the engine recorded it then. Evidence-record hydration is skipped in replay (live stream may have rolled off) — the run manifest carries the historical records.",
              "Pick a past timestamp to see this control's status, score, and requirement breakdown as the engine recorded it then. Evidence-record hydration is skipped in replay (live stream may have rolled off) — the run manifest carries the historical records.",
            )}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <input
              type="datetime-local"
              value={asOfInput}
              onChange={(e) => setAsOfInput(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: 'var(--border-radius-sm)',
                border: '1px solid var(--color-border-secondary)',
                background: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                fontSize: 13,
              }}
            />
            <button
              type="button"
              onClick={applyReplay}
              disabled={!asOfInput || loading}
              style={{
                padding: '6px 12px',
                borderRadius: 'var(--border-radius-sm)',
                border: '1px solid var(--color-border-secondary)',
                background: 'var(--color-brand-primary)',
                color: 'var(--color-on-brand)',
                fontSize: 13,
                cursor: !asOfInput || loading ? 'default' : 'pointer',
                opacity: !asOfInput || loading ? 0.5 : 1,
              }}
            >
              {t('Replay this control', 'Replay this control')}
            </button>
            {data?.is_replay ? (
              <button
                type="button"
                onClick={exitReplay}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--border-radius-sm)',
                  border: '1px solid var(--color-border-secondary)',
                  background: 'var(--color-background-secondary)',
                  color: 'var(--color-text-primary)',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {t('Back to live', 'Back to live')}
              </button>
            ) : null}
            {data?.framework_evaluated_at ? (
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {t('Framework evaluated at', 'Framework evaluated at')}: {new Date(data.framework_evaluated_at).toLocaleString()}
              </span>
            ) : null}
          </div>
          {data?.is_replay && data?.reason ? (
            <div style={{ marginTop: 8 }}>
              <Banner tone="warning">{data.reason}</Banner>
            </div>
          ) : null}
        </Card>

        <Banner tone="info" title={t('What this page is', 'What this page is')}>
          {t(
            'Auditor spot-check view. For this control, lists every evidence record the engine used to score it — record id, source, timestamp, the requirement tag it satisfies, and a 5-field payload preview. Plus the per-requirement axis breakdown (presence, freshness, frequency, threshold, field match) so you see which axis pulled the score down.',
            'Auditor spot-check view. For this control, lists every evidence record the engine used to score it — record id, source, timestamp, the requirement tag it satisfies, and a 5-field payload preview. Plus the per-requirement axis breakdown (presence, freshness, frequency, threshold, field match) so you see which axis pulled the score down.',
          )}
        </Banner>

        {loading ? (
          <Skeleton lines={8} height={32} />
        ) : !data ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No data', 'No data')}</div>
        ) : (
          <>
            <Card style={{ marginTop: 12 }}>
              <CardTitle right={
                <span style={{ fontSize: 18, fontWeight: 600 }}>{(data.score * 100).toFixed(1)}%</span>
              }>
                {data.control_name || data.control_id}
              </CardTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 8 }}>
                <Tile label={t('Status', 'Status')} value={(data.status || '—').toUpperCase()} tone={statusTone(data.status)} />
                <Tile label={t('Evidence count', 'Evidence count')} value={String(data.evidence_count)} tone={data.evidence_count > 0 ? 'green' : 'red'} />
                <Tile label={t('Requirements', 'Requirements')} value={String(data.requirements.length)} />
                {typeof data.contribution_pct === 'number' && data.contribution_pct > 0 ? (
                  <Tile
                    label={t('Weight in framework', 'Weight in framework')}
                    value={`${data.contribution_pct}%`}
                    sub={typeof data.weight === 'number' ? t('weight {w}', 'weight {w}', { w: data.weight }) : undefined}
                  />
                ) : (
                  <Tile label={t('Records returned', 'Records returned')} value={String(data.records.length)} />
                )}
              </div>
            </Card>

            {/* "How did I pass?" explainability drill-down — board-readable
                narrative, headline, provenance, in-flight linkage and the
                gap list. Renders only in the live view (not historical
                replay) and only once the breakdown endpoint has answered. */}
            {breakdown && !data.is_replay ? (
              <ControlBreakdownPanels
                data={breakdown}
                status={data.status}
                score={data.score}
                onCreateRemediation={createRemediation}
              />
            ) : null}

            {data.explanation ? (
              <Card style={{ marginTop: 12 }}>
                <CardTitle
                  right={
                    data.explanation.citation ? (
                      <Badge tone={data.explanation.citation_verified ? 'green' : 'amber'}>
                        {data.explanation.citation}
                        {data.explanation.citation_verified
                          ? ''
                          : data.explanation.citation_status === 'derived'
                            ? ` · ${t('derived — verify', 'derived — verify')}`
                            : ` · ${t('draft — verify', 'draft — verify')}`}
                      </Badge>
                    ) : null
                  }
                >
                  {t('Why this result', 'Why this result')}
                </CardTitle>

                {data.explanation.summary ? (
                  <p style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{data.explanation.summary}</p>
                ) : null}

                {data.explanation.explanation ? (
                  <p style={{ fontSize: 13, marginTop: 8 }}>
                    <strong>{t('What it checks', 'What it checks')}: </strong>
                    {data.explanation.explanation}
                  </p>
                ) : null}
                {data.explanation.rationale ? (
                  <p style={{ fontSize: 13, marginTop: 6 }}>
                    <strong>{t('Why it matters', 'Why it matters')}: </strong>
                    {data.explanation.rationale}
                  </p>
                ) : null}

                {data.explanation.requirements && data.explanation.requirements.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 }}>
                      {t('Evidence found', 'Evidence found')}
                    </div>
                    {data.explanation.requirements.map((req) => (
                      <div key={req.tag} style={{ padding: '6px 0', borderTop: '0.5px solid var(--color-border-tertiary)', display: 'flex', gap: 8, alignItems: 'baseline' }}>
                        <Badge tone={reqTone(req.status)}>{req.status}</Badge>
                        <code style={{ fontSize: 11 }}>{req.tag}</code>
                        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{req.why}</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                {data.status && data.status.toLowerCase() !== 'pass' && data.explanation.remediation ? (
                  <div style={{ marginTop: 10, padding: 10, borderRadius: 6, background: 'var(--color-surface-muted, #f8fafc)' }}>
                    <strong style={{ fontSize: 13 }}>{t('How to fix it', 'How to fix it')}: </strong>
                    <span style={{ fontSize: 13 }}>{data.explanation.remediation}</span>
                  </div>
                ) : null}

                {data.explanation.findings && data.explanation.findings.length > 0 ? (
                  <div style={{ marginTop: 10 }}>
                    {data.explanation.findings.map((f, i) => (
                      <div key={i} style={{ fontSize: 12, marginTop: 4 }}>
                        <Badge tone={f.severity === 'critical' ? 'red' : 'amber'}>{f.severity}</Badge>{' '}
                        {f.description}
                        {f.remediation ? <span style={{ color: 'var(--color-text-tertiary)' }}> — {f.remediation}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {data.explanation.citation && !data.explanation.citation_verified ? (
                  <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 10 }}>
                    {data.explanation.citation_status === 'derived'
                      ? t(
                          'Citation derived automatically from the framework and control identifier — pending review by a qualified juriste. Do not rely on it for a formal audit until verified.',
                          'Citation derived automatically from the framework and control identifier — pending review by a qualified juriste. Do not rely on it for a formal audit until verified.',
                        )
                      : t(
                          'Regulatory citation is a draft pending review by a qualified juriste — do not rely on it for a formal audit until verified.',
                          'Regulatory citation is a draft pending review by a qualified juriste — do not rely on it for a formal audit until verified.',
                        )}
                  </p>
                ) : null}
              </Card>
            ) : null}

            <Card style={{ marginTop: 12 }}>
              <CardTitle>{t('Requirement breakdown', 'Requirement breakdown')}</CardTitle>
              {data.requirements.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  {t('No requirements recorded for this control.', 'No requirements recorded for this control.')}
                </div>
              ) : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
                  <thead>
                    <tr style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textAlign: 'left' }}>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Tag', 'Tag')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Type', 'Type')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Combined', 'Combined')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Presence', 'Presence')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Freshness', 'Freshness')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Frequency', 'Frequency')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Threshold', 'Threshold')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Fields', 'Fields')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Gate', 'Gate')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.requirements.map((r, i) => (
                      <tr key={r.tag + ':' + i} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                        <td style={{ padding: '6px 8px' }}><code style={{ fontSize: 11 }}>{r.tag}</code></td>
                        <td style={{ padding: '6px 8px', fontSize: 10, color: 'var(--color-text-tertiary)' }}>{r.type}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: scoreColor(r.combined_score) }}>{(r.combined_score * 100).toFixed(0)}%</td>
                        <td style={cellStyle()}>{fmtAxis(r.presence_score)}</td>
                        <td style={cellStyle()}>{fmtAxis(r.freshness_score)}</td>
                        <td style={cellStyle()}>{fmtAxis(r.frequency_score)}</td>
                        <td style={cellStyle()}>{fmtAxis(r.threshold_score)}</td>
                        <td style={cellStyle()}>{fmtAxis(r.field_match_score)}</td>
                        <td style={{ padding: '6px 8px' }}>
                          {r.gate_failed ? <Badge tone="red">{t('FAILED', 'FAILED')}</Badge> : <Badge tone="gray">—</Badge>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {data.requirements.length > 0 ? (
                <div style={{ marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                    {t('What we found', 'What we found')}
                  </div>
                  {data.requirements.map((r) => {
                    const f = requirementFinding(r, t)
                    const color =
                      f.tone === 'pass'
                        ? 'var(--color-status-green-deep)'
                        : f.tone === 'fail'
                          ? 'var(--color-status-red-mid)'
                          : 'var(--color-status-amber-deep, var(--color-text-secondary))'
                    const mark = f.tone === 'pass' ? '✓' : f.tone === 'fail' ? '✗' : '•'
                    return (
                      <div key={`found-${r.tag}`} style={{ padding: '3px 0', fontSize: 13, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span style={{ color, fontWeight: 700 }}>{mark}</span>
                        <code style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{r.tag}</code>
                        <span style={{ color: 'var(--color-text-secondary)' }}>{f.text}</span>
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </Card>

            <Card style={{ marginTop: 12 }}>
              <CardTitle>{t('Evidence records', 'Evidence records')} <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>({data.records.length})</span></CardTitle>
              {data.records.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  {t('No evidence records resolvable. Either no evaluation has run, or every recorded evidence ID has rolled off the current evidence stream.', 'No evidence records resolvable. Either no evaluation has run, or every recorded evidence ID has rolled off the current evidence stream.')}
                </div>
              ) : (
                <PaginatedEvidenceRecords
                  records={data.records}
                  requirements={data.requirements}
                  page={evidencePage}
                  pageSize={evidencePageSize}
                  onPageChange={setEvidencePage}
                  onPageSizeChange={(s) => {
                    setEvidencePageSize(s)
                    setEvidencePage(0)
                  }}
                  t={t}
                />
              )}
            </Card>
            {/* B4: in-line per-control upload affordance. Lifts a
                control from "not-evidenced" to "attested" via a
                signed policy doc without leaving the page. The
                server hashes the file (B1); the linked control's
                next register read sees attested status (C1). */}
            <PolicyDocUploadWidget
              frameworkId={frameworkId}
              controlId={controlId}
              t={t}
            />
          </>
        )}
      </div>
    </>
  )
}

// --- Human-readable evidence helpers -------------------------------------
// Turn a record's raw payload preview into a one-line "what this record
// says" headline, and (when the requirement it satisfies has a threshold)
// a pass/fail verdict against the actual bar — so the evidence reads as a
// sentence instead of a key/value dump.

const IDENTITY_KEYS = [
  'vm_name', 'hostname', 'host', 'asset_name', 'asset_id', 'device_name',
  'device', 'name', 'serial', 'serial_number', 'user', 'username', 'account',
  'email', 'repo', 'repository', 'resource', 'subject', 'rule', 'policy_id',
]

function recordIdentity(p?: Record<string, string>): string | null {
  if (!p) return null
  for (const k of IDENTITY_KEYS) {
    const v = (p[k] ?? '').trim()
    if (v) return v
  }
  return null
}

function humanizeField(field: string): string {
  return field.replace(/_/g, ' ').replace(/\bhours?\b/i, 'h').trim()
}

function opSymbol(op?: string): string {
  switch ((op ?? '').toLowerCase()) {
    case 'lte': case 'le': case 'lessthanorequal': return '≤'
    case 'gte': case 'ge': case 'greaterthanorequal': return '≥'
    case 'lt': case 'lessthan': return '<'
    case 'gt': case 'greaterthan': return '>'
    case 'eq': case 'equals': return '='
    default: return op ?? ''
  }
}

function meetsThreshold(value: number, op: string, target: number): boolean {
  switch ((op ?? '').toLowerCase()) {
    case 'lte': case 'le': case 'lessthanorequal': return value <= target
    case 'gte': case 'ge': case 'greaterthanorequal': return value >= target
    case 'lt': case 'lessthan': return value < target
    case 'gt': case 'greaterthan': return value > target
    case 'eq': case 'equals': return value === target
    default: return false
  }
}

// thresholdReqForRecord finds the threshold-bearing requirement a record
// satisfies (by tag) whose field is present in the record's payload.
function thresholdReqForRecord(rec: EvidenceRecord, requirements: RequirementRow[]): RequirementRow | null {
  if (!rec.satisfies_tags || !rec.payload_preview) return null
  for (const tag of rec.satisfies_tags) {
    const req = requirements.find((r) => r.tag === tag && r.has_threshold && r.threshold_field)
    if (req && req.threshold_field && rec.payload_preview[req.threshold_field] != null) return req
  }
  return null
}

// recordVerdict renders the readable headline + optional pass/fail chip.
function recordVerdict(rec: EvidenceRecord, requirements: RequirementRow[]): {
  title: string
  detail: string | null
  pass: boolean | null
} {
  const title = recordIdentity(rec.payload_preview) ?? rec.evidence_id
  // Threshold record: exact pass/fail against the bar.
  const req = thresholdReqForRecord(rec, requirements)
  if (req && req.threshold_field) {
    const raw = rec.payload_preview?.[req.threshold_field] ?? ''
    const num = Number(String(raw).replace(/[^0-9.-]/g, ''))
    const target = req.threshold_value ?? 0
    const sym = opSymbol(req.threshold_op)
    const detail = `${humanizeField(req.threshold_field)} ${raw} (target ${sym} ${target})`
    const pass = Number.isFinite(num) ? meetsThreshold(num, req.threshold_op ?? '', target) : null
    return { title, detail, pass }
  }
  // Non-threshold record: it contributes to a pass when the requirement it
  // satisfies is itself satisfied (presence/freshness/gate all met). That's
  // what lets a PASSING control's evidence still read as a green ✓ rather
  // than rendering bare.
  if (rec.satisfies_tags) {
    for (const tag of rec.satisfies_tags) {
      const r = requirements.find((x) => x.tag === tag)
      if (r && !r.gate_failed && r.presence_score > 0 && r.combined_score >= 0.95) {
        return { title, detail: null, pass: true }
      }
    }
  }
  return { title, detail: null, pass: null }
}

// requirementFinding produces a concrete one-line "what we found" for ANY
// requirement — threshold or not, passing or failing — so a 100% control
// explains itself just as much as a 0% one. Tone drives the ✓ / • / ✗ mark.
function requirementFinding(
  r: RequirementRow,
  t: (key: string, fallback: string, params?: Record<string, string | number>) => string,
): { text: string; tone: 'pass' | 'partial' | 'fail' } {
  const count = r.evidence_ids?.length ?? r.total_count ?? 0
  if (r.gate_failed) return { text: t('required event not on record', 'required event not on record'), tone: 'fail' }
  if (r.presence_score === 0) return { text: t('no evidence found', 'no evidence found'), tone: 'fail' }
  if (r.has_threshold && (r.total_count ?? 0) > 0) {
    const passed = r.passed_count ?? 0
    const total = r.total_count ?? 0
    const bar = `${humanizeField(r.threshold_field || '')} ${opSymbol(r.threshold_op)} ${r.threshold_value}`
    if (passed >= total) return { text: t('all {n} met {bar}', 'all {n} met {bar}', { n: total, bar }), tone: 'pass' }
    return {
      text: t('{p} of {n} met {bar} — {f} failing', '{p} of {n} met {bar} — {f} failing', { p: passed, n: total, bar, f: total - passed }),
      tone: 'fail',
    }
  }
  // Non-threshold (presence / freshness / cadence / field-match). Describe
  // what's there and flag whichever axis is below bar.
  const issues: string[] = []
  if (r.freshness_score < 0.99) issues.push(r.freshness_score > 0 ? t('some evidence aging', 'some evidence aging') : t('evidence stale', 'evidence stale'))
  if (r.frequency_score < 0.99) issues.push(t('cadence below target', 'cadence below target'))
  if (r.field_match_score < 0.99) issues.push(t('field mismatch', 'field mismatch'))
  if (issues.length === 0) {
    return { text: t('{n} record(s) found — current and on cadence', '{n} record(s) found — current and on cadence', { n: count }), tone: r.combined_score >= 0.95 ? 'pass' : 'partial' }
  }
  return { text: t('{n} found, but {issues}', '{n} found, but {issues}', { n: count, issues: issues.join(', ') }), tone: r.combined_score >= 0.7 ? 'partial' : 'fail' }
}

function PaginatedEvidenceRecords({
  records,
  requirements,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  t,
}: {
  records: EvidenceRecord[]
  requirements: RequirementRow[]
  page: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  t: (key: string, fallback: string) => string
}) {
  const pageCount = Math.max(1, Math.ceil(records.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageStart = currentPage * pageSize
  const pageRows = useMemo(
    () => records.slice(pageStart, pageStart + pageSize),
    [records, pageStart, pageSize],
  )
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ maxHeight: 560, overflowY: 'auto' }}>
        {pageRows.map((rec, i) => (
          <div
            key={rec.evidence_id + ':' + (pageStart + i)}
            style={{
              padding: '8px 0',
              borderTop: i === 0 && currentPage === 0 ? 'none' : '0.5px solid var(--color-border-tertiary)',
            }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{rec.evidence_id}</code>
              <Badge tone="gray">{rec.type}</Badge>
              {rec.source ? <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('via', 'via')} <strong>{rec.source}</strong></span> : null}
              {rec.timestamp ? <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{rec.timestamp}</span> : <span style={{ fontSize: 11, color: 'var(--color-status-red-mid)' }}>{t('rolled off', 'rolled off')}</span>}
              {rec.type === 'policy_document'
                ? (() => {
                    // Policy-doc evidence is a file — link straight to the document
                    // (where it can be viewed/downloaded). evidence_id is
                    // "policy:<id>"; payload_preview.policy_id is the same id.
                    const docId = (rec.payload_preview?.policy_id || rec.evidence_id.replace(/^policy:/, '')).trim()
                    return docId ? (
                      <a
                        href={`/policies/${encodeURIComponent(docId)}`}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: 'var(--color-status-blue-deep)',
                          textDecoration: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <i className="ti ti-file-text" aria-hidden="true" />
                        {t('View document', 'View document')}
                      </a>
                    ) : null
                  })()
                : null}
            </div>
            {(() => {
              const v = recordVerdict(rec, requirements)
              return (
                <div style={{ marginTop: 5, display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  {v.pass === true ? <span style={{ color: 'var(--color-status-green-deep)', fontWeight: 700 }}>✓</span> : null}
                  {v.pass === false ? <span style={{ color: 'var(--color-status-red-mid)', fontWeight: 700 }}>✗</span> : null}
                  <strong style={{ fontSize: 13 }}>{v.title}</strong>
                  {v.detail ? (
                    <span style={{ fontSize: 12, color: v.pass === false ? 'var(--color-status-red-mid)' : 'var(--color-text-secondary)' }}>
                      {v.detail}
                    </span>
                  ) : null}
                </div>
              )
            })()}
            {rec.satisfies_tags && rec.satisfies_tags.length > 0 ? (
              <div style={{ marginTop: 4, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {t('Satisfies', 'Satisfies')}: {rec.satisfies_tags.map((tag) => <code key={tag} style={{ marginRight: 6, fontSize: 10 }}>{tag}</code>)}
              </div>
            ) : null}
            {rec.payload_preview && Object.keys(rec.payload_preview).length > 0 ? (
              <div style={{ marginTop: 6, fontSize: 11, color: 'var(--color-text-secondary)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '2px 12px' }}>
                {Object.entries(rec.payload_preview).map(([k, v]) => (
                  <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                    <span style={{ color: 'var(--color-text-tertiary)' }}>{k}:</span>
                    <span style={{ fontFamily: 'var(--font-family-mono, monospace)', fontSize: 10 }}>{v}</span>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <Pagination
          page={currentPage}
          pageSize={pageSize}
          total={records.length}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          label={t('Evidence', 'Evidence')}
        />
      </div>
    </div>
  )
}

function Tile({ label, value, tone, sub }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' | 'gray'; sub?: string }) {
  const palette: Record<NonNullable<typeof tone>, string> = {
    green: 'var(--color-status-green-mid)',
    amber: 'var(--color-status-amber-mid)',
    red: 'var(--color-status-red-mid)',
    gray: 'var(--color-text-tertiary)',
  }
  const color = palette[tone || 'gray']
  return (
    <Card>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 600, color }}>{value}</div>
      {sub ? <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{sub}</div> : null}
    </Card>
  )
}

function reqTone(status: string): 'green' | 'amber' | 'red' | 'gray' {
  switch ((status || '').toLowerCase()) {
    case 'satisfied': return 'green'
    case 'partial': return 'amber'
    case 'weak': return 'red'
    case 'missing': return 'red'
    case 'blocked': return 'red'
    default: return 'gray'
  }
}

function cellStyle(): React.CSSProperties {
  return { padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
}

function fmtAxis(v: number): string {
  if (!v && v !== 0) return '—'
  return `${(v * 100).toFixed(0)}%`
}

function scoreColor(v: number): string {
  if (v >= 0.95) return 'var(--color-status-green-mid)'
  if (v >= 0.7) return 'var(--color-status-amber-mid)'
  if (v > 0) return 'var(--color-status-red-mid)'
  return 'var(--color-text-tertiary)'
}
