// Provenance of a host IP address.
//
// The backend records, per host IP, where it learned the address from in
// `metadata.ip_sources` — a map of `{ "<ip>": "connector" | "ad_dns" | "dns_lookup" }`.
// A connector-reported IP is authoritative (the source system told us the box
// owns that address); a DNS-derived IP is weaker — it was resolved from an
// Active Directory record ("ad_dns") or a live forward lookup ("dns_lookup"),
// neither of which proves the host currently answers on it.
//
// The asset detail page badges the weaker (DNS) IPs so an operator/auditor can
// tell at a glance which addresses are second-hand. `ipSourceTag` is the pure
// mapping from a raw source value to that badge decision + tooltip; it is
// deliberately UI-free (returns i18n source strings, not rendered nodes) so it
// can be unit-tested and reused.

export type IpSourceTag = {
  // English source string for the compact badge label (passed through t()).
  label: string
  // English source string for the hover tooltip (passed through t()), tuned to
  // distinguish an AD DNS record from a live DNS lookup.
  tooltip: string
}

// Tooltip source strings — kept as module constants so the i18n catalog keys
// and the test assertions reference one definition.
const TOOLTIP_AD_DNS =
  'Resolved from an Active Directory DNS record — not directly reported by a connector.'
const TOOLTIP_DNS_LOOKUP =
  'Resolved from a live DNS lookup — not directly reported by a connector.'
const TOOLTIP_GENERIC = 'Resolved from DNS — not directly reported by a connector.'

// ipSourceTag returns the badge descriptor for a host IP's provenance, or
// `null` when the IP needs no badge.
//
// No badge is shown for:
//   - connector-sourced IPs (authoritative)
//   - IPs absent from ip_sources (undefined source — treated as connector-grade,
//     i.e. we have no signal that it's DNS-derived, so we don't weaken it)
//   - an absent/empty ip_sources map (defensive: old assets, or hosts the new
//     backend field hasn't populated yet)
//
// A "DNS" badge IS shown for `ad_dns` and `dns_lookup`, with a tooltip that
// distinguishes the two. The comparison is case-insensitive and trims stray
// whitespace so minor backend formatting drift doesn't silently drop the badge.
export function ipSourceTag(source: string | undefined | null): IpSourceTag | null {
  const normalized = String(source ?? '').trim().toLowerCase()
  switch (normalized) {
    case 'ad_dns':
      return { label: 'DNS', tooltip: TOOLTIP_AD_DNS }
    case 'dns_lookup':
      return { label: 'DNS', tooltip: TOOLTIP_DNS_LOOKUP }
    case 'dns':
      // Defensive: a bare "dns" value (no AD/live distinction) still gets the
      // generic DNS marker rather than being mistaken for a connector source.
      return { label: 'DNS', tooltip: TOOLTIP_GENERIC }
    default:
      // 'connector', '', or anything unrecognised → no badge.
      return null
  }
}
