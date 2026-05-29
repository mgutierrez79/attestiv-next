'use client'
// Network topology view — cross-source enriched graph rendered as
// inline SVG. No external library. Sites become columns, devices
// arrange within each site grouped by asset type. Edges run between
// nodes from the network_adjacency snapshot (Cisco MAC tables +
// DNAC physical topology). Color/border encode overlays the operator
// picks from the legend.
//
// Trade-off: not a force-directed physics engine, so very large fleets
// (1000+ nodes) won't auto-arrange beautifully. For pilot-sized
// estates (449 assets max) the layered layout is more legible than
// physics anyway — sites stay separated, types stay grouped.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Card,
  CardTitle,
  GhostButton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type TopologyNode = {
  id: string
  label: string
  asset_type: string
  criticality?: string
  site_id?: string
  site_name?: string
  app_id?: string
  app_tier?: string
  health?: string
  backup_state?: string
  compliance?: string
  mfa?: string
  switch_port?: string
  present_in?: string[]
}

type TopologyEdge = {
  id: string
  source: string
  target: string
  kind: string
  status?: string
  source_interface?: string
  target_interface?: string
  vlan?: string
}

type TopologyResponse = {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
}

type Overlay = 'criticality' | 'health' | 'backup' | 'compliance' | 'mfa'

