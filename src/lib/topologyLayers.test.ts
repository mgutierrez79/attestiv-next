import { describe, it, expect } from 'vitest'
import {
  buildLayeredGraph,
  seedPositions,
  layoutGraph,
  type BaseNode,
  type BaseEdge,
  type InfraCategories,
  type LayerKey,
} from './topologyLayers'

// These helpers back the layered application-topology map. The base graph
// (app + component VMs) is always drawn; toggleable layers add declared
// app→app dependencies / dependents and DERIVED infrastructure nodes,
// matched to component VMs by display name.

const APP = 'billing'

function baseGraph(): { nodes: BaseNode[]; edges: BaseEdge[] } {
  return {
    nodes: [
      { id: `app:${APP}`, label: 'Billing', asset_type: 'application' },
      { id: 'vm:web01', label: 'web01', asset_type: 'vm' },
      { id: 'vm:db01', label: 'db01', asset_type: 'vm' },
      // a non-VM neighbour that must never be drawn as a base node
      { id: 'vol:a', label: 'Vol A', asset_type: 'storage_volume' },
    ],
    edges: [
      { id: 'm1', source: `app:${APP}`, target: 'vm:web01', kind: 'app_membership' },
      { id: 'm2', source: `app:${APP}`, target: 'vm:db01', kind: 'app_membership' },
      { id: 's1', source: 'vm:web01', target: 'vol:a', kind: 'storage_attachment' },
    ],
  }
}

const allOff: Record<LayerKey, boolean> = {
  dependencies: false,
  dependents: false,
  host: false,
  storage: false,
  switch: false,
  firewall: false,
}

const infra: InfraCategories = {
  host: [{ id: 'h1', name: 'esx-01', used_by: ['web01', 'db01'] }],
  storage: [{ id: 'st1', name: 'datastore-1', used_by: ['db01'] }],
  switch: [{ id: 'sw1', name: 'leaf-1', used_by: ['web01'] }],
  firewall: [{ id: 'fw1', name: 'pan-edge', used_by: ['web01'] }],
}

describe('buildLayeredGraph — base', () => {
  it('always draws the app node + component VMs and app_membership edges only', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra,
      dependencies: [],
      dependents: [],
      enabled: allOff,
    })
    expect(g.nodes.map((n) => n.id).sort()).toEqual([`app:${APP}`, 'vm:db01', 'vm:web01'])
    // the storage_attachment edge endpoint (vol:a) is not drawn, so its
    // edge is dropped — only the two app_membership edges remain.
    expect(g.edges).toHaveLength(2)
    expect(g.edges.every((e) => e.relation === 'app_membership')).toBe(true)
  })
})

describe('buildLayeredGraph — dependency / dependent layers', () => {
  it('adds upstream dependency nodes with app→dep edges', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra: null,
      dependencies: [{ application_id: 'auth' }, { application_id: 'dns' }],
      dependents: [],
      enabled: { ...allOff, dependencies: true },
    })
    expect(g.nodes.find((n) => n.id === 'app:auth')?.group).toBe('dependency')
    const dep = g.edges.find((e) => e.relation === 'dependency' && e.target === 'app:auth')
    expect(dep?.source).toBe(`app:${APP}`)
  })

  it('adds downstream dependent nodes with dep→app edges', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra: null,
      dependencies: [],
      dependents: ['reporting'],
      enabled: { ...allOff, dependents: true },
    })
    expect(g.nodes.find((n) => n.id === 'app:reporting')?.group).toBe('dependent')
    const dep = g.edges.find((e) => e.relation === 'dependent')
    expect(dep?.source).toBe('app:reporting')
    expect(dep?.target).toBe(`app:${APP}`)
  })
})

