// vulnerabilities.ts — pure derivation logic for the per-asset
// vulnerability card and the fleet vulnerability view.
//
// Both surfaces read the ADDITIVE backend endpoints
//   GET /v1/inventory/assets/{id}/vulnerabilities
//   GET /v1/vulnerabilities
// which older backends do not expose. The single most important rule
// lives here: an asset that is NOT covered by any vulnerability source
// (scanner_coverage=false, or the endpoint 404s on an older backend)
// must render "not scanned" — never an empty list that implies clean.
// Keeping that decision in a pure function makes it testable without
// mounting the page.

export type VulnSeverity = 'critical' | 'high' | 'medium' | 'low'

export type VulnItem = {
  cve_id: string
  severity?: string
  cvss?: number
  title?: string
  product?: string
  version?: string
  source?: string
  source_type?: string
  match_confidence?: string
  state?: string
  first_found?: string
  last_found?: string
  days_open?: number
  is_kev?: boolean
  kev_due_date?: string
  kev_ransomware?: string
  solution?: string
}

export type VulnSummary = {
  critical?: number
  high?: number
  medium?: number
  low?: number
  kev?: number
  sources?: string[]
  scanner_coverage?: boolean
  newest_observed_at?: string
  oldest_open_days?: number
}

export type AssetVulnResponse = {
  asset_id: string
  count?: number
  summary?: VulnSummary
  items?: VulnItem[]
  limit?: number
  offset?: number
  truncated?: boolean
}

export type FleetVulnItem = VulnItem & {
  asset_id?: string
  hostname?: string
}

export type FleetVulnResponse = {
  count?: number
  items?: FleetVulnItem[]
  limit?: number
  offset?: number
  truncated?: boolean
}

// ---------------------------------------------------------------------------
// Severity presentation

// Badge tones for the shared <Badge> component. Medium maps to blue
// (informational), not amber — amber is reserved for high so the two
// stay distinguishable at a glance.
export type VulnTone = 'red' | 'amber' | 'blue' | 'gray'

export function severityTone(severity: string | undefined): VulnTone {
  switch (String(severity ?? '').toLowerCase()) {
    case 'critical':
      return 'red'
    case 'high':
      return 'amber'
    case 'medium':
      return 'blue'
    default:
      return 'gray'
  }
}

// English seed labels for the severity chips — resolved through t()
// at render time (the keys already exist in every locale catalog).
export const SEVERITY_LABELS: Record<VulnSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

export type SeverityChip = {
  key: VulnSeverity | 'kev'
  label: string
  count: number
  tone: VulnTone
}

// Chips for the summary row, in fixed critical→low order with KEV
// appended. Zero-count severities are kept (an explicit "0 critical"
// is information); the KEV chip is dropped at zero to avoid alarming
// red chrome with nothing behind it.
export function severityChips(summary: VulnSummary | undefined): SeverityChip[] {
  const s = summary ?? {}
  const chips: SeverityChip[] = (
    ['critical', 'high', 'medium', 'low'] as VulnSeverity[]
  ).map((key) => ({
    key,
    label: SEVERITY_LABELS[key],
    count: Number(s[key] ?? 0),
    tone: severityTone(key),
  }))
  const kev = Number(s.kev ?? 0)
  if (kev > 0) chips.push({ key: 'kev', label: 'KEV', count: kev, tone: 'red' })
  return chips
}

// ---------------------------------------------------------------------------
// Match confidence

// The backend joins scanner findings to inventory assets. When the join
// is a name-only software match without a version pin, host attribution
// is weak — surface it rather than presenting it as scanner truth.
export const WEAK_MATCH_CONFIDENCE = 'scanner_inventory_join_unversioned'

export function isWeakMatch(item: Pick<VulnItem, 'match_confidence'>): boolean {
  return item.match_confidence === WEAK_MATCH_CONFIDENCE
}

// "product@version" cell text; falls back to the bare product (or the
// CVE title) when no version was reported.
export function productLabel(item: Pick<VulnItem, 'product' | 'version' | 'title'>): string {
  const product = String(item.product ?? '').trim()
  const version = String(item.version ?? '').trim()
  if (product && version) return `${product}@${version}`
  if (product) return product
  return String(item.title ?? '').trim() || '—'
}

// ---------------------------------------------------------------------------
// Per-asset card state

