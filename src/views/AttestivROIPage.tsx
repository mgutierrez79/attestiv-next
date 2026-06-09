'use client';
// Audit ▸ ROI — financial posture derived from the platform's own
// data. Three audiences:
//
//   1. CISO presenting to the CFO / Board. The headline tiles are
//      what gets screenshot.
//   2. CFO due-diligence. Every formula is cited inline so the
//      methodology is auditable, not a black box.
//   3. Customer success in a QBR. The scenario simulator lets the
//      account team model "if you closed your top DORA gaps, here is
//      the financial swing" without leaving the console.
//
// Honesty rules baked into the surface:
//   - Insurance opportunity surfaces "data pending" until the
//     coverage signals are wired. We do not invent a number.
//   - Estimated badge fires when ANY financial input is a platform
//     default. The page stays usable in either case; the badge
//     prevents the customer from confusing "your data" with
//     "industry average."
//   - Breach risk is marked as the squishiest line and rendered
//     muted relative to the harder regulatory exposure numbers.

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  Skeleton,
  TextInput,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n'

type FrameworkExposure = {
  framework_id: string
  kind: 'regulatory_fine' | 'audit_remediation' | string
  max_exposure_eur: number
  current_exposure_eur: number
  citation: string
  assumption: string
}

type LaborAvoidance = {
  baseline_hours: number
  avoided_hours: number
  avoided_cost_eur: number
  evidence_completeness: number
  citation: string
  assumption: string
}

type DowntimeEstimate = {
  untested_rto_hours: number
  tested_rto_hours: number
  hours_saved_per_event: number
  annual_outage_probability: number
  avoided_cost_eur: number
  eligible: boolean
  citation: string
  assumption: string
}

type InsuranceOpportunity = {
  baseline_premium_eur: number
  discount_fraction: number
  avoided_cost_eur: number
  citation: string
  assumption: string
}

type BreachRiskEstimate = {
  baseline_expected_loss_eur: number
  current_expected_loss_eur: number
  avoided_cost_eur: number
  reduction_fraction: number
  citation: string
  assumption: string
}

type ROISummary = {
  tenant_id: string
  generated_at: string
  version: string
  estimated: boolean
  overall_compliance_score: number
  regulatory_exposure: FrameworkExposure[]
  audit_prep_labor: LaborAvoidance
  downtime_avoidance: DowntimeEstimate
  insurance_premium: InsuranceOpportunity
  breach_risk: BreachRiskEstimate
  total_annual_avoided_eur: number
  total_exposure_reduced_eur: number
}

type ScenarioResult = {
  baseline: ROISummary
  projected: ROISummary
  delta: { avoided_cost_delta_eur: number; exposure_reduction_delta_eur: number }
  applied: Array<{ framework_id: string; new_score: number }>
}

const EUR = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

function fmtEUR(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '€0'
  return EUR.format(Math.round(n))
}

function fmtPct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—'
  return `${(fraction * 100).toFixed(digits)}%`
}

