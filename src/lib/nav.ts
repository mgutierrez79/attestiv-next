// nav.ts — the console's navigation model and its location resolver.
//
// Extracted from AttestivLayout so the shell, the command palette and
// the breadcrumb all read one source of truth for "what sections and
// pages exist" and — the part that was missing — "which one am I on
// right now".
//
// resolveNavLocation() answers that second question. The check it
// replaces compared usePathname() against item.to with === /
// startsWith, which silently failed for the two commonest route shapes
// in this nav:
//
//   - query-string entries (/inventory?asset_type=vm). usePathname()
//     drops the query, so they never matched and the section root
//     ("All assets") stayed lit on every filtered view.
//   - detail routes (/inventory/{id}). The guard excluded the section
//     root from prefix matching, so a detail page lit nothing at all.
//
// Plus /scoring/* — reachable only from the Frameworks sidebar —
// matched no rail prefix and fell through to the dashboard default, so
// opening "Coverage by evidence" threw the rail back to Dashboard.
//
// Scoring every candidate and keeping the most specific one fixes all
// three, and hands the breadcrumb its ancestor chain for free.

import type { NavDestination } from '../components/CommandPalette'
// Translation keys for the rail tooltips. Kept as a side table rather
// than added to each RailItem so the rail definition stays a plain
// data declaration; the renderer pulls the key when it resolves the
// localised label.
export const RAIL_LABEL_TKEY: Record<SectionKey, string> = {
  dashboard: 'nav.dashboard',
  management: 'nav.management',
  connectors: 'nav.connectors',
  evidence: 'nav.evidence',
  frameworks: 'nav.frameworks',
  apps: 'nav.apps',
  sites: 'nav.sites',
  inventory: 'nav.inventory',
  risks: 'nav.risks',
  policies: 'nav.policies',
  exceptions: 'nav.exceptions',
  remediation: 'nav.remediation',
  incidents: 'nav.incidents',
  thirdparties: 'nav.third_parties',
  dr: 'nav.dr',
  audit: 'nav.audit',
  settings: 'nav.settings',
}

export type SectionKey =
  | 'dashboard'
  | 'management'
  | 'connectors'
  | 'evidence'
  | 'frameworks'
  | 'apps'
  | 'sites'
  | 'inventory'
  | 'risks'
  | 'policies'
  | 'exceptions'
  | 'remediation'
  | 'incidents'
  | 'thirdparties'
  | 'dr'
  | 'audit'
  | 'settings'

export type RailItem = {
  key: SectionKey
  label: string
  icon: string
  prefix: string
}

export type NavItem = {
  to: string
  label: string
  icon: string
  badge?: 'issues' | 'dlq'
}

export type Section = {
  key: SectionKey
  navLabel: string
  items: NavItem[]
}

