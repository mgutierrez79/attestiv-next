'use client'

// Inventory → Network: dedicated view for network_link assets.
// Two panes:
//
//   1. Main connections map  — a compact SVG showing sites as
//      containers, switches as nodes, and the "main" links (Intersite,
//      Port_Channel, Switch_Link) as edges. Host_Trunk excluded to
//      keep the picture readable; the link list below still shows
//      every bundle.
//
//   2. Bundle list           — every parent network_link with the
//      summary fields the operator scans: type, endpoints, member
//      count, verified flag. Click → asset detail page.
//
// Children (network_link_member) are filtered out of the list — they
// surface via the parent's detail page.

import { useEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent as ReactWheelEvent, type MouseEvent as ReactMouseEvent } from 'react'

import { Badge, Banner, Card, CardTitle, EmptyState, Pagination, Skeleton, Topbar } from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type LinkAsset = {
  asset_id: string
  name?: string | null
  asset_type?: string | null
  datacenter_id?: string | null
  criticality?: string | null
  tags?: string[]
  metadata?: Record<string, unknown>
}

const MAIN_TYPES = new Set(['Intersite_Link', 'Port_Channel', 'Switch_Link', 'Firewall_Trunk'])

export function AttestivNetworkMapPage() {
  const { t } = useI18n()
  const [links, setLinks] = useState<LinkAsset[]>([])
  // Endpoint resolution cache: every switch / host / array the map
  // might reference, so we can resolve site + criticality from the
  // inventory even when the link asset's metadata.endpoints[].site
  // is empty (which it is for assets created before
  // inferAndPersistSwitchSites filled the gap).
  const [siteByAssetID, setSiteByAssetID] = useState<Record<string, string>>({})
  const [typeByAssetID, setTypeByAssetID] = useState<Record<string, string>>({})
  // Standalone devices: firewalls, switches, etc. that exist in
  // inventory with a known site but aren't endpoints of any link
  // asset. Without these, Panorama-discovered firewalls were
  // invisible on the map because Panorama doesn't emit cable-level
  // adjacency to the switches they sit on.
  const [orphanDevices, setOrphanDevices] = useState<MapNode[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'Intersite_Link' | 'Port_Channel' | 'Firewall_Trunk' | 'Host_Trunk' | 'Switch_Link'>('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // Fetch in parallel: the links themselves AND the rest of
        // the inventory so we can resolve endpoint sites that the
        // link asset's metadata may have left empty.
        const [linksResp, invResp] = await Promise.all([
          apiFetch('/inventory/assets?asset_type=network_link&limit=1000'),
          apiFetch('/inventory/assets?limit=5000'),
        ])
        if (!linksResp.ok) throw new Error(`${linksResp.status} ${linksResp.statusText}`)
        const linksBody = await linksResp.json()
        const invBody = invResp.ok ? await invResp.json() : { items: [] }
        if (cancelled) return
        const linkItems = Array.isArray(linksBody?.items) ? (linksBody.items as LinkAsset[]) : []
        const parents = linkItems.filter((a) => a.asset_type === 'network_link')
        setLinks(parents)
        // Build the asset_id → (site, type) lookup. Includes EVERY
        // asset so the map can resolve any endpoint reference.
        const invItems = Array.isArray(invBody?.items) ? (invBody.items as LinkAsset[]) : []
        const sm: Record<string, string> = {}
        const tm: Record<string, string> = {}
        // Asset types that belong on the topology map even when no
        // link asset references them. Firewalls are the common case
        // (Panorama doesn't emit cable-level adjacency); switches,
        // routers, and firewall managers round out the set.
        const STANDALONE_DEVICE_TYPES = new Set([
          'firewall',
          'firewall_manager',
          'network_device',
          'switch',
          'router',
        ])
        const orphans: MapNode[] = []
        for (const a of invItems) {
          const id = String(a.asset_id ?? '').trim()
          if (!id) continue
          const site = String(a.datacenter_id ?? '').trim()
          const type = String(a.asset_type ?? '').trim()
          if (site) sm[id] = site
          if (type) tm[id] = type
          if (site && STANDALONE_DEVICE_TYPES.has(type.toLowerCase())) {
            orphans.push({
              id,
              label: String(a.name ?? id),
              site,
              assetType: type,
            })
          }
        }
        setSiteByAssetID(sm)
        setTypeByAssetID(tm)
        setOrphanDevices(orphans)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (filter === 'all') return links
    return links.filter((l) => {
      const label = String(l.metadata?.['link_type_label'] ?? '').trim()
      return label === filter
    })
  }, [links, filter])

  // Reset to page 0 whenever the filter or underlying data changes
  // so the operator doesn't land on a phantom page 4 when the
  // matching set just shrank.
  useEffect(() => {
    setPage(0)
  }, [filter, filtered.length])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const pageStart = currentPage * pageSize
  const pageRows = useMemo(
    () => filtered.slice(pageStart, pageStart + pageSize),
    [filtered, pageStart, pageSize],
  )

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: links.length, Intersite_Link: 0, Port_Channel: 0, Firewall_Trunk: 0, Host_Trunk: 0, Switch_Link: 0 }
    for (const l of links) {
      const label = String(l.metadata?.['link_type_label'] ?? '').trim()
      if (label in out) out[label]++
    }
    return out
  }, [links])

  const mapData = useMemo(
    () => buildMapData(links, siteByAssetID, typeByAssetID, orphanDevices),
    [links, siteByAssetID, typeByAssetID, orphanDevices],
  )

  return (
    <>
      <Topbar title={t('Network', 'Network')} />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Card>
          <CardTitle right={<Badge tone="navy">{mapData.edges.length}</Badge>}>
            {t('Main connections', 'Main connections')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={4} height={36} />
          ) : mapData.edges.length === 0 ? (
            <EmptyState
              title={t('No main connections discovered yet', 'No main connections discovered yet')}
              description={t(
                'Catalyst Center /topology + per-device CDP/LLDP populate this view. If empty, check that those subsections are returning data on the connector page.',
                'Catalyst Center /topology + per-device CDP/LLDP populate this view. If empty, check that those subsections are returning data on the connector page.',
              )}
            />
          ) : (
            <NetworkMap data={mapData} />
          )}
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {t(
              'Map shows Intersite_Link, Port_Channel, and Switch_Link bundles only. Host_Trunk edges are excluded to keep the picture readable; see the list below for the full set.',
              'Map shows Intersite_Link, Port_Channel, and Switch_Link bundles only. Host_Trunk edges are excluded to keep the picture readable; see the list below for the full set.',
            )}
          </div>
        </Card>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
          {(['all', 'Intersite_Link', 'Port_Channel', 'Firewall_Trunk', 'Host_Trunk', 'Switch_Link'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              style={{
                cursor: 'pointer',
                border: '0.5px solid var(--color-border-tertiary)',
                background: filter === key ? 'var(--color-bg-accent)' : 'transparent',
                color: filter === key ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                padding: '4px 10px',
                borderRadius: 12,
                fontSize: 12,
              }}
            >
              {key === 'all' ? t('All', 'All') : key.replace(/_/g, ' ')} ({counts[key] ?? 0})
            </button>
          ))}
        </div>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<Badge tone="navy">{filtered.length}</Badge>}>{t('Link bundles', 'Link bundles')}</CardTitle>
          {loading ? (
            <Skeleton lines={5} height={28} />
          ) : filtered.length === 0 ? (
            <EmptyState
              title={t('No links match this filter', 'No links match this filter')}
              description={t('Switch to "All" or another type to see what was discovered.', 'Switch to "All" or another type to see what was discovered.')}
            />
          ) : (
            <div style={{ overflowX: 'auto', overflowY: 'auto', marginTop: 8, maxHeight: 560 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <th style={{ padding: '6px 8px 6px 0' }}>{t('Type', 'Type')}</th>
                    <th style={{ padding: '6px 8px' }}>{t('Endpoints', 'Endpoints')}</th>
                    <th style={{ padding: '6px 8px' }}>{t('Members', 'Members')}</th>
                    <th style={{ padding: '6px 8px' }}>{t('Verified', 'Verified')}</th>
                    <th style={{ padding: '6px 8px' }}>{t('Site', 'Site')}</th>
                    <th style={{ padding: '6px 0 6px 8px' }}>{t('Tags', 'Tags')}</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((link) => {
                    const label = String(link.metadata?.['link_type_label'] ?? '').trim() || link.asset_type || '—'
                    const memberCount = Number(link.metadata?.['member_count'] ?? 0)
                    const verified = Boolean(link.metadata?.['verified'])
                    // Render both sides explicitly when available:
                    // metadata.site_a + .site_b (preferred — always
                    // present on links built by the new code), fall
                    // back to the metadata.sites legacy array, then
                    // datacenter_id for very old assets.
                    const tableSiteA = String(link.metadata?.['site_a'] ?? '').trim()
                    const tableSiteB = String(link.metadata?.['site_b'] ?? '').trim()
                    const legacySites = Array.isArray(link.metadata?.['sites'])
                      ? (link.metadata!['sites'] as string[])
                      : []
                    const sites = (tableSiteA && tableSiteB)
                      ? (tableSiteA === tableSiteB ? tableSiteA : `${tableSiteA} ↔ ${tableSiteB}`)
                      : legacySites.length > 0
                        ? legacySites.join(' ↔ ')
                        : String(link.datacenter_id ?? '—')
                    const endpoints = Array.isArray(link.metadata?.['endpoints'])
                      ? (link.metadata!['endpoints'] as Array<Record<string, unknown>>)
                      : []
                    const endpointSummary = endpoints
                      .map((e) => String(e['label'] ?? e['asset_id'] ?? ''))
                      .filter(Boolean)
                      .join(' ↔ ')
                    return (
                      <tr key={link.asset_id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                        <td style={{ padding: '8px 8px 8px 0' }}>
                          <Badge tone="navy">{label.replace(/_/g, ' ')}</Badge>
                        </td>
                        <td style={{ padding: '8px' }}>
                          <a
                            href={`/inventory/${encodeURIComponent(link.asset_id)}`}
                            style={{ color: 'var(--color-text-primary)', textDecoration: 'none', fontWeight: 500 }}
                          >
                            {endpointSummary || link.name || link.asset_id}
                          </a>
                          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                            {link.asset_id}
                          </div>
                        </td>
                        <td style={{ padding: '8px' }}>{memberCount || '—'}</td>
                        <td style={{ padding: '8px' }}>
                          <Badge tone={verified ? 'green' : 'amber'}>{verified ? t('Yes', 'Yes') : t('Single-sided', 'Single-sided')}</Badge>
                        </td>
                        <td style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{sites}</td>
                        <td style={{ padding: '8px 0 8px 8px' }}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {(link.tags ?? []).slice(0, 4).map((tag) => (
                              <span
                                key={tag}
                                style={{
                                  fontSize: 10,
                                  padding: '1px 6px',
                                  borderRadius: 10,
                                  background: 'var(--color-surface-secondary)',
                                  color: 'var(--color-text-secondary)',
                                }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          {filtered.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <Pagination
                page={currentPage}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s)
                  setPage(0)
                }}
                label={t('Links', 'Links')}
              />
            </div>
          ) : null}
        </Card>
      </div>
    </>
  )
}

// ----- Map data + rendering ----------------------------------------

type MapNode = { id: string; label: string; site: string; assetType: string }
type MapEdge = {
  from: string
  to: string
  subtype: string
  // Backend asset_id of the underlying network_link asset. Used by
  // the panel's "✕ this isn't real" action to call the suppression
  // API for synthesised firewall intersite links.
  assetID?: string
  // Where the link came from. "firewall_subnet_join" = synthesised
  // from shared /30 transit. Anything else (or empty) is LLDP /
  // CDP / MAC-table evidence and not suppressible.
  discoverySource?: string
}

// resolveSite picks the best site label for one endpoint. Tries in
// order:
//   1. endpoint.site in the link's metadata.endpoints[]
//   2. inventory store's asset.datacenter_id (catches assets the
//      link metadata didn't know about — typically because the
//      link was created before inferAndPersistSwitchSites filled
//      the gap)
//   3. the link's metadata.site_a or .site_b — explicit per-side
//      site the backend stamps on every link asset
//   4. the link's own datacenter_id (intra-site fallback)
//   5. "unassigned" — honest signal that nothing knows where the
//      endpoint is, so the operator sees the gap
function resolveSite(
  endpoint: Record<string, unknown>,
  linkSite: string,
  linkSideSite: string,
  siteByAssetID: Record<string, string>,
): string {
  const fromMeta = String(endpoint['site'] ?? '').trim()
  if (fromMeta) return fromMeta
  const id = String(endpoint['asset_id'] ?? '').trim()
  if (id && siteByAssetID[id]) return siteByAssetID[id]
  if (linkSideSite) return linkSideSite
  if (linkSite) return linkSite
  return 'unassigned'
}

function buildMapData(
  links: LinkAsset[],
  siteByAssetID: Record<string, string>,
  typeByAssetID: Record<string, string>,
  orphanDevices: MapNode[],
): { nodes: MapNode[]; edges: MapEdge[]; siteOrder: string[] } {
  const nodes = new Map<string, MapNode>()
  const edges: MapEdge[] = []
  const sites = new Set<string>()
  // Map shows ONLY network-equipment-to-network-equipment links:
  // switch↔switch, switch↔firewall, firewall↔firewall. Cluster /
  // hypervisor / VM endpoints are excluded — operators read the map
  // for "how does my backbone hang together?", not "which host is
  // plugged into which uplink?" (that question lives on the host
  // detail page). Anything whose endpoint isn't network gear ends
  // up as visual noise that obscures the topology question.
  const networkGearTypes = new Set(['network_device', 'firewall', 'firewall_manager'])
  const isNetworkGear = (assetID: string): boolean => {
    const t = String(typeByAssetID[assetID] ?? '').toLowerCase()
    if (t === '') {
      // No type known → assume gear ONLY if the ID looks like a link
      // child (network_link_member) or a link asset itself; otherwise
      // default to non-gear so cluster nodes (which we never have a
      // type stamp for in this dataset) drop out.
      return false
    }
    return networkGearTypes.has(t)
  }
  for (const link of links) {
    const label = String(link.metadata?.['link_type_label'] ?? '').trim()
    if (!MAIN_TYPES.has(label)) continue
    const endpoints = Array.isArray(link.metadata?.['endpoints'])
      ? (link.metadata!['endpoints'] as Array<Record<string, unknown>>)
      : []
    if (endpoints.length < 2) continue
    const [a, b] = endpoints
    const aID = String(a['asset_id'] ?? '').trim()
    const bID = String(b['asset_id'] ?? '').trim()
    const aLabel = String(a['label'] ?? aID).trim()
    const bLabel = String(b['label'] ?? bID).trim()
    const linkSite = String(link.datacenter_id ?? '').trim()
    // Per-side site comes from the link's metadata.site_a / site_b
    // (set by the backend on every link asset, parent + children).
    // Falls back through endpoint.site + inventory lookup + link
    // datacenter_id when the per-side fields are empty.
    const linkSiteA = String(link.metadata?.['site_a'] ?? '').trim()
    const linkSiteB = String(link.metadata?.['site_b'] ?? '').trim()
    const aSite = resolveSite(a, linkSite, linkSiteA, siteByAssetID)
    const bSite = resolveSite(b, linkSite, linkSiteB, siteByAssetID)
    if (!aID || !bID) continue
    // Drop the edge if either side isn't network gear.
    if (!isNetworkGear(aID) || !isNetworkGear(bID)) continue
    sites.add(aSite)
    sites.add(bSite)
    if (!nodes.has(aID)) {
      nodes.set(aID, { id: aID, label: aLabel, site: aSite, assetType: typeByAssetID[aID] ?? '' })
    }
    if (!nodes.has(bID)) {
      nodes.set(bID, { id: bID, label: bLabel, site: bSite, assetType: typeByAssetID[bID] ?? '' })
    }
    edges.push({
      from: aID,
      to: bID,
      subtype: label,
      assetID: String(link.asset_id ?? ''),
      discoverySource: String(link.metadata?.['discovery_source'] ?? ''),
    })
  }
  // Standalone devices: inventory rows that didn't appear as an
  // endpoint of any link (typical for firewalls — Panorama doesn't
  // emit cable-level adjacency to the switches they sit on). Show
  // them inside their site so the operator at least sees the
  // device + which DC it lives in, even without edges.
  for (const orphan of orphanDevices) {
    if (nodes.has(orphan.id)) continue
    sites.add(orphan.site)
    nodes.set(orphan.id, orphan)
  }
  // Site order: real sites first (alphabetical), "unassigned" last so
  // the columns operators care about appear first.
  const realSites = Array.from(sites).filter((s) => s !== 'unassigned').sort()
  const siteOrder = sites.has('unassigned') ? [...realSites, 'unassigned'] : realSites
  return { nodes: Array.from(nodes.values()), edges, siteOrder }
}

// ----- Modern network map renderer ---------------------------------
//
// Visual choices:
//   - Site columns sit on a deep-navy gradient backdrop ("data-center
//     floors") with a coloured top stripe so each site reads as a
//     physical location, not a generic box.
//   - Nodes are pill cards with a left accent stripe coloured by
//     asset role (network=brand-blue, host=blue-mid, firewall=rust,
//     storage=violet) and an inline SVG icon — no emoji.
//   - Edges are gradient strokes routed as smooth Bezier arcs.
//     Intersite_Link gets an animated dash flow drawing attention to
//     the cross-DC pipe. A bundle's member count is stamped as a chip
//     at the edge midpoint when > 1.
//   - Hovering a node fades non-connected nodes + edges so the
//     operator can isolate one switch's neighbourhood; hovering an
//     edge highlights both endpoints and surfaces a tooltip with
//     site_a ↔ site_b + member count.
//
// Layout: each site is a column. Within each column the per-site
// star-topology layout places the highest-degree switch at the
// geometric centre and arranges the other devices on a ring around
// it — the radius scales with the spoke count so labels never
// overlap. Sites with a single node sit alone at the centre.

function NetworkMap({ data }: { data: { nodes: MapNode[]; edges: MapEdge[]; siteOrder: string[] } }) {
  const SITE_PAD_X = 16
  const SITE_PAD_TOP = 60
  const SITE_PAD_BOTTOM = 24
  const SITE_GAP = 80
  const NODE_W = 188
  const NODE_H = 38
  // Star-layout tunables. RING_NODE_PITCH controls how much arc
  // length each spoke node consumes — bumping it spreads spokes
  // further apart at the cost of a bigger ring.
  const RING_MIN_R = 130
  const RING_NODE_PITCH = NODE_W + 22
  const VIEWPORT_H = 560

  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null)

  // Free-form drag offsets. Sites + nodes can each be displaced from
  // their algorithmic positions; offsets persist across re-layouts
  // until the operator clicks "Reset layout" or refreshes the page.
  // Site offsets apply to the whole column (header + all nodes); node
  // offsets apply ON TOP, so dragging a node inside a moved site
  // works as expected. Stored in SVG coordinate units.
  const [siteOffsets, setSiteOffsets] = useState<Record<string, { dx: number; dy: number }>>({})
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { dx: number; dy: number }>>({})

  // Pan/zoom state expressed as an SVG viewBox. Initialised to the
  // full content bounds once the layout is computed. wheel = zoom
  // (centered on cursor), drag = pan, +/− buttons + "Fit" reset.
  type ViewBox = { x: number; y: number; w: number; h: number }
  const [view, setView] = useState<ViewBox | null>(null)
  // Drag is a discriminated union — pan, site move, or node move are
  // mutually exclusive. The 'moved' flag distinguishes a drag from a
  // click: small-delta mouseup on a node fires the existing
  // selection handler instead of leaving it stuck in place.
  type DragState =
    | { kind: 'pan'; startX: number; startY: number; viewX: number; viewY: number }
    | { kind: 'site'; site: string; startX: number; startY: number; initialDx: number; initialDy: number; moved: boolean }
    | { kind: 'node'; node: string; startX: number; startY: number; initialDx: number; initialDy: number; moved: boolean }
  const [dragging, setDragging] = useState<DragState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Entry animation: nodes + edges fade/scale in once mounted.
  const [mounted, setMounted] = useState(false)
  // Search: empty string = no filter highlight. Matching is case-
  // insensitive substring against node.label and node.id.
  const [searchQuery, setSearchQuery] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30)
    return () => clearTimeout(t)
  }, [])

  // Esc clears selection from anywhere. Doesn't need an input-focus
  // check because the search box already handles its own Esc-to-clear.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setSelectedNode(null)
        setSelectedEdge(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sitesWithNodes = data.siteOrder.map((site) => ({
    site,
    nodes: data.nodes.filter((n) => n.site === site),
  }))

  // Degree (edge count) per node — used to pick the per-site hub
  // for the star layout. The most-connected node in a site is the
  // natural backbone switch; placing it at the centre matches what
  // operators read on a real topology diagram.
  const degree = new Map<string, number>()
  for (const n of data.nodes) degree.set(n.id, 0)
  for (const e of data.edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1)
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1)
  }

  // Smart initial layout. Two passes:
  //
  //   1. Classify each site as tier-1 (main row) or tier-2 (leaf —
  //      a small site, 1–2 nodes with at most one inter-site partner;
  //      these get LIFTED above their parent rather than fighting for
  //      a horizontal slot they don't need).
  //   2. Order tier-1 sites so connected ones land adjacent — start
  //      from the highest-intersite-degree site and extend greedily
  //      via the next-highest-weight neighbour. Eliminates the long
  //      arcs that otherwise cut across intervening columns.
  //
  // Both tiers still use the same star + ring sizing. Tier-2 sites
  // are simply painted on a second row above the tier-1 row, centred
  // over their parent's column.
  //
  // The user can override either decision by dragging — the auto
  // layout only fires on initial mount.

  const siteByNodeId = new Map<string, string>()
  for (const node of data.nodes) siteByNodeId.set(node.id, node.site)

  const intersiteWeights = new Map<string, Map<string, number>>()
  const noteIntersite = (a: string, b: string) => {
    if (!intersiteWeights.has(a)) intersiteWeights.set(a, new Map())
    const m = intersiteWeights.get(a)!
    m.set(b, (m.get(b) ?? 0) + 1)
  }
  for (const e of data.edges) {
    const fs = siteByNodeId.get(e.from)
    const ts = siteByNodeId.get(e.to)
    if (!fs || !ts || fs === ts) continue
    noteIntersite(fs, ts)
    noteIntersite(ts, fs)
  }

  const nodeCountBySite = new Map<string, number>()
  for (const n of data.nodes) {
    nodeCountBySite.set(n.site, (nodeCountBySite.get(n.site) ?? 0) + 1)
  }

  // Classify tier-2 leaves. Only counts when the partner is itself
  // tier-1 — two leaves attached to each other would otherwise both
  // try to live above the other, recursing forever.
  const tier2Parent = new Map<string, string>()
  for (const site of data.siteOrder) {
    const conns = intersiteWeights.get(site)
    if (!conns || conns.size !== 1) continue
    if ((nodeCountBySite.get(site) ?? 0) > 2) continue
    const partner = Array.from(conns.keys())[0]
    const partnerConns = intersiteWeights.get(partner)?.size ?? 0
    const partnerNodes = nodeCountBySite.get(partner) ?? 0
    // Partner qualifies as tier-1 if it has more than one partner OR
    // more than two nodes (both signs of a backbone site).
    if (partnerConns > 1 || partnerNodes > 2) tier2Parent.set(site, partner)
  }
  const tier1Sites = data.siteOrder.filter((s) => !tier2Parent.has(s))

  // Tier-1 ordering: greedy chain by intersite weight.
  const tier1Degree = new Map<string, number>()
  for (const s of tier1Sites) {
    let deg = 0
    const conns = intersiteWeights.get(s)
    if (conns) {
      for (const [partner, w] of conns) {
        if (tier1Sites.includes(partner)) deg += w
      }
    }
    tier1Degree.set(s, deg)
  }
  const tier1Ordered: string[] = []
  const remaining = new Set(tier1Sites)
  const pickHighestRemaining = () =>
    [...remaining].sort(
      (a, b) => (tier1Degree.get(b) ?? 0) - (tier1Degree.get(a) ?? 0) || a.localeCompare(b),
    )[0]
  while (remaining.size > 0) {
    let next: string
    if (tier1Ordered.length === 0) {
      next = pickHighestRemaining()
    } else {
      const last = tier1Ordered[tier1Ordered.length - 1]
      const lastConns = intersiteWeights.get(last)
      let best: string | null = null
      let bestWeight = -1
      if (lastConns) {
        for (const [partner, w] of lastConns) {
          if (remaining.has(partner) && w > bestWeight) {
            best = partner
            bestWeight = w
          }
        }
      }
      next = best ?? pickHighestRemaining()
    }
    tier1Ordered.push(next)
    remaining.delete(next)
  }

  // Compute the (w, h) of each site box independently of placement
  // so tier-2 sites can centre themselves over their parent in the
  // same units the tier-1 walker is using.
  const sortNodesByDegree = (nodes: MapNode[]) =>
    [...nodes].sort((a, b) => {
      const da = degree.get(a.id) ?? 0
      const db = degree.get(b.id) ?? 0
      if (db !== da) return db - da
      return a.id.localeCompare(b.id)
    })
  const siteBox = (nodes: MapNode[]) => {
    if (nodes.length <= 1) {
      return {
        w: SITE_PAD_X * 2 + NODE_W + 20,
        h: SITE_PAD_TOP + NODE_H + SITE_PAD_BOTTOM,
        ringR: 0,
      }
    }
    const spokeCount = nodes.length - 1
    const ringR = Math.max(RING_MIN_R, (RING_NODE_PITCH * spokeCount) / (2 * Math.PI))
    const siteRadiusPx = ringR + NODE_W / 2 + 16
    return {
      w: SITE_PAD_X * 2 + siteRadiusPx * 2,
      h: SITE_PAD_TOP + siteRadiusPx * 2 + SITE_PAD_BOTTOM,
      ringR,
    }
  }

  const siteBoxesBySite = new Map<string, { w: number; h: number; ringR: number; nodes: MapNode[] }>()
  for (const { site, nodes } of sitesWithNodes) {
    const box = siteBox(nodes)
    siteBoxesBySite.set(site, { ...box, nodes })
  }

  // Vertical layout: if there are tier-2 sites, push tier-1 down by
  // the tallest tier-2 box + a gap so the leaf row sits cleanly above.
  const TIER_ROW_GAP = 36
  let tier2RowHeight = 0
  for (const site of tier2Parent.keys()) {
    tier2RowHeight = Math.max(tier2RowHeight, siteBoxesBySite.get(site)?.h ?? 0)
  }
  const tier1RowY = tier2RowHeight > 0 ? tier2RowHeight + TIER_ROW_GAP : 0

  // Walk the tier-1 row left to right, assigning x.
  const sitePosBySite = new Map<string, { x: number; y: number }>()
  {
    let cursor = 0
    for (const site of tier1Ordered) {
      const box = siteBoxesBySite.get(site)
      if (!box) continue
      sitePosBySite.set(site, { x: cursor, y: tier1RowY })
      cursor += box.w + SITE_GAP
    }
  }

  // Place tier-2 sites centred over their parent. If parent isn't
  // in the tier-1 row (shouldn't happen given the classifier), fall
  // back to next free slot at the top.
  for (const [site, parent] of tier2Parent) {
    const myBox = siteBoxesBySite.get(site)
    const parentPos = sitePosBySite.get(parent)
    const parentBox = siteBoxesBySite.get(parent)
    if (!myBox) continue
    if (parentPos && parentBox) {
      sitePosBySite.set(site, {
        x: parentPos.x + (parentBox.w - myBox.w) / 2,
        y: 0,
      })
    }
  }

  // Force-directed refinement. The tier-based positions above are a
  // good seed but produce strict rows — operators read connected
  // sites as "next to each other", which a relaxation pass produces
  // far more naturally than a hand-coded column walker.
  //
  //  - Repulsion: every pair of sites pushes apart, scaled so
  //    overlapping boxes are aggressively separated and distant ones
  //    barely move (Coulomb-style 1/d²).
  //  - Attraction: pairs connected via intersite edges pull together
  //    with spring force proportional to the edge weight. The desired
  //    rest length is roughly the average of the two boxes' half-
  //    widths plus a small gap — gives "connected, but not touching".
  //  - Cooling: the per-iteration force scaling decays linearly so the
  //    layout converges instead of oscillating.
  //
  // Skipped when there's only one site (nothing to refine) and capped
  // at SITE_LAYOUT_ITERATIONS so the cost stays under a millisecond
  // even on a busy estate.
  const SITE_LAYOUT_ITERATIONS = 180
  if (sitePosBySite.size >= 2) {
    const allSiteIDs = Array.from(sitePosBySite.keys())
    type Force = { fx: number; fy: number }
    const forces = new Map<string, Force>()
    for (let iter = 0; iter < SITE_LAYOUT_ITERATIONS; iter++) {
      const cooling = 1 - iter / SITE_LAYOUT_ITERATIONS
      for (const s of allSiteIDs) forces.set(s, { fx: 0, fy: 0 })
      // Pairwise repulsion.
      for (let i = 0; i < allSiteIDs.length; i++) {
        const a = allSiteIDs[i]
        const posA = sitePosBySite.get(a)!
        const boxA = siteBoxesBySite.get(a)!
        for (let j = i + 1; j < allSiteIDs.length; j++) {
          const b = allSiteIDs[j]
          const posB = sitePosBySite.get(b)!
          const boxB = siteBoxesBySite.get(b)!
          const ax = posA.x + boxA.w / 2
          const ay = posA.y + boxA.h / 2
          const bx = posB.x + boxB.w / 2
          const by = posB.y + boxB.h / 2
          const dx = bx - ax
          const dy = by - ay
          const dist = Math.max(Math.hypot(dx, dy), 1)
          const minClearance = (boxA.w + boxB.w) / 2 + SITE_GAP * 0.4
          let magnitude: number
          if (dist < minClearance) {
            // Strong push when bounding boxes are too close / overlapping.
            magnitude = (minClearance - dist) * 0.6
          } else {
            // Mild long-range repulsion so isolated sites don't drift
            // off into the void.
            magnitude = Math.min(40_000 / (dist * dist), 1.5)
          }
          const ux = dx / dist
          const uy = dy / dist
          const fA = forces.get(a)!
          const fB = forces.get(b)!
          fA.fx -= ux * magnitude
          fA.fy -= uy * magnitude
          fB.fx += ux * magnitude
          fB.fy += uy * magnitude
        }
      }
      // Attractive springs along intersite edges.
      for (const [a, partners] of intersiteWeights) {
        if (!sitePosBySite.has(a)) continue
        for (const [b, weight] of partners) {
          if (!sitePosBySite.has(b)) continue
          if (a >= b) continue // each pair once
          const posA = sitePosBySite.get(a)!
          const posB = sitePosBySite.get(b)!
          const boxA = siteBoxesBySite.get(a)!
          const boxB = siteBoxesBySite.get(b)!
          const ax = posA.x + boxA.w / 2
          const ay = posA.y + boxA.h / 2
          const bx = posB.x + boxB.w / 2
          const by = posB.y + boxB.h / 2
          const dx = bx - ax
          const dy = by - ay
          const dist = Math.max(Math.hypot(dx, dy), 1)
          const restLen = (boxA.w + boxB.w) / 2 + SITE_GAP * 1.6
          const stretch = dist - restLen
          const magnitude = stretch * 0.04 * Math.log(1 + weight)
          const ux = dx / dist
          const uy = dy / dist
          const fA = forces.get(a)!
          const fB = forces.get(b)!
          fA.fx += ux * magnitude
          fA.fy += uy * magnitude
          fB.fx -= ux * magnitude
          fB.fy -= uy * magnitude
        }
      }
      // Apply forces with cooling.
      for (const [s, pos] of sitePosBySite) {
        const f = forces.get(s)!
        const stepCap = 30
        pos.x += clamp(f.fx * cooling, -stepCap, stepCap)
        pos.y += clamp(f.fy * cooling, -stepCap, stepCap)
      }
    }
    // Normalise so the topmost / leftmost site sits at ~(20, 20) —
    // gives the viewport a small margin without changing the relative
    // spatial relationships.
    let minX = Infinity
    let minY = Infinity
    for (const pos of sitePosBySite.values()) {
      if (pos.x < minX) minX = pos.x
      if (pos.y < minY) minY = pos.y
    }
    const shiftX = -minX + 20
    const shiftY = -minY + 20
    for (const pos of sitePosBySite.values()) {
      pos.x += shiftX
      pos.y += shiftY
    }
  }

  // Now materialise nodePos + sites[] from the placement decisions.
  const nodePos: Record<string, { x: number; y: number; w: number; h: number }> = {}
  const sites: Array<{ site: string; nodeCount: number; x: number; y: number; w: number; h: number; accent: string }> = []
  for (const site of data.siteOrder) {
    const box = siteBoxesBySite.get(site)
    const pos = sitePosBySite.get(site)
    if (!box || !pos) continue
    const { nodes, w, h, ringR } = box

    if (nodes.length <= 1) {
      if (nodes[0]) {
        nodePos[nodes[0].id] = {
          x: pos.x + SITE_PAD_X + 10,
          y: pos.y + SITE_PAD_TOP,
          w: NODE_W,
          h: NODE_H,
        }
      }
      sites.push({ site, nodeCount: nodes.length, x: pos.x, y: pos.y, w, h, accent: siteAccent(site) })
      continue
    }

    const sorted = sortNodesByDegree(nodes)
    const hub = sorted[0]
    const spokes = sorted.slice(1)
    const siteRadiusPx = ringR + NODE_W / 2 + 16
    const centerX = pos.x + w / 2
    const centerY = pos.y + SITE_PAD_TOP + siteRadiusPx

    nodePos[hub.id] = {
      x: centerX - NODE_W / 2,
      y: centerY - NODE_H / 2,
      w: NODE_W,
      h: NODE_H,
    }
    spokes.forEach((node, i) => {
      const angle = (i / spokes.length) * Math.PI * 2 - Math.PI / 2
      nodePos[node.id] = {
        x: centerX + Math.cos(angle) * ringR - NODE_W / 2,
        y: centerY + Math.sin(angle) * ringR - NODE_H / 2,
        w: NODE_W,
        h: NODE_H,
      }
    })

    sites.push({ site, nodeCount: nodes.length, x: pos.x, y: pos.y, w, h, accent: siteAccent(site) })
  }

  // cursor placeholder kept for downstream width math.
  const cursor =
    tier1Ordered.reduce(
      (acc, s) => acc + (siteBoxesBySite.get(s)?.w ?? 0) + SITE_GAP,
      0,
    )
  const svgWidth = Math.max(cursor - SITE_GAP, 400) + 24
  const svgContentHeight = Math.max(...sites.map((s) => s.y + s.h), 240) + 24

  // Reserve vertical space ABOVE the site boxes so intersite edges
  // can arc over them instead of cutting through whatever site
  // happens to sit between the two endpoints. Only allocated when
  // the data actually has at least one cross-site edge (otherwise
  // a single-site map wastes the headroom).
  const hasIntersiteEdge = data.edges.some((e) => e.subtype === 'Intersite_Link')
  const ARC_HEADROOM = hasIntersiteEdge ? 160 : 0
  const svgInitialY = -ARC_HEADROOM
  const svgHeight = svgContentHeight + ARC_HEADROOM

  // Site-index lookup so edge routing can tell intra-site from
  // inter-site edges + measure how many columns an intersite edge
  // spans. Used to pick the arc lift.
  const siteIndexByNodeId = useMemo(() => {
    const map = new Map<string, number>()
    data.siteOrder.forEach((site, idx) => {
      for (const node of data.nodes) {
        if (node.site === site) map.set(node.id, idx)
      }
    })
    return map
  }, [data.nodes, data.siteOrder])

  // Initialise the view to the content bounds on first render.
  useEffect(() => {
    if (view === null) {
      setView({ x: 0, y: svgInitialY, w: svgWidth, h: svgHeight })
    }
    // Intentionally dependent only on size — we don't reset the
    // operator's pan/zoom when data refreshes underneath them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svgWidth, svgHeight])

  // Clamp zoom to a sensible range. Below 0.25× is unreadable, above
  // 4× is just empty white.
  const MIN_ZOOM = 0.25
  const MAX_ZOOM = 4
  const baseScale = view ? svgWidth / view.w : 1

  function applyZoom(factor: number, anchor?: { x: number; y: number }) {
    setView((prev) => {
      if (!prev) return prev
      const newW = clamp(prev.w / factor, svgWidth / MAX_ZOOM, svgWidth / MIN_ZOOM)
      const newH = newW * (svgHeight / svgWidth)
      // Keep the anchor point under the cursor stable when zooming.
      const ax = anchor ? anchor.x : prev.x + prev.w / 2
      const ay = anchor ? anchor.y : prev.y + prev.h / 2
      const newX = ax - (ax - prev.x) * (newW / prev.w)
      const newY = ay - (ay - prev.y) * (newH / prev.h)
      return { x: newX, y: newY, w: newW, h: newH }
    })
  }

  function fitToContent() {
    setView({ x: 0, y: svgInitialY, w: svgWidth, h: svgHeight })
  }

  function resetLayout() {
    setSiteOffsets({})
    setNodeOffsets({})
    fitToContent()
  }

  // Effective coordinates: base layout + site offset + (for nodes) own
  // offset. Sites carry their nodes when moved; individual nodes can
  // still be dragged on top.
  function siteOffset(site: string) {
    return siteOffsets[site] ?? { dx: 0, dy: 0 }
  }
  function nodeOffset(nodeId: string) {
    return nodeOffsets[nodeId] ?? { dx: 0, dy: 0 }
  }
  function nodeCombinedOffset(nodeId: string, site: string) {
    const s = siteOffset(site)
    const n = nodeOffset(nodeId)
    return { dx: s.dx + n.dx, dy: s.dy + n.dy }
  }

  function screenToSvg(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current
    if (!svg || !view) return null
    const rect = svg.getBoundingClientRect()
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.w,
      y: view.y + ((clientY - rect.top) / rect.height) * view.h,
    }
  }

  function handleWheel(e: ReactWheelEvent<SVGSVGElement>) {
    if (!view) return
    e.preventDefault()
    const anchor = screenToSvg(e.clientX, e.clientY)
    const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18
    applyZoom(factor, anchor ?? undefined)
  }

  function handleMouseDown(e: ReactMouseEvent<SVGSVGElement>) {
    if (!view) return
    if (e.button !== 0) return
    // Walk up the SVG tree to find the first ancestor carrying a
    // data-role attribute. Three kinds matter:
    //   site-header → drag the whole site
    //   node        → drag this node alone, OR click-to-select if
    //                 the mouse barely moves
    //   edge        → click-to-select (no drag)
    // Anything else → pan the canvas.
    let el: Element | null = e.target as Element
    let role: string | undefined
    let roleTarget: string | undefined
    while (el && el !== e.currentTarget) {
      const r = (el as HTMLElement).dataset?.role
      if (r === 'site-header' || r === 'node' || r === 'edge') {
        role = r
        roleTarget = (el as HTMLElement).dataset?.target
        break
      }
      el = el.parentElement
    }
    if (role === 'edge') {
      return
    }
    if (role === 'site-header' && roleTarget) {
      const start = siteOffset(roleTarget)
      setDragging({
        kind: 'site',
        site: roleTarget,
        startX: e.clientX,
        startY: e.clientY,
        initialDx: start.dx,
        initialDy: start.dy,
        moved: false,
      })
      e.preventDefault()
      return
    }
    if (role === 'node' && roleTarget) {
      const start = nodeOffset(roleTarget)
      setDragging({
        kind: 'node',
        node: roleTarget,
        startX: e.clientX,
        startY: e.clientY,
        initialDx: start.dx,
        initialDy: start.dy,
        moved: false,
      })
      e.preventDefault()
      return
    }
    setSelectedNode(null)
    setSelectedEdge(null)
    setDragging({ kind: 'pan', startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y })
  }

  useEffect(() => {
    if (!dragging) return
    const DRAG_THRESHOLD = 4 // px of mouse movement before "drag" overrides "click"

    function onMove(e: MouseEvent) {
      if (!dragging) return
      const dxPx = e.clientX - dragging.startX
      const dyPx = e.clientY - dragging.startY
      if (dragging.kind === 'pan') {
        setView((prev) => {
          if (!prev) return prev
          const svg = svgRef.current
          if (!svg) return prev
          const rect = svg.getBoundingClientRect()
          const dx = (dxPx / rect.width) * prev.w
          const dy = (dyPx / rect.height) * prev.h
          return { ...prev, x: dragging.viewX - dx, y: dragging.viewY - dy }
        })
        return
      }
      // Site + node drag: convert pixel delta to SVG-unit delta
      // using the current view scale.
      const svg = svgRef.current
      if (!svg || !view) return
      const rect = svg.getBoundingClientRect()
      const dx = (dxPx / rect.width) * view.w
      const dy = (dyPx / rect.height) * view.h
      const moved = Math.hypot(dxPx, dyPx) >= DRAG_THRESHOLD
      if (dragging.kind === 'site') {
        // Sites move freely — no clamp.
        setSiteOffsets((prev) => ({
          ...prev,
          [dragging.site]: { dx: dragging.initialDx + dx, dy: dragging.initialDy + dy },
        }))
      } else if (dragging.kind === 'node') {
        // Nodes stay inside their parent site box: compute the
        // unoffset site bounds + base node position, then clamp the
        // node's offset so the node card never bleeds past the site
        // border or the title pill on top.
        const node = data.nodes.find((n) => n.id === dragging.node)
        const base = nodePos[dragging.node]
        const siteBox = sites.find((s) => node && s.site === node.site)
        const rawDx = dragging.initialDx + dx
        const rawDy = dragging.initialDy + dy
        let clampedDx = rawDx
        let clampedDy = rawDy
        if (base && siteBox) {
          const minDx = siteBox.x + SITE_PAD_X - base.x
          const maxDx = siteBox.x + siteBox.w - SITE_PAD_X - base.x - base.w
          const minDy = siteBox.y + SITE_PAD_TOP - base.y
          const maxDy = siteBox.y + siteBox.h - SITE_PAD_BOTTOM - base.y - base.h
          // Guard against degenerate boxes (min > max means the site
          // is too small to hold the node + padding; just don't move).
          if (minDx <= maxDx) clampedDx = Math.max(minDx, Math.min(maxDx, rawDx))
          if (minDy <= maxDy) clampedDy = Math.max(minDy, Math.min(maxDy, rawDy))
        }
        setNodeOffsets((prev) => ({
          ...prev,
          [dragging.node]: { dx: clampedDx, dy: clampedDy },
        }))
      }
      if (moved && !dragging.moved) {
        setDragging({ ...dragging, moved: true })
      }
    }
    function onUp() {
      // If the user clicked without moving, treat as a click on the
      // node (selection) — site headers don't have a click action so
      // a stationary mouseup on one is just a no-op.
      if (dragging && dragging.kind === 'node' && !dragging.moved) {
        const nodeId = dragging.node
        setSelectedNode(nodeId)
        setSelectedEdge(null)
      }
      setDragging(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, view])

  // Zoom-to-fit a single node when it's selected (only if the node
  // is currently outside the viewport).
  useEffect(() => {
    if (!selectedNode || !view) return
    const pos = nodePos[selectedNode]
    if (!pos) return
    const cx = pos.x + pos.w / 2
    const cy = pos.y + pos.h / 2
    const inView = cx >= view.x && cx <= view.x + view.w && cy >= view.y && cy <= view.y + view.h
    if (inView) return
    // Pan to centre the node; preserve current zoom.
    setView({ x: cx - view.w / 2, y: cy - view.h / 2, w: view.w, h: view.h })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode])

  // Effective node positions: base layout + any drag offsets. Used
  // for both rendering and edge routing so a moved node carries its
  // edges with it.
  const effectiveNodePos: typeof nodePos = {}
  for (const node of data.nodes) {
    const base = nodePos[node.id]
    if (!base) continue
    const off = nodeCombinedOffset(node.id, node.site)
    effectiveNodePos[node.id] = {
      x: base.x + off.dx,
      y: base.y + off.dy,
      w: base.w,
      h: base.h,
    }
  }
  // Effective site positions: same, minus the per-node offset (sites
  // only carry the site-level offset).
  const effectiveSites = sites.map((s) => {
    const off = siteOffset(s.site)
    return { ...s, x: s.x + off.dx, y: s.y + off.dy }
  })

  // Bundle parallel edges between the same pair into a single
  // visible line and remember the count so we can stamp a chip
  // at the midpoint.
  //
  // Intersite_Link gets special treatment: collapse by SITE pair
  // instead of device pair, so a sensorium↔dca-par7 link via the
  // backbone switches AND a parallel link via the firewalls draw as
  // ONE arc with a "×2" badge — not two arcs that visually clutter
  // without telling the operator anything actionable. Same applies
  // to dca-par7↔dcb-mrs2 and every other intersite pair. The
  // selection panel's "Site-pair redundancy" row already exposes the
  // underlying device pairs and counts, so no detail is lost.
  const grouped = new Map<string, { edge: MapEdge; count: number; idx: number }>()
  data.edges.forEach((edge, idx) => {
    let key: string
    if (edge.subtype === 'Intersite_Link') {
      const fromSite = siteByNodeId.get(edge.from) ?? ''
      const toSite = siteByNodeId.get(edge.to) ?? ''
      key = [fromSite, toSite].sort().join('|') + '::Intersite_Link'
    } else {
      key = [edge.from, edge.to].sort().join('|') + '::' + edge.subtype
    }
    const prev = grouped.get(key)
    if (prev) {
      prev.count += 1
    } else {
      grouped.set(key, { edge, count: 1, idx })
    }
  })
  const visibleEdges = Array.from(grouped.values())

  // Edge routing.
  //
  // Intra-site edges (both endpoints in the same site column) use a
  // small perpendicular Bezier offset so parallel bundles between
  // the same pair draw to both sides.
  //
  // Inter-site edges arc OVER the top of the site boxes — the
  // control point is pulled into the ARC_HEADROOM region above the
  // columns so the line never passes through an intervening site
  // box. The lift scales with how many columns the edge spans so a
  // long-haul DCA → SENS edge clears more headroom than a DCA → DCB
  // hop between adjacent columns. Parallel intersite bundles between
  // the same pair stack at slightly different lifts so the chip
  // labels don't overlap.
  const parallelTally: Record<string, number> = {}
  const edgePath = (
    edge: MapEdge,
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ): { d: string; mx: number; my: number } => {
    const key = [edge.from, edge.to].sort().join('|')
    const parallel = parallelTally[key] ?? 0
    parallelTally[key] = parallel + 1
    const ax = a.x + a.w / 2
    const ay = a.y + a.h / 2
    const bx = b.x + b.w / 2
    const by = b.y + b.h / 2

    const fromIdx = siteIndexByNodeId.get(edge.from) ?? -1
    const toIdx = siteIndexByNodeId.get(edge.to) ?? -1
    const isIntersite = fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx
    if (isIntersite) {
      // Arc above the site boxes. Lift = base headroom + extra per
      // spanned column + a small per-parallel offset.
      const sitesSpanned = Math.abs(fromIdx - toIdx)
      const baseLift = 70 + sitesSpanned * 16
      const parallelLift = parallel * 14
      const cx = (ax + bx) / 2
      const cy = -baseLift - parallelLift
      const mx = 0.25 * ax + 0.5 * cx + 0.25 * bx
      const my = 0.25 * ay + 0.5 * cy + 0.25 * by
      return { d: `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`, mx, my }
    }

    const dx = bx - ax
    const dy = by - ay
    const len = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
    const sign = parallel % 2 === 0 ? 1 : -1
    const magnitude = 22 + Math.floor(parallel / 2) * 16
    const cx = (ax + bx) / 2 + sign * magnitude * (-dy / len)
    const cy = (ay + by) / 2 + sign * magnitude * (dx / len)
    const mx = 0.25 * ax + 0.5 * cx + 0.25 * bx
    const my = 0.25 * ay + 0.5 * cy + 0.25 * by
    return { d: `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`, mx, my }
  }

  // Which edges + nodes are highlighted given the current hover state.
  const connectedNodeIds = new Set<string>()
  if (hoveredNode) {
    connectedNodeIds.add(hoveredNode)
    visibleEdges.forEach(({ edge }) => {
      if (edge.from === hoveredNode) connectedNodeIds.add(edge.to)
      if (edge.to === hoveredNode) connectedNodeIds.add(edge.from)
    })
  }
  const hoveredEdgeData = hoveredEdge !== null ? visibleEdges[hoveredEdge] : null

  // Centre the view on a specific node — used by search-enter and the
  // minimap click. Preserves the current zoom level.
  function panToNode(nodeId: string) {
    const pos = effectiveNodePos[nodeId]
    if (!pos || !view) return
    const cx = pos.x + pos.w / 2
    const cy = pos.y + pos.h / 2
    setView({ x: cx - view.w / 2, y: cy - view.h / 2, w: view.w, h: view.h })
  }

  // Search match set: nodes whose label OR id includes the search
  // query (case-insensitive). Empty query → empty set (no highlight).
  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return new Set<string>()
    const out = new Set<string>()
    for (const n of data.nodes) {
      if (n.label.toLowerCase().includes(q) || n.id.toLowerCase().includes(q)) {
        out.add(n.id)
      }
    }
    return out
  }, [searchQuery, data.nodes])

  return (
    <div ref={wrapperRef} style={{ position: 'relative', marginTop: 8 }}>
      {/* Top-left floating search box */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          zIndex: 3,
          background: '#ffffff',
          border: '0.5px solid rgba(20,30,60,0.18)',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(3,35,74,0.08)',
          display: 'flex',
          alignItems: 'center',
          padding: '4px 8px',
          gap: 6,
        }}
      >
        <span style={{ color: '#807e76', fontSize: 12 }}>🔎</span>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const first = Array.from(searchMatches)[0]
              if (first) {
                panToNode(first)
                setSelectedNode(first)
                setSelectedEdge(null)
              }
            }
            if (e.key === 'Escape') {
              setSearchQuery('')
            }
          }}
          placeholder="Find device…"
          style={{
            border: 0,
            outline: 'none',
            background: 'transparent',
            fontSize: 12,
            color: '#14130f',
            width: 180,
            fontFamily: 'var(--font-sans)',
          }}
        />
        {searchQuery ? (
          <span
            style={{
              fontSize: 10,
              color: '#807e76',
              fontFamily: 'var(--font-mono)',
              marginRight: 4,
            }}
          >
            {searchMatches.size}
          </span>
        ) : null}
        {searchQuery ? (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            style={{
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              color: '#807e76',
              fontSize: 12,
              padding: 0,
              lineHeight: 1,
            }}
            title="Clear (Esc)"
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* Top-right floating zoom controls */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 3,
          display: 'flex',
          gap: 4,
          background: '#ffffff',
          border: '0.5px solid rgba(20,30,60,0.18)',
          padding: 3,
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(3,35,74,0.08)',
        }}
      >
        <ZoomButton onClick={() => applyZoom(1.25)} title="Zoom in">+</ZoomButton>
        <ZoomButton onClick={() => applyZoom(1 / 1.25)} title="Zoom out">−</ZoomButton>
        <ZoomButton onClick={fitToContent} title="Fit to screen">⤢</ZoomButton>
        <ZoomButton onClick={resetLayout} title="Reset layout (undo all moves + zoom to fit)">↺</ZoomButton>
        <div
          style={{
            padding: '0 8px',
            fontSize: 10,
            color: '#807e76',
            display: 'flex',
            alignItems: 'center',
            fontFamily: 'var(--font-mono)',
            minWidth: 38,
            justifyContent: 'center',
          }}
        >
          {Math.round(baseScale * 100)}%
        </div>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height={VIEWPORT_H}
        viewBox={view ? `${view.x} ${view.y} ${view.w} ${view.h}` : `0 0 ${svgWidth} ${svgHeight}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        style={{
          width: '100%',
          height: VIEWPORT_H,
          fontSize: 11,
          fontFamily: 'var(--font-sans)',
          background: '#fbfaf6',
          border: '0.5px solid rgba(20,30,60,0.08)',
          borderRadius: 12,
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <defs>
          {/* Engineering-blueprint dot grid behind everything */}
          <pattern id="nm-dot-grid" x="0" y="0" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.7" fill="rgba(20,30,60,0.10)" />
          </pattern>
          {/* Soft card drop shadow */}
          <filter id="nm-card-shadow" x="-10%" y="-10%" width="120%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#03234A" floodOpacity="0.10" />
          </filter>
          {/* Stronger glow used on hover-pulse and selection halo */}
          <filter id="nm-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          {/* Site backdrop: subtle warm vertical gradient */}
          <linearGradient id="nm-site-bg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f6f6f3" />
            <stop offset="100%" stopColor="#ecebe5" />
          </linearGradient>
          {/* Intersite gradient: navy → vivid blue, animated */}
          <linearGradient id="nm-edge-intersite" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#C73030" />
            <stop offset="100%" stopColor="#1C68C7" />
          </linearGradient>
          {/* Port_Channel gradient: brand navy → blue-mid */}
          <linearGradient id="nm-edge-portchannel" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#03234A" />
            <stop offset="100%" stopColor="#3E92E6" />
          </linearGradient>
          {/* Switch_Link: pale blue */}
          <linearGradient id="nm-edge-switchlink" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#8CC0F2" />
            <stop offset="100%" stopColor="#1C68C7" />
          </linearGradient>
        </defs>

        {/* Dot-grid backdrop — covers a generous border around the
            content bounds so the pattern is visible even when the
            user pans past the edges of the laid-out sites. */}
        <rect
          x={-2000}
          y={-2000}
          width={svgWidth + 4000}
          height={svgHeight + 4000}
          fill="url(#nm-dot-grid)"
        />

        {/* Site containers */}
        {effectiveSites.map((s) => {
          const siteCursor =
            dragging?.kind === 'site' && dragging.site === s.site ? 'grabbing' : 'grab'
          return (
            <g key={s.site}>
              {/* Backdrop — the entire site box is the drag handle.
                  Nodes drawn ON TOP carry their own data-role="node",
                  so clicks on nodes route to node-drag instead. */}
              <rect
                x={s.x}
                y={s.y}
                width={s.w}
                height={s.h}
                fill="url(#nm-site-bg)"
                stroke="rgba(20,30,60,0.08)"
                strokeWidth={0.5}
                rx={12}
                data-role="site-header"
                data-target={s.site}
                style={{ cursor: siteCursor }}
              />
              {/* Coloured top stripe */}
              <rect
                x={s.x}
                y={s.y}
                width={s.w}
                height={4}
                fill={s.accent}
                rx={2}
                data-role="site-header"
                data-target={s.site}
              />
              {/* Site title pill */}
              <rect
                x={s.x + SITE_PAD_X}
                y={s.y + 14}
                width={Math.max(s.site.length * 6.5 + 28, 90)}
                height={22}
                fill="#03234A"
                rx={11}
                data-role="site-header"
                data-target={s.site}
                style={{ cursor: siteCursor }}
              />
              <text
                x={s.x + SITE_PAD_X + 12}
                y={s.y + 29}
                fill="#ffffff"
                fontWeight={600}
                fontSize={11}
                style={{ letterSpacing: '0.02em', pointerEvents: 'none' }}
              >
                {s.site}
              </text>
              {/* Node count chip */}
              <rect
                x={s.x + s.w - SITE_PAD_X - 62}
                y={s.y + 14}
                width={62}
                height={22}
                fill="#ffffff"
                stroke="rgba(20,30,60,0.08)"
                strokeWidth={0.5}
                rx={11}
                data-role="site-header"
                data-target={s.site}
              />
              <text
                x={s.x + s.w - SITE_PAD_X - 31}
                y={s.y + 29}
                textAnchor="middle"
                fill="#54534e"
                fontSize={10}
                fontWeight={500}
                style={{ pointerEvents: 'none' }}
              >
                {s.nodeCount} {s.nodeCount === 1 ? 'node' : 'nodes'}
              </text>
            </g>
          )
        })}

        {/* Edges */}
        {visibleEdges.map(({ edge, count }, i) => {
          const a = effectiveNodePos[edge.from]
          const b = effectiveNodePos[edge.to]
          if (!a || !b) return null
          const { d, mx, my } = edgePath(edge, a, b)
          const style = edgeStyle(edge.subtype)
          const isSelected = selectedEdge === i
          const isSelectedNodeEdge =
            selectedNode !== null && (edge.from === selectedNode || edge.to === selectedNode)
          const dimmed =
            (hoveredNode !== null && edge.from !== hoveredNode && edge.to !== hoveredNode) ||
            (selectedNode !== null && !isSelectedNodeEdge && selectedEdge === null)
          const highlighted =
            hoveredEdge === i ||
            isSelected ||
            isSelectedNodeEdge ||
            (hoveredNode !== null && (edge.from === hoveredNode || edge.to === hoveredNode))
          return (
            <g
              key={i}
              opacity={mounted ? (dimmed ? 0.18 : 1) : 0}
              style={{ transition: 'opacity 360ms ease' }}
            >
              {/* Wide invisible hit area for hover + click */}
              <path
                d={d}
                fill="none"
                stroke="transparent"
                strokeWidth={14}
                data-role="edge"
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredEdge(i)}
                onMouseLeave={() => setHoveredEdge(null)}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedEdge(i)
                  setSelectedNode(null)
                }}
              />
              {/* Faint glow under intersite + highlighted */}
              {(edge.subtype === 'Intersite_Link' || highlighted) && (
                <path
                  d={d}
                  fill="none"
                  stroke={style.stroke}
                  strokeWidth={highlighted ? style.width + 6 : style.width + 3}
                  strokeOpacity={0.18}
                  strokeLinecap="round"
                />
              )}
              {/* Main stroke */}
              <path
                d={d}
                fill="none"
                stroke={style.stroke}
                strokeWidth={highlighted ? style.width + 0.8 : style.width}
                strokeDasharray={style.dash}
                strokeLinecap="round"
                opacity={0.95}
              >
                {edge.subtype === 'Intersite_Link' ? (
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to="-24"
                    dur="1.4s"
                    repeatCount="indefinite"
                  />
                ) : null}
              </path>
              {/* Member chip at midpoint when bundle > 1 */}
              {count > 1 && (
                <g>
                  <rect
                    x={mx - 14}
                    y={my - 9}
                    width={28}
                    height={18}
                    fill="#ffffff"
                    stroke={style.stroke}
                    strokeWidth={0.6}
                    rx={9}
                  />
                  <text x={mx} y={my + 4} textAnchor="middle" fill="#14130f" fontSize={10} fontWeight={600}>
                    ×{count}
                  </text>
                </g>
              )}
            </g>
          )
        })}

        {/* Nodes (drawn last so they sit ON TOP of edges) */}
        {data.nodes.map((node, nodeIdx) => {
          const pos = effectiveNodePos[node.id]
          if (!pos) return null
          const accent = nodeAccent(node.assetType)
          const isSelected = node.id === selectedNode
          const isNeighbor =
            selectedNode !== null &&
            visibleEdges.some(
              ({ edge }) =>
                (edge.from === selectedNode && edge.to === node.id) ||
                (edge.to === selectedNode && edge.from === node.id),
            )
          const dimmed =
            (hoveredNode !== null && !connectedNodeIds.has(node.id)) ||
            (selectedNode !== null && !isSelected && !isNeighbor)
          const highlighted = node.id === hoveredNode || isSelected
          // Stagger the entry animation so the columns reveal left-to-
          // right rather than popping in all at once.
          const delay = mounted ? 0 : nodeIdx * 12
          return (
            <g
              key={node.id}
              opacity={mounted ? (dimmed ? 0.25 : 1) : 0}
              transform={mounted ? 'translate(0,0)' : `translate(0,8)`}
              style={{
                cursor: 'pointer',
                transition: `opacity 380ms ease ${delay}ms, transform 380ms cubic-bezier(0.2, 0.7, 0.2, 1) ${delay}ms`,
              }}
              onMouseEnter={() => setHoveredNode(node.id)}
              onMouseLeave={() => setHoveredNode(null)}
              data-role="node"
              data-target={node.id}
            >
              {/* Selection halo */}
              {isSelected && (
                <rect
                  x={pos.x - 4}
                  y={pos.y - 4}
                  width={pos.w + 8}
                  height={pos.h + 8}
                  fill="none"
                  stroke={accent}
                  strokeOpacity={0.35}
                  strokeWidth={2}
                  rx={11}
                >
                  <animate attributeName="stroke-opacity" values="0.15;0.55;0.15" dur="2s" repeatCount="indefinite" />
                </rect>
              )}
              {/* Search-match glow — yellow ring around every node
                  whose name matches the active search query. Doesn't
                  conflict with the selection halo (which uses the
                  accent colour). */}
              {searchMatches.has(node.id) && (
                <rect
                  x={pos.x - 6}
                  y={pos.y - 6}
                  width={pos.w + 12}
                  height={pos.h + 12}
                  fill="none"
                  stroke="#ED9314"
                  strokeOpacity={0.5}
                  strokeWidth={2.5}
                  rx={12}
                />
              )}
              <rect
                x={pos.x}
                y={pos.y}
                width={pos.w}
                height={pos.h}
                fill="#ffffff"
                stroke={highlighted ? accent : 'rgba(20,30,60,0.12)'}
                strokeWidth={highlighted ? 1.4 : 0.6}
                rx={8}
                filter="url(#nm-card-shadow)"
                data-role="node"
                data-target={node.id}
                style={{ cursor: dragging?.kind === 'node' && dragging.node === node.id ? 'grabbing' : 'grab' }}
              />
              {/* Left accent stripe */}
              <rect x={pos.x} y={pos.y} width={3} height={pos.h} fill={accent} rx={1.5} data-role="node" data-target={node.id} />
              {/* Icon */}
              <g transform={`translate(${pos.x + 12}, ${pos.y + (pos.h - 16) / 2})`}>
                <NodeIcon kind={nodeKind(node.assetType)} color={accent} />
              </g>
              <text
                x={pos.x + 36}
                y={pos.y + 17}
                fill="#14130f"
                fontSize={12}
                fontWeight={500}
              >
                {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
              </text>
              <text
                x={pos.x + 36}
                y={pos.y + 30}
                fill="#807e76"
                fontSize={10}
                style={{ letterSpacing: '0.02em' }}
              >
                {nodeRoleLabel(node.assetType)}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Minimap — bottom-right corner overview of the full layout
          with the current viewport drawn as a translucent rectangle.
          Click anywhere on the minimap to pan the main view to that
          spot. Updates live as the user pans / zooms / drags. */}
      <Minimap
        nodes={data.nodes}
        nodePos={effectiveNodePos}
        sites={effectiveSites}
        view={view}
        svgWidth={svgWidth}
        svgHeight={svgHeight}
        svgInitialY={svgInitialY}
        onPan={(svgX, svgY) => {
          setView((prev) => (prev ? { ...prev, x: svgX - prev.w / 2, y: svgY - prev.h / 2 } : prev))
        }}
      />

      {/* Edge tooltip */}
      {hoveredEdgeData && (
        <EdgeTooltip
          subtype={hoveredEdgeData.edge.subtype}
          fromLabel={data.nodes.find((n) => n.id === hoveredEdgeData.edge.from)?.label ?? ''}
          toLabel={data.nodes.find((n) => n.id === hoveredEdgeData.edge.to)?.label ?? ''}
          fromSite={data.nodes.find((n) => n.id === hoveredEdgeData.edge.from)?.site ?? ''}
          toSite={data.nodes.find((n) => n.id === hoveredEdgeData.edge.to)?.site ?? ''}
          count={hoveredEdgeData.count}
        />
      )}

      {/* Selection side panel — slides in from the right. Shown for
          either a selected node or a selected edge. Persistent (does
          not close on cursor move, unlike the hover tooltip). */}
      <SelectionPanel
        node={selectedNode ? data.nodes.find((n) => n.id === selectedNode) : null}
        edgeInfo={
          selectedEdge !== null && visibleEdges[selectedEdge]
            ? (() => {
                const sel = visibleEdges[selectedEdge]
                const fromSite = data.nodes.find((n) => n.id === sel.edge.from)?.site ?? ''
                const toSite = data.nodes.find((n) => n.id === sel.edge.to)?.site ?? ''
                // Site-pair resilience: how many distinct intersite
                // bundles connect the two SITES (across any device
                // pair)? This is what answers the "single point of
                // failure?" question — counting only this device pair
                // (sel.count) misses redundant paths through other
                // switches or firewalls.
                let sitePairBundles = 0
                let sitePairCables = 0
                if (fromSite && toSite && fromSite !== toSite) {
                  const nodeSite = new Map<string, string>()
                  data.nodes.forEach((n) => nodeSite.set(n.id, n.site))
                  const seenBundleKeys = new Set<string>()
                  data.edges.forEach((e) => {
                    if (e.subtype !== 'Intersite_Link') return
                    const sa = nodeSite.get(e.from)
                    const sb = nodeSite.get(e.to)
                    if (!sa || !sb) return
                    const samePair =
                      (sa === fromSite && sb === toSite) ||
                      (sa === toSite && sb === fromSite)
                    if (!samePair) return
                    sitePairCables += 1
                    const bundleKey = [e.from, e.to].sort().join('|')
                    if (!seenBundleKeys.has(bundleKey)) {
                      seenBundleKeys.add(bundleKey)
                      sitePairBundles += 1
                    }
                  })
                }
                return {
                  edge: sel.edge,
                  count: sel.count,
                  sitePairBundles,
                  sitePairCables,
                  fromLabel: data.nodes.find((n) => n.id === sel.edge.from)?.label ?? '',
                  toLabel: data.nodes.find((n) => n.id === sel.edge.to)?.label ?? '',
                  fromSite,
                  toSite,
                }
              })()
            : null
        }
        connectedCount={
          selectedNode
            ? visibleEdges.filter(({ edge }) => edge.from === selectedNode || edge.to === selectedNode).length
            : 0
        }
        onClose={() => {
          setSelectedNode(null)
          setSelectedEdge(null)
        }}
      />

      <div style={{ display: 'flex', gap: 12, marginTop: 10, fontSize: 11, color: '#54534e', flexWrap: 'wrap' }}>
        <LegendItem gradientId="nm-edge-intersite" label="Intersite link" animated />
        <LegendItem gradientId="nm-edge-portchannel" label="Port channel" />
        <LegendItem gradientId="nm-edge-switchlink" label="Switch link" dashed />
        <span style={{ marginLeft: 'auto', color: '#807e76' }}>
          🔎 type to find a device · drag site to move · drag node inside its site · scroll to zoom · click minimap to jump · Esc clears selection
        </span>
      </div>
    </div>
  )
}

function ZoomButton({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      style={{
        width: 26,
        height: 26,
        border: 0,
        background: 'transparent',
        color: '#03234A',
        cursor: 'pointer',
        fontSize: 14,
        fontWeight: 600,
        borderRadius: 6,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = '#f6f6f3'
      }}
      onMouseLeave={(e) => {
        ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

function Minimap({
  nodes,
  nodePos,
  sites,
  view,
  svgWidth,
  svgHeight,
  svgInitialY,
  onPan,
}: {
  nodes: MapNode[]
  nodePos: Record<string, { x: number; y: number; w: number; h: number }>
  sites: Array<{ site: string; x: number; y: number; w: number; h: number; accent: string }>
  view: { x: number; y: number; w: number; h: number } | null
  svgWidth: number
  svgHeight: number
  svgInitialY: number
  onPan: (svgX: number, svgY: number) => void
}) {
  // Fixed minimap viewport. Aspect ratio of the source content is
  // preserved by computing the scale that fits the content into the
  // minimap rectangle.
  const MM_W = 200
  const MM_H = 140
  const PAD = 6
  const usableW = MM_W - PAD * 2
  const usableH = MM_H - PAD * 2

  // Source content bounds.
  const contentW = svgWidth
  const contentH = svgHeight
  const contentTop = svgInitialY
  const scale = Math.min(usableW / contentW, usableH / contentH)
  const innerW = contentW * scale
  const innerH = contentH * scale
  const offsetX = PAD + (usableW - innerW) / 2
  const offsetY = PAD + (usableH - innerH) / 2

  // SVG → minimap coordinate transform.
  const toMm = (x: number, y: number) => ({
    x: offsetX + (x - 0) * scale,
    y: offsetY + (y - contentTop) * scale,
  })

  // Minimap → SVG coordinate transform (click-to-pan).
  function onMinimapClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const mmX = e.clientX - rect.left
    const mmY = e.clientY - rect.top
    const svgX = (mmX - offsetX) / scale
    const svgY = (mmY - offsetY) / scale + contentTop
    onPan(svgX, svgY)
  }

  if (!view) return null

  const viewportTL = toMm(view.x, view.y)
  const viewportBR = toMm(view.x + view.w, view.y + view.h)

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 44, // clear the legend below the SVG
        right: 8,
        zIndex: 3,
        background: '#ffffff',
        border: '0.5px solid rgba(20,30,60,0.18)',
        borderRadius: 8,
        boxShadow: '0 2px 8px rgba(3,35,74,0.08)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: '#807e76',
          padding: '4px 8px',
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
          borderBottom: '0.5px solid rgba(20,30,60,0.08)',
          fontWeight: 500,
        }}
      >
        Overview
      </div>
      <svg
        width={MM_W}
        height={MM_H}
        viewBox={`0 0 ${MM_W} ${MM_H}`}
        style={{ display: 'block', cursor: 'crosshair', background: '#fbfaf6' }}
        onClick={onMinimapClick}
      >
        {/* Site rectangles */}
        {sites.map((s) => {
          const tl = toMm(s.x, s.y)
          return (
            <rect
              key={s.site}
              x={tl.x}
              y={tl.y}
              width={s.w * scale}
              height={s.h * scale}
              fill="rgba(20,30,60,0.05)"
              stroke="rgba(20,30,60,0.18)"
              strokeWidth={0.5}
              rx={2}
            />
          )
        })}
        {/* Node dots */}
        {nodes.map((n) => {
          const pos = nodePos[n.id]
          if (!pos) return null
          const c = toMm(pos.x + pos.w / 2, pos.y + pos.h / 2)
          return <circle key={n.id} cx={c.x} cy={c.y} r={1.4} fill="#03234A" opacity={0.7} />
        })}
        {/* Viewport rectangle (current main-view extent) */}
        <rect
          x={Math.max(0, viewportTL.x)}
          y={Math.max(0, viewportTL.y)}
          width={Math.max(0, viewportBR.x - viewportTL.x)}
          height={Math.max(0, viewportBR.y - viewportTL.y)}
          fill="rgba(28,104,199,0.10)"
          stroke="#1C68C7"
          strokeWidth={1.2}
          rx={2}
          pointerEvents="none"
        />
      </svg>
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function SelectionPanel({
  node,
  edgeInfo,
  connectedCount,
  onClose,
}: {
  node: MapNode | null | undefined
  edgeInfo:
    | {
        edge: MapEdge
        count: number
        // Total intersite cables / distinct device-pair bundles
        // between the two sites this edge connects. Used to decide
        // whether the "splits the two sites" warning is accurate.
        sitePairBundles: number
        sitePairCables: number
        fromLabel: string
        toLabel: string
        fromSite: string
        toSite: string
      }
    | null
  connectedCount: number
  onClose: () => void
}) {
  const open = Boolean(node || edgeInfo)
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        bottom: 8,
        width: open ? 300 : 0,
        background: '#ffffff',
        border: open ? '0.5px solid rgba(20,30,60,0.18)' : '0 solid transparent',
        borderRadius: 12,
        boxShadow: open ? '0 6px 24px rgba(3,35,74,0.12)' : 'none',
        overflow: 'hidden',
        transition: 'width 240ms cubic-bezier(0.2, 0.7, 0.2, 1), border 240ms ease',
        zIndex: 2,
        marginTop: 38, // clear the zoom controls
        marginBottom: 38, // clear the legend
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      {open && (
        <div style={{ padding: 14, height: '100%', overflowY: 'auto', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#807e76', marginBottom: 2 }}>
                {node ? 'Device' : 'Link'}
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#14130f', wordBreak: 'break-word' }}>
                {node ? node.label : edgeInfo ? edgeInfo.edge.subtype.replace(/_/g, ' ') : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              title="Close"
              style={{
                border: 0,
                background: 'transparent',
                color: '#807e76',
                cursor: 'pointer',
                fontSize: 16,
                padding: 4,
                borderRadius: 4,
              }}
            >
              ✕
            </button>
          </div>

          {node && (
            <>
              <PanelRow label="Role" value={nodeRoleLabel(node.assetType)} accent={nodeAccent(node.assetType)} />
              <PanelRow label="Site" value={node.site} mono />
              <PanelRow label="Links" value={`${connectedCount} ${connectedCount === 1 ? 'connection' : 'connections'}`} />
              <PanelRow label="Asset ID" value={node.id} mono small />
              <a
                href={`/inventory/${encodeURIComponent(node.id)}`}
                style={{
                  display: 'block',
                  marginTop: 12,
                  padding: '8px 12px',
                  background: '#03234A',
                  color: '#ffffff',
                  textAlign: 'center',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  textDecoration: 'none',
                }}
              >
                Open in inventory →
              </a>
            </>
          )}

          {edgeInfo && (
            <>
              <PanelRow label="From" value={edgeInfo.fromLabel} mono />
              <PanelRow label="To" value={edgeInfo.toLabel} mono />
              <PanelRow
                label="Sites"
                value={
                  edgeInfo.fromSite === edgeInfo.toSite
                    ? edgeInfo.fromSite
                    : `${edgeInfo.fromSite} → ${edgeInfo.toSite}`
                }
                mono
              />
              {edgeInfo.edge.subtype !== 'Intersite_Link' && (
                <PanelRow
                  label="This cable / bundle"
                  value={`${edgeInfo.count} ${edgeInfo.count === 1 ? 'cable in 1 bundle' : 'parallel cables in 1 bundle'}`}
                />
              )}
              {edgeInfo.edge.subtype === 'Intersite_Link' && edgeInfo.sitePairBundles > 0 && (
                <PanelRow
                  label="Site-pair redundancy"
                  value={
                    edgeInfo.sitePairBundles === 1
                      ? `1 intersite bundle between ${edgeInfo.fromSite} and ${edgeInfo.toSite} — no alternate path`
                      : `${edgeInfo.sitePairBundles} intersite bundles between ${edgeInfo.fromSite} and ${edgeInfo.toSite}`
                  }
                />
              )}
              {edgeInfo.edge.subtype === 'Intersite_Link' && edgeInfo.sitePairBundles <= 1 && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 10px',
                    background: '#FFF6E5',
                    color: '#7A4A00',
                    borderRadius: 6,
                    fontSize: 11,
                    lineHeight: 1.4,
                  }}
                >
                  Only 1 cross-site path discovered between {edgeInfo.fromSite} and {edgeInfo.toSite}.
                  DORA Art. 12 / NIS2 Art. 21 expect redundancy here, so this would split the two sites
                  on failure if no alternate exists. If you expect a second path (firewall transit,
                  backup fibre) but it isn&apos;t showing, the platform&apos;s discovery missed it — check{' '}
                  <a
                    href="/v1/admin/firewall-intersite-synth-diagnostic"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#7A4A00', textDecoration: 'underline' }}
                  >
                    /firewall-intersite-synth-diagnostic
                  </a>
                  {' '}for the synthesiser&apos;s decision log.
                </div>
              )}
              {edgeInfo.edge.subtype === 'Intersite_Link' && edgeInfo.sitePairBundles >= 2 && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 10px',
                    background: '#E0F0E4',
                    color: '#1B4D2F',
                    borderRadius: 6,
                    fontSize: 11,
                    lineHeight: 1.4,
                  }}
                >
                  Cross-site link with redundancy — {edgeInfo.sitePairBundles} parallel intersite bundles satisfy DORA Art. 12 / NIS2 Art. 21 single-failure resilience.
                </div>
              )}
              {edgeInfo.edge.discoverySource === 'firewall_subnet_join' && edgeInfo.edge.assetID ? (
                <SuppressSyntheticLinkButton assetID={edgeInfo.edge.assetID} onSuppressed={onClose} />
              ) : null}
            </>
          )}
        </div>
      )}
    </div>
  )
}

// SuppressSyntheticLinkButton lets the operator flag a synthesised
// firewall intersite link as a false positive. Calls the suppression
// API which (a) deletes the link asset and (b) persists the asset_id
// so the next synthesizer pass doesn't re-create it. The page
// reloads on success so the map refreshes without the phantom arc.
function SuppressSyntheticLinkButton({ assetID, onSuppressed }: { assetID: string; onSuppressed: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handle = async () => {
    if (busy) return
    const reason = window.prompt(
      "Mark this synthetic intersite link as a false positive?\n\nThe link will be deleted now and the platform won't re-create it on the next poll.\n\nOptional: short reason for the audit log (e.g. 'verified absent in datacentre walk')",
    )
    if (reason === null) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/admin/firewall-synth-suppress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_id: assetID, reason: reason.trim() }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        setError(body?.detail || body?.error || `${response.status} ${response.statusText}`)
        setBusy(false)
        return
      }
      onSuppressed()
      // Force a hard refresh — the map data is fetched at mount, so
      // the simplest way to drop the suppressed link from view is to
      // reload. Operators typically suppress once and move on; the
      // refresh cost is fine.
      window.location.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'request failed')
      setBusy(false)
    }
  }
  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={handle}
        disabled={busy}
        style={{
          width: '100%',
          padding: '8px 10px',
          border: '0.5px solid #B4321E',
          background: busy ? '#FCE7E5' : '#ffffff',
          color: '#6E1A1A',
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? '…' : '✕ This link isn’t real (mark as false positive)'}
      </button>
      {error ? (
        <div style={{ marginTop: 6, fontSize: 10, color: '#6E1A1A' }}>{error}</div>
      ) : (
        <div style={{ marginTop: 6, fontSize: 10, color: '#807e76', lineHeight: 1.3 }}>
          Synthesised from a shared /30 transit subnet — Panorama doesn&apos;t expose direct cabling, so the platform infers. Suppress here when you know the cable doesn&apos;t exist.
        </div>
      )}
    </div>
  )
}

function PanelRow({ label, value, mono, small, accent }: { label: string; value: string; mono?: boolean; small?: boolean; accent?: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, color: '#807e76', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>
        {label}
      </div>
      <div
        style={{
          fontSize: small ? 10 : 12,
          color: accent ?? '#14130f',
          fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
          wordBreak: 'break-all',
        }}
      >
        {value || '—'}
      </div>
    </div>
  )
}

function EdgeTooltip({
  subtype,
  fromLabel,
  toLabel,
  fromSite,
  toSite,
  count,
}: {
  subtype: string
  fromLabel: string
  toLabel: string
  fromSite: string
  toSite: string
  count: number
}) {
  const accent = edgeStyle(subtype).stroke
  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        background: '#ffffff',
        border: '0.5px solid rgba(20,30,60,0.18)',
        borderLeft: `3px solid ${accent}`,
        padding: '8px 12px',
        borderRadius: 8,
        fontSize: 11,
        color: '#14130f',
        boxShadow: '0 2px 8px rgba(3,35,74,0.12)',
        maxWidth: 280,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{subtype.replace(/_/g, ' ')}</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#54534e' }}>
        {fromLabel} <span style={{ color: accent }}>↔</span> {toLabel}
      </div>
      <div style={{ fontSize: 10, color: '#807e76', marginTop: 4 }}>
        {fromSite}
        {fromSite !== toSite ? ` → ${toSite}` : ''} · {count} {count === 1 ? 'bundle' : 'bundles'}
      </div>
    </div>
  )
}

function LegendItem({ gradientId, label, dashed, animated }: { gradientId: string; label: string; dashed?: boolean; animated?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width={28} height={8}>
        <line
          x1={0}
          y1={4}
          x2={28}
          y2={4}
          stroke={`url(#${gradientId})`}
          strokeWidth={2.5}
          strokeDasharray={dashed ? '4 3' : undefined}
          strokeLinecap="round"
        />
        {animated ? (
          <line x1={0} y1={4} x2={28} y2={4} stroke="#fff" strokeWidth={2.5} strokeDasharray="3 6" opacity={0.4}>
            <animate attributeName="stroke-dashoffset" from="0" to="-9" dur="1s" repeatCount="indefinite" />
          </line>
        ) : null}
      </svg>
      <span>{label}</span>
    </span>
  )
}

