// Per-dependency network flow model + helpers, shared across the
// application detail / create / edit views.
//
// Each declared application dependency can carry a `flows[]` array
// describing the network conversations that dependency requires
// (source → destination, protocol, ports, direction). The backend owns
// the contract; the frontend just renders, edits and exports it.
//
// `validation` is an OPTIONAL Phase-2 enrichment. It is absent today;
// callers must degrade gracefully (render nothing) when it's missing.

export type FlowProtocol = 'tcp' | 'udp' | 'icmp' | 'any'

export type FlowDirection = 'egress' | 'ingress' | 'bidirectional'

export type FlowValidationStatus = 'permitted' | 'not_permitted' | 'unknown'

export type FlowValidation = {
  status: FlowValidationStatus
  matched_rule?: string
  // Optional human-readable explanation of WHY a flow is (not) permitted —
  // surfaced as the badge tooltip. Part of the same Phase-2 enrichment.
  reason?: string
}

export type DependencyFlow = {
  source?: string
  destination?: string
  protocol?: FlowProtocol
  ports?: string
  description?: string
  direction?: FlowDirection
  // Optional Phase-2 enrichment — may be absent. Render nothing when so.
  validation?: FlowValidation
}

export const FLOW_PROTOCOLS: FlowProtocol[] = ['tcp', 'udp', 'icmp', 'any']

// Direction options for the edit selects. The empty string represents
// "unset" (no direction declared) and maps to `undefined` on save.
export const FLOW_DIRECTIONS: FlowDirection[] = ['egress', 'ingress', 'bidirectional']

// emptyFlow is the shape used when an operator clicks "Add flow". Protocol
// defaults to tcp (the overwhelmingly common case); everything else blank.
export function emptyFlow(): DependencyFlow {
  return { source: '', destination: '', protocol: 'tcp', ports: '', direction: undefined, description: '' }
}

// cleanFlows normalizes the edit-form flow rows into the persisted shape:
// trims strings, drops empty optional fields, and discards rows that have
// neither a source nor a destination (an operator clicked Add but never
// filled it in). Validation is never written from the client.
export function cleanFlows(flows: DependencyFlow[] | undefined): DependencyFlow[] {
  if (!Array.isArray(flows)) return []
  const out: DependencyFlow[] = []
  for (const f of flows) {
    const source = (f.source ?? '').trim()
    const destination = (f.destination ?? '').trim()
    const ports = (f.ports ?? '').trim()
    const description = (f.description ?? '').trim()
    if (!source && !destination && !ports && !description) continue
    const row: DependencyFlow = {
      source: source || undefined,
      destination: destination || undefined,
      protocol: f.protocol ?? 'tcp',
      ports: ports || undefined,
      description: description || undefined,
    }
    if (f.direction) row.direction = f.direction
    out.push(row)
  }
  return out
}

// validationTone maps a flow validation status to an AttestivUi Badge tone.
export function validationTone(status: FlowValidationStatus): 'green' | 'red' | 'gray' {
  switch (status) {
    case 'permitted':
      return 'green'
    case 'not_permitted':
      return 'red'
    default:
      return 'gray'
  }
}

// --- CSV export -----------------------------------------------------------

// Minimal RFC-4180-ish quoting: wrap in quotes when the value contains a
// comma, quote or newline, doubling embedded quotes. Mirrors the inline
// escaping used by the Risks page export.
export function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
}

export const FLOW_CSV_HEADER = [
  'dependency_application_id',
  'source',
  'destination',
  'protocol',
  'ports',
  'direction',
  'description',
] as const

// A dependency, reduced to the only fields the flow export needs.
export type FlowExportDependency = {
  application_id?: string
  flows?: DependencyFlow[]
}