// Top-rail order matches the mockup. "Settings" is pinned to the
// bottom via a flex spacer so admin-only entries don't crowd the
// daily-use rail.
export const railTop: RailItem[] = [
  { key: 'dashboard',  label: 'Dashboard',  icon: 'ti-layout-dashboard', prefix: '/dashboard' },
  // Management is the explicit boundary for non-auditor consumption
  // (ROI, financial posture, what-if scenarios). Excluded from
  // auditorAllowedPrefixes — auditor tokens can NOT see this section,
  // and audit pre-packet generators MUST NOT pull from /v1/roi/* (see
  // docs/audit-management-boundary.md).
  // Management section (Financial posture / Board pack / SBOM / ROPA)
  // hidden from the nav for now — re-enable by un-commenting this entry.
  // The /management/* pages + APIs stay intact; flipping it back on is a
  // one-line change.
  // { key: 'management', label: 'Management', icon: 'ti-briefcase',        prefix: '/management' },
  { key: 'connectors', label: 'Connectors', icon: 'ti-plug',             prefix: '/connectors' },
  { key: 'evidence',   label: 'Evidence',   icon: 'ti-lock',             prefix: '/evidence' },
  // Apps + Sites moved INSIDE the Inventory page as tabs — a single
  // entry point for "everything in scope" instead of three parallel
  // sections in the rail. Direct routes /apps/{id} + /sites/{id}
  // still resolve (used by deep links from detail pages and the
  // Inventory "App tier" column).
  { key: 'inventory',  label: 'Inventory',  icon: 'ti-database',         prefix: '/inventory' },
  { key: 'incidents',  label: 'Incidents',  icon: 'ti-radar-2',          prefix: '/incidents' },
  { key: 'risks',      label: 'Risk',       icon: 'ti-alert-octagon',    prefix: '/risks' },
  { key: 'policies',   label: 'Policies',   icon: 'ti-file-text',        prefix: '/policies' },
  { key: 'exceptions', label: 'Exceptions', icon: 'ti-shield-off',       prefix: '/exceptions' },
  { key: 'remediation', label: 'Remediation', icon: 'ti-checklist',      prefix: '/remediation' },
  // Third parties moved INSIDE the Inventory section — vendors are
  // managed objects like apps and sites, kept alongside them so the
  // rail isn't crowded with parallel CMDB-ish entries.
  { key: 'dr',         label: 'DR Testing', icon: 'ti-refresh-alert',    prefix: '/dr' },
  { key: 'frameworks', label: 'Frameworks', icon: 'ti-shield-check',     prefix: '/frameworks' },
  { key: 'audit',      label: 'Audit',      icon: 'ti-file-certificate', prefix: '/audit' },
]
export const railBottom: RailItem[] = [
  { key: 'settings', label: 'Settings', icon: 'ti-settings', prefix: '/settings' },
]

// Three intent groups that divide the rail visually.
// Keys must match SectionKey values in railTop.
export type RailGroup = { labelKey: string; label: string; keys: SectionKey[] }
export const RAIL_GROUPS: RailGroup[] = [
  { labelKey: 'nav.group.monitor', label: 'Monitor', keys: ['dashboard', 'connectors', 'evidence', 'inventory', 'incidents'] },
  { labelKey: 'nav.group.act',     label: 'Act',     keys: ['risks', 'policies', 'exceptions', 'remediation', 'dr'] },
  { labelKey: 'nav.group.report',  label: 'Report',  keys: ['frameworks', 'audit'] },
]

