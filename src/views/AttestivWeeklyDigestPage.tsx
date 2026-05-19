'use client';
// Audit ▸ Weekly digest.
//
// "Since last Monday" view. Auto-comparison between the current
// scoring state and the most-recent historical FrameworkResult
// older than the configurable lookback window (default 7 days).
// Surfaces: headline sentence, per-framework score deltas, control
// flips (new failures + recoveries), remediation and risk in/out
// counts. No upload required — the diff machinery lives in stored
// history.

import { useEffect, useMemo, useState } from 'react'
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

type FrameworkRow = {
  framework_id: string
  framework_name: string
  current_score: number
  prior_score: number
  score_delta_pp: number
  current_status: string
  prior_status: string
  new_failures: number
  recovered_controls: number
}

type Flip = {
  framework_id: string
  control_id: string
  control_name: string
  prior_status: string
  now_status: string
}

type DigestResponse = {
  tenant_id: string
  days: number
  window_start: string
  window_end: string
  headline: string
  frameworks: FrameworkRow[]
  new_failures: Flip[]
  recovered_controls: Flip[]
  remediation: {
    opened_in_window: number
    resolved_in_window: number
    open_at_window_start: number
    open_now: number
    overdue_now: number
  }
  risks: {
    opened_in_window: number
    closed_in_window: number
    open_now: number
  }
}

