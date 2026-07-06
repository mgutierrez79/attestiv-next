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
import { useRouter, useSearchParams } from 'next/navigation'

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
  const searchParams = useSearchParams()
  // Deep-link from the embedded card on the app detail page lands
  // here with ?app=<application_id>. Reading it as the initial
  // appFilter value preserves the prefilter on the standalone page.
  const initialApp = searchParams?.get('app') ?? ''
  const initialAppFilter = initialApp ? `app:${initialApp}` : ''
  const [data, setData] = useState<TopologyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<Overlay>('criticality')
  const [showHostPorts, setShowHostPorts] = useState(false)
  const [showOrphans, setShowOrphans] = useState(false)
  // Edge-kind toggles. Backbone (device_link) + host_port come from
  // network_adjacency; hypervisor_host / storage_attachment /
  // backup_coverage / app_membership are cross-source joins computed
  // server-side. Defaults match the "auditor first look" — backbone
  // + hypervisor + storage on; backup + app off (denser graphs).
  const [showHypervisor, setShowHypervisor] = useState(true)
  const [showStorage, setShowStorage] = useState(true)
  const [showBackup, setShowBackup] = useState(false)
  const [showAppMembership, setShowAppMembership] = useState(false)
  const [showNetworkPort, setShowNetworkPort] = useState(true)
  // Focus controls — narrow the graph to one application's blast
  // radius OR to N hops around a single asset. Defaults: no focus,
  // entire graph visible.
  const [appFilter, setAppFilter] = useState<string>(initialAppFilter)
  const [focusAssetId, setFocusAssetId] = useState<string | null>(null)
  const [hopRadius] = useState<number>(2)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Hover mirrors selection's emphasis but transiently — moving the pointer
  // over a node previews its relationships without committing a selection.
  const [hoveredId, setHoveredId] = useState<string | null>(null)

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

  // List of available apps for the filter dropdown — pulled from the
  // synthetic app nodes the backend emits when app_membership edges
  // exist.
  const availableApps = useMemo(() => {
    if (!data) return []
    const seen = new Map<string, string>() // id → label
    for (const node of data.nodes) {
      if (node.id.startsWith('app:')) {
        seen.set(node.id, node.label)
      }
    }
    return Array.from(seen.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [data])

  // The kept-node ID set based on the focus controls. Empty filter
  // = all nodes visible. App filter = app + its 1-hop component VMs
  // + 2-hop joins (host, storage, backup). Asset focus = N hops
  // around the chosen asset.
  const focusedIDs = useMemo(() => {
    if (!data) return null
    if (!appFilter && !focusAssetId) return null
    const keep = new Set<string>()
    const adjacency = new Map<string, string[]>()
    for (const e of data.edges) {
      if (!adjacency.has(e.source)) adjacency.set(e.source, [])
      adjacency.get(e.source)!.push(e.target)
      if (!adjacency.has(e.target)) adjacency.set(e.target, [])
      adjacency.get(e.target)!.push(e.source)
    }
    const seed = appFilter ? [appFilter] : focusAssetId ? [focusAssetId] : []
    const queue: Array<{ id: string; depth: number }> = seed.map((id) => ({ id, depth: 0 }))
    while (queue.length > 0) {
      const { id, depth } = queue.shift()!
      if (keep.has(id)) continue
      keep.add(id)
      if (depth >= hopRadius) continue
      const neighbors = adjacency.get(id) || []
      for (const n of neighbors) queue.push({ id: n, depth: depth + 1 })
    }
    return keep
  }, [data, appFilter, focusAssetId, hopRadius])

  // Filter edges by toggle (host_port hidden by default; auditor view
  // is backbone first).
  const visibleEdges = useMemo(() => {
    if (!data) return []
    return data.edges.filter((e) => {
      // Focus filter first — drop edges where neither endpoint is
      // in the kept set.
      if (focusedIDs && !focusedIDs.has(e.source) && !focusedIDs.has(e.target)) return false
      switch (e.kind) {
        case 'host_port':
          return showHostPorts
        case 'hypervisor_host':
          return showHypervisor
        case 'storage_attachment':
          return showStorage
        case 'backup_coverage':
          return showBackup
        case 'app_membership':
          return showAppMembership
        case 'network_port':
          return showNetworkPort
        default:
          return true
      }
    })
  }, [data, focusedIDs, showHostPorts, showHypervisor, showStorage, showBackup, showAppMembership, showNetworkPort])

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
    return data.nodes.filter((n) => {
      if (focusedIDs && !focusedIDs.has(n.id)) return false
      if (!showOrphans && !referenced.has(n.id)) return false
      return true
    })
  }, [data, referenced, showOrphans, focusedIDs])

  // Per-node degree (count of edges in/out) — used for the
  // aggregation badge so big-fan-out nodes (a host with 50 VMs, a
  // storage array with 200 volumes) read as hubs at a glance.
  const degreeByNode = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of visibleEdges) {
      counts.set(e.source, (counts.get(e.source) ?? 0) + 1)
      counts.set(e.target, (counts.get(e.target) ?? 0) + 1)
    }
    return counts
  }, [visibleEdges])

  const layout = useMemo(() => layoutNodes(visibleNodes), [visibleNodes])

  const selected = useMemo(
    () => (selectedId ? visibleNodes.find((n) => n.id === selectedId) ?? null : null),
    [selectedId, visibleNodes],
  )

  // Label lookup spanning visible + synthetic nodes, so a neighbour row can
  // show a friendly name (not the raw id) even for app/usernet endpoints.
  const nodeLabelById = useMemo(() => {
    const m = new Map<string, string>()
    if (data) for (const n of data.nodes) m.set(n.id, n.label)
    return m
  }, [data])

  // The selected node's direct connections, deduped by (neighbour, kind) and
  // carrying the interface where the edge has one. Drives the panel's
  // "Connections" navigator — the relation between this node and its peers.
  const selectedConnections = useMemo(() => {
    if (!selectedId) return []
    const seen = new Set<string>()
    const out: Array<{ kind: string; id: string; label: string; iface?: string }> = []
    for (const e of visibleEdges) {
      const other = e.source === selectedId ? e.target : e.target === selectedId ? e.source : null
      if (!other) continue
      const key = `${e.kind}|${other}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ kind: e.kind, id: other, label: nodeLabelById.get(other) ?? other, iface: e.source_interface || e.target_interface })
    }
    return out
  }, [selectedId, visibleEdges, nodeLabelById])

  // Fetch the clicked node's FULL inventory detail so the panel shows
  // rich, node-specific facts (vendor / model / serial / OS / mgmt IP /
  // switch connectivity) rather than only the thin graph summary. Skip
  // synthetic nodes (app:, usernet:, mac:, veeam-…) which aren't assets.
  const [nodeDetail, setNodeDetail] = useState<Record<string, unknown> | null>(null)
  const [nodeDetailLoading, setNodeDetailLoading] = useState(false)
  useEffect(() => {
    const synthetic = ['app:', 'usernet:', 'mac:', 'veeam']
    if (!selectedId || synthetic.some((p) => selectedId.toLowerCase().startsWith(p))) {
      setNodeDetail(null)
      return
    }
    let cancelled = false
    setNodeDetail(null)
    setNodeDetailLoading(true)
    apiFetch(`/inventory/assets/${encodeURIComponent(selectedId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!cancelled) setNodeDetail(body as Record<string, unknown> | null)
      })
      .catch(() => {
        if (!cancelled) setNodeDetail(null)
      })
      .finally(() => {
        if (!cancelled) setNodeDetailLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11, flexWrap: 'wrap' }}>
            <select
              value={appFilter}
              onChange={(e) => {
                setAppFilter(e.target.value)
                setFocusAssetId(null)
              }}
              style={{
                fontSize: 11,
                padding: '4px 6px',
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                background: appFilter ? 'var(--color-status-blue-bg)' : 'var(--color-background-primary)',
                fontFamily: 'inherit',
              }}
            >
              <option value="">{t('All applications', 'All applications')}</option>
              {availableApps.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            {focusAssetId ? (
              <GhostButton onClick={() => setFocusAssetId(null)}>
                <i className="ti ti-x" aria-hidden="true" /> {t('Clear focus', 'Clear focus')}
              </GhostButton>
            ) : null}
            <EdgeToggle checked={showHypervisor} onChange={setShowHypervisor} label={t('VM↔Host', 'VM↔Host')} color="var(--color-status-amber-mid)" />
            <EdgeToggle checked={showStorage} onChange={setShowStorage} label={t('VM↔Storage', 'VM↔Storage')} color="var(--color-status-green-mid)" />
            <EdgeToggle checked={showBackup} onChange={setShowBackup} label={t('Backup', 'Backup')} color="var(--color-status-blue-deep)" />
            <EdgeToggle checked={showAppMembership} onChange={setShowAppMembership} label={t('App↔VM', 'App↔VM')} color="var(--color-status-red-mid)" />
            <EdgeToggle checked={showNetworkPort} onChange={setShowNetworkPort} label={t('Network ports', 'Network ports')} color="var(--color-status-blue-deep)" />
            <EdgeToggle checked={showHostPorts} onChange={setShowHostPorts} label={t('Unresolved MACs', 'Unresolved MACs')} color="var(--color-border-tertiary)" />
            <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 8 }}>
              <input
                type="checkbox"
                checked={showOrphans}
                onChange={(e) => setShowOrphans(e.target.checked)}
              />
              {t('Orphans', 'Orphans')}
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
                hoveredId={hoveredId}
                onSelect={(id) => setSelectedId(id === selectedId ? null : id)}
                onHover={setHoveredId}
                onClear={() => setSelectedId(null)}
                degreeByNode={degreeByNode}
              />
            )}
            <Legend overlay={overlay} t={t} />
          </Card>
          {selected ? (
            <NodeDetailPanel
              node={selected}
              detail={nodeDetail}
              detailLoading={nodeDetailLoading}
              connections={selectedConnections}
              onClose={() => setSelectedId(null)}
              onOpen={() => router.push(`/inventory/${encodeURIComponent(selected.id)}`)}
              onFocus={() => {
                setFocusAssetId(selected.id)
                setAppFilter('')
              }}
              onSelectNeighbor={(id) => setSelectedId(id)}
              onHoverNeighbor={setHoveredId}
              isFocused={focusAssetId === selected.id}
              t={t}
            />
          ) : null}
        </div>
      </div>
    </>
  )
}