function edgeStyle(subtype: string): { stroke: string; width: number; dash?: string } {
  switch (subtype) {
    case 'Intersite_Link':
      return { stroke: 'url(#nm-edge-intersite)', width: 2.6, dash: '8 4' }
    case 'Port_Channel':
      return { stroke: 'url(#nm-edge-portchannel)', width: 2 }
    case 'Switch_Link':
      return { stroke: 'url(#nm-edge-switchlink)', width: 1.8, dash: '4 3' }
    default:
      return { stroke: '#3E92E6', width: 1.8 }
  }
}

// ----- Node icons + classification --------------------------------

type NodeKind = 'network' | 'host' | 'server' | 'firewall' | 'storage' | 'generic'

function nodeKind(assetType: string): NodeKind {
  const t = assetType.toLowerCase()
  if (t === 'network_device' || t === 'switch' || t === 'router') return 'network'
  if (t === 'host' || t === 'esxi_host' || t === 'hypervisor') return 'host'
  if (t === 'server') return 'server'
  if (t === 'firewall' || t === 'firewall_manager') return 'firewall'
  if (t === 'storage_array' || t === 'storage_appliance' || t === 'storage_volume') return 'storage'
  return 'generic'
}

function nodeAccent(assetType: string): string {
  switch (nodeKind(assetType)) {
    case 'network':
      return '#03234A'
    case 'host':
      return '#1C68C7'
    case 'server':
      return '#3E92E6'
    case 'firewall':
      return '#993C1D'
    case 'storage':
      return '#534AB7'
    default:
      return '#807e76'
  }
}

