'use client';
// Scoring ▸ Crosswalk — the "born multi-framework" visibility page.
//
// Three things on screen:
//   1. Top-line stat: N evidence types × M controls touched × K frameworks
//      (the headline number from /v1/scoring/crosswalk-summary).
//   2. Ranked table of every evidence type by controls_count, with a
//      mini-grid of how many controls per framework. Operators see at
//      a glance which evidence is the highest-leverage to collect well.
//   3. Click an evidence type → expand its full hit list (every
//      (framework, control) pair that references it), fetched live
//      from /v1/scoring/crosswalk?evidence_type=...
//
// The page answers the buyer's question — "if I improve THIS one
// piece of evidence, how many controls move?" — in one view.

import { useEffect, useState } from 'react'
import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch, apiJson } from '../lib/api'

import { useI18n } from '../lib/i18n'

type CrosswalkSummaryRow = {
  evidence_type: string
  controls_count: number
  frameworks_count: number
  frameworks: string[]
  controls_by_framework: Record<string, number>
}

type CrosswalkSummary = {
  total_evidence_types: number
  covered_evidence_types: number
  total_controls_touched: number
  frameworks_count: number
  rows: CrosswalkSummaryRow[]
}

type CrosswalkHit = {
  framework_id: string
  framework_name: string
  control_id: string
  control_name: string
  control_area?: string
  weight: number
  matched_tag: string
}

type CrosswalkDetail = {
  queried_as: string
  evidence_type: string
  tag: string
  controls_count: number
  frameworks_count: number
  hits: CrosswalkHit[]
}

const FRAMEWORK_TONE: Record<string, 'navy' | 'amber' | 'green' | 'red' | 'gray'> = {
  dora: 'navy',
  nis2: 'navy',
  gxp: 'amber',
  iso27001: 'navy',
  cis: 'green',
  nist: 'green',
  pci_dss: 'amber',
  soc2: 'gray',
}

export function AttestivScoringCrosswalkPage() {
  const { t } = useI18n()

  const [summary, setSummary] = useState<CrosswalkSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<CrosswalkDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiJson<CrosswalkSummary>('/scoring/crosswalk-summary')
      .then((resp) => {
        if (!cancelled) setSummary(resp)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load crosswalk')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function loadDetail(evidenceType: string) {
    if (expanded === evidenceType) {
      setExpanded(null)
      setDetail(null)
      return
    }
    setExpanded(evidenceType)
    setDetail(null)
    setDetailLoading(true)
    try {
      const response = await apiFetch(`/scoring/crosswalk?evidence_type=${encodeURIComponent(evidenceType)}`)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const body = (await response.json()) as CrosswalkDetail
      setDetail(body)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load detail')
    } finally {
      setDetailLoading(false)
    }
  }

  return (
    <>
      <Topbar
        title={t('Cross-framework crosswalk', 'Cross-framework crosswalk')}
        left={
          summary ? (
            <Badge tone="navy">
              {summary.covered_evidence_types}/{summary.total_evidence_types} {t('types covered', 'types covered')}
            </Badge>
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Banner tone="info" title={t('Why this matters', 'Why this matters')}>
          {t(
            'Attestiv is born multi-framework — one piece of evidence satisfies controls across every framework you owe. This page surfaces that math directly: pick the evidence type that gives you the highest framework leverage, fix it well, and watch every framework score move at once.',
            'Attestiv is born multi-framework — one piece of evidence satisfies controls across every framework you owe. This page surfaces that math directly: pick the evidence type that gives you the highest framework leverage, fix it well, and watch every framework score move at once.'
          )}
        </Banner>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 10,
            marginTop: 10,
          }}
        >
          <HeadlineCard
            label={t('Evidence types', 'Evidence types')}
            value={summary?.covered_evidence_types}
            total={summary?.total_evidence_types}
            icon="ti-database"
          />
          <HeadlineCard
            label={t('Controls covered', 'Controls covered')}
            value={summary?.total_controls_touched}
            icon="ti-list-check"
          />
          <HeadlineCard
            label={t('Frameworks touched', 'Frameworks touched')}
            value={summary?.frameworks_count}
            icon="ti-stack-2"
          />
          <HeadlineCard
            label={t('Avg controls / type', 'Avg controls / type')}
            value={
              summary && summary.covered_evidence_types > 0
                ? Math.round((summary.total_controls_touched / summary.covered_evidence_types) * 10) / 10
                : null
            }
            icon="ti-divide"
          />
        </div>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={summary ? <Badge tone="navy">{summary.rows.length} {t('rows', 'rows')}</Badge> : null}>
            {t('Evidence types ranked by leverage', 'Evidence types ranked by leverage')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={10} height={32} />
          ) : !summary || summary.rows.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t('No evidence types found.', 'No evidence types found.')}
            </div>
          ) : (
            <div>
              {summary.rows.map((row) => (
                <div key={row.evidence_type}>
                  <button
                    type="button"
                    onClick={() => loadDetail(row.evidence_type)}
                    style={rowButtonStyle(expanded === row.evidence_type)}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <code style={{ fontSize: 12, color: 'var(--color-text-primary)' }}>
                        {row.evidence_type}
                      </code>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {row.frameworks.map((fwId) => (
                        <Badge key={fwId} tone={FRAMEWORK_TONE[fwId] ?? 'gray'}>
                          {fwId} · {row.controls_by_framework[fwId]}
                        </Badge>
                      ))}
                    </div>
                    <div style={{ minWidth: 80, textAlign: 'right' }}>
                      <span style={{ fontSize: 14, fontWeight: 600 }}>{row.controls_count}</span>
                      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}> {t('controls', 'controls')}</span>
                    </div>
                    <i
                      className={`ti ${expanded === row.evidence_type ? 'ti-chevron-down' : 'ti-chevron-right'}`}
                      aria-hidden="true"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    />
                  </button>
                  {expanded === row.evidence_type ? (
                    <div style={detailWrapperStyle}>
                      {detailLoading ? (
                        <Skeleton lines={4} height={28} />
                      ) : detail && detail.evidence_type === row.evidence_type ? (
                        <div>
                          {detail.hits.map((hit) => (
                            <div key={`${hit.framework_id}-${hit.control_id}`} style={hitRowStyle}>
                              <Badge tone={FRAMEWORK_TONE[hit.framework_id] ?? 'gray'}>{hit.framework_id}</Badge>
                              <code style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{hit.control_id}</code>
                              <div style={{ flex: 1, fontSize: 12 }}>{hit.control_name}</div>
                              {hit.matched_tag ? (
                                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                                  {t('via', 'via')} <code>{hit.matched_tag}</code>
                                </span>
                              ) : null}
                              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', minWidth: 50, textAlign: 'right' }}>
                                {t('w=', 'w=')}{hit.weight}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

function HeadlineCard({
  label,
  value,
  total,
  icon,
}: {
  label: string
  value?: number | null
  total?: number | null
  icon: string
}) {
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--color-brand-blue)1A',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--color-brand-blue)',
          }}
        >
          <i className={`ti ${icon}`} aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>
            {value ?? '—'}
            {total != null ? (
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                {' '}/ {total}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  )
}

function rowButtonStyle(expanded: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    padding: '10px 12px',
    border: 'none',
    background: expanded ? 'var(--color-background-secondary)' : 'transparent',
    borderBottom: '0.5px solid var(--color-border-tertiary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    color: 'var(--color-text-primary)',
  }
}

const detailWrapperStyle: React.CSSProperties = {
  padding: '8px 16px 12px 16px',
  background: 'var(--color-background-secondary)',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
}

const hitRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '6px 0',
}
