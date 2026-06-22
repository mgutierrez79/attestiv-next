// Per-control "How did I pass?" explainability — frozen-contract types
// and the pure logic the drill-down UI is built on.
//
// The component layer (ControlBreakdownPanels.tsx + the control-evidence
// detail page) stays thin and presentational; everything that can be
// expressed as a pure transform of the backend response lives here so it
// is unit-testable under the node-environment Vitest runner (no DOM).
//
// Backed by GET /v1/scoring/frameworks/{fid}/controls/{cid}/breakdown.
// Every field is optional (the backend uses omitempty) — code defensively
// and never assume an array/object is present.

// --- Frozen contract -----------------------------------------------------

export type PresentationMode = 'proportional' | 'gate' | 'event' | 'attestation'

export type CitationStatus = 'verified' | 'draft' | 'derived' | string

export type ControlNarrative = {
  // Obligation first: what the control asks for. Rendered as the lead.
  requirement?: string
  citation?: string
  citation_status?: CitationStatus
  // How we measured it.
  method?: string
  // What we found.
  result?: string
  // The gap, in plain prose.
  gap?: string
  // What to do about it.
  remediation?: string
}

export type Measured = {
  numerator?: number
  denominator?: number
  current_pct?: number
}

export type Threshold = {
  pass_pct?: number
  review_pct?: number
  warn_pct?: number
  source?: string
}

export type ConfidenceLevel = 'high' | 'medium' | 'low' | string

export type Confidence = {
  level?: ConfidenceLevel
  reason?: string
  healthy_sources?: number
  total_sources?: number
}

export type ProvenanceSource = {
  connector?: string
  pre_dedup_count?: number
  // healthy + stale are always present on the wire; branch on those. The
  // backend does NOT send a `status` string — kept optional/unused for
  // defensive back-compat only.
  status?: string
  healthy?: boolean
  stale?: boolean
  last_success?: string
}

export type Unmergeable = {
  count?: number
  reason?: string
}

export type Provenance = {
  dedup_rule?: string
  dedup_rule_version?: string
  sources?: ProvenanceSource[]
  // Connectors that should have reported but returned nothing.
  silent_sources?: string[]
  unmergeable?: Unmergeable
}

export type Freshness = {
  as_of?: string
  degraded?: boolean
}

// ObservedBy — each failing item is attributed to one or more sources that
// reported it. The wire shape is an array of objects (source + optional
// asset_id), NOT a bare string[]. The UI renders the source names.
export type ObservedBy = {
  source?: string
  asset_id?: string
}

export type FailingItem = {
  id?: string
  name?: string
  asset_type?: string
  owner?: string
  business_unit?: string
  criticality?: string
  crown_jewel?: boolean
  observed_by?: ObservedBy[]
}

// observedBySources flattens observed_by to the distinct source names for
// rendering (e.g. "cmdb, tenable"). Defensive against absent/blank entries.
export function observedBySources(observed?: ObservedBy[]): string[] {
  if (!observed || observed.length === 0) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const o of observed) {
    const s = (o?.source ?? '').trim()
    if (s && !seen.has(s)) {
      seen.add(s)
      out.push(s)
    }
  }
  return out
}

export type GroupCount = {
  // Generic bucket: key is the dimension value (owner name, BU, criticality).
  key?: string
  count?: number
}

export type Grouping = {
  by_owner?: GroupCount[]
  by_business_unit?: GroupCount[]
  by_criticality?: GroupCount[]
  unowned_count?: number
  crown_jewel_count?: number
}

export type Reconciliation = Record<string, unknown> & {
  // Optional cross-check between the snapshot the control was scored
  // against and the live data. Mirrors AsScored.consistency when present.
  consistency_with_scored?: string
}

