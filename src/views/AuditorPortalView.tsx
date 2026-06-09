'use client';
// Auditor portal landing view. One page that combines:
//
//   * Identity strip — tenant + framework filter + token expiry
//   * Executive summary (KPI tiles + per-framework narrative)
//   * Risk heatmap (4x4 likelihood × impact, click to drill)
//   * Audit pre-packet download button
//
// The auditor opened a magic link; they want answers, not a sidebar.
// Everything they need to start a walkthrough fits on one page.

import { useEffect, useMemo, useState } from 'react'

import {
  auditorApiFetch,
  captureAuditorTokenFromURL,
  readAuditorToken,
} from '../lib/auditorApi'

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
  severity?: string
  priority_score?: number
  cross_framework_count?: number
}

type ExecFramework = {
  framework_id: string
  framework_name?: string
  score: number
  status: string
  narrative_para1: string
  narrative_para2: string
  top_gaps: ExecGap[]
  yaml_version?: string
  yaml_sha256?: string
  evaluated_at?: string
}

type ExecResponse = {
  tenant_id: string
  framework_filter?: string
  generated_at: string
  kpis: ExecKPIs
  frameworks: ExecFramework[]
}

type HeatmapCell = {
  likelihood: string
  impact: string
  score: number
  count: number
  risk_ids?: string[]
}

type HeatmapResponse = {
  tenant_id: string
  likelihood_order: string[]
  impact_order: string[]
  cells: HeatmapCell[]
  total_open: number
}