// Each section's three sub-pages. Order is the order they appear in
// the sidebar. The first item is the section's default route (its
// /<section> path resolves here).
export const sections: Record<SectionKey, Section> = {
  dashboard: {
    key: 'dashboard',
    navLabel: 'Summary',
    items: [
      { to: '/dashboard',         label: 'Overview', icon: 'ti-home' },
      { to: '/dashboard/posture', label: 'Posture',  icon: 'ti-chart-pie' },
      { to: '/dashboard/issues',  label: 'Issues',   icon: 'ti-alert-triangle', badge: 'issues' },
    ],
  },
  management: {
    key: 'management',
    navLabel: 'Management',
    items: [
      // Financial posture (ROI) hidden from the nav for now — re-enable
      // by un-commenting this line. The /management/roi page + API stay
      // intact, so flipping it back on is a one-line change.
      // { to: '/management/roi', label: 'Financial posture', icon: 'ti-coin' },
      { to: '/management/board-pack', label: 'Board pack', icon: 'ti-presentation-analytics' },
      { to: '/management/sbom', label: 'Supply chain (SBOM)', icon: 'ti-package' },
      { to: '/management/ropa', label: 'GDPR register (ROPA)', icon: 'ti-file-shield' },
    ],
  },
  connectors: {
    key: 'connectors',
    navLabel: 'Sources',
    items: [
      { to: '/connectors',             label: 'Registry',    icon: 'ti-layout-grid' },
      { to: '/connectors/health',      label: 'Health',      icon: 'ti-activity' },
      { to: '/connectors/dead-letter', label: 'Dead-letter', icon: 'ti-inbox', badge: 'dlq' },
      { to: '/connectors/coverage',    label: 'Coverage',    icon: 'ti-checks' },
    ],
  },
  evidence: {
    key: 'evidence',
    navLabel: 'Evidence',
    items: [
      { to: '/evidence',            label: 'Live stream',       icon: 'ti-player-play' },
      { to: '/evidence/search',     label: 'Search',            icon: 'ti-search' },
      { to: '/evidence/cve-scans',  label: 'CVE scans',         icon: 'ti-bug' },
      { to: '/evidence/verify',     label: 'Verify signature',  icon: 'ti-check' },
    ],
  },
  frameworks: {
    key: 'frameworks',
    navLabel: 'Frameworks',
    items: [
      { to: '/frameworks',            label: 'All frameworks',    icon: 'ti-layout-list' },
      { to: '/frameworks/controls',   label: 'Controls',          icon: 'ti-checklist' },
      { to: '/frameworks/crosswalk',  label: 'Crosswalk',         icon: 'ti-arrows-cross' },
      { to: '/scoring/crosswalk',     label: 'Coverage by evidence', icon: 'ti-table-options' },
      { to: '/scoring/scope',         label: 'Per-scope score',   icon: 'ti-zoom-scan' },
      { to: '/scoring/citations',     label: 'Citation review',   icon: 'ti-gavel' },
    ],
  },
  apps: {
    key: 'apps',
    navLabel: 'Applications',
    items: [
      { to: '/apps',          label: 'Registry',  icon: 'ti-apps' },
      { to: '/apps?tier=tier_1', label: 'Tier 1',  icon: 'ti-flame' },
      { to: '/apps?gxp=true', label: 'GxP-validated', icon: 'ti-flask' },
    ],
  },
  sites: {
    key: 'sites',
    navLabel: 'Sites',
    items: [
      { to: '/sites',         label: 'Registry',         icon: 'ti-building' },
    ],
  },
  inventory: {
    key: 'inventory',
    navLabel: 'Inventory',
    items: [
      { to: '/inventory',                              label: 'All assets',      icon: 'ti-database' },
      { to: '/inventory?asset_type=vm',                label: 'Virtual machines', icon: 'ti-device-desktop' },
      { to: '/inventory?asset_type=host',              label: 'Hypervisor hosts', icon: 'ti-server-2' },
      { to: '/inventory?asset_type=cluster',           label: 'Clusters',         icon: 'ti-grid-pattern' },
      { to: '/inventory?asset_type=storage_array',     label: 'Storage arrays',   icon: 'ti-database' },
      { to: '/inventory?asset_type=storage_volume',    label: 'Storage volumes',  icon: 'ti-stack-2' },
      { to: '/inventory?asset_type=server',            label: 'Servers',          icon: 'ti-server' },
      { to: '/inventory?asset_type=firewall',          label: 'Firewalls',        icon: 'ti-wall' },
      { to: '/inventory?asset_type=network_device',    label: 'Network devices',  icon: 'ti-network' },
      // Network: dedicated link list + topology map (Port-channels,
      // Intersite links, host trunks). Distinct from "Network devices"
      // (that's the switches/routers themselves; this is the CABLES
      // between them).
      { to: '/inventory/network',                      label: 'Network',         icon: 'ti-route' },
      // Tab deep-links — same Inventory page, different tab.
      { to: '/inventory?tab=applications',             label: 'Applications',    icon: 'ti-apps' },
      { to: '/inventory?tab=sites',                    label: 'Sites',           icon: 'ti-building' },
      // Third parties — vendor register lives in the same managed-
      // objects family as apps and sites. Direct link, not a tab,
      // because the third-party UX is materially different (CSV
      // export, due-for-review filters) and doesn't fit cleanly into
      // a tabbed inventory layout.
      { to: '/third-parties',                          label: 'Third parties',   icon: 'ti-building-store' },
    ],
  },
  risks: {
    key: 'risks',
    navLabel: 'Risk',
    items: [
      { to: '/risks',          label: 'Register',  icon: 'ti-alert-octagon' },
      { to: '/risks/heatmap',  label: 'Heatmap',   icon: 'ti-grid-dots' },
      { to: '/risks?source=auto_scoring', label: 'Auto-created', icon: 'ti-rocket' },
      { to: '/risks?status=in_treatment', label: 'In treatment', icon: 'ti-tools' },
    ],
  },
  policies: {
    key: 'policies',
    navLabel: 'Policies',
    items: [
      { to: '/policies',                       label: 'All policies',  icon: 'ti-file-text' },
      { to: '/policies?overdueOnly=true',      label: 'Overdue review', icon: 'ti-clock-exclamation' },
      { to: '/policies?status=draft',          label: 'Draft',          icon: 'ti-pencil' },
    ],
  },
  exceptions: {
    key: 'exceptions',
    navLabel: 'Exceptions',
    items: [
      { to: '/exceptions',                  label: 'Register',       icon: 'ti-shield-off' },
      { to: '/exceptions?status=active',    label: 'Active',         icon: 'ti-clock' },
      { to: '/exceptions?status=expired',   label: 'Expired',        icon: 'ti-circle-x' },
    ],
  },
  remediation: {
    key: 'remediation',
    navLabel: 'Remediation',
    items: [
      { to: '/remediation',                  label: 'All tasks',  icon: 'ti-checklist' },
      { to: '/remediation?status=open',      label: 'Open',       icon: 'ti-circle-dot' },
      { to: '/remediation?priority=critical', label: 'Critical',  icon: 'ti-flame' },
    ],
  },
  incidents: {
    key: 'incidents',
    navLabel: 'Incidents',
    items: [
      { to: '/incidents',                            label: 'Register',          icon: 'ti-radar-2' },
      { to: '/incidents?nis2_significant=true',      label: 'NIS2 significant',  icon: 'ti-flame' },
      { to: '/incidents?status=detected',            label: 'Awaiting class.',   icon: 'ti-tag' },
    ],
  },
  thirdparties: {
    key: 'thirdparties',
    navLabel: 'Third parties',
    items: [
      { to: '/third-parties',                       label: 'Register',         icon: 'ti-building' },
      { to: '/third-parties?criticality=critical',  label: 'Critical',         icon: 'ti-flame' },
      { to: '/third-parties?due_only=true',         label: 'Due for review',   icon: 'ti-clock-exclamation' },
    ],
  },
  dr: {
    key: 'dr',
    navLabel: 'DR testing',
    items: [
      { to: '/dr/plans',     label: 'DR Plans',   icon: 'ti-map-2' },
      { to: '/dr',           label: 'Schedules',  icon: 'ti-calendar' },
      { to: '/dr/runs',      label: 'Test runs',  icon: 'ti-history' },
      { to: '/dr/approvals', label: 'Approvals',  icon: 'ti-user-check' },
      { to: '/dr/restore-verifications', label: 'Restore verifs', icon: 'ti-database-check' },
    ],
  },
  audit: {
    key: 'audit',
    navLabel: 'Audit',
    items: [
      { to: '/audit',                  label: 'Audit trail',        icon: 'ti-timeline' },
      { to: '/audit/executive-summary', label: 'Executive summary',  icon: 'ti-presentation' },
      // NOTE: Financial posture (ROI) is intentionally NOT here. It
      // lives under /management/roi because auditor-independence
      // requires management-tier metrics stay out of auditor-visible
      // artefacts. See docs/audit-management-boundary.md.
      { to: '/audit/weekly-digest',     label: 'Weekly digest',      icon: 'ti-mail-fast' },
      { to: '/audit/reports',   label: 'Reports',     icon: 'ti-file-description' },
      { to: '/audit/documentation', label: 'Architecture (DAT)', icon: 'ti-book-2' },
      { to: '/audit/manifests', label: 'Manifests',   icon: 'ti-file-certificate' },
      { to: '/audit/prepacket',      label: 'Pre-packet',  icon: 'ti-file-zip' },
      { to: '/audit/prepacket-diff', label: 'Posture diff', icon: 'ti-arrows-diff' },
      { to: '/audit/period-replay',  label: 'Period replay', icon: 'ti-history' },
    ],
  },
  settings: {
    key: 'settings',
    navLabel: 'Settings',
    items: [
      { to: '/settings',             label: 'Tenant',         icon: 'ti-building' },
      { to: '/settings/users',       label: 'Users & RBAC',   icon: 'ti-users' },
      { to: '/settings/keys',        label: 'API keys',       icon: 'ti-key' },
      { to: '/settings/frameworks',  label: 'Frameworks',     icon: 'ti-layout-list' },
      { to: '/settings/trust-store', label: 'Trust store',    icon: 'ti-certificate' },
      { to: '/settings/connectors',  label: 'Connector poll', icon: 'ti-refresh' },
      { to: '/settings/scoring',     label: 'Scoring poll',     icon: 'ti-gauge' },
      { to: '/settings/retention',     label: 'Retention policy', icon: 'ti-clock-hour-4' },
      { to: '/settings/dr-drill',      label: 'DR drill status',  icon: 'ti-shield-check' },
      { to: '/settings/authentication', label: 'Authentication',   icon: 'ti-key' },
      { to: '/settings/auth-posture',  label: 'Auth posture',     icon: 'ti-lock-square' },
      { to: '/settings/ai-engine',     label: 'AI engine',        icon: 'ti-sparkles' },
      { to: '/settings/support',     label: 'Support bundle',   icon: 'ti-file-zip' },
    ],
  },
}

