// User-access network model + helpers, shared across the application
// detail / create / edit views.
//
// An application can declare, alongside its `dependencies`, WHERE its users
// connect FROM: an external network, a private LAN, over VPN, a partner
// network, the public internet, or something else. Each entry describes
// that ingress conversation (network type + optional source range /
// protocol / ports / description). The backend owns the contract; the
// frontend just renders, edits and exports it.
//
// Mirrors src/lib/appFlows.ts in shape and intent: a single-source-of-truth
// type, an `emptyUserAccess()` for the "Add row" action, a `cleanUserAccess()`
// that normalizes the edit-form rows into the persisted shape, plus the
// label / tone helpers the badge uses.

export type NetworkType = 'external' | 'private' | 'vpn' | 'partner' | 'internet' | 'other'

export type UserAccessNetwork = {
  network_type: NetworkType
  source?: string
  protocol?: string
  ports?: string
  description?: string
}

// The six network types, in the order they appear in the edit selects.
export const NETWORK_TYPES: NetworkType[] = [
  'external',
  'private',
  'vpn',
  'partner',
  'internet',
  'other',
]

// networkTypeLabel maps a network type to its friendly, human-readable label.
// Falls back to the raw value for any unrecognised type so a future backend
// addition still renders something sensible rather than blank.
export function networkTypeLabel(type: NetworkType | string): string {
  switch (type) {
    case 'external':
      return 'External Network'
    case 'private':
      return 'Private Network'
    case 'vpn':
      return 'VPN'
    case 'partner':
      return 'Partner Network'
    case 'internet':
      return 'Internet'
    case 'other':
      return 'Other'
    default:
      return String(type)
  }
}

// networkTypeTone maps a network type to an AttestivUi Badge tone, so the
// higher-exposure networks read hotter: internet = red (public), external =
// amber (untrusted edge), private = navy (trusted LAN), vpn = blue (tunnelled),
// everything else = gray.
export function networkTypeTone(
  type: NetworkType | string,
): 'green' | 'amber' | 'red' | 'blue' | 'navy' | 'gray' {
  switch (type) {
    case 'internet':
      return 'red'
    case 'external':
      return 'amber'
    case 'private':
      return 'navy'
    case 'vpn':
      return 'blue'
    default:
      return 'gray'
  }
}

// emptyUserAccess is the shape used when an operator clicks "Add user access".
// network_type defaults to external (the common "users connect from outside"
// case); everything else blank.
export function emptyUserAccess(): UserAccessNetwork {
  return { network_type: 'external', source: '', protocol: '', ports: '', description: '' }
}

// cleanUserAccess normalizes the edit-form rows into the persisted shape:
// trims strings, drops empty optional fields, and discards rows that carry no
// meaningful data beyond the network_type default (an operator clicked Add but
// never filled anything in). network_type is always kept.
export function cleanUserAccess(
  entries: UserAccessNetwork[] | undefined,
): UserAccessNetwork[] {
  if (!Array.isArray(entries)) return []
  const out: UserAccessNetwork[] = []
  for (const e of entries) {
    const source = (e.source ?? '').trim()
    const protocol = (e.protocol ?? '').trim()
    const ports = (e.ports ?? '').trim()
    const description = (e.description ?? '').trim()
    // A row with only the default network_type and nothing else is an
    // un-filled "Add" click — drop it. Rows with any detail are kept.
    if (!source && !protocol && !ports && !description) continue
    const row: UserAccessNetwork = { network_type: e.network_type }
    if (source) row.source = source
    if (protocol) row.protocol = protocol
    if (ports) row.ports = ports
    if (description) row.description = description
    out.push(row)
  }
  return out
}

// countUserAccess totals the user-access entries — used to enable / disable
// the flow-export action on the detail page.
export function countUserAccess(entries: UserAccessNetwork[] | undefined): number {
  return Array.isArray(entries) ? entries.length : 0
}
