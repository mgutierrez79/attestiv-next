'use client';
// Audit ▸ Executive summary — the "show this to the board" view.
//
// 5 KPI tiles at the top, framework narrative cards below, score
// trend sparkline per framework. The exact data the audit pre-packet
// PDF carries as its front section, rendered live so a CISO can
// screenshot it for the risk committee.

import { useEffect, useState } from 'react'
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

type ExecKPIs = {
  composite_risk_score: number
  composite_risk_status: string
  open_critical_gaps: number
  open_overdue_tasks: number
  mean_remediation_days: number
  evidence_freshness_pct: number
}

type ExecGap = {
  control_id: string
  control_name?: string
  status: string
  weight: number
  finding_code?: string
  severity?: string
  priority_score?: number
  cross_framework_count?: number
  cross_frameworks?: string[]
}

type TrendPoint = { timestamp: string; score: number; status: string }

type ExecFramework = {
  framework_id: string
  framework_name?: string
  score: number
  // posture_pct = passing / regulation_total — the dashboard's
  // framework-posture metric. The card leads with this so the exec summary
  // and the main dashboard show the same number; `score` is the measured
  // posture over the evaluated subset, shown as a secondary figure.
  posture_pct?: number
  status: string
  yaml_version?: string
  yaml_sha256?: string
  narrative_para1: string
  narrative_para2: string
  top_gaps: ExecGap[]
  twelve_month_trend?: TrendPoint[]
  evaluated_at?: string
}

type ExecResponse = {
  tenant_id: string
  framework_filter?: string
  generated_at: string
  kpis: ExecKPIs
  frameworks: ExecFramework[]
}

