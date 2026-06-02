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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'Intersite_Link' | 'Port_Channel' | 'Host_Trunk' | 'Switch_Link'>('all')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // Use the inventory list endpoint with a large page size and
        // filter client-side. The pilot has ~50 link parents so
        // pagination isn't worth the complexity here.
        const resp = await apiFetch('/inventory/assets?asset_type=network_link&limit=1000')
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
        const body = await resp.json()
        if (cancelled) return
        const items = Array.isArray(body?.items) ? (body.items as LinkAsset[]) : []
        // Only PARENT bundles (asset_type=network_link); children
        // (network_link_member) drill in via their parent.
        const parents = items.filter((a) => a.asset_type === 'network_link')
        setLinks(parents)
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

  const mapData = useMemo(() => buildMapData(links), [links])

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

type MapNode = { id: string; label: string; site: string }
type MapEdge = { from: string; to: string; subtype: string }

function buildMapData(links: LinkAsset[]): { nodes: MapNode[]; edges: MapEdge[]; siteOrder: string[] } {
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
    const aSite = String(a['site'] ?? '').trim() || 'unassigned'
    const bSite = String(b['site'] ?? '').trim() || 'unassigned'
    if (!aID || !bID) continue
    sites.add(aSite)
    sites.add(bSite)
    if (!nodes.has(aID)) nodes.set(aID, { id: aID, label: aLabel, site: aSite })
    if (!nodes.has(bID)) nodes.set(bID, { id: bID, label: bLabel, site: bSite })
    edges.push({ from: aID, to: bID, subtype: label })
  }
  return { nodes: Array.from(nodes.values()), edges, siteOrder: Array.from(sites).sort() }
}

function NetworkMap({ data }: { data: { nodes: MapNode[]; edges: MapEdge[]; siteOrder: string[] } }) {
  // Layout: lay sites out horizontally as columns. Within each site
  // stack nodes vertically. SVG coordinates are computed from those
  // ranks; an edge runs from one node's right side to the other's
  // left side (or vice versa) with a single straight line. Static
  // layout is enough for the pilot's link counts (~10 nodes).
  const SITE_WIDTH = 220
  const SITE_GAP = 40
  const NODE_HEIGHT = 26
  const NODE_GAP = 12
  const SITE_PADDING_Y = 36
  const sitesWithNodes = data.siteOrder.map((site) => ({
    site,
    nodes: data.nodes.filter((n) => n.site === site),
  }))
  // Compute node positions.
  const nodePos: Record<string, { x: number; y: number; width: number }> = {}
  let svgWidth = 0
  let svgHeight = 0
  sitesWithNodes.forEach((bucket, siteIdx) => {
    const x = siteIdx * (SITE_WIDTH + SITE_GAP)
    svgWidth = x + SITE_WIDTH
    bucket.nodes.forEach((node, nodeIdx) => {
      const y = SITE_PADDING_Y + nodeIdx * (NODE_HEIGHT + NODE_GAP)
      nodePos[node.id] = { x, y, width: SITE_WIDTH }
      svgHeight = Math.max(svgHeight, y + NODE_HEIGHT + NODE_GAP)
    })
  })
  svgHeight = Math.max(svgHeight, 200)
  svgWidth = Math.max(svgWidth, 400)
  const edgeColor = (subtype: string) => {
    switch (subtype) {
      case 'Intersite_Link':
        return 'var(--color-text-danger, #c44)'
      case 'Port_Channel':
        return 'var(--color-text-secondary, #444)'
      case 'Switch_Link':
        return 'var(--color-text-tertiary, #888)'
      default:
        return '#999'
    }
  }
  return (
    <div style={{ overflow: 'auto', maxWidth: '100%', marginTop: 8 }}>
      <svg
        width={svgWidth + 20}
        height={svgHeight + 20}
        style={{ minWidth: svgWidth + 20, fontSize: 11, fontFamily: 'sans-serif' }}
      >
        {/* Site backgrounds + labels */}
        {sitesWithNodes.map(({ site, nodes }, idx) => {
          const x = idx * (SITE_WIDTH + SITE_GAP)
          const height = SITE_PADDING_Y + Math.max(nodes.length, 1) * (NODE_HEIGHT + NODE_GAP)
          return (
            <g key={site}>
              <rect x={x} y={0} width={SITE_WIDTH} height={height} fill="var(--color-surface-secondary, #f5f5f5)" rx={6} />
              <text x={x + 8} y={20} fill="var(--color-text-secondary, #444)" fontWeight={600} fontSize={11}>
                {site} ({nodes.length})
              </text>
            </g>
          )
        })}
        {/* Edges */}
        {data.edges.map((edge, i) => {
          const a = nodePos[edge.from]
          const b = nodePos[edge.to]
          if (!a || !b) return null
          const aCenterX = a.x + a.width / 2
          const aCenterY = a.y + NODE_HEIGHT / 2
          const bCenterX = b.x + b.width / 2
          const bCenterY = b.y + NODE_HEIGHT / 2
          return (
            <line
              key={i}
              x1={aCenterX}
              y1={aCenterY}
              x2={bCenterX}
              y2={bCenterY}
              stroke={edgeColor(edge.subtype)}
              strokeWidth={edge.subtype === 'Intersite_Link' ? 2.5 : 1.5}
              strokeDasharray={edge.subtype === 'Switch_Link' ? '4 3' : undefined}
              opacity={0.7}
            />
          )
        })}
        {/* Nodes (drawn last so they sit ON TOP of edges) */}
        {data.nodes.map((node) => {
          const pos = nodePos[node.id]
          if (!pos) return null
          return (
            <g key={node.id}>
              <rect
                x={pos.x + 8}
                y={pos.y}
                width={SITE_WIDTH - 16}
                height={NODE_HEIGHT}
                fill="var(--color-surface-primary, #fff)"
                stroke="var(--color-border-secondary, #ccc)"
                strokeWidth={0.5}
                rx={4}
              />
              <text x={pos.x + 14} y={pos.y + 17} fill="var(--color-text-primary, #111)" fontSize={11}>
                {node.label.length > 26 ? node.label.slice(0, 24) + '…' : node.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 2,
              background: 'var(--color-text-danger, #c44)',
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          Intersite_Link
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 2,
              background: 'var(--color-text-secondary, #444)',
              marginRight: 4,
              verticalAlign: 'middle',
            }}
          />
          Port_Channel
        </span>
        <span>
          <span
            style={{
              display: 'inline-block',
              width: 14,
              height: 2,
              background: 'var(--color-text-tertiary, #888)',
              marginRight: 4,
              borderTop: '1px dashed var(--color-text-tertiary, #888)',
              verticalAlign: 'middle',
            }}
          />
          Switch_Link
        </span>
      </div>
    </div>
  )
}