export function AttestivNetworkTopology() {
  const { t } = useI18n()
  const router = useRouter()
  const [data, setData] = useState<TopologyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('criticality')
  const [showHostPorts, setShowHostPorts] = useState(false)
  const [showOrphans, setShowOrphans] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/network/topology')
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`)
        }
        const body = (await response.json()) as TopologyResponse
        if (!cancelled) setData(body)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load topology')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Filter edges by toggle (host_port hidden by default; auditor view
  // is backbone first).
  const visibleEdges = useMemo(() => {
    if (!data) return []
    if (showHostPorts) return data.edges
    return data.edges.filter((e) => e.kind !== 'host_port')
  }, [data, showHostPorts])

  // The set of node IDs actually wired up.
  const referenced = useMemo(() => {
    const set = new Set<string>()
    for (const e of visibleEdges) {
      set.add(e.source)
      set.add(e.target)
    }
    return set
  }, [visibleEdges])

  const visibleNodes = useMemo(() => {
    if (!data) return []
    if (showOrphans) return data.nodes
    return data.nodes.filter((n) => referenced.has(n.id))
  }, [data, referenced, showOrphans])

  const layout = useMemo(() => layoutNodes(visibleNodes), [visibleNodes])

  const selected = useMemo(
    () => (selectedId ? visibleNodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, visibleNodes],
  )

  return (
    <>
      <Topbar
        title={t('Network topology', 'Network topology')}
        left={
          data ? (
            <Badge tone="navy">
              {t('{nodes} nodes · {edges} edges', '{nodes} nodes · {edges} edges', {
                nodes: visibleNodes.length,
                edges: visibleEdges.length,
              })}
            </Badge>
          ) : null
        }
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={showHostPorts}
                onChange={(e) => setShowHostPorts(e.target.checked)}
              />
              {t('Show host ports', 'Show host ports')}
            </label>
            <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={showOrphans}
                onChange={(e) => setShowOrphans(e.target.checked)}
              />
              {t('Show orphans', 'Show orphans')}
            </label>
            <select
              value={overlay}
              onChange={(e) => setOverlay(e.target.value as Overlay)}
              style={{
                fontSize: 11,
                padding: '4px 6px',
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-background-primary)',
                fontFamily: 'inherit',
              }}
            >
              <option value="criticality">{t('Color by: Criticality', 'Color by: Criticality')}</option>
              <option value="health">{t('Color by: Health', 'Color by: Health')}</option>
              <option value="backup">{t('Color by: Backup state', 'Color by: Backup state')}</option>
              <option value="compliance">{t('Color by: Intune compliance', 'Color by: Intune compliance')}</option>
              <option value="mfa">{t('Color by: MFA registered', 'Color by: MFA registered')}</option>
            </select>
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-status-red-bg)',
              color: 'var(--color-status-red-deep)',
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 280px' : '1fr', gap: 12 }}>
          <Card>
            <CardTitle>{t('Topology', 'Topology')}</CardTitle>
            {loading ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '40px 0', textAlign: 'center' }}>
                {t('Loading…', 'Loading…')}
              </div>
            ) : visibleNodes.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '40px 0', textAlign: 'center' }}>
                {t(
                  'No network adjacency data yet. Configure a Cisco connector (RESTCONF / NETCONF / DNA Center) and refresh.',
                  'No network adjacency data yet. Configure a Cisco connector (RESTCONF / NETCONF / DNA Center) and refresh.',
                )}
              </div>
            ) : (
              <TopologySVG
                layout={layout}
                edges={visibleEdges}
                overlay={overlay}
                selectedId={selectedId}
                onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
              />
            )}
            <Legend overlay={overlay} t={t} />
          </Card>
          {selected ? (
            <NodeDetailPanel node={selected} onClose={() => setSelectedId(null)} onOpen={() => router.push(`/inventory/${encodeURIComponent(selected.id)}`)} t={t} />
          ) : null}
        </div>
      </div>
    </>
  )
}

// layoutNodes places nodes in site-grouped columns with type-grouped
// rows inside each column. Site "" (no site) becomes the last column.
function layoutNodes(nodes: TopologyNode[]) {
  const COL_W = 240
  const ROW_H = 60
  const PAD = 30
  const sitesMap = new Map<string, TopologyNode[]>()
  for (const node of nodes) {
    const key = node.site_id || ''
    if (!sitesMap.has(key)) sitesMap.set(key, [])
    sitesMap.get(key)!.push(node)
  }
  const sites = Array.from(sitesMap.entries()).sort((a, b) => {
    if (a[0] === '') return 1
    if (b[0] === '') return -1
    return a[0].localeCompare(b[0])
  })
  const typeOrder = ['firewall', 'firewall_manager', 'network_device', 'host', 'cluster', 'server', 'vm', 'storage_array', 'storage_volume', 'backup_appliance', 'computer', 'unknown']
  const positions = new Map<string, { x: number; y: number; site: string; siteName: string }>()
  let xOffset = PAD
  let maxY = PAD
  for (const [siteID, members] of sites) {
    members.sort((a, b) => {
      const ai = typeOrder.indexOf(a.asset_type || 'unknown')
      const bi = typeOrder.indexOf(b.asset_type || 'unknown')
      return (ai === -1 ? typeOrder.length : ai) - (bi === -1 ? typeOrder.length : bi)
    })
    let y = PAD + 30
    const siteName = members[0]?.site_name || siteID || ''
    for (const node of members) {
      positions.set(node.id, { x: xOffset + COL_W / 2, y, site: siteID, siteName })
      y += ROW_H
    }
    if (y > maxY) maxY = y
    xOffset += COL_W
  }
  return { positions, width: Math.max(xOffset + PAD, 600), height: Math.max(maxY + PAD, 400), sites }
}

function TopologySVG({
  layout,
  edges,
  overlay,
  selectedId,
  onSelect,
}: {
  layout: ReturnType<typeof layoutNodes>
  edges: TopologyEdge[]
  overlay: Overlay
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const { positions, width, height, sites } = layout
  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 600 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Site columns as background bands so the operator sees the
            site grouping at a glance. */}
        {sites.map(([siteID, members], i) => {
          const x = 30 + i * 240
          return (
            <g key={siteID || `nosite-${i}`}>
              <rect
                x={x}
                y={20}
                width={220}
                height={height - 40}
                fill={i % 2 === 0 ? 'var(--color-background-secondary)' : 'transparent'}
                opacity={0.4}
                rx={6}
              />
              <text x={x + 110} y={36} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-text-secondary)">
                {members[0]?.site_name || siteID || '(no site)'}
              </text>
            </g>
          )
        })}
        {/* Edges first so nodes sit on top. */}
        {edges.map((edge) => {
          const a = positions.get(edge.source)
          const b = positions.get(edge.target)
          if (!a || !b) return null
          const stroke = edge.kind === 'host_port' ? 'var(--color-border-tertiary)' : 'var(--color-status-blue-mid)'
          const strokeWidth = edge.kind === 'host_port' ? 1 : 2
          return (
            <line
              key={edge.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={stroke}
              strokeWidth={strokeWidth}
              opacity={0.7}
            />
          )
        })}
        {/* Nodes. */}
        {Array.from(positions.entries()).map(([id, pos]) => {
          const node = layout.sites.flatMap(([, members]) => members).find((n) => n.id === id)
          if (!node) return null
          const fill = nodeFillFor(node, overlay)
          const stroke = selectedId === id ? 'var(--color-status-blue-deep)' : 'var(--color-border-secondary)'
          return (
            <g
              key={id}
              transform={`translate(${pos.x},${pos.y})`}
              onClick={() => onSelect(id)}
              style={{ cursor: 'pointer' }}
            >
              <circle r={12} fill={fill} stroke={stroke} strokeWidth={selectedId === id ? 3 : 1} />
              <text x={20} y={4} fontSize={10} fill="var(--color-text-primary)">
                {node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function nodeFillFor(node: TopologyNode, overlay: Overlay): string {
  if (overlay === 'criticality') {
    switch (node.criticality || node.app_tier) {
      case 'critical':
      case 'tier_1':
        return 'var(--color-status-red-mid)'
      case 'high':
      case 'tier_2':
        return 'var(--color-status-amber-mid)'
      case 'medium':
      case 'tier_3':
        return 'var(--color-status-blue-mid)'
      case 'low':
        return 'var(--color-status-green-mid)'
    }
    return 'var(--color-background-tertiary)'
  }
  if (overlay === 'health') {
    switch ((node.health || '').toLowerCase()) {
      case 'ok':
      case 'healthy':
        return 'var(--color-status-green-mid)'
      case 'warning':
        return 'var(--color-status-amber-mid)'
      case 'critical':
      case 'failed':
        return 'var(--color-status-red-mid)'
    }
    return 'var(--color-background-tertiary)'
  }
  if (overlay === 'backup') {
    return node.backup_state === 'ok' ? 'var(--color-status-green-mid)' : 'var(--color-background-tertiary)'
  }
  if (overlay === 'compliance') {
    switch ((node.compliance || '').toLowerCase()) {
      case 'compliant':
        return 'var(--color-status-green-mid)'
      case 'noncompliant':
      case 'non_compliant':
      case 'error':
      case 'conflict':
        return 'var(--color-status-red-mid)'
    }
    return 'var(--color-background-tertiary)'
  }
  if (overlay === 'mfa') {
    return node.mfa === 'true' ? 'var(--color-status-green-mid)' : 'var(--color-status-amber-mid)'
  }
  return 'var(--color-background-tertiary)'
}

function Legend({ overlay, t }: { overlay: Overlay; t: (key: string, fallback?: string) => string }) {
  const entries: Array<{ color: string; label: string }> = []
  switch (overlay) {
    case 'criticality':
      entries.push(
        { color: 'var(--color-status-red-mid)', label: 'critical / tier_1' },
        { color: 'var(--color-status-amber-mid)', label: 'high / tier_2' },
        { color: 'var(--color-status-blue-mid)', label: 'medium / tier_3' },
        { color: 'var(--color-status-green-mid)', label: 'low' },
        { color: 'var(--color-background-tertiary)', label: 'unspecified' },
      )
      break
    case 'health':
      entries.push(
        { color: 'var(--color-status-green-mid)', label: t('healthy', 'healthy') },
        { color: 'var(--color-status-amber-mid)', label: t('warning', 'warning') },
        { color: 'var(--color-status-red-mid)', label: t('critical / failed', 'critical / failed') },
        { color: 'var(--color-background-tertiary)', label: t('unknown', 'unknown') },
      )
      break
    case 'backup':
      entries.push(
        { color: 'var(--color-status-green-mid)', label: t('observed by Veeam', 'observed by Veeam') },
        { color: 'var(--color-background-tertiary)', label: t('no backup source', 'no backup source') },
      )
      break
    case 'compliance':
      entries.push(
        { color: 'var(--color-status-green-mid)', label: t('compliant', 'compliant') },
        { color: 'var(--color-status-red-mid)', label: t('non-compliant / error', 'non-compliant / error') },
        { color: 'var(--color-background-tertiary)', label: t('not MDM-managed', 'not MDM-managed') },
      )
      break
    case 'mfa':
      entries.push(
        { color: 'var(--color-status-green-mid)', label: t('MFA registered', 'MFA registered') },
        { color: 'var(--color-status-amber-mid)', label: t('no MFA', 'no MFA') },
      )
      break
  }
  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', padding: '8px 0', fontSize: 11, color: 'var(--color-text-secondary)' }}>
      {entries.map((entry) => (
        <span key={entry.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              background: entry.color,
              border: '0.5px solid var(--color-border-secondary)',
              display: 'inline-block',
            }}
          />
          {entry.label}
        </span>
      ))}
    </div>
  )
}

function NodeDetailPanel({
  node,
  onClose,
  onOpen,
  t,
}: {
  node: TopologyNode
  onClose: () => void
  onOpen: () => void
  t: (key: string, fallback?: string) => string
}) {
  return (
    <Card>
      <CardTitle right={<GhostButton onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></GhostButton>}>
        {node.label}
      </CardTitle>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
        {node.id}
      </div>
      <Row label={t('Asset type', 'Asset type')} value={node.asset_type || '—'} />
      <Row label={t('Criticality', 'Criticality')} value={node.criticality || node.app_tier || '—'} />
      <Row label={t('Site', 'Site')} value={node.site_name || node.site_id || '—'} />
      <Row label={t('Application', 'Application')} value={node.app_id || '—'} />
      <Row label={t('Health', 'Health')} value={node.health || '—'} />
      <Row label={t('Backup', 'Backup')} value={node.backup_state || '—'} />
      <Row label={t('Compliance', 'Compliance')} value={node.compliance || '—'} />
      <Row label={t('Switch port', 'Switch port')} value={node.switch_port || '—'} />
      <Row label={t('Seen by', 'Seen by')} value={(node.present_in || []).join(', ') || '—'} />
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <GhostButton onClick={onOpen}>
          <i className="ti ti-external-link" aria-hidden="true" /> {t('Open in inventory', 'Open in inventory')}
        </GhostButton>
      </div>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}>{value}</span>
    </div>
  )
}