describe('buildLayeredGraph — infra layers', () => {
  it('dedupes a host used by two VMs into one node with two edges', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra,
      dependencies: [],
      dependents: [],
      enabled: { ...allOff, host: true },
    })
    const hostNodes = g.nodes.filter((n) => n.group === 'host')
    expect(hostNodes).toHaveLength(1)
    const hostEdges = g.edges.filter((e) => e.relation === 'host')
    expect(hostEdges.map((e) => e.source).sort()).toEqual(['vm:db01', 'vm:web01'])
    // edges always point VM → infra node
    expect(hostEdges.every((e) => e.target === 'host:h1')).toBe(true)
  })

  it('matches infra used_by by VM display name and skips unknown names', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra: { host: [], storage: [], switch: [], firewall: [{ id: 'fw9', name: 'ghost', used_by: ['nope'] }] },
      dependencies: [],
      dependents: [],
      enabled: { ...allOff, firewall: true },
    })
    // used_by references a VM that isn't a component → no node, no edge.
    expect(g.nodes.some((n) => n.group === 'firewall')).toBe(false)
  })

  it('only includes layers that are enabled', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra,
      dependencies: [],
      dependents: [],
      enabled: { ...allOff, storage: true },
    })
    expect(g.nodes.some((n) => n.group === 'storage')).toBe(true)
    expect(g.nodes.some((n) => n.group === 'host')).toBe(false)
    expect(g.nodes.some((n) => n.group === 'switch')).toBe(false)
  })
})

describe('buildLayeredGraph — user networks', () => {
  it('draws a user_network node + user_access edge into the app, deduped by type', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra: null,
      dependencies: [],
      dependents: [],
      enabled: allOff,
      userNetworks: [
        { type: 'vpn', label: 'VPN' },
        { type: 'vpn', label: 'VPN' },
        { type: 'internet', label: 'Internet' },
      ],
    })
    const un = g.nodes.filter((n) => n.group === 'user_network')
    // two distinct types → two nodes (the duplicate vpn is deduped)
    expect(un.map((n) => n.id).sort()).toEqual([`usernet:${APP}:internet`, `usernet:${APP}:vpn`])
    const ua = g.edges.filter((e) => e.relation === 'user_access')
    expect(ua.every((e) => e.target === `app:${APP}`)).toBe(true)
    expect(ua.every((e) => e.source.startsWith(`usernet:${APP}:`))).toBe(true)
  })

  it('degrades gracefully with no user networks', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra: null,
      dependencies: [],
      dependents: [],
      enabled: allOff,
    })
    expect(g.nodes.some((n) => n.group === 'user_network')).toBe(false)
    expect(g.edges.some((e) => e.relation === 'user_access')).toBe(false)
  })
})

describe('buildLayeredGraph — switch routing', () => {
  it('routes switches through the VM hypervisor host (switch → host → VM)', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra,
      dependencies: [],
      dependents: [],
      enabled: { ...allOff, switch: true }, // Hosts layer stays OFF
    })
    // The switch node renders, and the host node is materialised even though
    // the Hosts toggle is off — the switch → host → VM path needs it.
    expect(g.nodes.some((n) => n.id === 'switch:sw1')).toBe(true)
    expect(g.nodes.some((n) => n.id === 'host:h1')).toBe(true)
    // Switch attaches to the host, NOT straight to the VM…
    expect(g.edges.some((e) => e.source === 'host:h1' && e.target === 'switch:sw1')).toBe(true)
    expect(g.edges.some((e) => e.target === 'switch:sw1' && e.source === 'vm:web01')).toBe(false)
    // …and the host → VM hop completes the cascade path.
    expect(g.edges.some((e) => e.source === 'vm:web01' && e.target === 'host:h1')).toBe(true)
  })

  it('falls back to a direct switch → VM edge when the VM has no known host', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra: { host: [], storage: [], switch: [{ id: 'sw1', name: 'leaf-1', used_by: ['web01'] }], firewall: [] },
      dependencies: [],
      dependents: [],
      enabled: { ...allOff, switch: true },
    })
    expect(g.edges.some((e) => e.source === 'vm:web01' && e.target === 'switch:sw1')).toBe(true)
    expect(g.nodes.some((n) => n.id.startsWith('host:'))).toBe(false)
  })
})

