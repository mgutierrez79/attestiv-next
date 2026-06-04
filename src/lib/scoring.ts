// Typed client for the /v1/scoring/* surface.
//
// The shapes here mirror Go's internal/scoring package — they're
// intentionally permissive (every field optional) so a backend that
// returns a no_data placeholder can be consumed without runtime
// type errors. The UI components do the narrowing.

import { apiFetch } from './api'

export type ControlStatus = 'PASS' | 'REVIEW' | 'WARN' | 'FAIL' | 'no_data'

export type RequirementResult = {
  Tag: string
  Type: 'standard' | 'gate'
  Weight: number
  PresenceScore: number
  FreshnessScore: number
  FrequencyScore: number
  ThresholdScore: number
  FieldMatchScore: number
  CombinedScore: number
  EvidenceIDs?: string[]
  GateFailed?: boolean
  Findings?: Finding[]
}

export type Finding = {
  Severity: string
  Code: string
  Description: string
  Remediation?: string
  ControlID?: string
  Tag?: string
}

export type ControlResult = {
  TenantID?: string
  FrameworkID?: string
  ControlID: string
  ControlName: string
  ControlArea?: string
  Score: number
  Status: ControlStatus
  Weight: number
  RequirementResults?: RequirementResult[]
  EvidenceIDs?: string[]
  Findings?: Finding[]
  EvaluatedAt?: string
  EvidenceWindowStart?: string
  EvidenceWindowEnd?: string
}

export type FrameworkSummary = {
  tenant_id?: string
  framework_id: string
  framework_name?: string
  score: number
  status: ControlStatus
  total_controls?: number
  passing_controls?: number
  review_controls?: number
  warn_controls?: number
  fail_controls?: number
  evaluated_at?: string
  control_results?: ControlResult[]
  // Attestation split (Workstream B2). `score` is the connector-MEASURED
  // weighted score. score_with_attestation recomputes it treating
  // attestable-only register entries (signed policy doc / owner
  // attestation, no connector evidence) as PASS. Only present when those
  // synthetics actually lifted the score, so a missing field means
  // "measured == augmented". The UI MUST show the two numbers distinctly
  // and label the augmented one as management-asserted, not measured.
  score_with_attestation?: number
  status_with_attestation?: ControlStatus
  attested_synthetic_count?: number
  weighted_attested_pct?: number
}

export type MonthlyScore = {
  Year: number
  Month: number
  FrameworkID: string
  Score: number
  Status: ControlStatus
  Events?: TrendEvent[]
}

export type TrendEvent = {
  OccurredAt: string
  Type: string
  Description: string
  Severity: string
  // Score (0..1) at the time of the event. Populated by the backend
  // for framework_scored / status_changed / score_dropped events so
  // the trend chart can plot a fine-grained timeseries without
  // re-parsing the human description. Older events may lack it.
  Score?: number
}

async function getJSON<T>(path: string): Promise<T> {
  const response = await apiFetch(path)
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `${response.status} ${response.statusText}`)
  }
  return (await response.json()) as T
}

export async function listFrameworks(): Promise<{ items: FrameworkSummary[]; count: number }> {
  return getJSON('/scoring/frameworks')
}

export async function getFramework(id: string): Promise<FrameworkSummary> {
  return getJSON(`/scoring/frameworks/${encodeURIComponent(id)}`)
}

export async function listControls(frameworkID: string): Promise<{ items: ControlResult[]; count: number }> {
  return getJSON(`/scoring/frameworks/${encodeURIComponent(frameworkID)}/controls`)
}

export async function getControl(frameworkID: string, controlID: string): Promise<ControlResult> {
  return getJSON(`/scoring/frameworks/${encodeURIComponent(frameworkID)}/controls/${encodeURIComponent(controlID)}`)
}

export async function getTrend(
  frameworkID: string,
  months = 12,
): Promise<{ items: MonthlyScore[]; events: TrendEvent[]; count: number }> {
  return getJSON(`/scoring/frameworks/${encodeURIComponent(frameworkID)}/trend?months=${months}`)
}

export async function listFailing(): Promise<{ items: ControlResult[]; by_framework: Record<string, ControlResult[]>; count: number }> {
  return getJSON('/scoring/failing')
}

export async function evaluate(): Promise<{ job_id: string; status: string; frameworks_evaluated: number; results: FrameworkSummary[] }> {
  const response = await apiFetch('/scoring/evaluate', { method: 'POST' })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `${response.status} ${response.statusText}`)
  }
  return await response.json()
}

export function statusTone(status: ControlStatus): 'green' | 'amber' | 'red' | 'gray' {
  switch (status) {
    case 'PASS':
      return 'green'
    case 'REVIEW':
      return 'amber'
    case 'WARN':
      return 'amber'
    case 'FAIL':
      return 'red'
    default:
      return 'gray'
  }
}

export function formatPercent(score: number | undefined | null): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '—'
  return `${(score * 100).toFixed(1)}%`
}
