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

import { useEffect, useMemo, useState } from 'react'

import { Badge, Banner, Card, CardTitle, EmptyState, Skeleton, Topbar } from '../components/AttestivUi'
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
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
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
                  {filtered.map((link) => {
                    const label = String(link.metadata?.['link_type_label'] ?? '').trim() || link.asset_type || '—'
                    const memberCount = Number(link.metadata?.['member_count'] ?? 0)
                    const verified = Boolean(link.metadata?.['verified'])
                    const sites = Array.isArray(link.metadata?.['sites'])
                      ? (link.metadata!['sites'] as string[]).join(' ↔ ')
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
        </Card>
      </div>
    </>
  )
}

// ----- Map data + rendering ----------------------------------------

type MapNode = { id: string; label: string; site: string; assetType: string }
type MapEdge = { from: string; to: string; subtype: string }

// resolveSite picks the best site label for an endpoint:
//   1. endpoint.site in the link's metadata (when promoter knew it)
//   2. inventory store's asset.datacenter_id (when the asset is in
//      inventory but the link metadata was empty — happens for links
//      created BEFORE inferAndPersistSwitchSites filled the gap)
//   3. fallback to the link's own datacenter_id (intra-site bundles)
//   4. "unassigned" — honest signal that nothing knows where this is.
function resolveSite(endpoint: Record<string, unknown>, linkSite: string, siteByAssetID: Record<string, string>): string {
  const fromMeta = String(endpoint['site'] ?? '').trim()
  if (fromMeta) return fromMeta
  const id = String(endpoint['asset_id'] ?? '').trim()
  if (id && siteByAssetID[id]) return siteByAssetID[id]
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
    const aSite = resolveSite(a, linkSite, siteByAssetID)
    const bSite = resolveSite(b, linkSite, siteByAssetID)
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

function NetworkMap({ data }: { data: { nodes: MapNode[]; edges: MapEdge[]; siteOrder: string[] } }) {
  // Layout: sites are horizontal columns separated by gaps. Within
  // each site, nodes flow in a 2-column grid so a site with 6
  // switches doesn't end up 6 deep. Inter-site edges arc through
  // the gap; intra-site edges curve gently to avoid overlap.
  const SITE_PAD_X = 14
  const SITE_PAD_TOP = 36
  const SITE_GAP = 56
  const NODE_W = 168
  const NODE_H = 30
  const NODE_GAP_X = 14
  const NODE_GAP_Y = 14
  const NODES_PER_ROW = 2

  const sitesWithNodes = data.siteOrder.map((site) => ({
    site,
    nodes: data.nodes.filter((n) => n.site === site),
  }))

  // First pass: compute each site box's width + the node positions
  // inside it.
  const nodePos: Record<string, { x: number; y: number; w: number; h: number }> = {}
  const sites: Array<{ site: string; nodeCount: number; x: number; w: number; h: number }> = []
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
    sites.push({ site, nodeCount: nodes.length, x: cursor, w, h })
    cursor += w + SITE_GAP
  }
  const svgWidth = Math.max(cursor - SITE_GAP, 400) + 20
  const svgHeight = Math.max(
    ...sites.map((s) => s.h),
    220,
  ) + 20

  const edgeStyle = (subtype: string): { stroke: string; width: number; dash?: string } => {
    switch (subtype) {
      case 'Intersite_Link':
        return { stroke: 'var(--color-text-danger, #c44)', width: 2.5 }
      case 'Port_Channel':
        return { stroke: 'var(--color-text-secondary, #444)', width: 1.5 }
      case 'Switch_Link':
        return { stroke: 'var(--color-text-tertiary, #888)', width: 1.5, dash: '4 3' }
      default:
        return { stroke: '#999', width: 1.5 }
    }
  }

  // Edge path: a quadratic Bezier whose control point sits between
  // the two endpoints, offset perpendicularly by a small amount so
  // parallel edges between the same pair don't stack directly on
  // top of each other.
  const edgeIndex: Record<string, number> = {}
  const edgePath = (edge: MapEdge, a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, i: number) => {
    const key = [edge.from, edge.to].sort().join('|')
    const parallel = edgeIndex[key] ?? 0
    edgeIndex[key] = parallel + 1
    const ax = a.x + a.w / 2
    const ay = a.y + a.h / 2
    const bx = b.x + b.w / 2
    const by = b.y + b.h / 2
    const mx = (ax + bx) / 2
    const my = (ay + by) / 2
    // Perpendicular offset (toggles sign per parallel edge so 2-cable
    // bundles draw to both sides).
    const dx = bx - ax
    const dy = by - ay
    const len = Math.max(Math.sqrt(dx * dx + dy * dy), 1)
    const sign = parallel % 2 === 0 ? 1 : -1
    const magnitude = 18 + Math.floor(parallel / 2) * 14
    const cx = mx + sign * magnitude * (-dy / len)
    const cy = my + sign * magnitude * (dx / len)
    return `M ${ax} ${ay} Q ${cx} ${cy} ${bx} ${by}`
  }

  return (
    <div style={{ overflow: 'auto', maxWidth: '100%', marginTop: 8 }}>
      <svg
        width={svgWidth}
        height={svgHeight}
        style={{ minWidth: svgWidth, fontSize: 11, fontFamily: 'sans-serif' }}
      >
        {/* Site backgrounds */}
        {sites.map((s) => (
          <g key={s.site}>
            <rect
              x={s.x}
              y={0}
              width={s.w}
              height={s.h}
              fill="var(--color-surface-secondary, #f5f5f5)"
              stroke="var(--color-border-tertiary, #e0e0e0)"
              strokeWidth={0.5}
              rx={8}
            />
            <text x={s.x + SITE_PAD_X} y={22} fill="var(--color-text-secondary, #444)" fontWeight={600} fontSize={12}>
              {s.site}
            </text>
            <text x={s.x + s.w - SITE_PAD_X} y={22} textAnchor="end" fill="var(--color-text-tertiary, #888)" fontSize={11}>
              {s.nodeCount} {s.nodeCount === 1 ? 'node' : 'nodes'}
            </text>
          </g>
        ))}
        {/* Edges */}
        {data.edges.map((edge, i) => {
          const a = nodePos[edge.from]
          const b = nodePos[edge.to]
          if (!a || !b) return null
          const style = edgeStyle(edge.subtype)
          return (
            <path
              key={i}
              d={edgePath(edge, a, b, i)}
              fill="none"
              stroke={style.stroke}
              strokeWidth={style.width}
              strokeDasharray={style.dash}
              opacity={0.7}
            />
          )
        })}
        {/* Nodes (drawn last so they sit ON TOP of edges) */}
        {data.nodes.map((node) => {
          const pos = nodePos[node.id]
          if (!pos) return null
          const icon = nodeIcon(node.assetType)
          return (
            <g key={node.id}>
              <rect
                x={pos.x}
                y={pos.y}
                width={pos.w}
                height={pos.h}
                fill="var(--color-surface-primary, #fff)"
                stroke="var(--color-border-secondary, #ccc)"
                strokeWidth={0.5}
                rx={5}
              />
              <text x={pos.x + 8} y={pos.y + 19} fontSize={13}>
                {icon}
              </text>
              <text
                x={pos.x + 28}
                y={pos.y + 19}
                fill="var(--color-text-primary, #111)"
                fontSize={11}
              >
                {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)', flexWrap: 'wrap' }}>
        <LegendItem color="var(--color-text-danger, #c44)" label="Intersite_Link" />
        <LegendItem color="var(--color-text-secondary, #444)" label="Port_Channel" />
        <LegendItem color="var(--color-text-tertiary, #888)" label="Switch_Link" dashed />
      </div>
    </div>
  )
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width={20} height={4}>
        <line x1={0} y1={2} x2={20} y2={2} stroke={color} strokeWidth={2} strokeDasharray={dashed ? '4 3' : undefined} />
      </svg>
      {label}
    </span>
  )
}

function nodeIcon(assetType: string): string {
  const t = assetType.toLowerCase()
  if (t === 'network_device' || t === 'switch' || t === 'router') return '🔀'
  if (t === 'host' || t === 'esxi_host' || t === 'hypervisor') return '🖥'
  if (t === 'server') return '⚙'
  if (t === 'firewall' || t === 'firewall_manager') return '🛡'
  if (t === 'storage_array' || t === 'storage_appliance' || t === 'storage_volume') return '💾'
  return '◆'
}
