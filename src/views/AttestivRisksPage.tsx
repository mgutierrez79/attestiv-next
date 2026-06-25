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

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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
  const [selectedCell, setSelectedCell] = useState<{ likelihood: Level; impact: Level } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggleSelected = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }, [])

  const exportCSV = useCallback((rows: Risk[]) => {
    const targets = selected.size > 0 ? rows.filter((r) => selected.has(r.risk_id)) : rows
    const header = ['risk_id', 'title', 'category', 'likelihood', 'impact', 'score', 'status', 'source', 'owner', 'created_at']
    const csv = [
      header.join(','),
      ...targets.map((r) =>
        header.map((k) => {
          const v = (r as Record<string, unknown>)[k] ?? ''
          const s = String(v)
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
        }).join(',')
      ),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `risks-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [selected])

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
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GhostButton onClick={() => router.push('/risks/failure-register')}>
              <i className="ti ti-history" aria-hidden="true" /> {t('Failure register', 'Failure register')}
            </GhostButton>
            {canWrite ? (
              <PrimaryButton onClick={() => setShowCreate(true)}>
                <i className="ti ti-plus" aria-hidden="true" /> {t('Add risk', 'Add risk')}
              </PrimaryButton>
            ) : null}
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error" onRetry={refresh}>{error}</Banner> : null}

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
          <RiskMatrix
            matrix={matrix}
            selected={selectedCell}
            onCellClick={(likelihood, impact) =>
              setSelectedCell((cur) =>
                cur && cur.likelihood === likelihood && cur.impact === impact ? null : { likelihood, impact },
              )
            }
          />
        </Card>

        {selectedCell ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle
              right={
                <button
                  onClick={() => setSelectedCell(null)}
                  style={{ fontSize: 11, background: 'none', border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-secondary)', padding: '4px 10px', borderRadius: 'var(--border-radius-md)', cursor: 'pointer' }}
                >
                  {t('Close', 'Close')}
                </button>
              }
            >
              {t('Risks in', 'Risks in')} {selectedCell.likelihood} × {selectedCell.impact}
            </CardTitle>
            {(() => {
              const cellRisks = matrix[selectedCell.likelihood][selectedCell.impact]
              if (cellRisks.length === 0) {
                return <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No risks in this cell.', 'No risks in this cell.')}</div>
              }
              return (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {cellRisks.map((r) => (
                    <li key={r.risk_id} style={{ padding: '8px 0', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <Link
                        href={`/risks/${encodeURIComponent(r.risk_id)}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--color-text-primary)', textDecoration: 'none', fontSize: 12 }}
                      >
                        <Badge tone={(r.score ?? 0) >= 12 ? 'red' : (r.score ?? 0) >= 6 ? 'amber' : 'gray'}>{r.score ?? 0}</Badge>
                        <span style={{ flex: '1 1 280px', minWidth: 220, color: 'var(--color-brand-blue)' }}>{r.title || r.risk_id}</span>
                        {frameworkLabel(r) ? (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{frameworkLabel(r)}</span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            })()}
          </Card>
        ) : null}

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {selected.size > 0 && (
                  <>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                      {selected.size} {t('selected', 'selected')}
                    </span>
                    <GhostButton onClick={() => exportCSV(risks)}>
                      <i className="ti ti-download" aria-hidden="true" style={{ fontSize: 12 }} /> {t('Export CSV', 'Export CSV')}
                    </GhostButton>
                    <GhostButton onClick={() => setSelected(new Set())}>
                      {t('Clear', 'Clear')}
                    </GhostButton>
                  </>
                )}
                {selected.size === 0 && (
                  <GhostButton onClick={() => exportCSV(risks)}>
                    <i className="ti ti-download" aria-hidden="true" style={{ fontSize: 12 }} /> {t('Export CSV', 'Export CSV')}
                  </GhostButton>
                )}
                <FilterBar
                  value={filter}
                  onChange={setFilter}
                  summary={summary}
                />
              </div>
            }
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                aria-label={t('Select all risks', 'Select all risks')}
                checked={risks.length > 0 && selected.size === risks.length}
                onChange={(e) => setSelected(e.target.checked ? new Set(risks.map((r) => r.risk_id)) : new Set())}
                style={{ cursor: 'pointer' }}
              />
              {t('Risks', 'Risks')}
            </div>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="checkbox"
                    checked={selected.has(risk.risk_id)}
                    onChange={() => toggleSelected(risk.risk_id)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Select ${risk.title}`}
                    style={{ cursor: 'pointer', flexShrink: 0 }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <RiskRow
                      risk={risk}
                      onOpen={() => router.push(`/risks/${encodeURIComponent(risk.risk_id)}`)}
                    />
                  </div>
                </div>
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
          <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 600, lineHeight: 1, letterSpacing: '-0.01em', fontVariantNumeric: 'tabular-nums', marginTop: 3 }}>{value}</div>
        </div>
      </div>
    </Card>
  )
}

function frameworkLabel(r: Risk): string {
  const fw = (r.metadata?.['framework_name'] as string | undefined) ?? r.source_framework_id ?? ''
  return typeof fw === 'string' ? fw : ''
}

function RiskMatrix({
  matrix,
  selected,
  onCellClick,
}: {
  matrix: Record<Level, Record<Level, Risk[]>>
  selected: { likelihood: Level; impact: Level } | null
  onCellClick: (likelihood: Level, impact: Level) => void
}) {
  const { t } = useI18n()
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480, fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ width: 90 }}></th>
            {LEVELS.map(impact => {
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
                  const isSelected = selected?.likelihood === likelihood && selected?.impact === impact
                  return (
                    <td
                      key={impact}
                      onClick={() => risks.length > 0 && onCellClick(likelihood, impact)}
                      style={{
                        padding: 6,
                        border: isSelected ? '2px solid var(--color-text-primary)' : '0.5px solid var(--color-border-tertiary)',
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
  // Closed risks show their close timestamp (from metadata.closed_at),
  // others show when they opened. Relative time hint helps the
  // operator scan stale-open vs recently-closed at a glance.
  const closedAt = status === 'closed' && typeof meta['closed_at'] === 'string'
    ? (meta['closed_at'] as string)
    : ''
  const displayedTime = closedAt || risk.created_at || risk.updated_at || ''
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 130px 110px 100px 120px 90px',
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
      <div
        style={{ fontSize: 11, color: 'var(--color-text-secondary)', minWidth: 0 }}
        title={displayedTime ? new Date(displayedTime).toLocaleString() : ''}
      >
        {displayedTime ? (
          <>
            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {closedAt ? 'closed' : 'opened'}
            </div>
            <div>{formatRiskTime(displayedTime)}</div>
          </>
        ) : (
          <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        )}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
        {risk.owner || 'unassigned'}
      </div>
    </button>
  )
}

// formatRiskTime renders an ISO timestamp as a compact relative-to-now
// string ("3d ago", "8mo ago"). Hover the parent cell to see the
// absolute value via the title attribute.
function formatRiskTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const delta = Date.now() - d.getTime()
  if (delta < 0) return 'future'
  const sec = Math.floor(delta / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
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
