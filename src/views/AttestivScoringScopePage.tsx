'use client';
// Scope-filtered scoring page.
//
// Operator picks scope_type (application | site | vm) + scope_id,
// hits Evaluate, sees framework scores computed against ONLY that
// scope's evidence pool. Mirrors what an auditor actually wants:
//
//   "Show me PCI for the CDE" / "Show me GxP for SAP" /
//   "Show me NIS2 for the Paris datacenter"
//
// Tenant-rollup blends everything; per-scope honestly attributes.

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type ScopeType = 'application' | 'site' | 'vm'

type ScopeOption = {
  id: string
  label: string
  description?: string
}

type ScopeResult = {
  scope_type: ScopeType
  scope_id: string
  members_in_scope: number
  evidence_count: number
  frameworks_evaluated: number
  results: FrameworkSummary[]
}

type FrameworkSummary = {
  framework_id: string
  framework_name?: string
  score: number
  status: string
  total_controls: number
  passing_controls: number
  review_controls: number
  warn_controls: number
  fail_controls: number
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  PASS: 'green',
  REVIEW: 'amber',
  WARN: 'amber',
  FAIL: 'red',
}

export function AttestivScoringScopePage() {
  const { t } = useI18n()

  const [scopeType, setScopeType] = useState<ScopeType>('application')
  const [scopeID, setScopeID] = useState<string>('')
  const [options, setOptions] = useState<ScopeOption[]>([])
  const [loading, setLoading] = useState(false)
  const [evaluating, setEvaluating] = useState(false)
  const [result, setResult] = useState<ScopeResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // When scope_type changes, reload the matching options list and
  // clear the selected id.
  useEffect(() => {
    let cancelled = false
    async function load() {
      setError(null)
      setLoading(true)
      setOptions([])
      setScopeID('')
      try {
        if (scopeType === 'application') {
          const response = await apiFetch('/apps')
          const body = await response.json().catch(() => ({}))
          if (!cancelled && response.ok) {
            const items: ScopeOption[] = (Array.isArray(body?.items) ? body.items : []).map(
              (a: any) => ({
                id: String(a.application_id ?? ''),
                label: String(a.display_name ?? a.application_id ?? ''),
                description: a.gxp?.validated ? 'GxP-validated' : undefined,
              }),
            )
            setOptions(items)
          }
        } else if (scopeType === 'site') {
          const response = await apiFetch('/sites')
          const body = await response.json().catch(() => ({}))
          if (!cancelled && response.ok) {
            const items: ScopeOption[] = (Array.isArray(body?.items) ? body.items : []).map(
              (s: any) => ({
                id: String(s.site_id ?? s.id ?? ''),
                label: String(s.display_name ?? s.name ?? s.site_id ?? ''),
              }),
            )
            // Augment with raw datacenter_id values from inventory so
            // sites that exist as labels on assets but aren't in the
            // site registry still show up.
            const invResp = await apiFetch('/inventory/assets?limit=0')
            const invBody = await invResp.json().catch(() => ({}))
            if (Array.isArray(invBody?.items)) {
              const seen = new Set(items.map((o) => o.id))
              for (const asset of invBody.items) {
                const dc = String(asset?.datacenter_id ?? '').trim()
                if (dc && !seen.has(dc)) {
                  items.push({ id: dc, label: dc })
                  seen.add(dc)
                }
              }
            }
            if (!cancelled) setOptions(items)
          }
        } else if (scopeType === 'vm') {
          const response = await apiFetch('/inventory/assets?limit=0')
          const body = await response.json().catch(() => ({}))
          if (!cancelled && response.ok) {
            const items: ScopeOption[] = (Array.isArray(body?.items) ? body.items : [])
              .filter((a: any) => String(a?.asset_type ?? '').toLowerCase() === 'vm')
              .map((a: any) => ({
                id: String(a.asset_id ?? ''),
                label: String(a.name ?? a.asset_id ?? ''),
              }))
            setOptions(items)
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load scope options')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [scopeType])

  async function evaluate() {
    if (!scopeID) {
      setError(t('Pick a scope first.', 'Pick a scope first.'))
      return
    }
    setEvaluating(true)
    setError(null)
    try {
      const response = await apiFetch('/scoring/evaluate-scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope_type: scopeType,
          scope_id: scopeID,
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
      }
      setResult(body as ScopeResult)
    } catch (err: any) {
      setError(err?.message ?? 'Evaluation failed')
      setResult(null)
    } finally {
      setEvaluating(false)
    }
  }

  const sortedResults = useMemo(() => {
    if (!result?.results) return []
    return [...result.results].sort((a, b) => a.framework_id.localeCompare(b.framework_id))
  }, [result])

  return (
    <>
      <Topbar title={t('Per-scope compliance', 'Per-scope compliance')} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 0 24px' }}>
        <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', margin: 0 }}>
          {t(
            'Evaluate framework scores against a single application, site, or VM. Mirrors how auditors actually evaluate compliance: per-system for GxP, per-CDE for PCI, per-service for DORA.',
            'Evaluate framework scores against a single application, site, or VM. Mirrors how auditors actually evaluate compliance: per-system for GxP, per-CDE for PCI, per-service for DORA.',
          )}
        </p>

        <Card>
          <CardTitle>{t('Scope', 'Scope')}</CardTitle>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span style={{ color: 'var(--color-text-tertiary)' }}>{t('Scope type', 'Scope type')}</span>
              <select
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value as ScopeType)}
                style={selectStyle}
              >
                <option value="application">{t('Application', 'Application')}</option>
                <option value="site">{t('Site / Datacenter', 'Site / Datacenter')}</option>
                <option value="vm">{t('Single VM', 'Single VM')}</option>
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, flex: 1, minWidth: 280 }}>
              <span style={{ color: 'var(--color-text-tertiary)' }}>
                {t('Scope target', 'Scope target')} {loading && <span>· {t('loading…', 'loading…')}</span>}
              </span>
              <select
                value={scopeID}
                onChange={(e) => setScopeID(e.target.value)}
                disabled={loading || options.length === 0}
                style={selectStyle}
              >
                <option value="">
                  {options.length === 0
                    ? t('No options available', 'No options available')
                    : t('Pick one…', 'Pick one…')}
                </option>
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                    {o.id !== o.label ? ` (${o.id})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <PrimaryButton onClick={() => void evaluate()} disabled={!scopeID || evaluating}>
              {evaluating ? t('Evaluating…', 'Evaluating…') : t('Evaluate', 'Evaluate')}
            </PrimaryButton>
          </div>
        </Card>

        {error && <Banner tone="error">{error}</Banner>}

        {result && (
          <>
            <Card>
              <CardTitle>{t('Scope summary', 'Scope summary')}</CardTitle>
              <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8, fontSize: 13 }}>
                <SummaryStat
                  label={t('Members in scope', 'Members in scope')}
                  value={String(result.members_in_scope)}
                />
                <SummaryStat
                  label={t('Evidence records', 'Evidence records')}
                  value={String(result.evidence_count)}
                />
                <SummaryStat
                  label={t('Frameworks evaluated', 'Frameworks evaluated')}
                  value={String(result.frameworks_evaluated)}
                />
                <SummaryStat
                  label={t('Scope', 'Scope')}
                  value={`${result.scope_type}: ${result.scope_id}`}
                />
              </div>
            </Card>

            <Card>
              <CardTitle>{t('Per-framework score', 'Per-framework score')}</CardTitle>
              {sortedResults.length === 0 ? (
                <EmptyState
                  icon="ti-chart-bar"
                  title={t('No framework results', 'No framework results')}
                  description={t(
                    'The scoring engine returned no per-framework results for this scope.',
                    'The scoring engine returned no per-framework results for this scope.',
                  )}
                />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '6px 10px 6px 0' }}>{t('Framework', 'Framework')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Score', 'Score')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Status', 'Status')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Pass', 'Pass')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Review', 'Review')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Warn', 'Warn')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Fail', 'Fail')}</th>
                      <th style={{ padding: '6px 0 6px 10px' }}>{t('Total', 'Total')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedResults.map((f) => (
                      <tr key={f.framework_id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                        <td style={{ padding: '8px 10px 8px 0' }}>
                          <div style={{ fontWeight: 500 }}>{f.framework_name || f.framework_id}</div>
                          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{f.framework_id}</div>
                        </td>
                        <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>
                          {(f.score * 100).toFixed(1)}%
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <Badge tone={STATUS_TONE[f.status] ?? 'gray'}>{f.status}</Badge>
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--color-text-success, #2a8050)' }}>{f.passing_controls}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--color-text-warn, #c08a30)' }}>{f.review_controls}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--color-text-warn, #c08a30)' }}>{f.warn_controls}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--color-text-danger, #b53b3b)' }}>{f.fail_controls}</td>
                        <td style={{ padding: '8px 0 8px 10px' }}>{f.total_controls}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </>
        )}

        {!result && !error && !evaluating && (
          <Card>
            <EmptyState
              icon="ti-zoom-scan"
              title={t('Pick a scope, then Evaluate', 'Pick a scope, then Evaluate')}
              description={t(
                'Choose an application, site, or VM and press Evaluate. The engine will compute scores against only that scope\'s evidence — the same answer an auditor wants for that specific system.',
                'Choose an application, site, or VM and press Evaluate. The engine will compute scores against only that scope\'s evidence — the same answer an auditor wants for that specific system.',
              )}
            />
          </Card>
        )}
      </div>
    </>
  )
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{value}</span>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 4,
  border: '0.5px solid var(--color-border-tertiary)',
  background: 'var(--color-surface-primary)',
  fontSize: 13,
  minWidth: 160,
}
