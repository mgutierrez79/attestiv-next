'use client';
// Dashboard > Overview — the Phase A vertical slice.
//
// Pixel-faithful to the Attestiv mockup but wired to real backend
// data: connector health from /v1/connectors, framework posture
// from /v1/dashboard/summary (when available), DLQ depth via the
// shared issuesCount source. The shape is fixed; the values are
// live.
//
// What's intentionally NOT here yet:
//   - Risk-driver detail (scoring engine output beyond the headline)
//   - Per-framework drill-down navigation (those land in Phase B
//     when /frameworks gets its real implementation)
//   - DR test schedule preview ("DR test scheduled" pipeline step
//     is hard-coded for now; wires up when /dr lands in Phase C)

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Badge,
  Card,
  CardTitle,
  FrameworkBar,
  GhostButton,
  MetricCard,
  PaginatedList,
  PipelineStep,
  Pulse,
  SourceRow,
  StatPill,
  StatusBadge,
  Topbar,
} from '../components/AttestivUi'
import { ApiError, apiJson } from '../lib/api'
import { deriveControlsPassing, deriveOverallPosture, deriveTopFramework, frameworkPosturePercent, scoreToPercent } from '../lib/dashboardHero'
import { ConnectorLogo, connectorBrandHex } from '../components/ConnectorLogo'

import { useI18n } from '../lib/i18n';

type ConnectorStatus = {
  name: string
  label?: string
  status?: string
  delivery_mode?: string
  last_run?: string | null
  last_success?: string | null
  failure_count?: number
  poll_interval_seconds?: number
  last_event_count?: number
  events_per_minute?: number
}
type ConnectorsResponse = { connectors: ConnectorStatus[] }

type FrameworkScore = {
  score?: number
  controls_score?: number
  // regulation_total + covered are the same shape as the lib-side
  // FrameworkScore. Kept in sync so the Framework posture rows can
  // grade against the full regulation denominator.
  controls_summary?: {
    compliant?: number
    total?: number
    regulation_total?: number
    covered?: number
  }
}
type DashboardSummary = {
  finding_count?: number
  framework_scores?: Record<string, FrameworkScore>
  connector_health?: { ok?: number; warn?: number; error?: number; unknown?: number }
  generated_at?: string | null
}

const FRAMEWORK_LABELS: Record<string, string> = {
  iso27001: 'ISO 27001',
  soc2: 'SOC 2 Type II',
  nis2: 'NIS2',
  dora: 'DORA regulation',
  gxp: 'GxP',
  cis: 'CIS',
  nist: 'NIST',
  pci_dss: 'PCI-DSS v4',
  'pci-dss': 'PCI-DSS v4',
}