// AsScored — the additive "as scored" snapshot block. Lets the drill-down
// say whether what the auditor is looking at now is the same inventory the
// control was scored against, or a live recompute drifted since scoring.
// Every field is optional (omitempty); branch on `consistency`.
export type AsScoredConsistency =
  | 'consistent'
  | 'inventory_changed_since_scoring'
  | 'no_snapshot'
  | 'not_reconcilable'

export type AsScoredPerSource = Record<string, unknown>

export type AsScored = {
  scored_at?: string
  run_id?: string
  framework_source_hash?: string
  numerator?: number | null
  denominator?: number | null
  per_source?: AsScoredPerSource[]
  dedup_rule_version?: string
  failing_digest?: string
  consistency?: AsScoredConsistency | string
}

// Risks carry a severity but NO due/overdue (those belong to tasks only).
export type LinkedRisk = {
  risk_id?: string
  title?: string
  status?: string
  severity?: string
  owner?: string
  auto_created?: boolean
}

// Tasks carry a due_date + past_due flag (the wire names — NOT due/overdue).
export type LinkedTask = {
  task_id?: string
  title?: string
  status?: string
  owner?: string
  due_date?: string
  past_due?: boolean
  auto_created?: boolean
}

export type LinkageRollup = {
  gaps?: number
  open_risks?: number
  open_tasks?: number
  overdue_tasks?: number
  accepted_exceptions?: number
}

export type Linkage = {
  risks?: LinkedRisk[]
  remediation_tasks?: LinkedTask[]
  rollup?: LinkageRollup
}

export type ControlBreakdown = {
  framework_id?: string
  control_id?: string
  presentation_mode?: PresentationMode
  // Mirrors the scored control status (pass/review/warn/fail). Additive —
  // may be used to tone the panel header.
  status?: string
  narrative?: ControlNarrative
  measured?: Measured
  threshold?: Threshold
  confidence?: Confidence
  provenance?: Provenance
  freshness?: Freshness
  failing_items?: FailingItem[]
  grouping?: Grouping
  reconciliation?: Reconciliation
  linkage?: Linkage
  // Additive "as scored" consistency snapshot (optional). See AsScored.
  as_scored?: AsScored
  // NOTE: attestation mode carries NO dedicated block — the backend sends
  // narrative + threshold + linkage only. There is no `attestation` object.
  as_recomputed_at?: string
}

// --- Pure logic ----------------------------------------------------------

// resolvePresentationMode falls back to 'proportional' (the canonical CMDB
// case) when the backend omits the mode or sends an unrecognised value, so
// the layout always has a defined branch.
const KNOWN_MODES: PresentationMode[] = ['proportional', 'gate', 'event', 'attestation']
export function resolvePresentationMode(mode?: string): PresentationMode {
  return KNOWN_MODES.includes(mode as PresentationMode)
    ? (mode as PresentationMode)
    : 'proportional'
}

// citationVerified — only an explicit "verified" status counts. Anything
// else (draft / derived / missing) must show the "do not rely on in audit"
// caption. Defaults to false so an absent status never reads as verified.
export function citationVerified(status?: string): boolean {
  return (status ?? '').toLowerCase() === 'verified'
}

// NarrativeBlock — the obligation-first ordering the lead renders. The
// requirement ("the control asks for…") always comes first; remaining
// prose follows in method → result → gap → remediation order. Absent
// fields are dropped (omitempty) rather than rendered as empty paragraphs.
export type NarrativeLine = {
  key: 'requirement' | 'method' | 'result' | 'gap' | 'remediation'
  text: string
}

export function narrativeLines(n?: ControlNarrative): NarrativeLine[] {
  if (!n) return []
  const order: NarrativeLine['key'][] = ['requirement', 'method', 'result', 'gap', 'remediation']
  const lines: NarrativeLine[] = []
  for (const key of order) {
    const text = (n[key] ?? '').trim()
    if (text) lines.push({ key, text })
  }
  return lines
}