export function AuditorPortalView() {
  const [tokenStatus, setTokenStatus] = useState<'pending' | 'ok' | 'missing'>('pending')
  const [exec, setExec] = useState<ExecResponse | null>(null)
  const [heatmap, setHeatmap] = useState<HeatmapResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    captureAuditorTokenFromURL()
    const token = readAuditorToken()
    if (!token) {
      setTokenStatus('missing')
      setLoading(false)
      return
    }
    setTokenStatus('ok')

    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [er, hr] = await Promise.all([
          auditorApiFetch('/audit/executive-summary'),
          auditorApiFetch('/risks/heatmap'),
        ])
        if (!er.ok) {
          if (er.status === 401 || er.status === 403) {
            throw new Error('Token rejected — it may have expired or been revoked. Ask for a fresh link.')
          }
          throw new Error(`Executive summary: ${er.status} ${er.statusText}`)
        }
        const execBody = (await er.json()) as ExecResponse
        if (cancelled) return
        setExec(execBody)
        if (hr.ok) {
          const hmBody = (await hr.json()) as HeatmapResponse
          if (!cancelled) setHeatmap(hmBody)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load auditor view')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  async function downloadPrepacket() {
    const r = await auditorApiFetch('/audit/prepacket')
    if (!r.ok) {
      setError(`Pre-packet download failed: ${r.status} ${r.statusText}`)
      return
    }
    const blob = await r.blob()
    const cd = r.headers.get('Content-Disposition') || ''
    const match = cd.match(/filename="?([^"]+)"?/)
    const filename = match?.[1] || `audit-prepacket-${new Date().toISOString().slice(0, 10)}.zip`
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const heatmapByKey = useMemo(() => {
    const m = new Map<string, HeatmapCell>()
    for (const c of heatmap?.cells || []) m.set(`${c.likelihood}|${c.impact}`, c)
    return m
  }, [heatmap])

  if (tokenStatus === 'missing') {
    return (
      <div style={{ padding: 32, maxWidth: 640, margin: '40px auto' }}>
        <h1 style={{ fontSize: 18, fontWeight: 600 }}>No token</h1>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
          This page requires a share-link token. Open the URL the platform admin sent you;
          it includes the token as a query parameter.
        </p>
      </div>
    )
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      {error ? (
        <div style={{ padding: 14, marginBottom: 16, background: 'var(--color-status-red-light)', color: 'var(--color-status-red-mid)', border: '0.5px solid var(--color-status-red-mid)', borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>Loading…</div>
      ) : !exec ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>No data</div>
      ) : (
        <>
          <section style={{ marginBottom: 18, padding: 16, background: 'var(--color-background-primary)', borderRadius: 8, border: '0.5px solid var(--color-border-secondary)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>Engagement</div>
                <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
                  Tenant: <code style={{ fontSize: 14, fontFamily: 'var(--font-mono, monospace)' }}>{exec.tenant_id}</code>
                  {exec.framework_filter ? <> · Scope: <code style={{ fontSize: 14 }}>{exec.framework_filter}</code></> : null}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                  Generated {exec.generated_at}
                </div>
              </div>
              <button
                onClick={() => { void downloadPrepacket() }}
                style={{
                  fontSize: 13,
                  padding: '10px 18px',
                  border: 'none',
                  borderRadius: 6,
                  background: 'var(--color-brand-blue)',
                  color: '#fff',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontWeight: 600,
                }}
              >
                Download signed audit pre-packet
              </button>
            </div>
          </section>

          <section style={{ marginBottom: 18 }}>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
              Headline KPIs
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10 }}>
              <KPI label="Composite risk score" value={`${(exec.kpis.composite_risk_score * 100).toFixed(1)}%`} sub={exec.kpis.composite_risk_status} tone={statusTone(exec.kpis.composite_risk_status)} />
              <KPI label="Critical open gaps" value={String(exec.kpis.open_critical_gaps)} tone={exec.kpis.open_critical_gaps > 0 ? 'red' : 'green'} />
              <KPI label="Overdue remediation" value={String(exec.kpis.open_overdue_tasks)} tone={exec.kpis.open_overdue_tasks > 0 ? 'amber' : 'green'} />
              <KPI label="Mean remediation" value={exec.kpis.mean_remediation_days > 0 ? `${exec.kpis.mean_remediation_days}d` : '—'} />
              <KPI label="Evidence freshness" value={`${exec.kpis.evidence_freshness_pct.toFixed(1)}%`} tone={exec.kpis.evidence_freshness_pct >= 80 ? 'green' : exec.kpis.evidence_freshness_pct >= 50 ? 'amber' : 'red'} />
            </div>
          </section>

          {heatmap && heatmap.cells.length > 0 ? (
            <section style={{ marginBottom: 18, padding: 16, background: 'var(--color-background-primary)', borderRadius: 8, border: '0.5px solid var(--color-border-secondary)' }}>
              <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                Risk heatmap · {heatmap.total_open} open
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(4, 1fr)', gap: 2 }}>
                <div />
                {heatmap.impact_order.map((im) => (
                  <div key={`h:${im}`} style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '6px 0', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    {im}
                  </div>
                ))}
                {[...heatmap.likelihood_order].reverse().map((l) => (
                  <HeatmapRow key={`r:${l}`} likelihood={l} impacts={heatmap.impact_order} cellMap={heatmapByKey} />
                ))}
              </div>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 10 }}>Open + in-treatment risks. Score = likelihood × impact (1..16).</div>
            </section>
          ) : null}

          <section>
            <h2 style={{ fontSize: 13, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
              Per-framework posture
            </h2>
            {exec.frameworks.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>No frameworks scored yet.</div>
            ) : (
              exec.frameworks.map((fw) => (
                <div key={fw.framework_id} style={{ marginTop: 12, padding: 16, background: 'var(--color-background-primary)', borderRadius: 8, border: '0.5px solid var(--color-border-secondary)' }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{fw.framework_name || fw.framework_id.toUpperCase()}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18, fontWeight: 600 }}>{(fw.score * 100).toFixed(1)}%</span>
                      <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: statusBg(fw.status), color: statusFg(fw.status), fontWeight: 600, textTransform: 'uppercase' }}>{fw.status}</span>
                    </div>
                  </div>
                  <p style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{fw.narrative_para1}</p>
                  <p style={{ fontSize: 13, marginTop: 6, lineHeight: 1.5 }}>{fw.narrative_para2}</p>
                  {fw.top_gaps.length > 0 ? (
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 10 }}>
                      <thead>
                        <tr style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textAlign: 'left' }}>
                          <th style={{ padding: '4px 8px', fontWeight: 500 }}>Severity</th>
                          <th style={{ padding: '4px 8px', fontWeight: 500 }}>Control</th>
                          <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>Priority</th>
                          <th style={{ padding: '4px 8px', fontWeight: 500 }}>Leverage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fw.top_gaps.map((g, i) => (
                          <tr key={g.control_id} style={{ borderTop: i ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                            <td style={{ padding: '6px 8px' }}>
                              <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: severityBg(g.severity), color: severityFg(g.severity), fontWeight: 600, textTransform: 'uppercase' }}>{g.severity || '—'}</span>
                            </td>
                            <td style={{ padding: '6px 8px' }}>
                              <code style={{ fontSize: 11 }}>{g.control_id}</code>
                              {g.control_name ? <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{g.control_name}</div> : null}
                            </td>
                            <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                              {typeof g.priority_score === 'number' ? g.priority_score.toFixed(2) : '—'}
                            </td>
                            <td style={{ padding: '6px 8px', fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                              {(g.cross_framework_count || 0) > 0 ? `+${g.cross_framework_count} frameworks` : 'Single-framework'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                  {fw.yaml_sha256 ? (
                    <div style={{ marginTop: 10, fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                      Control set: {fw.yaml_version ? `v${fw.yaml_version} · ` : ''}sha256:{fw.yaml_sha256.slice(0, 8)}…{fw.yaml_sha256.slice(-8)}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  )
}

function KPI({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'green' | 'amber' | 'red' | 'gray' }) {
  const palette: Record<NonNullable<typeof tone>, string> = {
    green: 'var(--color-status-green-mid)',
    amber: 'var(--color-status-amber-mid)',
    red: 'var(--color-status-red-mid)',
    gray: 'var(--color-text-tertiary)',
  }
  const color = palette[tone || 'gray']
  return (
    <div style={{ padding: 14, background: 'var(--color-background-primary)', borderRadius: 8, border: '0.5px solid var(--color-border-secondary)' }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1, color, marginTop: 2 }}>{value}</div>
      {sub ? <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{sub}</div> : null}
    </div>
  )
}

function HeatmapRow({ likelihood, impacts, cellMap }: {
  likelihood: string
  impacts: string[]
  cellMap: Map<string, HeatmapCell>
}) {
  return (
    <>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', alignSelf: 'center', textTransform: 'uppercase', letterSpacing: 0.4 }}>{likelihood}</div>
      {impacts.map((im) => {
        const c = cellMap.get(`${likelihood}|${im}`)
        const count = c?.count ?? 0
        const score = c?.score ?? 0
        return (
          <div
            key={`${likelihood}|${im}`}
            style={{
              minHeight: 64,
              borderRadius: 6,
              background: count > 0 ? heatmapTone(score) : 'transparent',
              color: count > 0 ? '#fff' : 'var(--color-text-tertiary)',
              border: count > 0 ? 'none' : '0.5px dashed var(--color-border-tertiary)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 6,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700 }}>{count}</div>
            <div style={{ fontSize: 9, opacity: 0.85 }}>score {score}</div>
          </div>
        )
      })}
    </>
  )
}

function heatmapTone(score: number): string {
  if (score >= 16) return '#7e1d1d'
  if (score >= 8) return 'var(--color-status-red-mid)'
  if (score >= 3) return 'var(--color-status-amber-mid)'
  if (score >= 1) return 'var(--color-status-green-mid)'
  return 'transparent'
}

function statusTone(status: string): 'green' | 'amber' | 'red' | 'gray' {
  switch ((status || '').toUpperCase()) {
    case 'PASS': return 'green'
    case 'REVIEW': return 'amber'
    case 'WARN': return 'amber'
    case 'FAIL': return 'red'
    default: return 'gray'
  }
}

function statusBg(status: string): string {
  switch ((status || '').toUpperCase()) {
    case 'PASS': return 'var(--color-status-green-light)'
    case 'REVIEW':
    case 'WARN': return 'var(--color-status-amber-light)'
    case 'FAIL': return 'var(--color-status-red-light)'
    default: return 'var(--color-background-secondary)'
  }
}

function statusFg(status: string): string {
  switch ((status || '').toUpperCase()) {
    case 'PASS': return 'var(--color-status-green-mid)'
    case 'REVIEW':
    case 'WARN': return 'var(--color-status-amber-mid)'
    case 'FAIL': return 'var(--color-status-red-mid)'
    default: return 'var(--color-text-tertiary)'
  }
}

function severityBg(severity?: string): string {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
    case 'high': return 'var(--color-status-red-light)'
    case 'medium': return 'var(--color-status-amber-light)'
    case 'low': return 'var(--color-status-green-light)'
    default: return 'var(--color-background-secondary)'
  }
}

function severityFg(severity?: string): string {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
    case 'high': return 'var(--color-status-red-mid)'
    case 'medium': return 'var(--color-status-amber-mid)'
    case 'low': return 'var(--color-status-green-mid)'
    default: return 'var(--color-text-tertiary)'
  }
}