// Role-based nav visibility. The backend RBAC (internal/security/
// auth.go) is the enforcer; this only decides what to SHOW so a role
// isn't sent down dead-ends that 403. Mapping mirrors the backend:
//   - admin     superset, sees every section
//   - reporter  full read+write surface, minus admin config (Settings)
//   - reader    same surface as reporter for visibility (read-only)
//   - auditor   read-only AND restricted to auditorAllowedPrefixes,
//               so it only sees sections backed by those paths
export type Role = 'admin' | 'reporter' | 'reader' | 'auditor'

// Non-admin roles allowed to see each section. admin is implicit
// (always allowed). An empty list means admin-only.
export const SECTION_ROLES: Record<SectionKey, Role[]> = {
  dashboard:    ['reporter', 'reader', 'auditor'],
  // Management explicitly excludes the auditor role. ROI / financial
  // posture is a management view; surfacing it to an auditor token
  // breaches the independence boundary (PCAOB AS 2701, ISAE 3000).
  management:   ['reporter', 'reader'],
  connectors:   ['reporter', 'reader', 'auditor'],
  evidence:     ['reporter', 'reader', 'auditor'],
  frameworks:   ['reporter', 'reader', 'auditor'],
  apps:         ['reporter', 'reader'],
  sites:        ['reporter', 'reader'],
  inventory:    ['reporter', 'reader', 'auditor'],
  risks:        ['reporter', 'reader'],
  policies:     ['reporter', 'reader'],
  exceptions:   ['reporter', 'reader', 'auditor'],
  remediation:  ['reporter', 'reader'],
  incidents:    ['reporter', 'reader'],
  thirdparties: ['reporter', 'reader'],
  dr:           ['reporter', 'reader', 'auditor'],
  audit:        ['reporter', 'reader', 'auditor'],
  settings:     [],
}

