'use client';
// Scoring calculator — 4 tabs.
//
// Tab 1: Evidence taxonomy table
// Tab 2: Control mapping per framework
// Tab 3: Algorithm explainer (static educational view)
// Tab 4: Live calculator with sliders for area-level simulation
//
// Why this page exists: compliance managers need to understand
// HOW a number was computed before they trust it. Auditors want to
// see the rule the score follows. Engineers want to understand
// what evidence buys what credit. All three audiences land here.

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  Topbar,
} from '../components/AttestivUi'
import { ScoringBreakdown } from '../components/ScoringBreakdown'
import {
  evaluate as evaluateAll,
  formatPercent,
  getFramework,
  listFrameworks,
  statusTone,
  type FrameworkSummary,
  type ControlResult,
} from '../lib/scoring'

import { useI18n } from '../lib/i18n';

type Tab = 'taxonomy' | 'mapping' | 'algorithm' | 'calculator'

export function AttestivScoringCalculatorPage() {
  const {
    t
  } = useI18n();

  const [tab, setTab] = useState<Tab>('algorithm')
  const [frameworks, setFrameworks] = useState<FrameworkSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [evaluating, setEvaluating] = useState(false)

  async function refresh() {
    try {
      const body = await listFrameworks()
      setFrameworks(body.items)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load frameworks')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function reEvaluate() {
    setEvaluating(true)
    setError(null)
    setInfo(null)
    try {
      const body = await evaluateAll()
      setInfo(`Evaluated ${body.frameworks_evaluated} frameworks. Scores reflect the current taxonomy + library.`)
      await refresh()
    } catch (err: any) {
      setError(err?.message ?? 'Evaluation failed')
    } finally {
      setEvaluating(false)
    }
  }

  return (
    <>
      <Topbar
        title={t('Scoring calculator', 'Scoring calculator')}
        right={
          <PrimaryButton onClick={reEvaluate} disabled={evaluating}>
            <i className={`ti ${evaluating ? 'ti-loader-2' : 'ti-calculator'}`} aria-hidden="true" />
            {evaluating ? 'Evaluating…' : 'Re-evaluate now'}
          </PrimaryButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {info ? <Banner tone="info">{info}</Banner> : null}

        <div
          style={{
            display: 'flex',
            gap: 4,
            background: 'var(--color-background-secondary)',
            padding: 4,
            borderRadius: 'var(--border-radius-md)',
            marginBottom: 14,
          }}
        >
          {([
            { value: 'taxonomy', label: 'Evidence taxonomy', icon: 'ti-list-tree' },
            { value: 'mapping', label: 'Control mapping', icon: 'ti-arrows-shuffle' },
            { value: 'algorithm', label: 'Scoring algorithm', icon: 'ti-math-function' },
            { value: 'calculator', label: 'Live calculator', icon: 'ti-adjustments-horizontal' },
          ] as Array<{ value: Tab; label: string; icon: string }>).map((entry) => {
            const active = entry.value === tab
            return (
              <button
                key={entry.value}
                type="button"
                onClick={() => setTab(entry.value)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: active ? 500 : 400,
                  padding: '8px 12px',
                  border: 'none',
                  borderRadius: 'var(--border-radius-md)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  background: active ? 'var(--color-background-primary)' : 'transparent',
                  color: active ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                }}
              >
                <i className={`ti ${entry.icon}`} aria-hidden="true" />
                {entry.label}
              </button>
            )
          })}
        </div>

        {tab === 'taxonomy' ? <TaxonomyTab /> : null}
        {tab === 'mapping' ? <MappingTab frameworks={frameworks} /> : null}
        {tab === 'algorithm' ? <AlgorithmTab /> : null}
        {tab === 'calculator' ? <CalculatorTab frameworks={frameworks} /> : null}
      </div>
    </>
  );
}

// ─── Tab 1 ─────────────────────────────────────────────────────────

const TAXONOMY_HINT = [
  { tag: 'mfa_status', desc: 'MFA enrollment status per account', delivery: 'polling', frameworks: ['SOC 2', 'ISO 27001', 'NIS2', 'PCI-DSS'] },
  { tag: 'storage_encryption', desc: 'Storage encryption at rest', delivery: 'polling', frameworks: ['ISO 27001', 'PCI-DSS', 'SOC 2', 'GxP'] },
  { tag: 'dr_test_result', desc: 'Complete DR test result, signed', delivery: 'calculated', frameworks: ['ISO 27001', 'DORA', 'NIS2', 'SOC 2', 'PCI-DSS', 'GxP'] },
  { tag: 'security_training', desc: 'Security awareness training completion', delivery: 'polling', frameworks: ['ISO 27001', 'SOC 2', 'NIS2', 'PCI-DSS'] },
  { tag: 'config_change', desc: 'Security configuration change on a device', delivery: 'streaming', frameworks: ['ISO 27001', 'PCI-DSS', 'SOC 2'] },
  { tag: 'application_dr_test_result', desc: 'Application-level DR test (full stack)', delivery: 'calculated', frameworks: ['GxP', 'DORA', 'ISO 27001', 'SOC 2', 'NIS2', 'PCI-DSS'] },
  { tag: 'application_validation_status', desc: 'GxP IQ/OQ/PQ status', delivery: 'manual', frameworks: ['GxP'] },
  { tag: 'change_control_record', desc: 'Formal approval for a system change', delivery: 'manual', frameworks: ['GxP', 'ISO 27001', 'SOC 2'] },
]

function TaxonomyTab() {
  const {
    t
  } = useI18n();

  return (
    <Card>
      <CardTitle right={<Badge tone="navy">{TAXONOMY_HINT.length} {t('of 41 types shown', 'of 41 types shown')}</Badge>}>
        {t('Evidence taxonomy', 'Evidence taxonomy')}
      </CardTitle>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
        {t(
          'Each evidence type carries one or more',
          'Each evidence type carries one or more'
        )} <strong>tags</strong>{t(
          '. Controls reference tags, not raw type names — that\'s how\n        one signed record (a single',
          '. Controls reference tags, not raw type names — that\'s how\n        one signed record (a single'
        )} <code>dr_test_result</code>{t(
          ') can satisfy DORA Art. 12, ISO 27001 A.17.1, and SOC 2 A1.2 at once.\n        The full 41-type taxonomy lives in',
          ') can satisfy DORA Art. 12, ISO 27001 A.17.1, and SOC 2 A1.2 at once.\n        The full 41-type taxonomy lives in'
        )} <code>{t('policies/evidence_taxonomy.yaml', 'policies/evidence_taxonomy.yaml')}</code> {t('and is loaded at boot.', 'and is loaded at boot.')}
      </div>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr
            style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              color: 'var(--color-text-tertiary)',
              textAlign: 'left',
            }}
          >
            <th style={{ padding: '6px 10px 6px 0' }}>{t('Tag', 'Tag')}</th>
            <th style={{ padding: '6px 10px' }}>{t('Description', 'Description')}</th>
            <th style={{ padding: '6px 10px' }}>{t('Delivery', 'Delivery')}</th>
            <th style={{ padding: '6px 0 6px 10px' }}>{t('Frameworks', 'Frameworks')}</th>
          </tr>
        </thead>
        <tbody>
          {TAXONOMY_HINT.map((entry) => (
            <tr key={entry.tag} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              <td style={{ padding: '10px 10px 10px 0', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500 }}>
                {entry.tag}
              </td>
              <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>{entry.desc}</td>
              <td style={{ padding: '10px' }}>
                <Badge tone={entry.delivery === 'streaming' ? 'green' : entry.delivery === 'manual' ? 'amber' : 'gray'}>
                  {entry.delivery}
                </Badge>
              </td>
              <td style={{ padding: '10px 0 10px 10px' }}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {entry.frameworks.map((fw) => (
                    <Badge key={fw} tone="blue">
                      {fw}
                    </Badge>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ─── Tab 2 ─────────────────────────────────────────────────────────

function MappingTab({ frameworks }: { frameworks: FrameworkSummary[] }) {
  const {
    t
  } = useI18n();

  const [selected, setSelected] = useState<string>('')
  const [framework, setFramework] = useState<FrameworkSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!selected && frameworks.length > 0) {
      setSelected(frameworks[0].framework_id)
    }
  }, [frameworks, selected])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setBusy(true)
    setError(null)
    getFramework(selected)
      .then((body) => {
        if (!cancelled) setFramework(body)
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? 'Load failed')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected])

  return (
    <Card>
      <CardTitle
        right={
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-background-primary)',
              fontFamily: 'inherit',
            }}
          >
            {frameworks.map((fw) => (
              <option key={fw.framework_id} value={fw.framework_id}>
                {fw.framework_name ?? fw.framework_id}
              </option>
            ))}
          </select>
        }
      >
        {t('Control mapping', 'Control mapping')}
      </CardTitle>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {busy ? <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Loading…', 'Loading…')}</div> : null}
      {framework && framework.control_results && framework.control_results.length > 0 ? (
        <div>
          {framework.control_results.map((control) => (
            <ScoringBreakdown key={control.ControlID} control={control} compact />
          ))}
        </div>
      ) : framework ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {framework.framework_name ?? framework.framework_id} {t('has no scored results yet — click', 'has no scored results yet — click')}{' '}
          <strong>{t('Re-evaluate now', 'Re-evaluate now')}</strong> {t(
            'at the top of the page to run the engine.',
            'at the top of the page to run the engine.'
          )}
        </div>
      ) : null}
    </Card>
  );
}