// EdgeToggle renders a checkbox + colored swatch so the operator can
// see which edge kind the toggle maps to without consulting the legend.
function EdgeToggle({
  checked,
  onChange,
  label,
  color,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  color: string
}) {
  return (
    <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span style={{ display: 'inline-block', width: 10, height: 2, background: color, borderRadius: 1 }} />
      {label}
    </label>
  )
}

// layoutNodes places each site's nodes in a GRID inside a bounded
// "site container" box. Containers flow left-to-right and wrap to a
// new row when they would overflow the canvas width — so every
// component is visually grouped under its Site, nodes never collapse
// onto a single overlapping column, and edges get room to route. Site
// "" (no site) sorts last.
function layoutNodes(nodes: TopologyNode[]) {
  const CELL_W = 116
  const CELL_H = 84
  const SITE_PAD = 18
  const HEADER_H = 30
  const SITE_GAP = 28
  const CANVAS_MAX_W = 1480
  const typeOrder = ['firewall', 'firewall_manager', 'network_device', 'host', 'cluster', 'server', 'vm', 'storage_array', 'storage_volume', 'backup_appliance', 'computer', 'unknown']

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

  const positions = new Map<string, { x: number; y: number }>()
  const nodeById = new Map<string, TopologyNode>()
  const containers: Array<{ siteID: string; siteName: string; x: number; y: number; w: number; h: number }> = []

  let cursorX = SITE_PAD
  let cursorY = SITE_PAD
  let rowMaxH = 0
  let canvasW = 0

  for (const [siteID, members] of sites) {
    members.sort((a, b) => {
      const ai = typeOrder.indexOf(a.asset_type || 'unknown')
      const bi = typeOrder.indexOf(b.asset_type || 'unknown')
      return (ai === -1 ? typeOrder.length : ai) - (bi === -1 ? typeOrder.length : bi)
    })
    const n = members.length
    // Roughly-square grid, capped so a huge site doesn't sprawl wider
    // than the canvas before wrapping.
    const cols = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(n * 1.3))))
    const rows = Math.ceil(n / cols)
    const boxW = cols * CELL_W + SITE_PAD * 2
    const boxH = HEADER_H + rows * CELL_H + SITE_PAD

    // Wrap to the next container row when this box would overflow.
    if (cursorX > SITE_PAD && cursorX + boxW > CANVAS_MAX_W) {
      cursorX = SITE_PAD
      cursorY += rowMaxH + SITE_GAP
      rowMaxH = 0
    }

    const siteName = members[0]?.site_name || siteID || '(no site)'
    containers.push({ siteID, siteName, x: cursorX, y: cursorY, w: boxW, h: boxH })

    members.forEach((node, i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = cursorX + SITE_PAD + col * CELL_W + CELL_W / 2
      const y = cursorY + HEADER_H + SITE_PAD + row * CELL_H + 22
      positions.set(node.id, { x, y })
      nodeById.set(node.id, node)
    })

    cursorX += boxW + SITE_GAP
    rowMaxH = Math.max(rowMaxH, boxH)
    canvasW = Math.max(canvasW, cursorX)
  }

  return {
    positions,
    nodeById,
    containers,
    width: Math.max(canvasW + SITE_PAD, 600),
    height: Math.max(cursorY + rowMaxH + SITE_PAD, 400),
  }
}