export function AttestivExecutiveSummaryPage() {
  const { t } = useI18n()
  const [data, setData] = useState<ExecResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [framework, setFramework] = useState('')

  async function load(filter: string) {
    setLoading(true)
    setError(null)
    try {
      const q = filter ? `?framework=${encodeURIComponent(filter)}` : ''
      const r = await apiFetch('/audit/executive-summary' + q)
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      setData((await r.json()) as ExecResponse)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load executive summary')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load(framework) }, [framework])

  const kpiTone = (status: string): 'green' | 'amber' | 'red' | 'gray' => {
    switch ((status || '').toUpperCase()) {
      case 'PASS': return 'green'
      case 'REVIEW': return 'amber'
      case 'WARN': return 'amber'
      case 'FAIL': return 'red'
      default: return 'gray'
    }
  }

  // severityTone maps the prioritizer's canonical severity buckets to
  // the same badge palette the rest of the audit surface uses. Keep
  // the buckets in sync with scoring.PriorityForWeight.
  const severityTone = (severity?: string): 'green' | 'amber' | 'red' | 'gray' => {
    switch ((severity || '').toLowerCase()) {
      case 'critical': return 'red'
      case 'high': return 'red'
      case 'medium': return 'amber'
      case 'low': return 'green'
      default: return 'gray'
    }
  }

  return (
    <>
      <Topbar
        title={t('Executive summary', 'Executive summary')}
        left={data ? (
          <Badge tone={kpiTone(data.kpis.composite_risk_status)}>
            {data.kpis.composite_risk_status || '—'}
          </Badge>
        ) : null}
        right={
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value)}
            style={{
              fontSize: 12,
              padding: '4px 10px',
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)',
              fontFamily: 'inherit',
            }}
          >
            <option value="">{t('All frameworks', 'All frameworks')}</option>
            {(data?.frameworks || []).map((fw) => (
              <option key={fw.framework_id} value={fw.framework_id}>{fw.framework_name || fw.framework_id}</option>
            ))}
          </select>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Banner tone="info" title={t('What this page is', 'What this page is')}>
          {t(
            'The same executive narrative the audit pre-packet PDF carries as its front section, rendered live. Composite risk + 4 operational KPIs at the top; per-framework 2-paragraph narrative with the top-3 highest-leverage gaps and a 12-month score trend. Designed for a CISO screenshot or a board slide.',
            'The same executive narrative the audit pre-packet PDF carries as its front section, rendered live. Composite risk + 4 operational KPIs at the top; per-framework 2-paragraph narrative with the top-3 highest-leverage gaps and a 12-month score trend. Designed for a CISO screenshot or a board slide.',
          )}
        </Banner>

        {loading ? (
          <Skeleton lines={10} height={32} />
        ) : !data ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {t('No data', 'No data')}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
              <KPI label={t('Composite risk score', 'Composite risk score')} value={`${(data.kpis.composite_risk_score * 100).toFixed(1)}%`} sub={data.kpis.composite_risk_status} tone={kpiTone(data.kpis.composite_risk_status)} icon="ti-gauge" />
              <KPI label={t('Critical open gaps', 'Critical open gaps')} value={String(data.kpis.open_critical_gaps)} tone={data.kpis.open_critical_gaps > 0 ? 'red' : 'green'} icon="ti-alert-octagon" />
              <KPI label={t('Overdue remediation', 'Overdue remediation')} value={String(data.kpis.open_overdue_tasks)} tone={data.kpis.open_overdue_tasks > 0 ? 'amber' : 'green'} icon="ti-clock-exclamation" />
              <KPI label={t('Mean remediation time', 'Mean remediation time')} value={data.kpis.mean_remediation_days > 0 ? `${data.kpis.mean_remediation_days}d` : '—'} icon="ti-clock-bolt" />
              <KPI label={t('Evidence freshness', 'Evidence freshness')} value={`${data.kpis.evidence_freshness_pct.toFixed(1)}%`} tone={data.kpis.evidence_freshness_pct >= 80 ? 'green' : data.kpis.evidence_freshness_pct >= 50 ? 'amber' : 'red'} icon="ti-refresh" />
            </div>

            {data.frameworks.length === 0 ? (
              <Card style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  {t('No frameworks scored yet for this tenant.', 'No frameworks scored yet for this tenant.')}
                </div>
              </Card>
            ) : (
              data.frameworks.map((fw) => (
                <Card key={fw.framework_id} style={{ marginTop: 12 }}>
                  <CardTitle right={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Badge tone={kpiTone(fw.status)}>{fw.status || '—'}</Badge>
                      <span style={{ fontSize: 18, fontWeight: 600 }}>
                        {typeof fw.posture_pct === 'number'
                          ? `${Math.round(fw.posture_pct * 100)}%`
                          : `${(fw.score * 100).toFixed(1)}%`}
                      </span>
                      {typeof fw.posture_pct === 'number' && (
                        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                          {t('measured', 'measured')} {(fw.score * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  }>
                    {fw.framework_name || fw.framework_id.toUpperCase()}
                  </CardTitle>
                  <p style={{ fontSize: 13, color: 'var(--color-text-primary)', marginTop: 4, lineHeight: 1.5 }}>
                    {fw.narrative_para1}
                  </p>
                  <p style={{ fontSize: 13, color: 'var(--color-text-primary)', marginTop: 4, lineHeight: 1.5 }}>
                    {fw.narrative_para2}
                  </p>
                  {fw.top_gaps.length > 0 ? (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                        {t('Top gaps (ranked by priority)', 'Top gaps (ranked by priority)')}
                      </div>
                      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textAlign: 'left' }}>
                            <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Severity', 'Severity')}</th>
                            <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Control', 'Control')}</th>
                            <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Status', 'Status')}</th>
                            <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Priority', 'Priority')}</th>
                            <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Leverage', 'Leverage')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {fw.top_gaps.map((g, i) => (
                            <tr key={g.control_id} style={{ borderTop: i ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                              <td style={{ padding: '6px 8px' }}>
                                <Badge tone={severityTone(g.severity)}>{(g.severity || '—').toUpperCase()}</Badge>
                              </td>
                              <td style={{ padding: '6px 8px' }}>
                                <code style={{ fontSize: 11 }}>{g.control_id}</code>
                                {g.control_name ? <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{g.control_name}</div> : null}
                              </td>
                              <td style={{ padding: '6px 8px' }}><Badge tone={kpiTone(g.status)}>{g.status}</Badge></td>
                              <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                                {typeof g.priority_score === 'number' ? g.priority_score.toFixed(2) : '—'}
                              </td>
                              <td style={{ padding: '6px 8px', fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                                {(g.cross_framework_count || 0) > 0 ? (
                                  <span title={g.cross_frameworks?.join(', ')}>
                                    +{g.cross_framework_count} {t('framework(s)', 'framework(s)')}
                                  </span>
                                ) : (
                                  t('Single-framework', 'Single-framework')
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  {fw.twelve_month_trend && fw.twelve_month_trend.length > 1 ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>
                        {t('12-month score trend', '12-month score trend')}
                      </div>
                      <Sparkline points={fw.twelve_month_trend} />
                    </div>
                  ) : null}
                  {fw.yaml_sha256 ? (
                    <div style={{ marginTop: 12, fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                      {t('Control set', 'Control set')}: {fw.yaml_version ? `v${fw.yaml_version} · ` : ''}sha256:{fw.yaml_sha256.slice(0, 8)}…{fw.yaml_sha256.slice(-8)}
                    </div>
                  ) : null}
                </Card>
              ))
            )}
          </>
        )}
      </div>
    </>
  )
}

function KPI({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone?: 'green' | 'amber' | 'red' | 'gray'; icon: string }) {
  const palette: Record<NonNullable<typeof tone>, string> = {
    green: 'var(--color-status-green-mid)',
    amber: 'var(--color-status-amber-mid)',
    red: 'var(--color-status-red-mid)',
    gray: 'var(--color-text-tertiary)',
  }
  const color = palette[tone || 'gray']
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: `${color}1A`, display: 'flex', alignItems: 'center', justifyContent: 'center', color }}>
          <i className={`ti ${icon}`} aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 600, lineHeight: 1.1, color }}>{value}</div>
          {sub ? <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{sub}</div> : null}
        </div>
      </div>
    </Card>
  )
}

// Sparkline draws the 12-month trend as a tiny SVG polyline. Inline
// SVG so we don't drag in a chart library for what's effectively a
// 200x40 line. Each point is one historical scoring run.
function Sparkline({ points }: { points: TrendPoint[] }) {
  if (!points || points.length < 2) return null
  const w = 320
  const h = 48
  const xs = points.map((_, i) => (i / (points.length - 1)) * (w - 4) + 2)
  const ys = points.map((p) => h - 4 - p.score * (h - 8))
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  const first = points[0]
  const delta = (last.score - first.score) * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg width={w} height={h} style={{ flexShrink: 0 }}>
        <path d={d} fill="none" stroke="var(--color-brand-blue)" strokeWidth={1.5} />
        {xs.map((x, i) => (
          <circle key={i} cx={x} cy={ys[i]} r={1.5} fill="var(--color-brand-blue)" />
        ))}
      </svg>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        {points.length} data point{points.length === 1 ? '' : 's'} · Δ{delta >= 0 ? '+' : ''}{delta.toFixed(1)}pp
      </div>
    </div>
  )
}
