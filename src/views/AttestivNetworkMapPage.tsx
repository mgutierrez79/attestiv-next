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

const MAIN_TYPES = new Set(['Intersite_Link', 'Port_Channel', 'Switch_Link'])

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'Intersite_Link' | 'Port_Channel' | 'Host_Trunk' | 'Switch_Link'>('all')
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
        for (const a of invItems) {
          const id = String(a.asset_id ?? '').trim()
          if (!id) continue
          const site = String(a.datacenter_id ?? '').trim()
          const type = String(a.asset_type ?? '').trim()
          if (site) sm[id] = site
          if (type) tm[id] = type
        }
        setSiteByAssetID(sm)
        setTypeByAssetID(tm)
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
    const out: Record<string, number> = { all: links.length, Intersite_Link: 0, Port_Channel: 0, Host_Trunk: 0, Switch_Link: 0 }
    for (const l of links) {
      const label = String(l.metadata?.['link_type_label'] ?? '').trim()
      if (label in out) out[label]++
    }
    return out
  }, [links])

  const mapData = useMemo(() => buildMapData(links, siteByAssetID, typeByAssetID), [links, siteByAssetID, typeByAssetID])

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
          {(['all', 'Intersite_Link', 'Port_Channel', 'Host_Trunk', 'Switch_Link'] as const).map((key) => (
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
type MapEdge = { from: string; to: string; subtype: string }

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
): { nodes: MapNode[]; edges: MapEdge[]; siteOrder: string[] } {
  const nodes = new Map<string, MapNode>()
  const edges: MapEdge[] = []
  const sites = new Set<string>()
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
    sites.add(aSite)
    sites.add(bSite)
    if (!nodes.has(aID)) {
      nodes.set(aID, { id: aID, label: aLabel, site: aSite, assetType: typeByAssetID[aID] ?? '' })
    }
    if (!nodes.has(bID)) {
      nodes.set(bID, { id: bID, label: bLabel, site: bSite, assetType: typeByAssetID[bID] ?? '' })
    }
    edges.push({ from: aID, to: bID, subtype: label })
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
// Layout still uses fixed site columns + a 2-wide node grid per
// column — same data shape, just dressed properly.

function NetworkMap({ data }: { data: { nodes: MapNode[]; edges: MapEdge[]; siteOrder: string[] } }) {
  const SITE_PAD_X = 16
  const SITE_PAD_TOP = 44
  const SITE_GAP = 68
  const NODE_W = 188
  const NODE_H = 38
  const NODE_GAP_X = 14
  const NODE_GAP_Y = 12
  const NODES_PER_ROW = 2
  const VIEWPORT_H = 520

  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [hoveredEdge, setHoveredEdge] = useState<number | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null)

  // Pan/zoom state expressed as an SVG viewBox. Initialised to the
  // full content bounds once the layout is computed. wheel = zoom
  // (centered on cursor), drag = pan, +/− buttons + "Fit" reset.
  type ViewBox = { x: number; y: number; w: number; h: number }
  const [view, setView] = useState<ViewBox | null>(null)
  const [dragging, setDragging] = useState<{ startX: number; startY: number; viewX: number; viewY: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Entry animation: nodes + edges fade/scale in once mounted.
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 30)
    return () => clearTimeout(t)
  }, [])

  const sitesWithNodes = data.siteOrder.map((site) => ({
    site,
    nodes: data.nodes.filter((n) => n.site === site),
  }))

  const nodePos: Record<string, { x: number; y: number; w: number; h: number }> = {}
  const sites: Array<{ site: string; nodeCount: number; x: number; w: number; h: number; accent: string }> = []
  let cursor = 0
  for (const { site, nodes } of sitesWithNodes) {
    const cols = Math.min(NODES_PER_ROW, Math.max(nodes.length, 1))
    const rows = Math.ceil(Math.max(nodes.length, 1) / cols)
    const w = SITE_PAD_X * 2 + cols * NODE_W + (cols - 1) * NODE_GAP_X
    const h = SITE_PAD_TOP + rows * NODE_H + (rows - 1) * NODE_GAP_Y + SITE_PAD_X
    nodes.forEach((node, idx) => {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      nodePos[node.id] = {
        x: cursor + SITE_PAD_X + col * (NODE_W + NODE_GAP_X),
        y: SITE_PAD_TOP + row * (NODE_H + NODE_GAP_Y),
        w: NODE_W,
        h: NODE_H,
      }
    })
    sites.push({ site, nodeCount: nodes.length, x: cursor, w, h, accent: siteAccent(site) })
    cursor += w + SITE_GAP
  }
  const svgWidth = Math.max(cursor - SITE_GAP, 400) + 24
  const svgHeight = Math.max(...sites.map((s) => s.h), 240) + 24

  // Initialise the view to the content bounds on first render.
  useEffect(() => {
    if (view === null) {
      setView({ x: 0, y: 0, w: svgWidth, h: svgHeight })
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
    setView({ x: 0, y: 0, w: svgWidth, h: svgHeight })
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
    // Click on an empty backdrop starts a pan + deselects. Walk up
    // the SVG tree so a click on the text/icon inside a node group
    // (the parent g carries data-role="node") doesn't get mistaken
    // for a backdrop click.
    let el: Element | null = e.target as Element
    while (el && el !== e.currentTarget) {
      const role = (el as HTMLElement).dataset?.role
      if (role === 'node' || role === 'edge') return
      el = el.parentElement
    }
    setSelectedNode(null)
    setSelectedEdge(null)
    setDragging({ startX: e.clientX, startY: e.clientY, viewX: view.x, viewY: view.y })
  }

  useEffect(() => {
    if (!dragging) return
    function onMove(e: MouseEvent) {
      setView((prev) => {
        if (!prev || !dragging) return prev
        const svg = svgRef.current
        if (!svg) return prev
        const rect = svg.getBoundingClientRect()
        const dx = ((e.clientX - dragging.startX) / rect.width) * prev.w
        const dy = ((e.clientY - dragging.startY) / rect.height) * prev.h
        return { ...prev, x: dragging.viewX - dx, y: dragging.viewY - dy }
      })
    }
    function onUp() {
      setDragging(null)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

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

  // Bundle parallel edges between the same pair into a single
  // visible line and remember the count so we can stamp a chip
  // at the midpoint.
  const grouped = new Map<string, { edge: MapEdge; count: number; idx: number }>()
  data.edges.forEach((edge, idx) => {
    const key = [edge.from, edge.to].sort().join('|') + '::' + edge.subtype
    const prev = grouped.get(key)
    if (prev) {
      prev.count += 1
    } else {
      grouped.set(key, { edge, count: 1, idx })
    }
  })
  const visibleEdges = Array.from(grouped.values())

  // Edge routing: smooth quadratic Bezier with a small perpendicular
  // offset so parallel bundles between the same pair draw to both
  // sides.
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
    const dx = bx - ax
    const dy = by - ay
    const len = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
    const sign = parallel % 2 === 0 ? 1 : -1
    const magnitude = 22 + Math.floor(parallel / 2) * 16
    const cx = (ax + bx) / 2 + sign * magnitude * (-dy / len)
    const cy = (ay + by) / 2 + sign * magnitude * (dx / len)
    // Midpoint of the Bezier curve (t = 0.5) for the chip position.
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

  return (
    <div ref={wrapperRef} style={{ position: 'relative', marginTop: 8 }}>
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
          background:
            'radial-gradient(ellipse at 30% 0%, rgba(28,104,199,0.06), transparent 60%), radial-gradient(ellipse at 80% 100%, rgba(83,74,183,0.05), transparent 55%), #ffffff',
          border: '0.5px solid rgba(20,30,60,0.08)',
          borderRadius: 12,
          cursor: dragging ? 'grabbing' : 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <defs>
          {/* Card drop shadow */}
          <filter id="nm-card-shadow" x="-10%" y="-10%" width="120%" height="140%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.5" floodColor="#03234A" floodOpacity="0.10" />
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

        {/* Site containers */}
        {sites.map((s) => (
          <g key={s.site}>
            <rect
              x={s.x}
              y={0}
              width={s.w}
              height={s.h}
              fill="url(#nm-site-bg)"
              stroke="rgba(20,30,60,0.08)"
              strokeWidth={0.5}
              rx={12}
            />
            {/* Coloured top stripe */}
            <rect x={s.x} y={0} width={s.w} height={4} fill={s.accent} rx={2} />
            {/* Site title pill */}
            <rect
              x={s.x + SITE_PAD_X}
              y={14}
              width={Math.max(s.site.length * 6.5 + 28, 90)}
              height={22}
              fill="#03234A"
              rx={11}
            />
            <text
              x={s.x + SITE_PAD_X + 12}
              y={29}
              fill="#ffffff"
              fontWeight={600}
              fontSize={11}
              style={{ letterSpacing: '0.02em' }}
            >
              {s.site}
            </text>
            {/* Node count chip */}
            <rect
              x={s.x + s.w - SITE_PAD_X - 62}
              y={14}
              width={62}
              height={22}
              fill="#ffffff"
              stroke="rgba(20,30,60,0.08)"
              strokeWidth={0.5}
              rx={11}
            />
            <text
              x={s.x + s.w - SITE_PAD_X - 31}
              y={29}
              textAnchor="middle"
              fill="#54534e"
              fontSize={10}
              fontWeight={500}
            >
              {s.nodeCount} {s.nodeCount === 1 ? 'node' : 'nodes'}
            </text>
          </g>
        ))}

        {/* Edges */}
        {visibleEdges.map(({ edge, count }, i) => {
          const a = nodePos[edge.from]
          const b = nodePos[edge.to]
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
          const pos = nodePos[node.id]
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
              onClick={(e) => {
                e.stopPropagation()
                setSelectedNode(node.id)
                setSelectedEdge(null)
              }}
              data-role="node"
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
              />
              {/* Left accent stripe */}
              <rect x={pos.x} y={pos.y} width={3} height={pos.h} fill={accent} rx={1.5} data-role="node" />
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
            ? {
                edge: visibleEdges[selectedEdge].edge,
                count: visibleEdges[selectedEdge].count,
                fromLabel: data.nodes.find((n) => n.id === visibleEdges[selectedEdge].edge.from)?.label ?? '',
                toLabel: data.nodes.find((n) => n.id === visibleEdges[selectedEdge].edge.to)?.label ?? '',
                fromSite: data.nodes.find((n) => n.id === visibleEdges[selectedEdge].edge.from)?.site ?? '',
                toSite: data.nodes.find((n) => n.id === visibleEdges[selectedEdge].edge.to)?.site ?? '',
              }
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
          Scroll to zoom · drag empty space to pan · click a node or edge to inspect
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
  edgeInfo: { edge: MapEdge; count: number; fromLabel: string; toLabel: string; fromSite: string; toSite: string } | null
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
              <PanelRow
                label="Bundles"
                value={`${edgeInfo.count} ${edgeInfo.count === 1 ? 'bundle' : 'parallel bundles'}`}
              />
              {edgeInfo.edge.subtype === 'Intersite_Link' && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '8px 10px',
                    background: '#FCE7E5',
                    color: '#6E1A1A',
                    borderRadius: 6,
                    fontSize: 11,
                    lineHeight: 1.4,
                  }}
                >
                  Cross-DC link — DORA Art. 12 / NIS2 Art. 21 anchor. Failure here splits the two sites.
                </div>
              )}
            </>
          )}
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
      // Stacked rectangle (switch) with three port dots.
      return (
        <svg width={16} height={16} viewBox="0 0 16 16" style={common}>
          <rect x={1.5} y={4.5} width={13} height={7} rx={1.5} fill="none" stroke={color} strokeWidth={1.2} />
          <circle cx={4} cy={8} r={0.9} fill={color} />
          <circle cx={8} cy={8} r={0.9} fill={color} />
          <circle cx={12} cy={8} r={0.9} fill={color} />
          <line x1={3.5} y1={11.5} x2={3.5} y2={13.5} stroke={color} strokeWidth={1} />
          <line x1={12.5} y1={11.5} x2={12.5} y2={13.5} stroke={color} strokeWidth={1} />
        </svg>
      )
    case 'host':
    case 'server':
      // Rack stack
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
      // Shield
      return (
        <svg width={16} height={16} viewBox="0 0 16 16" style={common}>
          <path
            d="M8 1.5 L13.5 3.5 L13.5 8 C13.5 11 11 13.5 8 14.5 C5 13.5 2.5 11 2.5 8 L2.5 3.5 Z"
            fill="none"
            stroke={color}
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
          <line x1={5.5} y1={7.5} x2={10.5} y2={7.5} stroke={color} strokeWidth={1.2} />
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