// roles === null means "not resolved yet" (pre-/auth/me): render the
// full nav optimistically so there's no empty-rail flash and no
// regression. Once roles arrive we filter. Direct-URL access to a
// hidden section still works — the page's own 403 handling is the
// backstop — we just don't advertise it in the rail.
export function canSeeSection(key: SectionKey, roles: string[] | null): boolean {
  if (roles === null) return true
  const set = new Set(roles.map((role) => role.toLowerCase().trim()))
  if (set.has('admin')) return true
  return SECTION_ROLES[key].some((role) => set.has(role))
}

// navDestinations flattens the rail + sidebar nav into one quick-jump
// list for the command palette, filtered to what the given roles may
// see. Deduped by route so a path that appears under two sections shows
// once. Same English-seed labels the nav uses — the palette translates
// them at render time.
export function navDestinations(roles: string[] | null): NavDestination[] {
  const out: NavDestination[] = []
  const seen = new Set<string>()
  for (const rail of [...railTop, ...railBottom]) {
    if (!canSeeSection(rail.key, roles)) continue
    const sec = sections[rail.key]
    for (const item of sec.items) {
      if (seen.has(item.to)) continue
      seen.add(item.to)
      out.push({ label: item.label, to: item.to, icon: item.icon, section: sec.navLabel })
    }
  }
  return out
}


