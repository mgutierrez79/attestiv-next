// Pure derivation functions for the Dashboard hero band.
//
// Extracted out of the view so the displayed posture / top-framework /
// controls-passing values can be locked down by unit tests — W0-4
// (UI == signed source). The Evidence page had a 100%/1-source bug
// because the hero computed "not in DLQ" as "signed"; same drift class
// is possible on the Dashboard if these values stay inline in the view.

export type FrameworkScore = {
  score?: number
  controls_score?: number
  controls_summary?: {
    compliant?: number
    total?: number
    // regulation_total is the framework's FULL auditable count (CIS=153,
    // DORA=23, …) and is distinct from `total` above which is the
    // scored subset. When present, the dashboard hero grades against
    // this denominator instead of averaging score-of-scored-subsets.
    regulation_total?: number
    // covered = evidenced + attested controls per the coverage register.
    // Used to render the layered posture bar's amber "measured but not
    // passing" segment.
    covered?: number
  }
}

export type DashboardSummary = {
  finding_count?: number
  framework_scores?: Record<string, FrameworkScore>
  connector_health?: { ok?: number; warn?: number; error?: number; unknown?: number }
  generated_at?: string | null
}

// scoreToPercent normalises a framework's score to a 0–100 integer.
// Accepts both shapes the backend has emitted (0–1 fraction and 0–100
// percent) — same logic the Frameworks page uses, centralised here so
// Dashboard and Frameworks can never display different numbers for the
// same underlying score.
export function scoreToPercent(score: FrameworkScore | undefined): number {
  const raw = score?.score ?? score?.controls_score ?? 0
  const pct = raw <= 1 ? raw * 100 : raw
  return Math.max(0, Math.min(100, Math.round(pct)))
}

// deriveOverallPosture returns the trust-grade hero headline.
//
// When the backend payload carries regulation_total + compliant counts,
// the headline is the coverage-adjusted score: passing / regulation_total.
// This is the auditor-honest "how much of the regulation is demonstrably
// met?" number. It will be LOWER than the unweighted average of per-
// framework scores because frameworks with thin coverage (1 scored
// control passing of 200 auditable) previously inflated the average.
//
// When the backend doesn't carry regulation_total (older builds), we
// fall back to the unweighted average so the hero doesn't go blank —
// but the scoredAvg field is also returned so the view can render a
// "(fallback)" marker if it wants.
//
// scoredAvg ALWAYS carries the legacy unweighted average so the view
// can show it as a demoted subtitle ("X% of measured controls").
export type OverallPosture = {
  value: string         // "7%" or "—"
  percent: number       // 0..100 (0 when no data)
  count: number         // evaluated frameworks
  passing: number       // sum of compliant controls
  regulationTotal: number  // sum of regulation_total; 0 if unknown
  covered: number       // sum of covered (evidenced + attested); 0 if unknown
  scoredAvg: number     // legacy unweighted-average — demoted subtitle
}

export function deriveOverallPosture(summary: DashboardSummary | null): OverallPosture {
  const scores = summary?.framework_scores ?? {}
  const entries = Object.entries(scores)
  if (entries.length === 0) {
    return { value: '—', percent: 0, count: 0, passing: 0, regulationTotal: 0, covered: 0, scoredAvg: 0 }
  }
  const pcts = entries.map(([, s]) => scoreToPercent(s))
  const scoredAvg = Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length)
  let passing = 0
  let regulationTotal = 0
  let covered = 0
  for (const [, s] of entries) {
    const cs = s.controls_summary
    if (cs) {
      passing += cs.compliant ?? 0
      regulationTotal += cs.regulation_total ?? 0
      covered += cs.covered ?? 0
    }
  }
  const headline = regulationTotal > 0 ? Math.round((passing / regulationTotal) * 100) : scoredAvg
  return {
    value: `${headline}%`,
    percent: headline,
    count: entries.length,
    passing,
    regulationTotal,
    covered,
    scoredAvg,
  }
}

// deriveControlsPassing returns the cross-framework "% of controls
// passing" rollup. Two-line display: percent on top, "X / Y" sub.
// "—" when no controls have been totalled (no scoring run yet).
export type ControlsPassing = {
  value: string
  sub: string
  percent: number
  passing: number
  total: number
}

export function deriveControlsPassing(summary: DashboardSummary | null): ControlsPassing {
  const scores = summary?.framework_scores ?? {}
  let passing = 0
  let total = 0
  for (const score of Object.values(scores)) {
    if (score.controls_summary) {
      passing += score.controls_summary.compliant ?? 0
      total += score.controls_summary.total ?? 0
    }
  }
  if (total === 0) {
    return { value: '—', sub: '', percent: 0, passing: 0, total: 0 }
  }
  const pct = Math.round((passing / total) * 100)
  return { value: `${pct}%`, sub: `${passing} / ${total}`, percent: pct, passing, total }
}

// deriveTopFramework picks the highest-scoring framework — the
// trust-grade hero's secondary callout. NOT a hard-coded "DORA tier"
// (which would mislead a multi-framework tenant or be flat wrong when
// nothing is scored yet).
export type TopFramework = {
  id: string
  label: string   // FRAMEWORK_LABELS lookup or uppercased id
  value: string   // "96%" or "—"
  percent: number
  count: number   // total evaluated frameworks (for the "X frameworks scored" sub)
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

export function deriveTopFramework(summary: DashboardSummary | null): TopFramework {
  const scores = summary?.framework_scores ?? {}
  const entries = Object.entries(scores)
  if (entries.length === 0) {
    return { id: '', label: '—', value: '—', percent: 0, count: 0 }
  }
  const ranked = entries
    .map(([key, score]) => ({ id: key, percent: scoreToPercent(score) }))
    .sort((a, b) => b.percent - a.percent)
  const winner = ranked[0]
  return {
    id: winner.id,
    label: FRAMEWORK_LABELS[winner.id] || winner.id.toUpperCase(),
    value: `${winner.percent}%`,
    percent: winner.percent,
    count: entries.length,
  }
}