export function AttestivROIPage() {
  const { t } = useI18n()
  const [summary, setSummary] = useState<ROISummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scenarioOverrides, setScenarioOverrides] = useState<Record<string, number>>({})
  const [scenarioResult, setScenarioResult] = useState<ScenarioResult | null>(null)
  const [scenarioBusy, setScenarioBusy] = useState(false)

  async function loadSummary() {
    setLoading(true)
    setError(null)
    try {
      const r = await apiFetch('/roi/summary')
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const body = (await r.json()) as ROISummary
      setSummary(body)
      // Seed scenario overrides at the current per-framework scores so
      // the sliders read "do nothing → no delta" by default.
      const seed: Record<string, number> = {}
      for (const e of body.regulatory_exposure || []) {
        const matchedScore = inferCurrentScore(body, e.framework_id)
        seed[e.framework_id] = matchedScore
      }
      setScenarioOverrides(seed)
      setScenarioResult(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ROI summary')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadSummary() }, [])

  async function runScenario() {
    if (!summary) return
    setScenarioBusy(true)
    setError(null)
    try {
      const overrides = Object.entries(scenarioOverrides).map(([framework_id, new_score]) => ({
        framework_id,
        new_score,
      }))
      const r = await apiFetch('/roi/scenario', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      setScenarioResult((await r.json()) as ScenarioResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run scenario')
    } finally {
      setScenarioBusy(false)
    }
  }

  function resetScenario() {
    if (!summary) return
    const seed: Record<string, number> = {}
    for (const e of summary.regulatory_exposure || []) {
      seed[e.framework_id] = inferCurrentScore(summary, e.framework_id)
    }
    setScenarioOverrides(seed)
    setScenarioResult(null)
  }

  const totalAvoided = scenarioResult?.projected.total_annual_avoided_eur ?? summary?.total_annual_avoided_eur ?? 0
  const totalExposureReduced = scenarioResult?.projected.total_exposure_reduced_eur ?? summary?.total_exposure_reduced_eur ?? 0
  const overall = scenarioResult?.projected.overall_compliance_score ?? summary?.overall_compliance_score ?? 0

  const deltaAvoided = scenarioResult?.delta.avoided_cost_delta_eur ?? 0
  const deltaExposure = scenarioResult?.delta.exposure_reduction_delta_eur ?? 0

  return (
    <>
      <Topbar
        title={t('Financial posture (ROI)', 'Financial posture (ROI)')}
        left={summary?.estimated ? (
          <Badge tone="amber">{t('estimated (defaults in use)', 'estimated (defaults in use)')}</Badge>
        ) : summary ? (
          <Badge tone="green">{t('tenant data', 'tenant data')}</Badge>
        ) : null}
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <GhostButton onClick={() => void loadSummary()} disabled={loading}>
              {t('Refresh', 'Refresh')}
            </GhostButton>
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Banner tone="info" title={t('What this page is', 'What this page is')}>
          {t(
            'A financial read of the same posture the rest of the platform reports on. Numbers are derived from THIS tenant\'s scoring, DR drills, and evidence completeness — combined with the financial profile under Settings ▸ Tenant. Every line cites its formula. Use the scenario simulator below to model what a posture improvement would change.',
            'A financial read of the same posture the rest of the platform reports on. Numbers are derived from THIS tenant\'s scoring, DR drills, and evidence completeness — combined with the financial profile under Settings ▸ Tenant. Every line cites its formula. Use the scenario simulator below to model what a posture improvement would change.',
          )}
        </Banner>

        {summary?.estimated ? (
          <Banner tone="warning" title={t('Industry defaults in use', 'Industry defaults in use')}>
            {t(
              'One or more financial inputs (revenue, hourly revenue, audit cost, premium) are platform defaults, not tenant data. The numbers still compute but represent a market midpoint. Set your real figures in Settings ▸ Tenant to remove the badge.',
              'One or more financial inputs (revenue, hourly revenue, audit cost, premium) are platform defaults, not tenant data. The numbers still compute but represent a market midpoint. Set your real figures in Settings ▸ Tenant to remove the badge.',
            )}
          </Banner>
        ) : null}

        {loading ? (
          <Skeleton lines={10} height={32} />
        ) : !summary ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {t('No data', 'No data')}
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
              <KPI
                label={t('Annual avoided cost', 'Annual avoided cost')}
                value={fmtEUR(totalAvoided)}
                sub={scenarioResult ? `Δ ${deltaAvoided >= 0 ? '+' : ''}${fmtEUR(deltaAvoided)}` : t('current posture', 'current posture')}
                tone="green"
                icon="ti-coin"
              />
              <KPI
                label={t('Regulatory exposure reduced', 'Regulatory exposure reduced')}
                value={fmtEUR(totalExposureReduced)}
                sub={scenarioResult ? `Δ ${deltaExposure >= 0 ? '+' : ''}${fmtEUR(deltaExposure)}` : t('vs. uncontrolled exposure', 'vs. uncontrolled exposure')}
                tone="navy"
                icon="ti-shield-half-filled"
              />
              <KPI
                label={t('Overall compliance score', 'Overall compliance score')}
                value={fmtPct(overall)}
                tone={overall >= 0.8 ? 'green' : overall >= 0.5 ? 'amber' : 'red'}
                icon="ti-gauge"
              />
              <KPI
                label={t('Methodology version', 'Methodology version')}
                value={`v${summary.version}`}
                sub={new Date(summary.generated_at).toLocaleString()}
                tone="gray"
                icon="ti-stamp"
              />
            </div>

            <Card style={{ marginTop: 12 }}>
              <CardTitle right={<Badge tone="navy">{t('per framework', 'per framework')}</Badge>}>
                {t('Regulatory exposure', 'Regulatory exposure')}
              </CardTitle>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                {t(
                  'Maximum and current expected exposure per framework. Regulatory-fine rows are hard caps published by the regulator (e.g. DORA Art. 50, NIS2 Art. 34). Audit-remediation rows are the cost band of a finding requiring rework, not a statutory fine.',
                  'Maximum and current expected exposure per framework. Regulatory-fine rows are hard caps published by the regulator (e.g. DORA Art. 50, NIS2 Art. 34). Audit-remediation rows are the cost band of a finding requiring rework, not a statutory fine.',
                )}
              </p>
              {(scenarioResult?.projected.regulatory_exposure ?? summary.regulatory_exposure).length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  {t('No frameworks scored for this tenant yet.', 'No frameworks scored for this tenant yet.')}
                </div>
              ) : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
                  <thead>
                    <tr style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textAlign: 'left' }}>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Framework', 'Framework')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Kind', 'Kind')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Max exposure', 'Max exposure')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Current exposure', 'Current exposure')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500, textAlign: 'right' }}>{t('Reduced', 'Reduced')}</th>
                      <th style={{ padding: '4px 8px', fontWeight: 500 }}>{t('Citation', 'Citation')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scenarioResult?.projected.regulatory_exposure ?? summary.regulatory_exposure).map((e, i) => (
                      <tr key={`${e.framework_id}-${i}`} style={{ borderTop: i ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <code style={{ fontSize: 11 }}>{e.framework_id.toUpperCase()}</code>
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <Badge tone={e.kind === 'regulatory_fine' ? 'red' : 'amber'}>
                            {e.kind === 'regulatory_fine' ? t('Statutory fine', 'Statutory fine') : t('Remediation', 'Remediation')}
                          </Badge>
                        </td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtEUR(e.max_exposure_eur)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtEUR(e.current_exposure_eur)}</td>
                        <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--color-status-green-mid)' }}>
                          {fmtEUR(Math.max(0, e.max_exposure_eur - e.current_exposure_eur))}
                        </td>
                        <td style={{ padding: '6px 8px', fontSize: 10, color: 'var(--color-text-tertiary)' }} title={e.assumption}>
                          {e.citation}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, marginTop: 12 }}>
              <FormulaCard
                title={t('Audit-prep labor avoided', 'Audit-prep labor avoided')}
                tone="green"
                headline={fmtEUR(summary.audit_prep_labor.avoided_cost_eur)}
                rows={[
                  [t('Baseline hours per year', 'Baseline hours per year'), summary.audit_prep_labor.baseline_hours.toFixed(0)],
                  [t('Hours avoided', 'Hours avoided'), summary.audit_prep_labor.avoided_hours.toFixed(0)],
                  [t('Evidence completeness', 'Evidence completeness'), fmtPct(summary.audit_prep_labor.evidence_completeness)],
                ]}
                citation={summary.audit_prep_labor.citation}
                assumption={summary.audit_prep_labor.assumption}
              />

              <FormulaCard
                title={t('Downtime avoidance (tested DR)', 'Downtime avoidance (tested DR)')}
                tone={summary.downtime_avoidance.eligible ? 'green' : 'gray'}
                headline={summary.downtime_avoidance.eligible ? fmtEUR(summary.downtime_avoidance.avoided_cost_eur) : t('Not yet eligible', 'Not yet eligible')}
                rows={summary.downtime_avoidance.eligible ? [
                  [t('Untested RTO baseline', 'Untested RTO baseline'), `${summary.downtime_avoidance.untested_rto_hours.toFixed(1)} h`],
                  [t('Tested RTO (your drill mean)', 'Tested RTO (your drill mean)'), `${summary.downtime_avoidance.tested_rto_hours.toFixed(1)} h`],
                  [t('Hours saved per outage', 'Hours saved per outage'), summary.downtime_avoidance.hours_saved_per_event.toFixed(1)],
                  [t('Annual outage probability', 'Annual outage probability'), fmtPct(summary.downtime_avoidance.annual_outage_probability)],
                ] : [
                  [t('Status', 'Status'), t('No successful restore drill on record', 'No successful restore drill on record')],
                ]}
                citation={summary.downtime_avoidance.citation}
                assumption={summary.downtime_avoidance.assumption}
              />

              <FormulaCard
                title={t('Cyber-insurance premium opportunity', 'Cyber-insurance premium opportunity')}
                tone={summary.insurance_premium.avoided_cost_eur > 0 ? 'green' : 'gray'}
                headline={summary.insurance_premium.avoided_cost_eur > 0 ? fmtEUR(summary.insurance_premium.avoided_cost_eur) : t('Data pending', 'Data pending')}
                rows={summary.insurance_premium.avoided_cost_eur > 0 ? [
                  [t('Baseline premium', 'Baseline premium'), fmtEUR(summary.insurance_premium.baseline_premium_eur)],
                  [t('Achievable discount', 'Achievable discount'), fmtPct(summary.insurance_premium.discount_fraction)],
                ] : [
                  [t('Status', 'Status'), t('Coverage signals (MFA / EDR / patch / backup) not yet wired', 'Coverage signals (MFA / EDR / patch / backup) not yet wired')],
                ]}
                citation={summary.insurance_premium.citation}
                assumption={summary.insurance_premium.assumption}
              />

              <FormulaCard
                title={t('Breach-risk avoided', 'Breach-risk avoided')}
                tone="gray"
                muted
                headline={fmtEUR(summary.breach_risk.avoided_cost_eur)}
                rows={[
                  [t('Baseline expected loss', 'Baseline expected loss'), fmtEUR(summary.breach_risk.baseline_expected_loss_eur)],
                  [t('Current expected loss', 'Current expected loss'), fmtEUR(summary.breach_risk.current_expected_loss_eur)],
                  [t('Reduction', 'Reduction'), fmtPct(summary.breach_risk.reduction_fraction)],
                ]}
                citation={summary.breach_risk.citation}
                assumption={summary.breach_risk.assumption}
                footer={t(
                  'Most actuarial of the four lines — treat as directional, not invoiceable.',
                  'Most actuarial of the four lines — treat as directional, not invoiceable.',
                )}
              />
            </div>

            <Card style={{ marginTop: 12 }}>
              <CardTitle right={
                <div style={{ display: 'flex', gap: 6 }}>
                  <GhostButton onClick={resetScenario} disabled={scenarioBusy}>
                    {t('Reset', 'Reset')}
                  </GhostButton>
                  <PrimaryButton onClick={() => void runScenario()} disabled={scenarioBusy}>
                    {scenarioBusy ? t('Modeling…', 'Modeling…') : t('Run scenario', 'Run scenario')}
                  </PrimaryButton>
                </div>
              }>
                {t('Scenario simulator', 'Scenario simulator')}
              </CardTitle>
              <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                {t(
                  'Project a posture improvement framework-by-framework and see the financial swing. The simulator overrides framework scores; the engine recomputes every line above. This is the right altitude for a CFO conversation — "what does our DORA score going from X to Y do to the exposure number?"',
                  'Project a posture improvement framework-by-framework and see the financial swing. The simulator overrides framework scores; the engine recomputes every line above. This is the right altitude for a CFO conversation — "what does our DORA score going from X to Y do to the exposure number?"',
                )}
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginTop: 8 }}>
                {summary.regulatory_exposure.map((e) => (
                  <ScoreSlider
                    key={e.framework_id}
                    frameworkID={e.framework_id}
                    current={inferCurrentScore(summary, e.framework_id)}
                    value={scenarioOverrides[e.framework_id] ?? 0}
                    onChange={(v) => setScenarioOverrides((s) => ({ ...s, [e.framework_id]: v }))}
                  />
                ))}
              </div>
              {scenarioResult ? (
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  {t('Projected vs. baseline', 'Projected vs. baseline')}: <strong>{deltaAvoided >= 0 ? '+' : ''}{fmtEUR(deltaAvoided)}</strong> {t('annual avoided cost', 'annual avoided cost')}, <strong>{deltaExposure >= 0 ? '+' : ''}{fmtEUR(deltaExposure)}</strong> {t('exposure reduced', 'exposure reduced')}.
                </div>
              ) : null}
            </Card>

            <Card style={{ marginTop: 12 }}>
              <CardTitle>{t('Methodology and sources', 'Methodology and sources')}</CardTitle>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
                <li>{summary.regulatory_exposure[0]?.citation ?? t('Regulatory citation pending — no frameworks scored yet', 'Regulatory citation pending — no frameworks scored yet')}</li>
                <li>{summary.audit_prep_labor.citation}</li>
                <li>{summary.downtime_avoidance.citation}</li>
                <li>{summary.insurance_premium.citation}</li>
                <li>{summary.breach_risk.citation}</li>
              </ul>
              <p style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {t(
                  `Methodology v${summary.version}. Industry defaults (DORA cap, IBM breach cost, Uptime outage probability) are conservative midpoints sourced from the citations above. Any number derived from a platform default is flagged with the "estimated" badge at the top of the page.`,
                  `Methodology v${summary.version}. Industry defaults (DORA cap, IBM breach cost, Uptime outage probability) are conservative midpoints sourced from the citations above. Any number derived from a platform default is flagged with the "estimated" badge at the top of the page.`,
                )}
              </p>
            </Card>
          </>
        )}
      </div>
    </>
  )
}