// confidenceTone maps a measurement-confidence level to a badge tone. This
// is DISTINCT from the compliance-score tone (scoreTone): a control can be
// 100% compliant on low-confidence data, and the badge must read amber/red
// to flag that, independent of the green score.
export function confidenceTone(level?: string): 'green' | 'amber' | 'red' | 'gray' {
  switch ((level ?? '').toLowerCase()) {
    case 'high': return 'green'
    case 'medium': return 'amber'
    case 'low': return 'red'
    default: return 'gray'
  }
}

// confidenceSummary builds the "Confidence: medium · 2 of 6 sources stale"
// style caption from the confidence block. Returns null when there's
// nothing meaningful to show.
export function confidenceSummary(c?: Confidence): { level: string; detail: string } | null {
  if (!c || (!c.level && !c.reason && c.total_sources == null)) return null
  const level = (c.level ?? 'unknown').toLowerCase()
  const parts: string[] = []
  if (c.reason) parts.push(c.reason)
  else if (typeof c.healthy_sources === 'number' && typeof c.total_sources === 'number') {
    const stale = Math.max(0, c.total_sources - c.healthy_sources)
    if (c.total_sources > 0) parts.push(`${stale} of ${c.total_sources} sources stale`)
  }
  return { level, detail: parts.join(' · ') }
}

// measuredHeadline renders the "1,236 / 1,420 = 87%, needs 95%" line. Uses
// the numerator/denominator when both present; falls back to current_pct.
// Returns null when there's no measurable headline (e.g. event mode with a
// zero denominator — handled separately so we never print "/ 0 = NaN%").
export function measuredHeadline(
  measured?: Measured,
  threshold?: Threshold,
): { ratio: string | null; pct: string | null; needs: string | null } | null {
  if (!measured && !threshold) return null
  const num = measured?.numerator
  const den = measured?.denominator
  let ratio: string | null = null
  let pct: string | null = null
  if (typeof num === 'number' && typeof den === 'number' && den > 0) {
    ratio = `${formatCount(num)} / ${formatCount(den)}`
    pct = `${Math.round((num / den) * 100)}%`
  } else if (typeof measured?.current_pct === 'number') {
    pct = `${Math.round(measured.current_pct)}%`
  }
  const needs =
    typeof threshold?.pass_pct === 'number' ? `${Math.round(threshold.pass_pct)}%` : null
  if (!ratio && !pct && !needs) return null
  return { ratio, pct, needs }
}

// formatCount adds thousands separators ("1236" → "1,236") for board
// readability without depending on a locale at render time.
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  return n.toLocaleString('en-US')
}

// linkageRollupSummary renders the one-line rollup
// ("184 gaps · 1 open risk · 3 tasks (1 overdue) · 0 accepted exceptions").
// Pluralisation-ready via the caller's translator; here we return the raw
// counts so the component can localise.
export function hasOpenLinkage(linkage?: Linkage): boolean {
  const openRisks = (linkage?.risks ?? []).some((r) => isOpenStatus(r.status))
  const openTasks = (linkage?.remediation_tasks ?? []).some((t) => isOpenStatus(t.status))
  const rollupRisks = linkage?.rollup?.open_risks ?? 0
  const rollupTasks = linkage?.rollup?.open_tasks ?? 0
  return openRisks || openTasks || rollupRisks > 0 || rollupTasks > 0
}

function isOpenStatus(status?: string): boolean {
  const s = (status ?? '').toLowerCase()
  if (!s) return false
  // Anything not in a terminal state counts as "open / in flight".
  return !['closed', 'resolved', 'done', 'accepted', 'cancelled', 'rejected'].includes(s)
}

// remediationTaskHref builds the deep-link the linkage panel points a task
// row at. There is NO /remediation/[id] detail route — only the list page —
// so we link to the list with a ?task= query param the page deep-link
// handling highlights and scrolls into view. This can never 404. (Risks DO
// have a /risks/[id] route, so those keep their path-segment link.)
export function remediationTaskHref(taskId?: string): string {
  return `/remediation?task=${encodeURIComponent(taskId ?? '')}`
}