function relativeTime(iso?: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'never'
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

function tone(percent: number): 'green' | 'amber' | 'red' {
  if (percent >= 95) return 'green'
  if (percent >= 85) return 'amber'
  return 'red'
}

function PostureNarrative({
  posturePct,
  passingCount,
  auditableTotal,
  summary,
}: {
  posturePct: number
  passingCount: number
  auditableTotal: number
  summary: DashboardSummary | null
}) {
  const { t } = useI18n()
  const router = useRouter()
  if (auditableTotal === 0) return null

  const scores = summary?.framework_scores ?? {}
  const ranked = Object.entries(scores)
    .map(([key, score]) => ({ key, pct: frameworkPosturePercent(score) }))
    .sort((a, b) => b.pct - a.pct)

  const best = ranked[0]
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : null

  const toneColor =
    posturePct >= 80
      ? 'var(--color-status-green-deep)'
      : posturePct >= 40
        ? 'var(--color-status-amber-text)'
        : 'var(--color-status-red-deep)'
  const toneBg =
    posturePct >= 80
      ? 'var(--color-status-green-bg)'
      : posturePct >= 40
        ? 'var(--color-status-amber-bg)'
        : 'var(--color-status-red-bg)'

  const sep = (
    <span style={{ color: 'var(--color-border-secondary)', userSelect: 'none', flexShrink: 0 }}>|</span>
  )

  return (
    <div
      style={{
        background: toneBg,
        borderRadius: 'var(--border-radius-md)',
        padding: '9px 16px',
        marginBottom: 16,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        fontSize: 13,
        flexWrap: 'wrap',
        lineHeight: 1.4,
      }}
    >
      <span style={{ fontWeight: 700, color: toneColor, fontSize: 15, letterSpacing: '-0.01em' }}>
        {posturePct}%
      </span>
      <span style={{ color: 'var(--color-text-secondary)' }}>
        {passingCount} {t('of', 'of')} {auditableTotal} {t('auditable controls', 'auditable controls')} {t('passing', 'passing')}
      </span>
      {best ? (
        <>
          {sep}
          <span style={{ color: 'var(--color-text-secondary)' }}>
            <span style={{ fontWeight: 600, color: 'var(--color-status-green-deep)' }}>
              {FRAMEWORK_LABELS[best.key] || best.key.toUpperCase()}
            </span>{' '}
            {best.pct}% ↑
          </span>
        </>
      ) : null}
      {worst && worst.key !== best?.key ? (
        <>
          {sep}
          <span style={{ color: 'var(--color-text-secondary)' }}>
            <span style={{ fontWeight: 600, color: 'var(--color-status-red-deep)' }}>
              {FRAMEWORK_LABELS[worst.key] || worst.key.toUpperCase()}
            </span>{' '}
            {worst.pct}% ↓
          </span>
        </>
      ) : null}
      <div style={{ flex: 1 }} />
      {posturePct < 80 ? (
        <button
          type="button"
          onClick={() => router.push('/dashboard/issues?tab=controls')}
          style={{
            background: 'transparent',
            border: `1px solid ${toneColor}`,
            borderRadius: 'var(--border-radius-sm)',
            color: toneColor,
            fontSize: 12,
            fontWeight: 600,
            padding: '3px 10px',
            cursor: 'pointer',
            fontFamily: 'inherit',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {t('dashboard.narrative.fix_cta', 'Fix failing controls')} →
        </button>
      ) : null}
    </div>
  )
}

// loadGRCMetrics fans out to the four Phase-2 endpoints and squashes
// the responses into a flat shape the metric cards consume. Each
// fetch is independent — a 500 on one endpoint shouldn't blank out
// the others. Falls back to `null` per metric so cards render "—"
// rather than misleading zeros.
async function loadGRCMetrics(): Promise<GRCMetrics> {
  const [risksRes, expiringRes, deadlinesRes, policiesRes] = await Promise.allSettled([
    apiJson<{ open_critical?: number; open_high?: number }>('/risks/summary'),
    apiJson<{ items?: Array<{ expires_at?: string }>; count?: number }>('/exceptions/expiring-soon?within_days=14'),
    apiJson<{ items?: Array<{ minutes_until?: number }>; count?: number }>('/incidents/deadlines'),
    apiJson<{ items?: unknown[]; count?: number }>('/policy-docs/overdue'),
  ])
  const out: GRCMetrics = { ...EMPTY_GRC }
  if (risksRes.status === 'fulfilled') {
    const r = risksRes.value || {}
    out.risksOpenCriticalAndHigh = (r.open_critical ?? 0) + (r.open_high ?? 0)
  }
  if (expiringRes.status === 'fulfilled') {
    const items = expiringRes.value?.items ?? []
    out.exceptionsActive = items.length
    if (items.length > 0) {
      const soonest = items
        .map((it) => (it.expires_at ? new Date(it.expires_at).getTime() : Number.MAX_SAFE_INTEGER))
        .reduce((a, b) => Math.min(a, b), Number.MAX_SAFE_INTEGER)
      if (Number.isFinite(soonest)) {
        out.exceptionsNearestExpiryDays = Math.max(0, Math.floor((soonest - Date.now()) / 86_400_000))
      }
    }
  }
  if (deadlinesRes.status === 'fulfilled') {
    const items = deadlinesRes.value?.items ?? []
    out.overdueNIS2Notifications = items.filter((d) => (d.minutes_until ?? 0) < 0).length
  }
  if (policiesRes.status === 'fulfilled') {
    out.policiesOverdue = policiesRes.value?.count ?? policiesRes.value?.items?.length ?? 0
  }
  return out
}

type GRCMetrics = {
  risksOpenCriticalAndHigh: number | null
  exceptionsActive: number | null
  exceptionsNearestExpiryDays: number | null
  overdueNIS2Notifications: number | null
  policiesOverdue: number | null
}

type AuditEntry = {
  timestamp?: string
  action?: string
  subject?: string
  tenant_id?: string
  details?: Record<string, unknown>
}
type AuditLogResponse = { items?: AuditEntry[] }

type PrioritizedGap = {
  framework_id: string
  control_id: string
  control_name?: string
  control_area?: string
  status: string
  score: number
  severity: string
  finding_description?: string
  remediation?: string
  cross_framework_count: number
  priority_score: number
}
type PrioritizedGapsResponse = { gaps?: PrioritizedGap[] }

// humanizeAuditAction maps the backend's snake_case action strings to
// a one-line title for the Recent activity feed. Anything unmapped
// renders the raw action with underscores swapped for spaces — better
// than dropping the row.
function humanizeAuditAction(action: string): { title: string; desc: string } {
  const map: Record<string, { title: string; desc: string }> = {
    admin_system_config_updated:        { title: 'System config updated',     desc: 'Admin saved a new system_config payload' },
    connector_poll_interval_updated:    { title: 'Connector poll retuned',    desc: 'New cadence applies on the next iteration' },
    trust_store_ca_uploaded:            { title: 'Trusted root CA uploaded',  desc: 'Connector probes will trust this CA' },
    trust_store_ca_deleted:             { title: 'Trusted root CA removed',   desc: 'Connectors relying on it will fail TLS' },
    admin_record_upserted:              { title: 'Admin record upserted',     desc: 'Tenants / users / keys collection write' },
    admin_record_updated:               { title: 'Admin record patched',      desc: 'Tenants / users / keys partial update' },
    admin_record_deleted:               { title: 'Admin record deleted',      desc: 'Tenants / users / keys hard delete' },
    admin_api_key_created:              { title: 'API key created',           desc: 'New API key issued' },
    admin_api_key_rotated:              { title: 'API key rotated',           desc: 'Old key invalidated' },
    admin_tenant_deactivated:           { title: 'Tenant deactivated',        desc: 'Tenant marked inactive' },
    admin_tenant_secret_upserted:       { title: 'Tenant secret upserted',    desc: 'Tenant secret written' },
    admin_tenant_secret_deleted:        { title: 'Tenant secret removed',     desc: 'Tenant secret revoked' },
    admin_group_member_added:           { title: 'Group member added',        desc: 'RBAC group membership change' },
    admin_tenant_policy_updated:        { title: 'Tenant policy updated',     desc: 'Retention / scoring policy change' },
    admin_tenant_policy_retention_applied: { title: 'Retention applied',       desc: 'Tenant retention policy executed' },
  }
  const hit = map[action]
  if (hit) return hit
  return { title: action.replace(/_/g, ' '), desc: '' }
}

const EMPTY_GRC: GRCMetrics = {
  risksOpenCriticalAndHigh: null,
  exceptionsActive: null,
  exceptionsNearestExpiryDays: null,
  overdueNIS2Notifications: null,
  policiesOverdue: null,
}

// CoverageTrend mirrors GET /v1/scoring/coverage-trend: the honest
// aggregate coverage rollup across every framework register + a weekly
// series of connector-evidenced coverage reconstructed from history.
type CoverageTrendPoint = {
  date: string
  total: number
  evidenced: number
  not_evidenced: number
  out_of_scope: number
  evidenced_pct: number
}
type CoverageTrend = {
  weeks: number
  current: {
    total: number
    evidenced: number
    attested: number
    not_evidenced: number
    out_of_scope: number
    covered_pct: number
    evidenced_pct: number
  }
  points: CoverageTrendPoint[]
}

const pct1 = (v: number) => `${Math.round(v * 100)}%`

// CoverageChip is one labelled count in the coverage split. Colour keys
// to the four effective-status buckets so the card reads the same as the
// /coverage-register page (evidenced=green, attested=blue, uncovered=amber).
function CoverageChip({ label, value, deep, bg }: { label: string; value: number; deep: string; bg: string }) {
  return (
    <div style={{ background: bg, borderRadius: 8, padding: '8px 12px', minWidth: 84 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: deep, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

// CoverageSparkline draws connector-evidenced coverage over time as a
// filled area chart. Pure SVG (no chart lib in this project), viewBox
// stretched to the card width via preserveAspectRatio="none".
function CoverageSparkline({ points }: { points: CoverageTrendPoint[] }) {
  const {
    t
  } = useI18n();

  const n = points.length
  if (n < 2) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '12px 0' }}>
        {t(
          'Not enough history yet — the trend fills in as weekly snapshots accrue.',
          'Not enough history yet — the trend fills in as weekly snapshots accrue.'
        )}
      </div>
    );
  }
  const W = 100
  const H = 36
  const pad = 2
  const x = (i: number) => (i / (n - 1)) * W
  const y = (p: number) => H - pad - Math.max(0, Math.min(1, p)) * (H - pad * 2)
  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.evidenced_pct).toFixed(2)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  const first = points[0].evidenced_pct
  const last = points[n - 1].evidenced_pct
  const delta = last - first
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 60, display: 'block' }}>
        <path d={area} fill="var(--color-status-green-bg)" />
        <path d={line} fill="none" stroke="var(--color-status-green-deep)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
        <span>{pct1(first)}</span>
        <span style={{ color: delta >= 0 ? 'var(--color-status-green-deep)' : 'var(--color-status-amber-deep)' }}>
          {delta >= 0 ? '▲' : '▼'} {pct1(Math.abs(delta))} over {points.length - 1}w
        </span>
        <span style={{ fontWeight: 600 }}>{pct1(last)}</span>
      </div>
    </div>
  )
}

