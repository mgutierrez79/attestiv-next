'use client';
// Risk register page (Phase-2 GRC, chunk 1).
//
// What's on screen:
//   - 4 summary cards (open, open-critical, open-high, auto-created)
//   - 4×4 likelihood × impact heat-map with risks plotted as dots
//   - Filterable list (status, category, source, owner)
//   - "Add risk" button → modal that captures the four required fields
//
// Auto-created risks are tagged visually so the auditor can tell at
// a glance which ones came from the scoring engine vs human entry.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PaginatedList,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n';
import { useRoles } from '../lib/roles'

type Risk = {
  risk_id: string
  title: string
  category?: string
  likelihood?: string
  impact?: string
  score?: number
  status?: string
  source?: string
  source_control_id?: string
  source_framework_id?: string
  source_rule_code?: string
  owner?: string
  created_at?: string
  updated_at?: string
  metadata?: Record<string, unknown>
}

type Summary = {
  total: number
  by_status: Record<string, number>
  by_severity_open: Record<string, number>
  by_source: Record<string, number>
  open_critical: number
  open_high: number
  open_total: number
}

const LEVELS = ['critical', 'high', 'medium', 'low'] as const
type Level = (typeof LEVELS)[number]

const STATUS_TONE: Record<string, 'amber' | 'green' | 'gray' | 'red' | 'navy'> = {
  open: 'amber',
  in_treatment: 'navy',
  accepted: 'gray',
  closed: 'green',
}

const CATEGORY_LABEL: Record<string, string> = {
  operational: 'Operational',
  compliance: 'Compliance',
  infrastructure: 'Infrastructure',
  third_party: 'Third party',
}

export function AttestivRisksPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const [risks, setRisks] = useState<Risk[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const { canWrite } = useRoles()
  const [filter, setFilter] = useState<{ status?: string; source?: string; category?: string }>({})

  async function refresh() {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter.status) params.set('status', filter.status)
      if (filter.source) params.set('source', filter.source)
      if (filter.category) params.set('category', filter.category)
      params.set('limit', '500')
      const [listRes, summaryRes] = await Promise.all([
        apiFetch(`/risks?${params.toString()}`),
        apiFetch('/risks/summary'),
      ])
      if (!listRes.ok) throw new Error(`${listRes.status} ${listRes.statusText}`)
      const listBody = await listRes.json()
      setRisks(Array.isArray(listBody?.items) ? listBody.items : [])
      if (summaryRes.ok) {
        const summaryBody = await summaryRes.json()
        setSummary(summaryBody)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load risks'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.status, filter.source, filter.category])

  async function createRisk(payload: Record<string, unknown>) {
    setCreateBusy(true)
    try {
      const response = await apiFetch('/risks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      setShowCreate(false)
      await refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create risk'
      setError(message)
    } finally {
      setCreateBusy(false)
    }
  }

  const matrix = useMemo(() => buildMatrix(risks), [risks])
  const openCritical = summary?.open_critical ?? 0
  const openHigh = summary?.open_high ?? 0
  const autoCreated = summary?.by_source?.auto_scoring ?? 0
  const openTotal = summary?.open_total ?? 0

  return (
    <>
      <Topbar
        title={t('Risk register', 'Risk register')}
        left={<Badge tone="navy">{risks.length} entries</Badge>}
        right={
          canWrite ? (
            <PrimaryButton onClick={() => setShowCreate(true)}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Add risk', 'Add risk')}
            </PrimaryButton>
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
          }}
        >
          <SummaryCard label={t('Open total', 'Open total')} value={openTotal} tone="amber" icon="ti-alert-triangle" />
          <SummaryCard label={t('Open critical', 'Open critical')} value={openCritical} tone="red" icon="ti-flame" />
          <SummaryCard label={t('Open high', 'Open high')} value={openHigh} tone="amber" icon="ti-flame" />
          <SummaryCard label={t('Auto-created', 'Auto-created')} value={autoCreated} tone="navy" icon="ti-rocket" />
        </div>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('likelihood × impact', 'likelihood × impact')}</span>}>
            {t('Risk heat-map', 'Risk heat-map')}
          </CardTitle>
          <RiskMatrix matrix={matrix} onCellClick={(level) => setFilter((f) => ({ ...f, status: undefined }))} />
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <FilterBar
                value={filter}
                onChange={setFilter}
                summary={summary}
              />
            }
          >
            {t('Risks', 'Risks')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={5} height={42} />
          ) : risks.length === 0 ? (
            <EmptyState
              icon="ti-alert-octagon"
              title={t('Register is empty', 'Register is empty')}
              description={t(
                'No risks match these filters. Auto-risks appear when scoring detects a control transition; manual risks come from the Add risk button above.',
                'No risks match these filters. Auto-risks appear when scoring detects a control transition; manual risks come from the Add risk button above.'
              )}
            />
          ) : (
            <PaginatedList
              items={risks}
              itemKey={(risk) => risk.risk_id}
              renderItem={(risk) => (
                <RiskRow
                  risk={risk}
                  onOpen={() => router.push(`/risks/${encodeURIComponent(risk.risk_id)}`)}
                />
              )}
              label={t('Risks', 'Risks')}
            />
          )}
        </Card>
      </div>
      {showCreate ? (
        <CreateRiskModal busy={createBusy} onCancel={() => setShowCreate(false)} onSubmit={createRisk} />
      ) : null}
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: number
  tone: 'red' | 'amber' | 'navy' | 'green'
  icon: string
}) {
  const palette: Record<typeof tone, string> = {
    red: 'var(--color-status-red-mid)',
    amber: 'var(--color-status-amber-mid)',
    navy: 'var(--color-brand-blue)',
    green: 'var(--color-status-green-mid)',
  }
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: `${palette[tone]}1A`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: palette[tone],
          }}
        >
          <i className={`ti ${icon}`} aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
        </div>
      </div>
    </Card>
  )
}