// isHighlightedTask answers "should this remediation row render highlighted,
// given the ?task= deep-link param?" The breakdown linkage's task_id equals
// the remediation task's .id. Blank/absent on either side never matches, so
// a plain /remediation visit highlights nothing.
export function isHighlightedTask(rowId?: string, highlightId?: string | null): boolean {
  const id = (rowId ?? '').trim()
  const target = (highlightId ?? '').trim()
  return id !== '' && id === target
}

// CSV export ---------------------------------------------------------------
// Columns match the FailingItem shape the gap-list table renders. Reuses the
// quoting rules from the Risks CSV pattern (escape comma / quote / newline).

export const FAILING_ITEM_CSV_COLUMNS: (keyof FailingItem)[] = [
  'id',
  'name',
  'asset_type',
  'owner',
  'business_unit',
  'criticality',
  'crown_jewel',
]

function csvCell(value: unknown): string {
  let s: string
  if (value == null) s = ''
  else if (typeof value === 'boolean') s = value ? 'true' : 'false'
  else s = String(value)
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s
}

export function failingItemsToCSV(items: FailingItem[]): string {
  const header = FAILING_ITEM_CSV_COLUMNS.join(',')
  const rows = items.map((item) =>
    FAILING_ITEM_CSV_COLUMNS.map((col) => csvCell(item[col])).join(','),
  )
  return [header, ...rows].join('\n')
}

// groupingCallouts surfaces the two numbers an auditor reads first — how
// many failing assets are unowned, and how many are crown jewels. Falls
// back to deriving them from failing_items when the backend omits the
// pre-computed counts.
export function groupingCallouts(
  grouping?: Grouping,
  failingItems?: FailingItem[],
): { unowned: number; crownJewel: number } {
  let unowned = grouping?.unowned_count
  let crownJewel = grouping?.crown_jewel_count
  if (typeof unowned !== 'number' || typeof crownJewel !== 'number') {
    const items = failingItems ?? []
    if (typeof unowned !== 'number') {
      unowned = items.filter((i) => !(i.owner ?? '').trim()).length
    }
    if (typeof crownJewel !== 'number') {
      crownJewel = items.filter((i) => i.crown_jewel === true).length
    }
  }
  return { unowned, crownJewel }
}

// asScoredBadge maps the "as scored" consistency state to a badge tone +
// message key. The reconciliation block may carry the same signal
// (consistency_with_scored) on a different code path, so we accept an
// optional fallback string and prefer the explicit as_scored.consistency.
//
// - consistent                      → neutral/green, "as scored · consistent"
// - inventory_changed_since_scoring → amber, "inventory changed … live recompute"
// - not_reconcilable                → muted/gray, "as scored · can't be
//                                      auto-reconciled" (honest, NOT an alarm —
//                                      the failing set can't be re-derived live)
// - no_snapshot / absent / unknown  → null (the component renders nothing,
//                                      or an optional muted "not yet scored")
export type AsScoredBadge = {
  tone: 'green' | 'amber' | 'gray'
  messageKey: string
  // Whether the scored_at timestamp is interpolated into the message.
  usesScoredAt: boolean
}

export function asScoredBadge(
  asScored?: AsScored,
  reconciliationConsistency?: string,
): AsScoredBadge | null {
  const consistency = (
    asScored?.consistency ??
    reconciliationConsistency ??
    ''
  )
    .toString()
    .trim()
    .toLowerCase()
  switch (consistency) {
    case 'consistent':
      return {
        tone: 'green',
        messageKey: 'control.breakdown.as_scored_consistent',
        usesScoredAt: true,
      }
    case 'inventory_changed_since_scoring':
      return {
        tone: 'amber',
        messageKey: 'control.breakdown.as_scored_changed',
        usesScoredAt: true,
      }
    case 'not_reconcilable':
      // Muted/neutral — same tone as no_snapshot, NOT green/amber. We're
      // honestly NOT claiming consistency, but it isn't an alarm either:
      // the failing set simply can't be re-derived live for this control.
      return {
        tone: 'gray',
        messageKey: 'control.breakdown.as_scored_not_reconcilable',
        usesScoredAt: true,
      }
    // no_snapshot, empty, or anything unrecognised → no badge.
    default:
      return null
  }
}