// CoverageCard is the dashboard's honest-coverage headline + variation
// graph. Reads the aggregate register rollup so the operator sees
// "N of TOTAL auditable units" instead of a vanity framework score.
function CoverageCard({ data, t }: { data: CoverageTrend | null; t: (a: string, b: string) => string }) {
  if (!data) {
    return (
      <Card>
        <CardTitle>{t('Compliance coverage', 'Compliance coverage')}</CardTitle>
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Loading coverage…', 'Loading coverage…')}</div>
      </Card>
    )
  }
  const c = data.current
  return (
    <Card>
      <CardTitle right={<Badge tone="navy">{pct1(c.covered_pct)} {t('covered', 'covered')}</Badge>}>
        {t('Compliance coverage', 'Compliance coverage')}
      </CardTitle>
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: -4, marginBottom: 12 }}>
        {c.total} {t('auditable units across all frameworks', 'auditable units across all frameworks')}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <CoverageChip label={t('Evidenced', 'Evidenced')} value={c.evidenced} deep="var(--color-status-green-deep)" bg="var(--color-status-green-bg)" />
        <CoverageChip label={t('Attested', 'Attested')} value={c.attested} deep="var(--color-status-blue-deep)" bg="var(--color-status-blue-bg)" />
        <CoverageChip label={t('Uncovered', 'Uncovered')} value={c.not_evidenced} deep="var(--color-status-amber-deep)" bg="var(--color-status-amber-bg)" />
        <CoverageChip label={t('Out of scope', 'Out of scope')} value={c.out_of_scope} deep="var(--color-text-secondary)" bg="var(--color-surface-sunken)" />
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
        {t('Evidenced (connector) coverage over time', 'Evidenced (connector) coverage over time')}
      </div>
      <CoverageSparkline points={data.points} />
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
        {t(
          'Trend tracks connector-evidenced coverage (reconstructed from history). Attested coverage is point-in-time and shown in the split above only.',
          'Trend tracks connector-evidenced coverage (reconstructed from history). Attested coverage is point-in-time and shown in the split above only.',
        )}
      </div>
    </Card>
  )
}