describe('buildLayeredGraph — firewall routing', () => {
  it('routes firewalls through the bridging switch → host → VM', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra: {
        host: [{ id: 'h1', name: 'esx-01', used_by: ['web01'] }],
        storage: [],
        switch: [{ id: 'sw1', name: 'leaf-1', used_by: ['web01'] }],
        firewall: [{ id: 'fw1', name: 'pan-edge', used_by: ['web01'], via_switches: ['leaf-1'] }],
      },
      dependencies: [],
      dependents: [],
      enabled: { ...allOff, firewall: true }, // Network + Hosts layers stay OFF
    })
    // Firewall attaches to its bridging switch, NOT straight to the VM…
    expect(g.edges.some((e) => e.source === 'switch:sw1' && e.target === 'firewall:fw1')).toBe(true)
    expect(g.edges.some((e) => e.target === 'firewall:fw1' && e.source === 'vm:web01')).toBe(false)
    // …and the whole switch → host → VM chain is materialised behind it.
    expect(g.nodes.some((n) => n.id === 'switch:sw1')).toBe(true)
    expect(g.nodes.some((n) => n.id === 'host:h1')).toBe(true)
    expect(g.edges.some((e) => e.source === 'host:h1' && e.target === 'switch:sw1')).toBe(true)
    expect(g.edges.some((e) => e.source === 'vm:web01' && e.target === 'host:h1')).toBe(true)
  })

  it('falls back to a direct firewall → VM edge when no bridging switch is known', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra: { host: [], storage: [], switch: [], firewall: [{ id: 'fw1', name: 'pan-edge', used_by: ['web01'] }] },
      dependencies: [],
      dependents: [],
      enabled: { ...allOff, firewall: true },
    })
    expect(g.edges.some((e) => e.source === 'vm:web01' && e.target === 'firewall:fw1')).toBe(true)
    expect(g.nodes.some((n) => n.id === 'firewall:fw1')).toBe(true)
  })
})

describe('layout is deterministic', () => {
  const opts = { width: 800, height: 500, iterations: 60 }

  it('seedPositions places the app node at centre', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra: null,
      dependencies: [],
      dependents: [],
      enabled: allOff,
    })
    const seed = seedPositions(g.nodes, opts)
    expect(seed.get(`app:${APP}`)).toEqual({ x: 400, y: 250 })
  })

  it('produces identical positions for identical inputs', () => {
    const { nodes, edges } = baseGraph()
    const build = () =>
      buildLayeredGraph({
        appID: APP,
        baseNodes: nodes,
        baseEdges: edges,
        infra,
        dependencies: [{ application_id: 'auth' }],
        dependents: ['reporting'],
        enabled: { dependencies: true, dependents: true, host: true, storage: true, switch: true, firewall: true },
      })
    const a = build()
    const b = build()
    const pa = layoutGraph(a.nodes, a.edges, opts)
    const pb = layoutGraph(b.nodes, b.edges, opts)
    for (const n of a.nodes) {
      expect(pb.get(n.id)).toEqual(pa.get(n.id))
    }
  })

  it('clamps every node inside the viewBox', () => {
    const { nodes, edges } = baseGraph()
    const g = buildLayeredGraph({
      appID: APP,
      baseNodes: nodes,
      baseEdges: edges,
      infra,
      dependencies: [{ application_id: 'auth' }, { application_id: 'dns' }],
      dependents: ['reporting'],
      enabled: { dependencies: true, dependents: true, host: true, storage: true, switch: true, firewall: true },
    })
    const pos = layoutGraph(g.nodes, g.edges, opts)
    for (const p of pos.values()) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(opts.width)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(opts.height)
    }
  })
})