function nodeRoleLabel(assetType: string): string {
  switch (nodeKind(assetType)) {
    case 'network':
      return 'switch / router'
    case 'host':
      return 'hypervisor host'
    case 'server':
      return 'server'
    case 'firewall':
      return 'firewall'
    case 'storage':
      return 'storage'
    default:
      return assetType || 'asset'
  }
}

// Deterministic per-site accent — same site keeps the same colour
// across renders. Picks from the brand palette so the colours feel
// curated rather than random.
function siteAccent(site: string): string {
  const palette = ['#1C68C7', '#534AB7', '#199E78', '#ED9314', '#993C1D', '#3E92E6']
  if (site === 'unassigned') return '#807e76'
  let hash = 0
  for (let i = 0; i < site.length; i++) {
    hash = (hash * 31 + site.charCodeAt(i)) >>> 0
  }
  return palette[hash % palette.length]
}

// Inline SVG icons (16×16, single colour). Hand-tuned for the node
// card — no emoji, no icon-font dependency.
function NodeIcon({ kind, color }: { kind: NodeKind; color: string }) {
  const common: CSSProperties = { display: 'block' }
  switch (kind) {
    case 'network':
      // Switch — chassis with a row of stacked ports + uplink/downlink
      // arrows so it reads as a managed switch at a glance, not just
      // a generic box.
      return (
        <svg width={16} height={16} viewBox="0 0 16 16" style={common}>
          <rect x={1.5} y={5.5} width={13} height={5.5} rx={1} fill="none" stroke={color} strokeWidth={1.2} />
          {/* Port indicators along the bottom of the chassis */}
          <rect x={3} y={9} width={1.6} height={1.2} fill={color} />
          <rect x={5.2} y={9} width={1.6} height={1.2} fill={color} />
          <rect x={7.4} y={9} width={1.6} height={1.2} fill={color} />
          <rect x={9.6} y={9} width={1.6} height={1.2} fill={color} />
          <rect x={11.8} y={9} width={1.6} height={1.2} fill={color} />
          {/* Up / down arrows above the chassis — packets transiting */}
          <path d="M5 3.5 L5 5.2 M5 3.5 L4 4.4 M5 3.5 L6 4.4" stroke={color} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <path d="M11 5.2 L11 3.5 M11 5.2 L10 4.3 M11 5.2 L12 4.3" stroke={color} strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      )
    case 'host':
      // Hypervisor host (ESXi) — server chassis with a 2x2 grid of
      // tinted "VM" tiles inside. Distinguishes a virtualisation
      // platform from a plain server (which keeps the rack-stack icon
      // below).
      return (
        <svg width={16} height={16} viewBox="0 0 16 16" style={common}>
          {/* Server chassis */}
          <rect x={1} y={2} width={14} height={12} rx={1.2} fill="none" stroke={color} strokeWidth={1.2} />
          {/* 2×2 VM tiles inside */}
          <rect x={2.6} y={3.4} width={4.4} height={3.6} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={0.8} />
          <rect x={9} y={3.4} width={4.4} height={3.6} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={0.8} />
          <rect x={2.6} y={9} width={4.4} height={3.6} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={0.8} />
          <rect x={9} y={9} width={4.4} height={3.6} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={0.8} />
        </svg>
      )
    case 'server':
      // Plain server — rack stack (kept distinct from hypervisor host).
      return (
        <svg width={16} height={16} viewBox="0 0 16 16" style={common}>
          <rect x={2} y={2.5} width={12} height={3.5} rx={0.6} fill="none" stroke={color} strokeWidth={1.2} />
          <rect x={2} y={6.8} width={12} height={3.5} rx={0.6} fill="none" stroke={color} strokeWidth={1.2} />
          <rect x={2} y={11.1} width={12} height={2.5} rx={0.6} fill="none" stroke={color} strokeWidth={1.2} />
          <circle cx={4} cy={4.3} r={0.7} fill={color} />
          <circle cx={4} cy={8.6} r={0.7} fill={color} />
        </svg>
      )
    case 'firewall':
      // Firewall — brick wall. Three rows of bricks with the middle
      // row offset by half a brick (the standard brickwork
      // staggered-bond pattern). Universally readable as "wall".
      return (
        <svg width={16} height={16} viewBox="0 0 16 16" style={common}>
          {/* Outer wall outline */}
          <rect x={1.5} y={2.5} width={13} height={11} fill="none" stroke={color} strokeWidth={1.2} />
          {/* Two horizontal mortar lines splitting wall into 3 rows */}
          <line x1={1.5} y1={6.2} x2={14.5} y2={6.2} stroke={color} strokeWidth={0.9} />
          <line x1={1.5} y1={9.8} x2={14.5} y2={9.8} stroke={color} strokeWidth={0.9} />
          {/* Row 1 (top) — 3 bricks with verticals at 1/3 and 2/3 */}
          <line x1={5.8} y1={2.5} x2={5.8} y2={6.2} stroke={color} strokeWidth={0.9} />
          <line x1={10.2} y1={2.5} x2={10.2} y2={6.2} stroke={color} strokeWidth={0.9} />
          {/* Row 2 (middle) — offset by half a brick: verticals at 1/6 and 1/2 and 5/6 */}
          <line x1={3.7} y1={6.2} x2={3.7} y2={9.8} stroke={color} strokeWidth={0.9} />
          <line x1={8} y1={6.2} x2={8} y2={9.8} stroke={color} strokeWidth={0.9} />
          <line x1={12.3} y1={6.2} x2={12.3} y2={9.8} stroke={color} strokeWidth={0.9} />
          {/* Row 3 (bottom) — same pattern as row 1 */}
          <line x1={5.8} y1={9.8} x2={5.8} y2={13.5} stroke={color} strokeWidth={0.9} />
          <line x1={10.2} y1={9.8} x2={10.2} y2={13.5} stroke={color} strokeWidth={0.9} />
        </svg>
      )
    case 'storage':
      // Disk platters
      return (
        <svg width={16} height={16} viewBox="0 0 16 16" style={common}>
          <ellipse cx={8} cy={4} rx={5.5} ry={1.6} fill="none" stroke={color} strokeWidth={1.2} />
          <path d="M2.5 4 L2.5 8 C2.5 8.88 4.96 9.6 8 9.6 C11.04 9.6 13.5 8.88 13.5 8 L13.5 4" fill="none" stroke={color} strokeWidth={1.2} />
          <path d="M2.5 8 L2.5 12 C2.5 12.88 4.96 13.6 8 13.6 C11.04 13.6 13.5 12.88 13.5 12 L13.5 8" fill="none" stroke={color} strokeWidth={1.2} />
        </svg>
      )
    default:
      // Diamond
      return (
        <svg width={16} height={16} viewBox="0 0 16 16" style={common}>
          <path d="M8 2 L14 8 L8 14 L2 8 Z" fill="none" stroke={color} strokeWidth={1.2} strokeLinejoin="round" />
        </svg>
      )
  }
}