// Routes whose owning section can't be read off a rail prefix. The
// longest matching prefix wins, so ordering here doesn't matter.
//
//   /apps, /sites, /third-parties, /network  folded into Inventory
//   /scoring                                 linked straight from the
//                                            Frameworks sidebar
//   /management                              section hidden from the
//                                            rail but still routable
const SECTION_OVERRIDES: Array<{ prefix: string; key: SectionKey }> = [
  { prefix: '/apps', key: 'inventory' },
  { prefix: '/sites', key: 'inventory' },
  { prefix: '/third-parties', key: 'inventory' },
  { prefix: '/network', key: 'inventory' },
  { prefix: '/scoring', key: 'frameworks' },
  { prefix: '/management', key: 'management' },
]

export function sectionFromPath(pathname: string): SectionKey {
  const candidates = [
    ...SECTION_OVERRIDES,
    ...[...railTop, ...railBottom].map((entry) => ({ prefix: entry.prefix, key: entry.key })),
  ]
  let best: { prefix: string; key: SectionKey } | null = null
  for (const candidate of candidates) {
    if (pathname !== candidate.prefix && !pathname.startsWith(`${candidate.prefix}/`)) continue
    if (!best || candidate.prefix.length > best.prefix.length) best = candidate
  }
  // Default: dashboard. Any unknown route lands here visually until it
  // 404s; better than rendering an empty rail.
  return best ? best.key : 'dashboard'
}

// Labels for routes that exist but carry no sidebar entry — creation
// wizards, detail sub-pages, and the /scoring pages reachable only from
// a card link. Without these the breadcrumb falls back to a de-slugged
// path segment. Keyed by full path; English seeds resolved through the
// same t(label, label) path the nav labels use.
const ROUTE_LABELS: Record<string, string> = {
  '/apps': 'Applications',
  '/apps/new': 'New application',
  '/sites': 'Sites',
  '/sites/new': 'New site',
  '/third-parties': 'Third parties',
  '/connectors/new': 'Add connector',
  '/connectors/bulk-restconf': 'Bulk RESTCONF',
  '/risks/failure-register': 'Failure register',
  '/scoring/calculator': 'Scoring calculator',
  '/scoring/coverage-register': 'Coverage register',
  '/scoring/frameworks': 'Framework score',
  '/scoring/trend': 'Score trend',
  '/network/topology': 'Network topology',
  '/management/roi': 'Financial posture',
  '/dr/plans/new': 'New DR plan',
}

// Path prefixes that are routing groups rather than pages — they must
// not surface as their own breadcrumb node.
const NON_PAGE_PREFIXES = new Set(['/scoring', '/network', '/management'])

// Paths that DO surface as a breadcrumb node (they name a level of the
// hierarchy the reader understands) but have no page of their own —
// linking them would 404. They render as plain text. '/scoring/trend'
// and '/scoring/frameworks' only exist as parents of {frameworkId} /
// {controlId} routes; the '.../controls' segment likewise.
const NON_LINK_PATHS = new Set(['/scoring/frameworks', '/scoring/trend'])
function isLinkablePath(path: string): boolean {
  if (NON_LINK_PATHS.has(path)) return false
  // /scoring/frameworks/{fid} and /scoring/frameworks/{fid}/controls
  // are structural — no page behind either.
  if (/^\/scoring\/frameworks\/[^/]+(\/controls)?$/.test(path)) return false
  return true
}

export type TrailNode = {
  /** English seed label, and the i18n lookup key unless `literal`. */
  label: string
  /** Explicit translation key when the seed label isn't the key. */
  tKey?: string
  /** Ancestor link. The current (last) node never carries one. */
  href?: string
  /** Tabler icon; set on the leading section node only. */
  icon?: string
  /** Record-derived text (ids, names) — never sent to the translator. */
  literal?: boolean
}