function RiskMatrix({
  matrix,
  onCellClick,
}: {
  matrix: Record<Level, Record<Level, Risk[]>>
  onCellClick: (level: Level) => void
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480, fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ width: 90 }}></th>
            {LEVELS.map(impact => {
              const {
                t
              } = useI18n();

              return (
                <th
                  key={impact}
                  style={{
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-tertiary)',
                    padding: '4px 6px',
                    fontWeight: 500,
                    fontSize: 10,
                  }}
                >
                  {t('Impact:', 'Impact:')} {impact}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {LEVELS.map(likelihood => {
            const {
              t
            } = useI18n();

            return (
              <tr key={likelihood}>
                <td
                  style={{
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-tertiary)',
                    padding: '4px 8px 4px 0',
                    fontWeight: 500,
                    fontSize: 10,
                    textAlign: 'right',
                  }}
                >
                  {t('Likelihood:', 'Likelihood:')} {likelihood}
                </td>
                {LEVELS.map((impact) => {
                  const risks = matrix[likelihood][impact]
                  const score = scoreFor(likelihood) * scoreFor(impact)
                  const tone = cellTone(score)
                  return (
                    <td
                      key={impact}
                      onClick={() => onCellClick(likelihood)}
                      style={{
                        padding: 6,
                        border: '0.5px solid var(--color-border-tertiary)',
                        background: tone.bg,
                        verticalAlign: 'top',
                        minHeight: 60,
                        cursor: risks.length > 0 ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {risks.slice(0, 9).map((r) => (
                          <span
                            key={r.risk_id}
                            title={r.title}
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: 5,
                              background: tone.dot,
                              display: 'inline-block',
                            }}
                          />
                        ))}
                        {risks.length > 9 ? (
                          <span style={{ fontSize: 9, color: 'var(--color-text-tertiary)' }}>
                            +{risks.length - 9}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 9, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                        score {score}
                      </div>
                    </td>
                  )
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FilterBar({
  value,
  onChange,
  summary,
}: {
  value: { status?: string; source?: string; category?: string }
  onChange: (next: { status?: string; source?: string; category?: string }) => void
  summary: Summary | null
}) {
  const {
    t
  } = useI18n();

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
      <SelectChip
        label={t('Status', 'Status')}
        value={value.status}
        options={['open', 'in_treatment', 'accepted', 'closed']}
        onChange={(v) => onChange({ ...value, status: v })}
      />
      <SelectChip
        label={t('Source', 'Source')}
        value={value.source}
        options={['manual', 'auto_scoring', 'auto_evidence']}
        onChange={(v) => onChange({ ...value, source: v })}
      />
      <SelectChip
        label={t('Category', 'Category')}
        value={value.category}
        options={['operational', 'compliance', 'infrastructure', 'third_party']}
        onChange={(v) => onChange({ ...value, category: v })}
      />
      {summary ? (
        <span style={{ color: 'var(--color-text-tertiary)' }}>showing {summary.open_total} {t('open /', 'open /')} {summary.total}total
                  </span>
      ) : null}
    </div>
  );
}

function SelectChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value?: string
  options: string[]
  onChange: (next: string | undefined) => void
}) {
  const {
    t
  } = useI18n();

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      style={{
        fontSize: 11,
        padding: '4px 8px',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--border-radius-md)',
        background: 'var(--color-background-primary)',
        color: 'var(--color-text-primary)',
        fontFamily: 'inherit',
      }}
    >
      <option value="">{label}{t(': any', ': any')}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {label}: {opt.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

function RiskRow({ risk, onOpen }: { risk: Risk; onOpen: () => void }) {
  const status = (risk.status || 'open').toLowerCase()
  const source = (risk.source || 'manual').toLowerCase()
  const tone = STATUS_TONE[status] ?? 'gray'
  const meta = (risk.metadata as Record<string, unknown>) || {}
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 110px 100px 90px',
        gap: 10,
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        background: 'transparent',
        border: 'none',
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: 'var(--color-text-primary)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {risk.title}
          </span>
          {source === 'auto_scoring' ? <Badge tone="navy" icon="ti-rocket">auto</Badge> : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {risk.source_control_id ? (
            <>
              <code>{risk.source_framework_id}/{risk.source_control_id}</code>
              {meta && typeof meta['control_name'] === 'string' ? ` · ${meta['control_name']}` : ''}
            </>
          ) : (
            CATEGORY_LABEL[risk.category || ''] ?? risk.category ?? '—'
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
        {(risk.likelihood ?? '—').toUpperCase()} × {(risk.impact ?? '—').toUpperCase()}
      </div>
      <div style={{ fontSize: 12, fontWeight: 500 }}>score {risk.score ?? 0}</div>
      <div>
        <Badge tone={tone}>{status.replace(/_/g, ' ')}</Badge>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
        {risk.owner || 'unassigned'}
      </div>
    </button>
  )
}

function CreateRiskModal({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const {
    t
  } = useI18n();

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('operational')
  const [likelihood, setLikelihood] = useState<Level>('medium')
  const [impact, setImpact] = useState<Level>('medium')
  const score = scoreFor(likelihood) * scoreFor(impact)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-background-primary)',
          padding: 18,
          borderRadius: 'var(--border-radius-lg)',
          width: 'min(520px, 92vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15, fontWeight: 500 }}>{t('Add risk', 'Add risk')}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
          {t('Manual risks are tagged', 'Manual risks are tagged')} <code>manual</code> {t(
            'and never auto-close. Auto-risks appear directly from the\n          scoring engine — you don\'t create those by hand.',
            'and never auto-close. Auto-risks appear directly from the\n          scoring engine — you don\'t create those by hand.'
          )}
        </p>
        <FormRow label={t('Title', 'Title')}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={inputStyle}
            placeholder={t(
              'e.g. Privileged access drift on vCenter',
              'e.g. Privileged access drift on vCenter'
            )}
          />
        </FormRow>
        <FormRow label={t('Description', 'Description')}>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
          />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormRow label={t('Category', 'Category')}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={inputStyle}>
              {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label={`Score: ${score}`}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {t('likelihood × impact, range 1–16', 'likelihood × impact, range 1–16')}
            </span>
          </FormRow>
          <FormRow label={t('Likelihood', 'Likelihood')}>
            <select value={likelihood} onChange={(e) => setLikelihood(e.target.value as Level)} style={inputStyle}>
              {LEVELS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label={t('Impact', 'Impact')}>
            <select value={impact} onChange={(e) => setImpact(e.target.value as Level)} style={inputStyle}>
              {LEVELS.map((level) => (
                <option key={level} value={level}>{level}</option>
              ))}
            </select>
          </FormRow>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <GhostButton onClick={onCancel} disabled={busy}>{t('Cancel', 'Cancel')}</GhostButton>
          <PrimaryButton
            onClick={() => onSubmit({ title, description, category, likelihood, impact })}
            disabled={busy || !title.trim()}
          >
            {busy ? 'Saving…' : 'Add risk'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
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

function buildMatrix(risks: Risk[]): Record<Level, Record<Level, Risk[]>> {
  const matrix: Record<Level, Record<Level, Risk[]>> = {
    critical: { critical: [], high: [], medium: [], low: [] },
    high:     { critical: [], high: [], medium: [], low: [] },
    medium:   { critical: [], high: [], medium: [], low: [] },
    low:      { critical: [], high: [], medium: [], low: [] },
  }
  for (const risk of risks) {
    const status = (risk.status ?? 'open').toLowerCase()
    if (status === 'closed') continue
    const l = (risk.likelihood ?? '').toLowerCase() as Level
    const i = (risk.impact ?? '').toLowerCase() as Level
    if (!LEVELS.includes(l) || !LEVELS.includes(i)) continue
    matrix[l][i].push(risk)
  }
  return matrix
}

function scoreFor(level: string): number {
  switch (level) {
    case 'critical': return 4
    case 'high':     return 3
    case 'medium':   return 2
    case 'low':      return 1
    default:         return 0
  }
}

function cellTone(score: number): { bg: string; dot: string } {
  if (score >= 12) return { bg: 'var(--color-status-red-bg)',   dot: 'var(--color-status-red-mid)' }
  if (score >= 6)  return { bg: 'var(--color-status-amber-bg)', dot: 'var(--color-status-amber-mid)' }
  if (score >= 2)  return { bg: 'var(--color-status-blue-bg)',  dot: 'var(--color-brand-blue)' }
  return            { bg: 'var(--color-background-secondary)',  dot: 'var(--color-text-tertiary)' }
}