// buildFlowsCsv flattens every flow across all dependencies into one CSV
// string (header + one row per flow). Dependencies without flows
// contribute nothing.
export function buildFlowsCsv(dependencies: FlowExportDependency[] | undefined): string {
  const lines: string[] = [FLOW_CSV_HEADER.join(',')]
  for (const dep of dependencies ?? []) {
    for (const f of dep.flows ?? []) {
      lines.push(
        [
          csvCell(dep.application_id),
          csvCell(f.source),
          csvCell(f.destination),
          csvCell(f.protocol),
          csvCell(f.ports),
          csvCell(f.direction),
          csvCell(f.description),
        ].join(','),
      )
    }
  }
  return lines.join('\n')
}

// countFlows totals the flows across all dependencies — used to enable /
// disable the export action.
export function countFlows(dependencies: FlowExportDependency[] | undefined): number {
  let n = 0
  for (const dep of dependencies ?? []) n += dep.flows?.length ?? 0
  return n
}

// --- Flow-validation enrichment (Phase-2) ---------------------------------
//
// GET /apps/{id}/flow-validation returns, per declared flow, whether the
// firewall rule-base permits it. The detail page builds a lookup keyed by
// the flow's identifying tuple and attaches the result as `validation` on
// each displayed flow so the existing badge lights up. The frontend never
// writes these back (cleanFlows strips validation on save).

// One evaluated flow as returned by the backend. The first four fields plus
// the owning dependency's application_id form the matching key.
export type FlowValidationEntry = {
  dependency_application_id?: string
  source?: string
  destination?: string
  protocol?: string
  ports?: string
  status: FlowValidationStatus
  matched_rule?: string
  reason?: string
}

export type FlowValidationResponse = {
  application_id?: string
  flows?: FlowValidationEntry[]
  rules_evaluated?: number
  firewalls?: number
}

// flowValidationKey builds the stable lookup key for a flow. The same
// function is used for both sides of the match — the backend entry and the
// displayed flow — so the field order and normalization stay identical.
// Keyed by dependency_application_id | source | destination | protocol | ports.
export function flowValidationKey(parts: {
  dependency_application_id?: string
  source?: string
  destination?: string
  protocol?: string
  ports?: string
}): string {
  return [
    parts.dependency_application_id ?? '',
    parts.source ?? '',
    parts.destination ?? '',
    parts.protocol ?? '',
    parts.ports ?? '',
  ].join('|')
}

// buildFlowValidationLookup turns a flow-validation response into a Map from
// flowValidationKey → FlowValidation, ready to attach onto displayed flows.
export function buildFlowValidationLookup(
  response: FlowValidationResponse | null | undefined,
): Map<string, FlowValidation> {
  const lookup = new Map<string, FlowValidation>()
  for (const e of response?.flows ?? []) {
    const key = flowValidationKey({
      dependency_application_id: e.dependency_application_id,
      source: e.source,
      destination: e.destination,
      protocol: e.protocol,
      ports: e.ports,
    })
    lookup.set(key, { status: e.status, matched_rule: e.matched_rule, reason: e.reason })
  }
  return lookup
}

// --- Flow suggestions (edit page) -----------------------------------------
//
// GET /apps/{id}/flow-suggestions proposes flows the operator likely needs,
// resolved to concrete source/destination addresses. The editor appends the
// matching dependency's suggestions as new flow rows.

export type FlowSuggestion = {
  dependency_application_id?: string
  source?: string
  destination?: string
  protocol?: FlowProtocol
  ports?: string
  source_addresses?: string[]
  destination_addresses?: string[]
}

export type FlowSuggestionsResponse = {
  application_id?: string
  suggestions?: FlowSuggestion[]
}

// suggestionToFlow maps one suggestion onto the editor's flow-row shape,
// using emptyFlow() as the base so unspecified fields keep their defaults.
export function suggestionToFlow(s: FlowSuggestion): DependencyFlow {
  return {
    ...emptyFlow(),
    source: s.source ?? '',
    destination: s.destination ?? '',
    protocol: s.protocol ?? 'tcp',
    ports: s.ports ?? '',
  }
}
