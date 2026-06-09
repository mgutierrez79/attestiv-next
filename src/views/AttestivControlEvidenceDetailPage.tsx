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
import { PolicyDocUploadWidget } from '../components/PolicyDocUploadWidget'
import { apiFetch } from '../lib/api'
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
                <Tile label={t('Records returned', 'Records returned')} value={String(data.records.length)} />
              </div>
            </Card>

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

function PaginatedEvidenceRecords({
  records,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  t,
}: {
  records: EvidenceRecord[]
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
            </div>
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

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' | 'gray' }) {
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