function TopologySVG({
  layout,
  edges,
  overlay,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
  onClear,
  degreeByNode,
}: {
  layout: ReturnType<typeof layoutNodes>
  edges: TopologyEdge[]
  overlay: Overlay
  selectedId: string | null
  hoveredId: string | null
  onSelect: (id: string) => void
  onHover: (id: string | null) => void
  onClear: () => void
  degreeByNode: Map<string, number>
}) {
  const { positions, nodeById, containers, width, height } = layout

  // Index each edge within its endpoint-pair group so parallel edges
  // (two switches with a port-channel + a backup link, say) fan out
  // along the perpendicular instead of stacking on one straight line.
  const pairPos = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const e of edges) {
      const key = [e.source, e.target].sort().join('|')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(e.id)
    }
    const out = new Map<string, { i: number; n: number }>()
    for (const ids of groups.values()) ids.forEach((id, i) => out.set(id, { i, n: ids.length }))
    return out
  }, [edges])

  // Emphasis: hover previews, selection commits. When a node is active we
  // light up it + its direct neighbours + the edges between them, and fade
  // everything else — so the relationships around the focus read at a glance
  // instead of drowning in the full mesh.
  const activeId = hoveredId ?? selectedId
  const { neighbourIds, incidentEdgeIds } = useMemo(() => {
    if (!activeId) return { neighbourIds: null as Set<string> | null, incidentEdgeIds: null as Set<string> | null }
    const nb = new Set<string>([activeId])
    const ie = new Set<string>()
    for (const e of edges) {
      if (e.source === activeId || e.target === activeId) {
        ie.add(e.id)
        nb.add(e.source)
        nb.add(e.target)
      }
    }
    return { neighbourIds: nb, incidentEdgeIds: ie }
  }, [activeId, edges])
  const emphasising = neighbourIds !== null

  return (
    <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 600 }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Background catcher: a click on empty canvas clears the selection. */}
        <rect x={0} y={0} width={width} height={height} fill="transparent" onClick={onClear} />
        <defs>
          {/* Directional arrowhead for app→dependency edges. */}
          <marker
            id="nt-app-dep-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
          </marker>
        </defs>
        {/* Site containers: one bounded, labelled box per site, sized
            to its node grid, so every component reads as belonging to
            its Site. */}
        {containers.map((c) => (
          <g key={c.siteID || `nosite-${c.x}-${c.y}`}>
            <rect
              x={c.x}
              y={c.y}
              width={c.w}
              height={c.h}
              rx={10}
              fill="var(--color-background-secondary)"
              opacity={0.45}
              stroke="var(--color-border-secondary)"
              strokeWidth={1}
            />
            <text
              x={c.x + 12}
              y={c.y + 18}
              fontSize={11}
              fontWeight={700}
              fill="var(--color-text-secondary)"
            >
              {c.siteName}
            </text>
          </g>
        ))}
        {/* Edges, drawn before nodes so the nodes sit on top. Each edge
            is a quadratic curve bowed along the perpendicular — single
            edges arc clear of any node on the straight path, parallel
            edges fan out so they never coincide. Per-kind stroke + dash
            keep a backbone link distinguishable from a hypervisor map. */}
        {edges.map((edge) => {
          const a = positions.get(edge.source)
          const b = positions.get(edge.target)
          if (!a || !b) return null
          // device_link / backbone default. (--color-status-blue-mid is
          // not defined in the current theme — renders invisible — so the
          // backbone uses the defined blue-deep token.)
          let stroke = 'var(--color-status-blue-deep)'
          let strokeWidth = 2
          let dash = '0'
          switch (edge.kind) {
            case 'host_port':
              stroke = 'var(--color-border-tertiary)'
              strokeWidth = 1
              break
            case 'hypervisor_host':
              stroke = 'var(--color-status-amber-mid)'
              strokeWidth = 1.5
              dash = '6 3'
              break
            case 'storage_attachment':
              stroke = 'var(--color-status-green-mid)'
              strokeWidth = 1.5
              dash = '2 3'
              break
            case 'backup_coverage':
              stroke = 'var(--color-status-blue-deep)'
              strokeWidth = 1
              dash = '1 4'
              break
            case 'app_membership':
              stroke = 'var(--color-status-red-mid)'
              strokeWidth = 1
              dash = '4 2'
              break
            case 'app_dependency':
              // App → the app it depends on. Prominent so the
              // application dependency backbone reads above the plumbing.
              // NOTE: blue-deep (not blue-mid) — --color-status-blue-mid is
              // NOT a defined token, so it renders as an invalid colour
              // (black fill / no stroke). blue-deep is the defined blue.
              stroke = 'var(--color-status-blue-deep)'
              strokeWidth = 2.5
              dash = '6 3'
              break
            case 'network_port':
              stroke = 'var(--color-status-blue-deep)'
              strokeWidth = 1.5
              break
          }
          const { i, n } = pairPos.get(edge.id) ?? { i: 0, n: 1 }
          const dx = b.x - a.x
          const dy = b.y - a.y
          const dist = Math.hypot(dx, dy) || 1
          // Perpendicular unit vector — the direction we bow/fan along.
          const px = -dy / dist
          const py = dx / dist
          // Always bow a little so a straight a→b line that would clip
          // an intervening node arcs clear; bow grows with length, capped.
          const bow = Math.min(Math.max(dist * 0.13, 14), 44)
          // Parallel edges fan symmetrically around that bowed center.
          const fan = (i - (n - 1) / 2) * 16
          const cx = (a.x + b.x) / 2 + px * (bow + fan)
          const cy = (a.y + b.y) / 2 + py * (bow + fan)
          const d = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`
          // Point on the quadratic at t=0.5 for the optional label.
          const lx = 0.25 * a.x + 0.5 * cx + 0.25 * b.x
          const ly = 0.25 * a.y + 0.5 * cy + 0.25 * b.y
          const label =
            edge.kind === 'network_port' && (edge.source_interface || edge.vlan)
              ? `${edge.source_interface || ''}${edge.vlan ? ' v' + edge.vlan : ''}`
              : ''
          // Fade edges not touching the active node; strengthen the ones that
          // do so the focus node's links stand out from the mesh.
          const incident = incidentEdgeIds ? incidentEdgeIds.has(edge.id) : false
          const edgeOpacity = emphasising ? (incident ? 0.95 : 0.06) : 0.7
          const edgeWidth = emphasising && incident ? strokeWidth + 0.8 : strokeWidth
          return (
            <g key={edge.id}>
              <path
                d={d}
                fill="none"
                stroke={stroke}
                strokeWidth={edgeWidth}
                strokeDasharray={dash === '0' ? undefined : dash}
                opacity={edgeOpacity}
                markerEnd={edge.kind === 'app_dependency' ? 'url(#nt-app-dep-arrow)' : undefined}
              />
              {label && !(emphasising && !incident) ? (
                <>
                  <rect
                    x={lx - label.length * 2.6 - 2}
                    y={ly - 9}
                    width={label.length * 5.2 + 4}
                    height={11}
                    rx={2}
                    fill="var(--color-background-primary)"
                    opacity={0.85}
                  />
                  <text
                    x={lx}
                    y={ly - 1}
                    textAnchor="middle"
                    fontSize={8}
                    fill="var(--color-status-blue-deep)"
                    fontFamily="var(--font-mono)"
                  >
                    {label}
                  </text>
                </>
              ) : null}
            </g>
          )
        })}
        {/* Nodes on top, with the label centred BELOW the circle (on a
            translucent halo) so it never bleeds into the neighbouring
            grid cell or gets lost under a crossing edge. */}
        {Array.from(positions.entries()).map(([id, pos]) => {
          const node = nodeById.get(id)
          if (!node) return null
          const fill = nodeFillFor(node, overlay)
          const isSelected = selectedId === id
          const isNeighbour = neighbourIds ? neighbourIds.has(id) : false
          const dim = emphasising && !isNeighbour
          // The active (selected/hovered) node gets the strong ring; its
          // neighbours a lighter accent ring; everyone else the quiet border.
          const stroke = isSelected
            ? 'var(--color-status-blue-deep)'
            : emphasising && isNeighbour
              ? 'var(--color-status-blue-deep)'
              : 'var(--color-border-secondary)'
          // Node radius grows with connection degree so hubs (host with
          // 50 VMs, storage array with 200 volumes) read as big circles.
          const degree = degreeByNode.get(id) ?? 0
          const radius = Math.min(12 + Math.floor(Math.sqrt(degree) * 2), 26)
          const short = node.label.length > 16 ? node.label.slice(0, 14) + '…' : node.label
          return (
            <g
              key={id}
              transform={`translate(${pos.x},${pos.y})`}
              onClick={(ev) => {
                ev.stopPropagation()
                onSelect(id)
              }}
              onMouseEnter={() => onHover(id)}
              onMouseLeave={() => onHover(null)}
              style={{ cursor: 'pointer', opacity: dim ? 0.22 : 1, transition: 'opacity 120ms ease' }}
            >
              <circle
                r={radius}
                fill={fill}
                stroke={stroke}
                strokeWidth={isSelected ? 3 : emphasising && isNeighbour ? 2 : 1}
              />
              {degree > 4 ? (
                <text x={0} y={4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-text-primary)">
                  {degree}
                </text>
              ) : null}
              {/* Hide labels of dimmed nodes so the focus neighbourhood reads
                  cleanly; always show the active + neighbour labels. */}
              {!dim ? (
                <>
                  <rect
                    x={-(short.length * 3.05) - 3}
                    y={radius + 2}
                    width={short.length * 6.1 + 6}
                    height={13}
                    rx={3}
                    fill="var(--color-background-primary)"
                    opacity={0.82}
                  />
                  <text x={0} y={radius + 12} textAnchor="middle" fontSize={9.5} fill="var(--color-text-primary)">
                    {short}
                  </text>
                </>
              ) : null}
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
      case 'tier_0':
      case 'tier_1':
        return 'var(--color-status-red-mid)'
      case 'high':
      case 'tier_2':
        return 'var(--color-status-amber-mid)'
      case 'medium':
      case 'tier_3':
      case 'tier_4':
        // NB: --color-status-blue-mid is NOT a defined theme token (renders
        // as an invalid colour). violet-mid IS defined and reads distinctly
        // between amber (high) and green (low).
        return 'var(--color-status-violet-mid)'
      case 'low':
        return 'var(--color-status-green-mid)'
      case 'tier_5':
        return 'var(--color-background-tertiary)'
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
        { color: 'var(--color-status-red-mid)', label: 'critical / tier_0 / tier_1' },
        { color: 'var(--color-status-amber-mid)', label: 'high / tier_2' },
        { color: 'var(--color-status-violet-mid)', label: 'medium / tier_3 / tier_4' },
        { color: 'var(--color-status-green-mid)', label: 'low' },
        { color: 'var(--color-background-tertiary)', label: 'tier_5 / unspecified' },
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
  detail,
  detailLoading,
  connections,
  onClose,
  onOpen,
  onFocus,
  onSelectNeighbor,
  onHoverNeighbor,
  isFocused,
  t,
}: {
  node: TopologyNode
  detail: Record<string, unknown> | null
  detailLoading: boolean
  connections: Array<{ kind: string; id: string; label: string; iface?: string }>
  onClose: () => void
  onOpen: () => void
  onFocus: () => void
  onSelectNeighbor: (id: string) => void
  onHoverNeighbor: (id: string | null) => void
  isFocused: boolean
  t: (key: string, fallback?: string) => string
}) {
  // Pull rich, node-specific facts out of the fetched asset metadata,
  // tolerant of the per-connector key spellings (same candidates the asset
  // detail page uses). guest.* covers vCenter VMs; raw.* covers OME/Redfish.
  const meta: Record<string, unknown> = (detail?.['metadata'] as Record<string, unknown>) ?? {}
  const guest: Record<string, unknown> = (meta['guest'] as Record<string, unknown>) ?? {}
  const raw: Record<string, unknown> = (meta['raw'] as Record<string, unknown>) ?? {}
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = meta[k] ?? guest[k] ?? raw[k]
      if (typeof v === 'string' && v.trim() !== '') return v.trim()
      if (typeof v === 'number') return String(v)
    }
    return ''
  }
  const vendor = pick('manufacturer', 'vendor')
  const model = pick('model', 'platform', 'platformId', 'platform_id')
  const serial = pick('serial', 'serialNumber', 'serial_number', 'service_tag')
  const software = pick('software_version', 'sw-version', 'softwareVersion', 'os_version', 'osVersion', 'operating_system', 'version', 'full_name')
  const mgmtIP = pick('management_ip', 'management_address', 'mgmt_ip', 'ip-address', 'ip_address', 'primary_ip', 'ip')
  const owner = pick('owner')
  const description = pick('description')
  const switchConns = Array.isArray(meta['switch_connections'])
    ? (meta['switch_connections'] as Array<Record<string, unknown>>)
    : []
  const stackMembers = Array.isArray(meta['stack_members'])
    ? (meta['stack_members'] as Array<Record<string, unknown>>)
    : []
  return (
    <Card>
      <CardTitle right={<GhostButton onClick={onClose}><i className="ti ti-x" aria-hidden="true" /></GhostButton>}>
        {node.label}
      </CardTitle>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', marginBottom: 8 }}>
        {node.id}
      </div>
      {description ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 8 }}>{description}</div>
      ) : null}
      <Row label={t('Asset type', 'Asset type')} value={node.asset_type || '—'} />
      <Row label={t('Criticality', 'Criticality')} value={node.criticality || node.app_tier || '—'} />
      <Row label={t('Site', 'Site')} value={node.site_name || node.site_id || '—'} />
      {node.app_id ? <Row label={t('Application', 'Application')} value={node.app_id} /> : null}
      {/* Rich, node-specific detail fetched from inventory (only rows that
          actually have a value for THIS node are shown). */}
      {vendor ? <Row label={t('Vendor', 'Vendor')} value={vendor} /> : null}
      {model ? <Row label={t('Model', 'Model')} value={model} /> : null}
      {serial ? <Row label={t('Serial', 'Serial')} value={serial} /> : null}
      {software ? <Row label={t('Software / OS', 'Software / OS')} value={software} /> : null}
      {mgmtIP ? <Row label={t('Management IP', 'Management IP')} value={mgmtIP} /> : null}
      {owner ? <Row label={t('Owner', 'Owner')} value={owner} /> : null}
      {node.health || pick('health', 'health_state') ? (
        <Row label={t('Health', 'Health')} value={node.health || pick('health', 'health_state')} />
      ) : null}
      {node.backup_state ? <Row label={t('Backup', 'Backup')} value={node.backup_state} /> : null}
      {node.compliance || pick('compliance_state') ? (
        <Row label={t('Compliance', 'Compliance')} value={node.compliance || pick('compliance_state')} />
      ) : null}
      {stackMembers.length > 0 ? (
        <Row label={t('Stack members', 'Stack members')} value={String(stackMembers.length)} />
      ) : null}
      {node.switch_port ? <Row label={t('Switch port', 'Switch port')} value={node.switch_port} /> : null}
      {switchConns.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
            {t('Switch connectivity', 'Switch connectivity')} ({switchConns.length})
          </div>
          {switchConns.slice(0, 8).map((c, i) => (
            <div key={i} style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--color-text-secondary)', padding: '2px 0' }}>
              {String(c['local_interface'] ?? '—')} → {String(c['peer_device'] ?? '—')}
              {c['peer_interface'] ? ` : ${String(c['peer_interface'])}` : ''}
            </div>
          ))}
        </div>
      ) : null}
      {(node.present_in || []).length > 0 ? (
        <Row label={t('Seen by', 'Seen by')} value={(node.present_in || []).join(', ')} />
      ) : null}
      {detailLoading ? (
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 6 }}>{t('Loading details…', 'Loading details…')}</div>
      ) : null}
      {connections.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            {t('Connections', 'Connections')} ({connections.length})
          </div>
          {groupConnections(connections).map(([kind, items]) => (
            <div key={kind} style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                <span style={{ display: 'inline-block', width: 9, height: 3, borderRadius: 1, background: edgeKindColor(kind) }} />
                <span style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontWeight: 600 }}>{edgeKindLabel(kind, t)}</span>
              </div>
              {items.map((c) => (
                <button
                  key={`${kind}|${c.id}`}
                  type="button"
                  onClick={() => onSelectNeighbor(c.id)}
                  onMouseEnter={() => onHoverNeighbor(c.id)}
                  onMouseLeave={() => onHoverNeighbor(null)}
                  title={c.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 6,
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--border-radius-sm)',
                    padding: '3px 4px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  onFocus={() => onHoverNeighbor(c.id)}
                  onBlur={() => onHoverNeighbor(null)}
                >
                  <span style={{ fontSize: 11, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.label}
                  </span>
                  {c.iface ? (
                    <span style={{ fontSize: 9.5, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>{c.iface}</span>
                  ) : (
                    <i className="ti ti-chevron-right" aria-hidden="true" style={{ color: 'var(--color-text-tertiary)', fontSize: 12, flexShrink: 0 }} />
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', gap: 6 }}>
        <GhostButton onClick={onFocus}>
          <i className={isFocused ? 'ti ti-zoom-out' : 'ti ti-zoom-in'} aria-hidden="true" />
          {isFocused ? t('Focused (2 hops)', 'Focused (2 hops)') : t('Focus 2 hops', 'Focus 2 hops')}
        </GhostButton>
        <GhostButton onClick={onOpen}>
          <i className="ti ti-external-link" aria-hidden="true" /> {t('Open', 'Open')}
        </GhostButton>
      </div>
    </Card>
  )
}

// groupConnections buckets a node's neighbours by edge kind, preserving a
// stable, meaningful order (backbone first, plumbing after) so the panel's
// Connections list reads top-down from most to least structural.
function groupConnections(
  connections: Array<{ kind: string; id: string; label: string; iface?: string }>,
): Array<[string, Array<{ kind: string; id: string; label: string; iface?: string }>]> {
  const order = [
    'device_link',
    'network_port',
    'app_dependency',
    'app_membership',
    'hypervisor_host',
    'storage_attachment',
    'backup_coverage',
    'host_port',
  ]
  const by = new Map<string, Array<{ kind: string; id: string; label: string; iface?: string }>>()
  for (const c of connections) {
    if (!by.has(c.kind)) by.set(c.kind, [])
    by.get(c.kind)!.push(c)
  }
  return Array.from(by.entries()).sort((a, b) => {
    const ai = order.indexOf(a[0])
    const bi = order.indexOf(b[0])
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi)
  })
}

// Human labels + swatch colours for edge kinds, matching the graph strokes so
// the Connections list keys back to the wires the operator sees.
function edgeKindLabel(kind: string, t: (key: string, fallback?: string) => string): string {
  switch (kind) {
    case 'device_link':
      return t('Network backbone', 'Network backbone')
    case 'network_port':
      return t('Switch port', 'Switch port')
    case 'app_dependency':
      return t('App dependency', 'App dependency')
    case 'app_membership':
      return t('Application', 'Application')
    case 'hypervisor_host':
      return t('Hypervisor host', 'Hypervisor host')
    case 'storage_attachment':
      return t('Storage', 'Storage')
    case 'backup_coverage':
      return t('Backup', 'Backup')
    case 'host_port':
      return t('Unresolved MAC', 'Unresolved MAC')
    default:
      return kind
  }
}

function edgeKindColor(kind: string): string {
  switch (kind) {
    case 'hypervisor_host':
      return 'var(--color-status-amber-mid)'
    case 'storage_attachment':
      return 'var(--color-status-green-mid)'
    case 'app_membership':
      return 'var(--color-status-red-mid)'
    case 'host_port':
      return 'var(--color-border-tertiary)'
    default:
      return 'var(--color-status-blue-deep)'
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
      <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)', fontSize: 11, textAlign: 'right' }}>{value}</span>
    </div>
  )
}