const SEVERITY_TONE: Record<string, 'red' | 'amber' | 'navy' | 'gray'> = {
  critical: 'red',
  high: 'amber',
  medium: 'navy',
  low: 'gray',
}

const FRAMEWORK_SHORT: Record<string, string> = {
  iso27001: 'ISO',
  soc2: 'SOC 2',
  nis2: 'NIS2',
  dora: 'DORA',
  gxp: 'GxP',
  cis: 'CIS',
  nist: 'NIST',
  pci_dss: 'PCI',
}

export function AttestivDashboardOverview() {
  const {
    t
  } = useI18n();
  const router = useRouter()

  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [coverage, setCoverage] = useState<CoverageTrend | null>(null)
  const [grc, setGRC] = useState<GRCMetrics>(EMPTY_GRC)
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([])
  const [gaps, setGaps] = useState<PrioritizedGap[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  // connector name → controls_supported count from the coverage attestation
  const [connectorCoverage, setConnectorCoverage] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const [connectorsResponse, summaryResponse, auditResponse, coverageResponse, gapsResponse, connCoverageResponse] = await Promise.allSettled([
          apiJson<ConnectorsResponse>('/connectors'),
          apiJson<DashboardSummary>('/dashboard/summary'),
          apiJson<AuditLogResponse>('/audit/log?limit=4'),
          apiJson<CoverageTrend>('/scoring/coverage-trend?weeks=12'),
          apiJson<PrioritizedGapsResponse>('/scoring/prioritized-gaps?limit=5&min_severity=high'),
          apiJson<{ connectors?: Array<{ name: string; controls_supported: number }> }>('/connectors/coverage'),
        ])
        if (cancelled) return
        if (connectorsResponse.status === 'fulfilled') {
          setConnectors(connectorsResponse.value.connectors || [])
        }
        if (summaryResponse.status === 'fulfilled') {
          setSummary(summaryResponse.value)
        }
        if (coverageResponse.status === 'fulfilled') {
          setCoverage(coverageResponse.value)
        }
        if (auditResponse.status === 'fulfilled') {
          setAuditEntries(auditResponse.value.items || [])
        }
        if (gapsResponse.status === 'fulfilled') {
          setGaps(gapsResponse.value.gaps ?? [])
        }
        if (connCoverageResponse.status === 'fulfilled') {
          const map: Record<string, number> = {}
          for (const c of connCoverageResponse.value.connectors ?? []) {
            map[c.name] = c.controls_supported
          }
          setConnectorCoverage(map)
        }
        // Surface only critical-path errors. A summary failure is
        // tolerable (the page degrades gracefully); a connectors
        // failure means we can't render the source-health panel
        // and should tell the user.
        if (connectorsResponse.status === 'rejected') {
          setError(connectorsResponse.reason as ApiError)
        }
        // Phase-2 metrics — fetched in parallel; each failure
        // degrades to "—" rather than blowing up the dashboard.
        if (!cancelled) {
          loadGRCMetrics().then((next) => {
            if (!cancelled) setGRC(next)
          })
        }
      } catch (err) {
        if (!cancelled) setError(err as ApiError)
      }
    }
    void load()
    const handle = window.setInterval(load, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  const renderConnectorRow = (connector: ConnectorStatus) => {
    const brandHex = connectorBrandHex(connector.name)
    const lastSeen = connector.last_success || connector.last_run
    const isStale = (() => {
      if (!lastSeen) return true
      const interval = (connector.poll_interval_seconds ||
        (connector.delivery_mode === 'stream' ? 60 : 21600)) * 2 * 1000
      return Date.now() - new Date(lastSeen).getTime() > interval
    })()
    // last_status reflects the current attempt; failure_count is a
    // lifetime counter and goes positive after one bad poll even
    // when the connector has since recovered.
    const lastStatus = ((connector as any).last_status ?? '').toLowerCase()
    const currentlyErroring = lastStatus === 'error' || lastStatus === 'failed'
    const status: 'OK' | 'Warn' | 'Down' = currentlyErroring || isStale ? 'Warn' : 'OK'
    const bar = status === 'OK' ? 92 : 45
    const barColor = status === 'OK'
      ? 'var(--color-status-green-mid)'
      : 'var(--color-status-amber-mid)'
    const controlsSupported = connectorCoverage[connector.name] ?? 0
    const baseSubtitle = connector.delivery_mode === 'stream'
      ? `Streaming · last: ${relativeTime(lastSeen)}`
      : `Polling · last: ${relativeTime(lastSeen)}`
    // When stale/erroring and we know how many controls this feeds,
    // surface the impact inline so the operator knows why they should act.
    const subtitle = (status === 'Warn' && controlsSupported > 0)
      ? `${baseSubtitle} · ⚠ feeds ${controlsSupported} control${controlsSupported === 1 ? '' : 's'} — evidence aging`
      : controlsSupported > 0
        ? `${baseSubtitle} · feeds ${controlsSupported} control${controlsSupported === 1 ? '' : 's'}`
        : baseSubtitle
    return (
      <SourceRow
        logo={<ConnectorLogo name={connector.name} size={16} />}
        iconBg={brandHex ? `${brandHex}1A` : 'var(--color-background-tertiary)'}
        name={connector.label || connector.name}
        sub={subtitle}
        bar={bar}
        barColor={barColor}
        badge={<Badge tone={status === 'OK' ? 'green' : 'amber'}>{status}</Badge>}
      />
    )
  }

  const frameworkRows = useMemo(() => {
    const scores = summary?.framework_scores || {}
    const entries = Object.entries(scores)
    if (!entries.length) {
      // No scoring run has produced framework results yet. Showing
      // every framework at 0% in red implied a failure state — be
      // honest: there's no data, not bad data.
      return null
    }
    return entries
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, score]) => {
        const cs = score.controls_summary
        const passing = cs?.compliant
        const regulationTotal = cs?.regulation_total
        const covered = cs?.covered
        // Coverage-adjusted % when the backend payload carries
        // regulation_total; otherwise fall back to the legacy
        // score-of-scored-subset so older builds still render.
        const display =
          typeof passing === 'number' && typeof regulationTotal === 'number' && regulationTotal > 0
            ? Math.round((passing / regulationTotal) * 100)
            : scoreToPercent(score)
        return (
          <FrameworkBar
            key={key}
            name={FRAMEWORK_LABELS[key] || key.toUpperCase()}
            percent={display}
            passing={passing}
            regulationTotal={regulationTotal}
            covered={covered}
            tone={tone(display)}
          />
        )
      })
  }, [summary])

  // Hero metric values. Derivations live in src/lib/dashboardHero and
  // are contract-tested under dashboardHero.test.ts — so the value the
  // UI displays is, by construction, the same value the tests assert
  // (W0-4 UI == signed source).
  const metricEvidenceCollected =
    summary?.finding_count != null ? summary.finding_count.toLocaleString() : '—'
  const overall = deriveOverallPosture(summary)
  const controlsPassing = deriveControlsPassing(summary)
  const metricControlsPassing = { value: controlsPassing.value, sub: controlsPassing.sub }
  const topFrameworkInfo = deriveTopFramework(summary)
  const topFramework = {
    label: topFrameworkInfo.label,
    value: topFrameworkInfo.value,
    sub:
      topFrameworkInfo.count > 0
        ? `${topFrameworkInfo.count} ${t('frameworks scored', 'frameworks scored')}`
        : t('No scoring run yet', 'No scoring run yet'),
  }
  const metricActiveConnectors = connectors.length || '—'
  const metricConnectorWarning =
    (summary?.connector_health?.warn ?? 0) + (summary?.connector_health?.error ?? 0)
  const lastEvidence = relativeTime(summary?.generated_at)
  // Honest hero (matches /frameworks page): headline = POSTURE, the
  // auditor-honest passing-rate against the FULL regulation denominator
  // (passing / regulation_total). Layered bar decomposes it into:
  //   green   — passing      (PASS verdict)
  //   amber   — measured     (evidenced/attested, verdict not PASS)
  //   grey    — unevidenced  (no signal at all — the rest of the bar)
  // Coverage and the legacy scored-subset average are demoted to the
  // secondary lines so neither can be misread as the headline.
  const cov = coverage?.current
  // Prefer the new dashboard-summary fields (passing + regulationTotal
  // come from the analytics overlay when the backend has been updated);
  // fall back to coverage.current when the new fields aren't there yet.
  const auditableTotal = overall.regulationTotal > 0 ? overall.regulationTotal : cov?.total ?? 0
  const passingCount = overall.passing
  const coveredCount =
    overall.covered > 0
      ? overall.covered
      : cov
      ? (cov.evidenced ?? 0) + (cov.attested ?? 0)
      : 0
  const measuredNotPassing = Math.max(0, coveredCount - passingCount)
  const unevidencedCount = Math.max(0, auditableTotal - coveredCount)
  const posturePct = auditableTotal > 0 ? Math.round((passingCount / auditableTotal) * 100) : 0
  const coveragePct = auditableTotal > 0 ? Math.round((coveredCount / auditableTotal) * 100) : null
  const measuredPctOfBar = auditableTotal > 0 ? Math.round((measuredNotPassing / auditableTotal) * 100) : 0
  const heroValue = auditableTotal > 0 ? `${posturePct}%` : overall.value
  const heroPct = auditableTotal > 0 ? posturePct : overall.percent
  const postureColor =
    heroPct >= 80
      ? 'var(--color-status-green-deep)'
      : heroPct >= 40
        ? 'var(--color-status-amber-text)'
        : 'var(--color-status-red-deep)'

  return (
    <>
      <Topbar
        title={t('Overview', 'Overview')}
        left={<Badge tone="green"><Pulse /> {t('Live', 'Live')}</Badge>}
        right={
          <>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {t('Last evidence:', 'Last evidence:')} {lastEvidence}
            </span>
            <GhostButton>
              <i className="ti ti-download" aria-hidden="true" style={{ fontSize: 13 }} /> {t('Export', 'Export')}
            </GhostButton>
          </>
        }
      />
      <div className="attestiv-content">
        {error ? (
          <Card>
            <div style={{ color: 'var(--color-status-red-deep)', fontSize: 12 }}>
              {t('Failed to load connector data:', 'Failed to load connector data:')} {error.message}
            </div>
          </Card>
        ) : null}

        <PostureNarrative
          posturePct={posturePct}
          passingCount={passingCount}
          auditableTotal={auditableTotal}
          summary={summary}
        />

        {/* Hero posture band — the trust-grade headline: overall
            compliance posture as one big number, with the four
            highest-signal stats alongside it. */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 1.3fr) 1fr',
            gap: 28,
            background: 'var(--color-background-primary)',
            borderRadius: 'var(--border-radius-lg)',
            boxShadow: 'var(--shadow-card)',
            padding: '28px 32px',
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--color-text-tertiary)',
                marginBottom: 12,
              }}
            >
              {t('Overall posture', 'Overall posture')}
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
              <span
                style={{
                  fontSize: 56,
                  fontWeight: 600,
                  lineHeight: 1,
                  letterSpacing: '-0.03em',
                  fontVariantNumeric: 'tabular-nums',
                  color: postureColor,
                }}
              >
                {heroValue}
              </span>
              {auditableTotal > 0 ? (
                <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                  {passingCount} {t('passing of', 'passing of')} {auditableTotal} {t('auditable controls', 'auditable controls')}
                </span>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                  {t('Loading coverage…', 'Loading coverage…')}
                </span>
              )}
            </div>
            {auditableTotal > 0 ? (
              <>
                <div
                  style={{
                    height: 10,
                    borderRadius: 999,
                    background: 'var(--color-background-tertiary)',
                    overflow: 'hidden',
                    marginBottom: 8,
                    display: 'flex',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${heroPct}%`,
                      background: 'var(--color-status-green-mid)',
                      transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                  <div
                    style={{
                      height: '100%',
                      width: `${measuredPctOfBar}%`,
                      background: 'var(--color-status-amber-mid)',
                      transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 14,
                    marginBottom: 10,
                    fontSize: 11,
                    color: 'var(--color-text-tertiary)',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--color-status-green-mid)' }} />
                    {t('passing', 'passing')} {passingCount}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--color-status-amber-mid)' }} />
                    {t('measured · not passing', 'measured · not passing')} {measuredNotPassing}
                  </span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: 'var(--color-background-tertiary)' }} />
                    {t('unevidenced', 'unevidenced')} {unevidencedCount}
                  </span>
                </div>
              </>
            ) : null}
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
              {coveragePct != null ? (
                <>
                  {t('Regulation coverage', 'Regulation coverage')}{' '}
                  <strong>{coveragePct}%</strong>{' '}
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    ({coveredCount} {t('of', 'of')} {auditableTotal})
                  </span>
                  {' · '}
                </>
              ) : null}
              {t('Subset score', 'Subset score')}{' '}
              <strong>{overall.scoredAvg > 0 ? `${overall.scoredAvg}%` : overall.value}</strong>{' '}
              <span style={{ color: 'var(--color-text-tertiary)' }}>{t('unweighted across frameworks', 'unweighted across frameworks')}</span>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t('Last evidence', 'Last evidence')} {lastEvidence} · {connectors.length}{' '}
              {t('sources connected', 'sources connected')}
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 12,
              alignContent: 'center',
            }}
          >
            <StatPill
              label={t('Top framework', 'Top framework')}
              value={topFramework.value}
              sub={topFramework.label !== '—' ? topFramework.label : topFramework.sub}
              valueColor={topFramework.value !== '—' ? 'var(--color-brand-blue)' : undefined}
            />
            <StatPill
              label={t('Controls passing', 'Controls passing')}
              value={metricControlsPassing.value}
              sub={metricControlsPassing.sub}
              valueColor="var(--color-status-green-deep)"
            />
            <StatPill
              label={t('Evidence collected', 'Evidence collected')}
              value={metricEvidenceCollected}
              sub={summary?.generated_at ? `${t('as of', 'as of')} ${relativeTime(summary.generated_at)}` : undefined}
            />
            <StatPill
              label={t('Open risks', 'Open risks')}
              value={grc.risksOpenCriticalAndHigh != null ? String(grc.risksOpenCriticalAndHigh) : '—'}
              sub={t('critical + high', 'critical + high')}
              valueColor={grc.risksOpenCriticalAndHigh && grc.risksOpenCriticalAndHigh > 0 ? 'var(--color-status-amber-mid)' : undefined}
            />
          </div>
        </div>

        {/* Operational metrics row */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <MetricCard
            label={t('Active connectors', 'Active connectors')}
            value={metricActiveConnectors}
            sub={metricConnectorWarning ? `${metricConnectorWarning} ${t('warning', 'warning')}` : t('all healthy', 'all healthy')}
          />
          <MetricCard
            label={t('Active exceptions', 'Active exceptions')}
            value={grc.exceptionsActive != null ? String(grc.exceptionsActive) : '—'}
            sub={grc.exceptionsNearestExpiryDays != null ? `${t('next expiry:', 'next expiry:')} ${grc.exceptionsNearestExpiryDays}d` : t('no active', 'no active')}
            valueColor={grc.exceptionsNearestExpiryDays != null && grc.exceptionsNearestExpiryDays <= 7 ? 'var(--color-status-red-mid)' : undefined}
          />
          <MetricCard
            label={t('Overdue NIS2', 'Overdue NIS2')}
            value={grc.overdueNIS2Notifications != null ? String(grc.overdueNIS2Notifications) : '—'}
            sub={grc.overdueNIS2Notifications && grc.overdueNIS2Notifications > 0 ? t('submit immediately', 'submit immediately') : t('on track', 'on track')}
            valueColor={
              grc.overdueNIS2Notifications && grc.overdueNIS2Notifications > 0
                ? 'var(--color-status-red-mid)'
                : 'var(--color-status-green-deep)'
            }
          />
          <MetricCard
            label={t('Policies needing review', 'Policies needing review')}
            value={grc.policiesOverdue != null ? String(grc.policiesOverdue) : '—'}
            sub={grc.policiesOverdue && grc.policiesOverdue > 0 ? t('−10% per linked control', '−10% per linked control') : t('all current', 'all current')}
            valueColor={grc.policiesOverdue && grc.policiesOverdue > 0 ? 'var(--color-status-amber-mid)' : undefined}
          />
        </div>

        {/* Top issues — ranked failing controls the CISO should act on first */}
        {gaps.length > 0 && (
          <Card style={{ marginBottom: 20 }}>
            <CardTitle
              right={
                <GhostButton onClick={() => router.push('/scoring/frameworks')}>
                  {t('View all gaps', 'View all gaps')} <i className="ti ti-chevron-right" aria-hidden="true" style={{ fontSize: 12 }} />
                </GhostButton>
              }
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: 13, color: 'var(--color-status-amber-mid)' }} />
                {t('Top issues — fix these first', 'Top issues — fix these first')}
              </span>
            </CardTitle>
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: -4, marginBottom: 10 }}>
              {t('Ranked by severity × failure depth × cross-framework leverage', 'Ranked by severity × failure depth × cross-framework leverage')}
            </div>
            {gaps.map((gap, i) => (
              <div
                key={`${gap.framework_id}-${gap.control_id}`}
                onClick={() => router.push(`/scoring/frameworks/${gap.framework_id}/controls/${gap.control_id}`)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '9px 0',
                  borderBottom: i < gaps.length - 1 ? '0.5px solid var(--color-border-tertiary)' : 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontVariantNumeric: 'tabular-nums', width: 16, flexShrink: 0 }}>
                  {i + 1}
                </span>
                <Badge tone={SEVERITY_TONE[gap.severity] ?? 'gray'}>{gap.severity}</Badge>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {gap.control_name || gap.control_id}
                  </div>
                  {gap.finding_description ? (
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>
                      {gap.finding_description}
                    </div>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  <Badge tone="blue">{FRAMEWORK_SHORT[gap.framework_id] ?? gap.framework_id.toUpperCase()}</Badge>
                  {gap.cross_framework_count > 1 && (
                    <Badge tone="navy">+{gap.cross_framework_count - 1}</Badge>
                  )}
                  <StatusBadge status={gap.status} />
                </div>
              </div>
            ))}
          </Card>
        )}

        <div style={{ marginBottom: 20 }}>
          <CoverageCard data={coverage} t={t} />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 20,
            marginBottom: 20,
          }}
        >
          <Card>
            <CardTitle right={<Badge tone="gray">{connectors.length} sources</Badge>}>
              {t('Source health', 'Source health')}
            </CardTitle>
            <PaginatedList
              items={connectors}
              itemKey={(c) => c.name}
              renderItem={renderConnectorRow}
              maxHeight={320}
              label={t('Sources', 'Sources')}
              empty={
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  {t('No connectors configured yet.', 'No connectors configured yet.')}
                </div>
              }
            />
          </Card>
          <Card>
            <CardTitle>{t('Framework posture', 'Framework posture')}</CardTitle>
            {frameworkRows ?? (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                {t(
                  'No scoring run has produced framework results yet. Frameworks will appear here after the first /scoring/evaluate.',
                  'No scoring run has produced framework results yet. Frameworks will appear here after the first /scoring/evaluate.',
                )}
              </div>
            )}
          </Card>
        </div>

        <Card>
          <CardTitle>{t('Recent platform activity', 'Recent platform activity')}</CardTitle>
          {auditEntries.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t(
                'No platform activity recorded yet. Admin actions (config changes, key rotations, CA uploads) will appear here.',
                'No platform activity recorded yet. Admin actions (config changes, key rotations, CA uploads) will appear here.',
              )}
            </div>
          ) : (
            auditEntries.map((entry, idx) => {
              const action = String(entry.action ?? '')
              const human = humanizeAuditAction(action)
              return (
                <PipelineStep
                  key={`${entry.timestamp ?? idx}-${action}`}
                  dotColor="var(--color-status-green-mid)"
                  name={human.title}
                  desc={entry.subject ? `${human.desc}${human.desc ? ' · ' : ''}by ${entry.subject}` : human.desc}
                  time={relativeTime(entry.timestamp)}
                />
              )
            })
          )}
        </Card>
      </div>
    </>
  );
}