// ─── Tab 3 ─────────────────────────────────────────────────────────

function AlgorithmTab() {
  const {
    t
  } = useI18n();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
      <Card>
        <CardTitle>{t('Five sub-scores per requirement', 'Five sub-scores per requirement')}</CardTitle>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>
          <li><strong>{t('Presence', 'Presence')}</strong> {t(
              '— 1.0 if any matching evidence exists, 0.0 otherwise. Hard multiplier on the rest.',
              '— 1.0 if any matching evidence exists, 0.0 otherwise. Hard multiplier on the rest.'
            )}</li>
          <li><strong>{t('Freshness', 'Freshness')}</strong> {t(
              '— 1.0 inside the window. Linear decay after, hitting 0 at 2× the window.',
              '— 1.0 inside the window. Linear decay after, hitting 0 at 2× the window.'
            )}</li>
          <li><strong>{t('Frequency', 'Frequency')}</strong> {t(
              '— count of records in window / required count, capped at 1.0.',
              '— count of records in window / required count, capped at 1.0.'
            )}</li>
          <li><strong>{t('Threshold', 'Threshold')}</strong> {t(
              '— 1.0 if a numeric field meets the operator (lte/gte/eq); 0.0 otherwise.',
              '— 1.0 if a numeric field meets the operator (lte/gte/eq); 0.0 otherwise.'
            )}</li>
          <li><strong>{t('Field match', 'Field match')}</strong> {t('— 1.0 if every key in', '— 1.0 if every key in')} <code>field_match</code> {t('matches at least one record.', 'matches at least one record.')}</li>
        </ul>
      </Card>
      <Card>
        <CardTitle>{t('Combination weights', 'Combination weights')}</CardTitle>
        <pre
          style={{
            fontSize: 11,
            background: 'var(--color-background-secondary)',
            padding: '10px 12px',
            borderRadius: 'var(--border-radius-md)',
            overflow: 'auto',
            margin: 0,
            fontFamily: 'var(--font-mono)',
          }}
        >
{`combined = presence × (
    freshness × 0.30
  + frequency × 0.30
  + threshold × 0.20
  + field_match × 0.20
)`}
        </pre>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
          {t(
            'Freshness + frequency dominate because stale or sporadic evidence is the most common failure mode. Threshold + field\n          match are pass/fail axes; their lower weight reflects that "the evidence is here and current" matters more than the\n          binary check passing for a one-shot record.',
            'Freshness + frequency dominate because stale or sporadic evidence is the most common failure mode. Threshold + field\n          match are pass/fail axes; their lower weight reflects that "the evidence is here and current" matters more than the\n          binary check passing for a one-shot record.'
          )}
        </div>
      </Card>
      <Card>
        <CardTitle>{t('Gate semantics', 'Gate semantics')}</CardTitle>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
          <p style={{ margin: '0 0 8px' }}>
            {t('A requirement marked', 'A requirement marked')} <Badge tone="navy">gate</Badge> {t(
              'in the YAML is binary at the control level: any gate failure\n            collapses the whole control to',
              'in the YAML is binary at the control level: any gate failure\n            collapses the whole control to'
            )} <Badge tone="red">FAIL</Badge> {t('with score 0.', 'with score 0.')}
          </p>
          <p style={{ margin: 0 }}>
            {t(
              'That\'s why "MFA enforced for all users" can never be "mostly passing." Either the threshold says 100% and the\n            evidence agrees, or the control fails — the framework engine doesn\'t average gate failures away.',
              'That\'s why "MFA enforced for all users" can never be "mostly passing." Either the threshold says 100% and the\n            evidence agrees, or the control fails — the framework engine doesn\'t average gate failures away.'
            )}
          </p>
        </div>
      </Card>
      <Card>
        <CardTitle>{t('Status thresholds', 'Status thresholds')}</CardTitle>
        <table style={{ width: '100%', fontSize: 12 }}>
          <tbody>
            <tr>
              <td style={{ padding: '6px 0' }}><Badge tone="green">PASS</Badge></td>
              <td style={{ padding: '6px 0', color: 'var(--color-text-secondary)' }}>{t('score ≥ 0.95', 'score ≥ 0.95')}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 0' }}><Badge tone="amber">REVIEW</Badge></td>
              <td style={{ padding: '6px 0', color: 'var(--color-text-secondary)' }}>{t('0.70 ≤ score < 0.95', '0.70 ≤ score < 0.95')}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 0' }}><Badge tone="amber">WARN</Badge></td>
              <td style={{ padding: '6px 0', color: 'var(--color-text-secondary)' }}>{t('0.40 ≤ score < 0.70', '0.40 ≤ score < 0.70')}</td>
            </tr>
            <tr>
              <td style={{ padding: '6px 0' }}><Badge tone="red">FAIL</Badge></td>
              <td style={{ padding: '6px 0', color: 'var(--color-text-secondary)' }}>{t('score < 0.40 OR any gate failure', 'score < 0.40 OR any gate failure')}</td>
            </tr>
          </tbody>
        </table>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
          {t(
            'Boundaries map up — a 0.95 is PASS, not REVIEW. Per-framework thresholds can override these defaults via',
            'Boundaries map up — a 0.95 is PASS, not REVIEW. Per-framework thresholds can override these defaults via'
          )}
          <code> scoring_thresholds</code> {t(
            'in the framework YAML; today every framework uses the defaults.',
            'in the framework YAML; today every framework uses the defaults.'
          )}
        </div>
      </Card>
    </div>
  );
}