function inferCurrentScore(summary: ROISummary, frameworkID: string): number {
  // The regulatory_exposure row already encodes (current = max × (1-score)).
  // Recover the score so the scenario slider starts at "today."
  for (const e of summary.regulatory_exposure) {
    if (e.framework_id === frameworkID) {
      if (e.max_exposure_eur <= 0) return 0
      const inferred = 1 - e.current_exposure_eur / e.max_exposure_eur
      return Math.max(0, Math.min(1, inferred))
    }
  }
  return 0
}

function KPI({ label, value, sub, tone, icon }: { label: string; value: string; sub?: string; tone?: 'green' | 'amber' | 'red' | 'gray' | 'navy'; icon: string }) {
  const palette: Record<NonNullable<typeof tone>, string> = {
    green: 'var(--color-status-green-mid)',
    amber: 'var(--color-status-amber-mid)',
    red: 'var(--color-status-red-mid)',
    gray: 'var(--color-text-tertiary)',
    navy: 'var(--color-brand-blue)',
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

type FormulaCardProps = {
  title: string
  headline: string
  rows: Array<[string, string]>
  citation: string
  assumption: string
  tone?: 'green' | 'amber' | 'red' | 'gray' | 'navy'
  muted?: boolean
  footer?: string
}

function FormulaCard({ title, headline, rows, citation, assumption, tone = 'gray', muted, footer }: FormulaCardProps) {
  const palette: Record<NonNullable<FormulaCardProps['tone']>, string> = {
    green: 'var(--color-status-green-mid)',
    amber: 'var(--color-status-amber-mid)',
    red: 'var(--color-status-red-mid)',
    gray: 'var(--color-text-tertiary)',
    navy: 'var(--color-brand-blue)',
  }
  const color = palette[tone]
  const opacity = muted ? 0.85 : 1
  return (
    <Card style={{ opacity }}>
      <CardTitle>{title}</CardTitle>
      <div style={{ fontSize: 24, fontWeight: 600, color, lineHeight: 1.2, marginTop: 6 }}>{headline}</div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 8 }}>
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={i} style={{ borderTop: i ? '0.5px solid var(--color-border-tertiary)' : 'none' }}>
              <td style={{ padding: '4px 0', color: 'var(--color-text-tertiary)' }}>{k}</td>
              <td style={{ padding: '4px 0', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
        <div><strong>{`Citation: `}</strong>{citation}</div>
        <div><strong>{`Assumption: `}</strong>{assumption}</div>
        {footer ? <div style={{ marginTop: 4, fontStyle: 'italic' }}>{footer}</div> : null}
      </div>
    </Card>
  )
}

function ScoreSlider({ frameworkID, current, value, onChange }: { frameworkID: string; current: number; value: number; onChange: (v: number) => void }) {
  const id = useMemo(() => `roi-slider-${frameworkID}`, [frameworkID])
  const [text, setText] = useState((value * 100).toFixed(0))
  useEffect(() => { setText((value * 100).toFixed(0)) }, [value])
  const delta = value - current
  return (
    <div>
      <label htmlFor={id} style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {frameworkID.toUpperCase()}
      </label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          id={id}
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(value * 100)}
          onChange={(e) => onChange(Number(e.target.value) / 100)}
          style={{ flex: 1 }}
        />
        <div style={{ width: 64 }}>
          <TextInput
            type="number"
            min={0}
            max={100}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              const n = Number(e.target.value)
              if (Number.isFinite(n)) onChange(Math.max(0, Math.min(100, n)) / 100)
            }}
          />
        </div>
      </div>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
        {`current ${(current * 100).toFixed(0)}% · `}
        <span style={{ color: delta === 0 ? 'var(--color-text-tertiary)' : delta > 0 ? 'var(--color-status-green-mid)' : 'var(--color-status-red-mid)' }}>
          {`Δ ${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(0)}pp`}
        </span>
      </div>
    </div>
  )
}
