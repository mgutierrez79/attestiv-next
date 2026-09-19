// Discovery filters — the operator's exclusion rules that keep unwanted
// connector-discovered assets (lab VMs, templates, test appliances) out of
// the inventory. The backend (attestiv-go internal/discoveryfilter) owns
// validation and matching; this module only shapes the editor state and
// the request bodies for Settings ▸ Discovery filters.
//
// Backend API:
//   GET  /v1/settings/discovery-filters          -> { rules, last_run, known_sources, limits }
//   PUT  /v1/settings/discovery-filters          body: { rules }            (replaces the list)
//   POST /v1/settings/discovery-filters/preview  body: { rules }?           -> { evaluated, matched, rule_hits, items, truncated }
//   POST /v1/settings/discovery-filters/apply    body: { expected_matches } -> { deleted, failed, asset_ids, truncated }

export type DiscoveryMatchMode = 'contains' | 'exact' | 'glob' | 'regex'
export type DiscoveryField = 'any' | 'name' | 'asset_id' | 'asset_type' | 'source' | 'ip' | 'tag'

export const MATCH_MODES: DiscoveryMatchMode[] = ['contains', 'exact', 'glob', 'regex']
export const FIELDS: DiscoveryField[] = ['any', 'name', 'asset_id', 'asset_type', 'source', 'ip', 'tag']

export type DiscoveryFilterRule = {
  id?: string
  pattern: string
  match: DiscoveryMatchMode
  field: DiscoveryField
  source?: string
  enabled: boolean
  note?: string
  created_by?: string
  created_at?: string
  updated_by?: string
  updated_at?: string
}

export type DiscoveryFiltersResponse = {
  rules: DiscoveryFilterRule[]
  last_run: { at: string; evaluated: number; excluded: number; rule_hits: Record<string, number> } | null
  known_sources: string[]
  limits: { max_rules: number; max_pattern_length: number; max_note_length: number }
}

export type DiscoveryPreviewItem = {
  asset_id: string
  name?: string
  asset_type?: string
  sources: string[]
  rules: number[]
}

export type DiscoveryPreviewResponse = {
  evaluated: number
  matched: number
  // Per rule: matches among the inventory rows.
  rule_hits: number[]
  // Per rule: matches among the assets the connectors report right now —
  // non-zero for a rule whose matches were already kept out of the
  // inventory.
  connector_rule_hits?: number[]
  items: DiscoveryPreviewItem[]
  truncated: boolean
}

// DraftRule is a rule in the editor. `key` is a client-only React key so
// unsaved rows (no server id yet) keep their identity while edited.
export type DraftRule = DiscoveryFilterRule & { key: string }

let draftCounter = 0
function nextKey(): string {
  draftCounter += 1
  return `draft-${draftCounter}`
}

export function blankRule(): DraftRule {
  return { key: nextKey(), pattern: '', match: 'contains', field: 'any', source: '', enabled: true, note: '' }
}

export function toDrafts(rules: DiscoveryFilterRule[]): DraftRule[] {
  return rules.map((rule) => ({ ...rule, source: rule.source ?? '', note: rule.note ?? '', key: rule.id || nextKey() }))
}

// editable is the part of a rule the operator controls — what a save
// sends and what decides whether the editor has unsaved changes. The
// server owns the created/updated stamps, so they are left out.
function editable(rule: DiscoveryFilterRule) {
  return {
    id: rule.id || undefined,
    pattern: rule.pattern.trim(),
    match: rule.match,
    field: rule.field,
    source: (rule.source ?? '').trim().toLowerCase(),
    enabled: rule.enabled,
    note: (rule.note ?? '').trim(),
  }
}

// rulesToSave drops new rows left empty — the editor always offers a blank
// row to type into, and an untouched one is not a change. A saved rule
// whose text was cleared stays, so a save reports it instead of silently
// deleting the rule.
export function rulesToSave<T extends DiscoveryFilterRule>(rules: T[]): T[] {
  return rules.filter((rule) => Boolean(rule.id) || rule.pattern.trim() !== '')
}

export function rulesPayload(rules: DiscoveryFilterRule[]) {
  return { rules: rules.map(editable) }
}

export function rulesEqual(a: DiscoveryFilterRule[], b: DiscoveryFilterRule[]): boolean {
  if (a.length !== b.length) return false
  return a.every((rule, i) => JSON.stringify(editable(rule)) === JSON.stringify(editable(b[i])))
}

// firstRuleProblem catches what is obvious before a round trip: an empty
// pattern or one past the length limit. Everything else — regex syntax
// (RE2, not JavaScript's engine), match-everything patterns, duplicates —
// is the server's call, so a preview or save reports it.
export function firstRuleProblem(
  rules: DiscoveryFilterRule[],
  maxPatternLength: number,
): { index: number; problem: 'empty' | 'too_long' } | null {
  for (let i = 0; i < rules.length; i++) {
    const pattern = rules[i].pattern.trim()
    if (!pattern) return { index: i, problem: 'empty' }
    if (pattern.length > maxPatternLength) return { index: i, problem: 'too_long' }
  }
  return null
}

// connectorScopeKnown reports whether a rule's connector scope names a
// connector the platform knows (the list the server accepts). An empty
// scope means every connector.
export function connectorScopeKnown(source: string | undefined, known: string[]): boolean {
  const value = (source ?? '').trim().toLowerCase()
  if (!value) return true
  return known.some((k) => k.toLowerCase() === value)
}

// ruleMatchesNothing: an enabled rule the preview found no match for,
// neither in the inventory nor among what the connectors report — it can
// never exclude anything (typically a sentence typed as the pattern).
export function ruleMatchesNothing(
  rule: DiscoveryFilterRule,
  index: number,
  preview: DiscoveryPreviewResponse | null,
): boolean {
  if (!rule.enabled || !preview) return false
  const inventory = preview.rule_hits[index] ?? 0
  const connectors = preview.connector_rule_hits?.[index] ?? 0
  return inventory === 0 && connectors === 0
}