// --- Signed-breakdown export ---------------------------------------------
// The audit-grade signed export is a binary (application/zip) download. The
// fetch + blob + object-URL + anchor-click dance is side-effectful, so it
// lives here as a dependency-injected pure-ish function: the component wires
// in apiFetch and the real DOM, the test wires in fakes. This is how the
// node-environment Vitest runner can assert "called the right URL, triggered
// a download on 200, surfaced the 409" without a DOM.

// signedBreakdownExportPath builds the proxy path (apiFetch prepends /v1).
export function signedBreakdownExportPath(frameworkId: string, controlId: string): string {
  return `/scoring/frameworks/${encodeURIComponent(frameworkId)}/controls/${encodeURIComponent(controlId)}/breakdown/export`
}

// contentDispositionFilename pulls the filename out of a Content-Disposition
// header, preferring RFC 5987 filename*=UTF-8''… then a plain quoted/bare
// filename=. Returns null when there's nothing usable so the caller can fall
// back to a sensible default.
export function contentDispositionFilename(header?: string | null): string | null {
  if (!header) return null
  const star = header.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)
  if (star && star[1]) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, '')) || null
    } catch {
      // fall through to the plain filename
    }
  }
  const plain = header.match(/filename\s*=\s*("?)([^";]+)\1/i)
  if (plain && plain[2]) return plain[2].trim() || null
  return null
}

export type SignedExportOutcome =
  | { status: 'ok'; filename: string }
  | { status: 'needs_evaluation' } // HTTP 409 — no scored snapshot yet
  | { status: 'error' }

// Minimal surfaces we depend on, so tests can supply fakes.
export type ApiErrorLike = { status?: number }
export type SignedExportDeps = {
  apiFetch: (path: string) => Promise<{
    blob: () => Promise<Blob>
    headers: { get: (name: string) => string | null }
  }>
  createObjectURL: (blob: Blob) => string
  revokeObjectURL: (url: string) => void
  triggerDownload: (url: string, filename: string) => void
}

// downloadSignedBreakdown runs the export flow and maps the result to a
// discriminated outcome the UI tones on. It never throws: a 409 maps to
// 'needs_evaluation', anything else (other non-OK status, network error,
// blob failure) maps to 'error'. apiFetch is expected to throw on non-2xx
// (the project's apiFetch throws ApiError with a numeric `status`).
export async function downloadSignedBreakdown(
  frameworkId: string,
  controlId: string,
  deps: SignedExportDeps,
): Promise<SignedExportOutcome> {
  const path = signedBreakdownExportPath(frameworkId, controlId)
  try {
    const res = await deps.apiFetch(path)
    const blob = await res.blob()
    const filename =
      contentDispositionFilename(res.headers.get('content-disposition')) ??
      `breakdown-${frameworkId}-${controlId}.zip`
    const url = deps.createObjectURL(blob)
    try {
      deps.triggerDownload(url, filename)
    } finally {
      deps.revokeObjectURL(url)
    }
    return { status: 'ok', filename }
  } catch (err) {
    const status = (err as ApiErrorLike)?.status
    if (status === 409) return { status: 'needs_evaluation' }
    return { status: 'error' }
  }
}

// sourceIsStale — a provenance source counts as stale when explicitly
// flagged stale, when its status string says so, or when healthy is false.
export function sourceIsStale(source: ProvenanceSource): boolean {
  if (source.stale === true) return true
  if (source.healthy === false) return true
  return (source.status ?? '').toLowerCase() === 'stale'
}