// ─── Tab 4 ─────────────────────────────────────────────────────────

const DEFAULT_AREAS = [
  { name: 'Access control', weight: 2.5, score: 95 },
  { name: 'Business continuity', weight: 3.0, score: 88 },
  { name: 'Data integrity', weight: 2.5, score: 92 },
  { name: 'Operations security', weight: 2.0, score: 90 },
  { name: 'Governance', weight: 1.5, score: 96 },
]

function CalculatorTab({ frameworks }: { frameworks: FrameworkSummary[] }) {
  const {
    t
  } = useI18n();

  const [areas, setAreas] = useState(DEFAULT_AREAS)
  const [pickedFramework, setPickedFramework] = useState<string>('')

  useEffect(() => {
    if (!pickedFramework && frameworks.length > 0) {
      setPickedFramework(frameworks[0].framework_id)
    }
  }, [frameworks, pickedFramework])

  const live = useMemo(() => computeWeighted(areas), [areas])
  const status = statusForScore(live / 100)

  function loadRealData() {
    const target = frameworks.find((fw) => fw.framework_id === pickedFramework)
    if (!target || target.status === 'no_data') return
    setAreas((current) =>
      current.map((area, index) => ({
        ...area,
        score: index === 0 ? Math.round(target.score * 100) : area.score,
      })),
    )
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) 320px', gap: 12 }}>
      <Card>
        <CardTitle right={<Badge tone={statusTone(status)}>{status}</Badge>}>
          {t('Live calculator', 'Live calculator')}
        </CardTitle>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
          {t(
            'Slide each area\'s aggregate score to see how it moves the framework rollup. Weights mirror the YAML\n          (critical = 3, high = 2, medium = 1, low = 0.5).',
            'Slide each area\'s aggregate score to see how it moves the framework rollup. Weights mirror the YAML\n          (critical = 3, high = 2, medium = 1, low = 0.5).'
          )}
        </div>
        {areas.map((area, index) => {
          return (
            <div key={area.name} style={{ marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>
                  {area.name} <span style={{ color: 'var(--color-text-tertiary)' }}>{t('· weight', '· weight')} {area.weight}</span>
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{area.score}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={area.score}
                onChange={(event) => {
                  const next = [...areas]
                  next[index] = { ...next[index], score: Number(event.target.value) }
                  setAreas(next)
                }}
                style={{ width: '100%' }}
              />
            </div>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 18 }}>
          <GhostButton onClick={() => setAreas(DEFAULT_AREAS)}>
            <i className="ti ti-rotate" aria-hidden="true" />
            {t('Reset', 'Reset')}
          </GhostButton>
          <div>
            <select
              value={pickedFramework}
              onChange={(event) => setPickedFramework(event.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-background-primary)',
                fontFamily: 'inherit',
                marginRight: 6,
              }}
            >
              {frameworks.map((fw) => (
                <option key={fw.framework_id} value={fw.framework_id}>
                  {fw.framework_name ?? fw.framework_id}
                </option>
              ))}
            </select>
            <GhostButton onClick={loadRealData}>{t('Use real data', 'Use real data')}</GhostButton>
          </div>
        </div>
      </Card>
      <div>
        <Card>
          <CardTitle>{t('Result', 'Result')}</CardTitle>
          <div
            style={{
              fontSize: 36,
              fontWeight: 500,
              color:
                statusTone(status) === 'green'
                  ? 'var(--color-status-green-deep)'
                  : statusTone(status) === 'amber'
                    ? 'var(--color-status-amber-text)'
                    : 'var(--color-status-red-deep)',
              lineHeight: 1,
              marginBottom: 6,
            }}
          >
            {formatPercent(live / 100)}
          </div>
          <Badge tone={statusTone(status)}>{status}</Badge>
          <pre
            style={{
              marginTop: 12,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              background: 'var(--color-background-secondary)',
              borderRadius: 'var(--border-radius-md)',
              padding: '10px 12px',
              overflow: 'auto',
              margin: '12px 0 0',
            }}
          >
{`weighted_sum = ${areas.map((a) => `${a.score}×${a.weight}`).join(' + ')}
total_weight = ${areas.reduce((acc, a) => acc + a.weight, 0)}
score = ${live.toFixed(1)}%`}
          </pre>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
            {t(
              'This calculator simulates the framework rollup math — it does NOT mutate live tenant data. Hit Re-evaluate now\n            in the topbar to score against actual evidence.',
              'This calculator simulates the framework rollup math — it does NOT mutate live tenant data. Hit Re-evaluate now\n            in the topbar to score against actual evidence.'
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function computeWeighted(areas: typeof DEFAULT_AREAS): number {
  let weightedSum = 0
  let totalWeight = 0
  for (const area of areas) {
    weightedSum += area.score * area.weight
    totalWeight += area.weight
  }
  if (totalWeight === 0) return 0
  return weightedSum / totalWeight
}

function statusForScore(score: number): 'PASS' | 'REVIEW' | 'WARN' | 'FAIL' {
  if (score >= 0.95) return 'PASS'
  if (score >= 0.7) return 'REVIEW'
  if (score >= 0.4) return 'WARN'
  return 'FAIL'
}

// Local Banner removed — replaced by the shared Banner export from
// AttestivUi so tone palettes, icons, and dismiss behaviour stay
// consistent across the app.

// Suppress unused-import warning for ControlResult — surface ships a type
// alias re-export for downstream views that import from this module.
export type { ControlResult }
