'use client';
// Risks ▸ Heatmap.
//
// 4×4 likelihood × impact grid of open risks. ISO 31000 / DORA
// Art.6 explicitly expect this visualisation. The platform's stored
// likelihood/impact vocabulary is 4 levels (critical/high/medium/
// low), so the grid is honest at 4×4 — no synthetic 5×5 padding.
//
// Backed by /v1/risks/heatmap. Cells are color-shaded by score
// (likelihood × impact, 1..16); clicking a cell expands the risk
// IDs that landed there with quick links to each detail page.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type HeatmapRisk = {
  risk_id: string
  title?: string
  framework_name?: string
  score: number
}

type Cell = {
  likelihood: string
  impact: string
  score: number
  count: number
  risk_ids?: string[]
  risks?: HeatmapRisk[]
}

type HeatmapResponse = {
  tenant_id: string
  likelihood_order: string[]
  impact_order: string[]
  cells: Cell[]
  total_open: number
  frameworks?: string[]
  framework?: string
}

export function AttestivRiskHeatmapPage() {
  const { t } = useI18n()
  const [data, setData] = useState<HeatmapResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [rederiving, setRederiving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [framework, setFramework] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = framework ? `?framework=${encodeURIComponent(framework)}` : ''
      const r = await apiFetch(`/risks/heatmap${q}`)
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const body = (await r.json()) as HeatmapResponse
      setData(body)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load heatmap')
    } finally {
      setLoading(false)
    }
  }, [framework])

  // Reload when the framework filter changes; clear any open cell drill-down
  // since its risk list no longer applies.
  useEffect(() => { setSelected(null); void load() }, [load])

  // Re-derive axes: recompute likelihood (from how long each control has
  // been failing) and impact (from control weight) across every open
  // auto-risk, then reload. Admin-only on the backend; a non-admin gets a
  // 403 surfaced as a notice. The scoring loop also runs this every tick,
  // so this is the "fix the heatmap now" shortcut.
  const rederive = useCallback(async () => {
    setRederiving(true)
    setNotice(null)
    setError(null)
    try {
      const r = await apiFetch('/risks/rederive-axes', { method: 'POST' })
      if (r.status === 401 || r.status === 403) {
        setNotice(t('Re-deriving axes requires an admin role.', 'Re-deriving axes requires an admin role.'))
        return
      }
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const body = (await r.json()) as { scanned: number; updated: number; skipped_manual: number }
      setNotice(
        t('Re-derived', 'Re-derived') +
          `: ${body.updated} ${t('updated', 'updated')} / ${body.scanned} ${t('open auto-risks', 'open auto-risks')}, ${body.skipped_manual} ${t('manual (skipped)', 'manual (skipped)')}.`,
      )
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-derive axes')
    } finally {
      setRederiving(false)
    }
  }, [load, t])

  // cells keyed by "likelihood|impact" for O(1) lookup as we render.
  const cellMap = useMemo(() => {
    const m = new Map<string, Cell>()
    for (const c of data?.cells || []) m.set(`${c.likelihood}|${c.impact}`, c)
    return m
  }, [data])

  return (
    <>
      <Topbar
        title={t('Risk heatmap', 'Risk heatmap')}
        left={
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {data ? <Badge tone={data.total_open === 0 ? 'green' : 'amber'}>{data.total_open} {t('open', 'open')}</Badge> : null}
            {data?.frameworks && data.frameworks.length > 0 ? (
              <select
                value={framework}
                onChange={(e) => setFramework(e.target.value)}
                title={t('Filter by framework', 'Filter by framework')}
                style={{
                  fontSize: 12,
                  padding: '5px 8px',
                  border: '0.5px solid var(--color-border-secondary)',
                  borderRadius: 'var(--border-radius-md)',
                  background: 'var(--color-background-primary)',
                  color: 'var(--color-text-primary)',
                  fontFamily: 'inherit',
                  maxWidth: 280,
                }}
              >
                <option value="">{t('All frameworks', 'All frameworks')}</option>
                {data.frameworks.map((fw) => (
                  <option key={fw} value={fw}>{fw}</option>
                ))}
              </select>
            ) : null}
          </div>
        }
        right={
          <button
            onClick={() => void rederive()}
            disabled={rederiving}
            title={t(
              'Recompute likelihood (from how long each control has been failing) and impact (from control weight) across open auto-risks.',
              'Recompute likelihood (from how long each control has been failing) and impact (from control weight) across open auto-risks.',
            )}
            style={{
              fontSize: 12,
              background: 'var(--color-brand-blue)',
              color: '#fff',
              border: 'none',
              padding: '6px 12px',
              borderRadius: 'var(--border-radius-md)',
              cursor: rederiving ? 'default' : 'pointer',
              opacity: rederiving ? 0.6 : 1,
            }}
          >
            {rederiving ? t('Re-deriving…', 'Re-deriving…') : t('Re-derive axes', 'Re-derive axes')}
          </button>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {notice ? <Banner tone="info">{notice}</Banner> : null}

        <Banner tone="info" title={t('What this page is', 'What this page is')}>
          {t(
            "ISO 31000 / DORA Art.6 risk visualisation. Rows are likelihood (bottom-up); columns are impact (left-right). The top-right cell is the highest exposure (critical likelihood × critical impact = score 16). Counts are open + in_treatment risks only; closed and accepted are out of this view. Click a non-zero cell to see the risks behind the number.",
            "ISO 31000 / DORA Art.6 risk visualisation. Rows are likelihood (bottom-up); columns are impact (left-right). The top-right cell is the highest exposure (critical likelihood × critical impact = score 16). Counts are open + in_treatment risks only; closed and accepted are out of this view. Click a non-zero cell to see the risks behind the number.",
          )}
        </Banner>

        {loading ? (
          <Skeleton lines={6} height={48} />
        ) : !data ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No data', 'No data')}</div>
        ) : (
          <Card style={{ marginTop: 12 }}>
            <CardTitle>{t('Likelihood × Impact', 'Likelihood × Impact')}</CardTitle>
            <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(4, 1fr)', gap: 2, marginTop: 12 }}>
              {/* top-left empty corner */}
              <div />
              {/* impact header — left to right: low → critical */}
              {data.impact_order.map((im) => (
                <div key={`h:${im}`} style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '6px 0', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  {im}
                </div>
              ))}
              {/* rows: top-down = critical → low */}
              {[...data.likelihood_order].reverse().map((l) => (
                <RowSliver key={`r:${l}`} likelihood={l} impacts={data.impact_order} cellMap={cellMap} selected={selected} setSelected={setSelected} t={t} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              <span>{t('Legend', 'Legend')}:</span>
              <LegendChip color="var(--color-status-green-mid)" label="1-2" />
              <LegendChip color="var(--color-status-amber-mid)" label="3-6" />
              <LegendChip color="var(--color-status-red-mid)" label="8-12" />
              <LegendChip color="#7e1d1d" label="16" />
              <span style={{ marginLeft: 'auto' }}>{t('Score = likelihood × impact', 'Score = likelihood × impact')} (1..16)</span>
            </div>
          </Card>
        )}

        {selected && data ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle right={<button onClick={() => setSelected(null)} style={{ fontSize: 11, background: 'none', border: '0.5px solid var(--color-border-secondary)', color: 'var(--color-text-secondary)', padding: '4px 10px', borderRadius: 'var(--border-radius-md)', cursor: 'pointer' }}>{t('Close', 'Close')}</button>}>
              {t('Risks in', 'Risks in')} {selected}
            </CardTitle>
            {(() => {
              const cell = cellMap.get(selected)
              // Prefer the human-readable risks[] (title + framework + score);
              // fall back to opaque risk_ids only for older backends.
              const rows: HeatmapRisk[] =
                cell?.risks && cell.risks.length > 0
                  ? cell.risks
                  : (cell?.risk_ids || []).map((id) => ({ risk_id: id, score: cell?.score ?? 0 }))
              if (rows.length === 0) {
                return <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No risks in this cell.', 'No risks in this cell.')}</div>
              }
              return (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {rows.map((rk) => (
                    <li key={rk.risk_id} style={{ padding: '8px 0', borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <Link
                        href={`/risks/${encodeURIComponent(rk.risk_id)}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', color: 'var(--color-text-primary)', textDecoration: 'none', fontSize: 12 }}
                      >
                        <Badge tone={rk.score >= 12 ? 'red' : rk.score >= 6 ? 'amber' : 'gray'}>{rk.score}</Badge>
                        <span style={{ flex: '1 1 280px', minWidth: 220, color: 'var(--color-brand-blue)' }}>
                          {rk.title || rk.risk_id}
                        </span>
                        {rk.framework_name ? (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{rk.framework_name}</span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              )
            })()}
          </Card>
        ) : null}
      </div>
    </>
  )
}

function RowSliver({ likelihood, impacts, cellMap, selected, setSelected, t }: {
  likelihood: string
  impacts: string[]
  cellMap: Map<string, Cell>
  selected: string | null
  setSelected: (v: string | null) => void
  t: (k: string, fallback?: string) => string
}) {
  return (
    <>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', alignSelf: 'center', textTransform: 'uppercase', letterSpacing: 0.4 }}>{likelihood}</div>
      {impacts.map((im) => {
        const key = `${likelihood}|${im}`
        const c = cellMap.get(key)
        const count = c?.count ?? 0
        const score = c?.score ?? 0
        const isSelected = selected === key
        const tone = scoreColor(score)
        return (
          <button
            key={key}
            onClick={() => count > 0 && setSelected(isSelected ? null : key)}
            disabled={count === 0}
            style={{
              minHeight: 72,
              border: isSelected ? '2px solid var(--color-text-primary)' : '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-md)',
              background: count > 0 ? tone : 'transparent',
              color: count > 0 ? '#fff' : 'var(--color-text-tertiary)',
              cursor: count > 0 ? 'pointer' : 'default',
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: 'inherit',
            }}
            title={count > 0 ? t('Click for risk IDs', 'Click for risk IDs') : t('No risks in this cell', 'No risks in this cell')}
          >
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1 }}>{count}</div>
            <div style={{ fontSize: 9, marginTop: 4, opacity: 0.85, letterSpacing: 0.4 }}>score {score}</div>
          </button>
        )
      })}
    </>
  )
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <span style={{ width: 14, height: 10, background: color, borderRadius: 2, display: 'inline-block' }} />
      <span>{label}</span>
    </span>
  )
}

function scoreColor(score: number): string {
  if (score >= 16) return '#7e1d1d'
  if (score >= 8) return 'var(--color-status-red-mid)'
  if (score >= 3) return 'var(--color-status-amber-mid)'
  if (score >= 1) return 'var(--color-status-green-mid)'
  return 'transparent'
}