export type NavLocation = {
  sectionKey: SectionKey
  section: Section
  rail: RailItem
  /** Sidebar entry to highlight; null when the route has no entry. */
  item: NavItem | null
  trail: TrailNode[]
}

// How well a sidebar entry describes the current URL. Higher wins; ties
// break on the longer path so /dr/plans beats /dr on /dr/plans/{id}.
// Zero means "not this entry".
//
//   4  entry is exactly this URL
//   3  entry's filter is active but the URL carries extra params
//   2  entry is the unfiltered section root and the URL is filtered by
//      something no entry claims (a free-text ?q=, say)
//   1  entry is an ancestor of a detail route
function scoreNavItem(item: NavItem, pathname: string, params: URLSearchParams): number {
  const [itemPath, itemQuery] = item.to.split('?')
  if (itemQuery) {
    if (pathname !== itemPath) return 0
    const want = new URLSearchParams(itemQuery)
    for (const [key, value] of want) {
      if (params.get(key) !== value) return 0
    }
    return [...params.keys()].length === [...want.keys()].length ? 4 : 3
  }
  if (pathname !== itemPath) {
    return pathname.startsWith(`${itemPath}/`) ? 1 : 0
  }
  return [...params.keys()].length === 0 ? 4 : 2
}

// De-slug an unmatched path segment: 'failure-register' → 'Failure
// register'. Anything carrying a digit is a record id (asset-4021, a
// UUID) and is shown verbatim rather than title-cased.
function labelForSegment(segment: string): { label: string; literal: boolean } {
  const decoded = decodeURIComponent(segment)
  if (!/^[a-zA-Z][a-zA-Z-]*$/.test(decoded)) return { label: decoded, literal: true }
  const spaced = decoded.replace(/-/g, ' ')
  return { label: spaced.charAt(0).toUpperCase() + spaced.slice(1), literal: false }
}

/**
 * resolveNavLocation maps a URL to the rail section, the sidebar entry
 * to highlight, and the breadcrumb trail leading to it.
 *
 * `search` is the raw query string, with or without the leading '?'.
 * It matters: half of this nav's entries are filter deep-links that
 * differ only by query, and a pathname alone cannot tell them apart.
 */
export function resolveNavLocation(pathname: string, search = ''): NavLocation {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const sectionKey = sectionFromPath(path)
  const section = sections[sectionKey]
  const rail =
    [...railTop, ...railBottom].find((entry) => entry.key === sectionKey) ??
    // Management's rail entry is commented out but its pages still
    // route, so synthesise an item rather than leaving the trail headless.
    { key: sectionKey, label: section.navLabel, icon: 'ti-briefcase', prefix: `/${sectionKey}` }

  let item: NavItem | null = null
  let best = 0
  for (const candidate of section.items) {
    const rank = scoreNavItem(candidate, path, params)
    if (rank === 0) continue
    const score = rank * 1000 + candidate.to.split('?')[0].length
    if (score > best) {
      best = score
      item = candidate
    }
  }

  const trail: TrailNode[] = [
    {
      label: rail.label,
      tKey: RAIL_LABEL_TKEY[sectionKey],
      icon: rail.icon,
      href: section.items[0]?.to,
    },
  ]
  if (item) trail.push({ label: item.label, href: item.to })

  // Everything below the matched entry — or below the root when nothing
  // matched — becomes one node per segment, so a detail page reads
  // Inventory › All assets › {id} instead of dead-ending at the section.
  const matchedPath = item ? item.to.split('?')[0] : ''
  let walked = matchedPath
  for (const segment of path.slice(matchedPath.length).split('/').filter(Boolean)) {
    walked = `${walked}/${segment}`
    if (NON_PAGE_PREFIXES.has(walked)) continue
    const known = ROUTE_LABELS[walked]
    const node: TrailNode = known ? { label: known } : labelForSegment(segment)
    if (isLinkablePath(walked)) node.href = walked
    trail.push(node)
  }

  // The page you are on is not a link to itself.
  delete trail[trail.length - 1].href
  return { sectionKey, section, rail, item, trail }
}