export type AssetVulnOutcome =
  | { kind: 'loading' }
  | { kind: 'loaded'; body: AssetVulnResponse }
  // Any fetch failure. status carries the HTTP code when known — 404
  // means an older backend without the endpoint; either way the card
  // may not imply the asset is clean.
  | { kind: 'error'; status?: number }

export type AssetVulnCard =
  | { state: 'loading' }
  | { state: 'not_scanned' }
  | { state: 'clean'; summary: VulnSummary }
  | { state: 'populated'; summary: VulnSummary; items: VulnItem[]; count: number }

export function deriveAssetVulnCard(outcome: AssetVulnOutcome): AssetVulnCard {
  if (outcome.kind === 'loading') return { state: 'loading' }
  // 404 (older backend) and every other failure fold into "not
  // scanned": we cannot distinguish "no findings" from "no visibility",
  // and only the pessimistic reading is safe to render.
  if (outcome.kind === 'error') return { state: 'not_scanned' }
  const body = outcome.body ?? {}
  const summary = body.summary ?? {}
  if (summary.scanner_coverage !== true) return { state: 'not_scanned' }
  const items = Array.isArray(body.items) ? body.items : []
  const count = Number(body.count ?? items.length)
  if (count <= 0 && items.length === 0) return { state: 'clean', summary }
  return { state: 'populated', summary, items, count }
}

// ---------------------------------------------------------------------------
// Fleet query + view state

export type FleetFilters = {
  // Exact inventory asset filter (additive backend param) — the deep
  // link from the asset detail card. Distinct from the free-text q.
  assetId?: string
  severity?: string
  source?: string
  kev?: boolean
  q?: string
  limit?: number
  offset?: number
}

// Query string for GET /v1/vulnerabilities. Empty/unset filters are
// omitted; kev is only ever sent as kev=true (unchecked means "no KEV
// filter", not kev=false). Parameter order is fixed so the string is
// stable for effect dependencies and tests.
export function buildFleetQuery(filters: FleetFilters): string {
  const params = new URLSearchParams()
  const assetId = String(filters.assetId ?? '').trim()
  if (assetId) params.set('asset_id', assetId)
  const severity = String(filters.severity ?? '').trim().toLowerCase()
  if (severity) params.set('severity', severity)
  if (filters.kev === true) params.set('kev', 'true')
  const source = String(filters.source ?? '').trim()
  if (source) params.set('source', source)
  const q = String(filters.q ?? '').trim()
  if (q) params.set('q', q)
  if (filters.limit != null && filters.limit > 0) params.set('limit', String(filters.limit))
  if (filters.offset != null && filters.offset > 0) params.set('offset', String(filters.offset))
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

export type FleetOutcome =
  | { kind: 'loading' }
  | { kind: 'loaded'; body: FleetVulnResponse }
  | { kind: 'error'; status?: number; message?: string }

export type FleetView =
  | { state: 'loading' }
  // Older backend without GET /v1/vulnerabilities.
  | { state: 'unsupported' }
  | { state: 'error'; message: string }
  | { state: 'loaded'; items: FleetVulnItem[]; count: number; truncated: boolean }

export function deriveFleetView(outcome: FleetOutcome): FleetView {
  if (outcome.kind === 'loading') return { state: 'loading' }
  if (outcome.kind === 'error') {
    if (outcome.status === 404) return { state: 'unsupported' }
    return { state: 'error', message: outcome.message || 'Request failed' }
  }
  const body = outcome.body ?? {}
  const items = Array.isArray(body.items) ? body.items : []
  return {
    state: 'loaded',
    items,
    count: Number(body.count ?? items.length),
    truncated: body.truncated === true,
  }
}

// Offset-based paging ↔ the shared <Pagination> component's page model.
export function pageFromOffset(offset: number, limit: number): number {
  if (!(limit > 0)) return 0
  return Math.max(0, Math.floor(offset / limit))
}

export function offsetFromPage(page: number, limit: number): number {
  if (!(limit > 0)) return 0
  return Math.max(0, page) * limit
}

// Deep link from an asset's card into the fleet view, using the exact
// asset_id filter (additive backend param) rather than the free-text q
// — no false positives from similarly-named hosts.
export function fleetHrefForAsset(assetID: string): string {
  return `/evidence/vulnerabilities?asset_id=${encodeURIComponent(assetID)}`
}