export function AttestivWeeklyDigestPage() {
  const { t } = useI18n()
  const [data, setData] = useState<DigestResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(7)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const r = await apiFetch(`/audit/weekly-digest?days=${days}`)
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        const body = (await r.json()) as DigestResponse
        if (!cancelled) setData(body)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load weekly digest')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [days])

  const deltaTone = (pp: number): 'green' | 'amber' | 'red' | 'gray' => {
    if (pp > 1) return 'green'
    if (pp < -1) return 'red'
    if (pp !== 0) return 'amber'
    return 'gray'
  }

  const totals = useMemo(() => {
    if (!data) return null
    return {
      newFailures: data.new_failures.length,
      recovered: data.recovered_controls.length,
    }
  }, [data])

  return (
    <>
      <Topbar
        title={t('Weekly digest', 'Weekly digest')}
        right={
          <select
            value={days}
            onChange={(e) => setDays(parseInt(e.target.value, 10))}
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
            <option value={7}>{t('Last 7 days', 'Last 7 days')}</option>
            <option value={14}>{t('Last 14 days', 'Last 14 days')}</option>
            <option value={30}>{t('Last 30 days', 'Last 30 days')}</option>
            <option value={90}>{t('Last 90 days', 'Last 90 days')}</option>
          </select>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Banner tone="info" title={t('What this page is', 'What this page is')}>
          {t(
            'Operational delta view: what changed in the platform since the cutoff. Score delta per framework, control flips (PASS → FAIL or vice versa), tasks opened/closed, risks opened/closed. The same source data the audit pre-packet diff endpoint produces, but anchored to stored history instead of an uploaded baseline.',
            'Operational delta view: what changed in the platform since the cutoff. Score delta per framework, control flips (PASS → FAIL or vice versa), tasks opened/closed, risks opened/closed. The same source data the audit pre-packet diff endpoint produces, but anchored to stored history instead of an uploaded baseline.',
          )}
        </Banner>

        {loading ? (
          <Skeleton lines={8} height={32} />
        ) : !data ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No data', 'No data')}</div>
        ) : (
          <>
            <Card style={{ marginTop: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>
                {data.headline}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                {t('Window', 'Window')}: {data.window_start} → {data.window_end}
              </div>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
              <KPI label={t('New control failures', 'New control failures')} value={String(totals?.newFailures ?? 0)} tone={(totals?.newFailures ?? 0) > 0 ? 'red' : 'green'} icon="ti-alert-octagon" />
              <KPI label={t('Controls recovered', 'Controls recovered')} value={String(totals?.recovered ?? 0)} tone={(totals?.recovered ?? 0) > 0 ? 'green' : 'gray'} icon="ti-arrow-up-right" />
              <KPI label={t('Tasks opened', 'Tasks opened')} value={String(data.remediation.opened_in_window)} icon="ti-checklist" />
              <KPI label={t('Tasks closed', 'Tasks closed')} value={String(data.remediation.resolved_in_window)} tone="green" icon="ti-check" />
              <KPI label={t('Overdue tasks', 'Overdue tasks')} value={String(data.remediation.overdue_now)} tone={data.remediation.overdue_now > 0 ? 'red' : 'green'} icon="ti-clock-exclamation" />
              <KPI label={t('Risks opened', 'Risks opened')} value={String(data.risks.opened_in_window)} icon="ti-alert-triangle" />
              <KPI label={t('Risks closed', 'Risks closed')} value={String(data.risks.closed_in_window)} tone="green" icon="ti-check" />
            </div>

            <Card style={{ marginTop: 12 }}>
              <CardTitle>{t('Framework score deltas', 'Framework score deltas')}</CardTitle>
              {data.frameworks.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No frameworks scored yet.', 'No frameworks scored yet.')}</div>
              ) : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
                  <thead>
                    <tr style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textAlign: 'left' }}>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Framework', 'Framework')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Prior', 'Prior')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Current', 'Current')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Δ', 'Δ')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Status', 'Status')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('New fails', 'New fails')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Recovered', 'Recovered')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.frameworks.map((f, i) => (
                      <tr key={f.framework_id} style={{ borderTop: i ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <Link href={`/scoring/trend/${encodeURIComponent(f.framework_id)}`} style={{ color: 'var(--color-brand-blue)' }}>
                            {f.framework_name || f.framework_id.toUpperCase()}
                          </Link>
                        </td>
                        <td style={cellStyle()}>{f.prior_score > 0 ? `${(f.prior_score * 100).toFixed(1)}%` : '—'}</td>
                        <td style={cellStyle()}>{(f.current_score * 100).toFixed(1)}%</td>
                        <td style={{ ...cellStyle(), color: deltaColor(f.score_delta_pp), fontWeight: 600 }}>
                          {f.prior_score > 0 ? `${f.score_delta_pp >= 0 ? '+' : ''}${f.score_delta_pp.toFixed(1)}pp` : '—'}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          {f.prior_status && f.prior_status !== f.current_status ? (
                            <span style={{ fontSize: 10 }}>
                              <Badge tone="gray">{f.prior_status}</Badge>
                              {' → '}
                              <Badge tone={deltaTone(f.score_delta_pp)}>{f.current_status}</Badge>
                            </span>
                          ) : (
                            <Badge tone="gray">{f.current_status}</Badge>
                          )}
                        </td>
                        <td style={cellStyle()}>{f.new_failures > 0 ? <span style={{ color: 'var(--color-status-red-mid)', fontWeight: 600 }}>{f.new_failures}</span> : '—'}</td>
                        <td style={cellStyle()}>{f.recovered_controls > 0 ? <span style={{ color: 'var(--color-status-green-mid)', fontWeight: 600 }}>{f.recovered_controls}</span> : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            {data.new_failures.length > 0 ? (
              <Card style={{ marginTop: 12 }}>
                <CardTitle>{t('New control failures', 'New control failures')} <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>({data.new_failures.length})</span></CardTitle>
                <FlipsList flips={data.new_failures} t={t} />
              </Card>
            ) : null}

            {data.recovered_controls.length > 0 ? (
              <Card style={{ marginTop: 12 }}>
                <CardTitle>{t('Controls recovered', 'Controls recovered')} <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>({data.recovered_controls.length})</span></CardTitle>
                <FlipsList flips={data.recovered_controls} t={t} />
              </Card>
            ) : null}
          </>
        )}
      </div>
    </>
  )
}

function FlipsList({ flips, t }: { flips: Flip[]; t: (k: string, fallback?: string) => string }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {flips.map((f) => (
        <li key={`${f.framework_id}|${f.control_id}`} style={{ padding: '6px 0', borderTop: '0.5px solid var(--color-border-tertiary)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <Badge tone="navy">{f.framework_id.toUpperCase()}</Badge>
          <Link
            href={`/scoring/frameworks/${encodeURIComponent(f.framework_id)}/controls/${encodeURIComponent(f.control_id)}`}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-brand-blue)' }}
          >
            {f.control_id}
          </Link>
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{f.control_name}</span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-tertiary)' }}>
            <Badge tone="gray">{f.prior_status}</Badge>{' → '}<Badge tone={f.now_status === 'PASS' ? 'green' : 'red'}>{f.now_status}</Badge>
          </span>
        </li>
      ))}
    </ul>
  )
}

function KPI({ label, value, tone, icon }: { label: string; value: string; tone?: 'green' | 'amber' | 'red' | 'gray'; icon: string }) {
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
        </div>
      </div>
    </Card>
  )
}

function cellStyle(): React.CSSProperties {
  return { padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }
}

function deltaColor(pp: number): string {
  if (pp >= 1) return 'var(--color-status-green-mid)'
  if (pp <= -1) return 'var(--color-status-red-mid)'
  if (pp !== 0) return 'var(--color-status-amber-mid)'
  return 'var(--color-text-tertiary)'
}
