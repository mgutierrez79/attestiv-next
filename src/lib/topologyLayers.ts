// Pure helpers backing the LAYERED application-topology map
// (AppTopologyEmbed in src/views/AttestivAppDetailPage.tsx). Kept free of
// React / i18n / fetch so they can be unit-tested in the node test env.
//
// The map always draws the app node + its component VMs. On top of that
// the user can toggle layers — declared app→app dependencies / dependents
// and DERIVED infrastructure (hosts, storage, switches, firewalls). This
// module builds the visible node + edge set from those three data sources
// (topology base graph, /apps/{id}/infrastructure, declared deps) and runs
// a small DETERMINISTIC force-directed layout so the picture stays
// readable as nodes are added and stable across renders (same inputs →
// same positions; no Math.random).

export type LayerKey = 'dependencies' | 'dependents' | 'host' | 'storage' | 'switch' | 'firewall'

// The category an edge/node belongs to — drives colour + dash + legend.
export type RelationKind =
  | 'app_membership'
  | 'dependency'
  | 'dependent'
  | 'host'
  | 'storage'
  | 'switch'
  | 'firewall'
  // user_access: a user-network → app ingress edge (where users connect from).
  | 'user_access'

export type LayoutNode = {
  id: string
  label: string
  // Logical group, distinct from the wire asset_type: drives styling and
  // the deterministic seed ring.
  group:
    | 'app'
    | 'vm'
    | 'dependency'
    | 'dependent'
    | 'host'
    | 'storage'
    | 'switch'
    | 'firewall'
    // user_network: a source network (VPN / internet / …) users connect from.
    | 'user_network'
  asset_type: string
  criticality?: string
  health?: string
  backup_state?: string
}

export type LayoutEdge = {
  id: string
  source: string
  target: string
  relation: RelationKind
}

// Minimal structural subset of the base topology node/edge so callers can
// pass their richer objects straight through.
export type BaseNode = {
  id: string
  label: string
  asset_type: string
  criticality?: string
  health?: string
  backup_state?: string
}
export type BaseEdge = { id: string; source: string; target: string; kind: string }

// Infrastructure entries — used_by holds component VM DISPLAY NAMES which
// we match against the drawn VM nodes by label.
// via_switches is populated for FIREWALL entries only: the name(s) of the
// switch(es) that bridge the app's L2 path to the firewall, so a firewall can
// be routed firewall → switch → host → VM rather than straight to each VM.
export type InfraEntry = { id: string; name: string; used_by: string[]; via_switches?: string[] }
export type InfraCategories = {
  host: InfraEntry[]
  storage: InfraEntry[]
  switch: InfraEntry[]
  firewall: InfraEntry[]
}

export type AppDep = { application_id: string; dependency_type?: string; criticality?: string }

// A user-network the application's users connect from. `type` is the raw
// network_type (external / private / vpn / …); `label` is the friendly badge
// label, used as the node label. Kept minimal + framework-free so this module
// stays unit-testable without pulling in the i18n / lib helpers.
export type UserNetwork = { type: string; label: string }

export type BuildInput = {
  appID: string
  baseNodes: BaseNode[]
  baseEdges: BaseEdge[]
  infra: InfraCategories | null
  dependencies: AppDep[]
  dependents: string[]
  enabled: Record<LayerKey, boolean>
  // Optional user-networks (where users connect from). Additive: always
  // drawn when present, absent → nothing changes. No toggle — like the app +
  // component VMs, these are part of the base picture.
  userNetworks?: UserNetwork[]
}

export type BuiltGraph = { nodes: LayoutNode[]; edges: LayoutEdge[] }

const INFRA_GROUPS: Record<'host' | 'storage' | 'switch' | 'firewall', LayoutNode['group']> = {
  host: 'host',
  storage: 'storage',
  switch: 'switch',
  firewall: 'firewall',
}

// buildLayeredGraph composes the visible node/edge set from the always-on
// base (app + component VMs) plus whichever layers are enabled. Every
// infra / dependency node is deduplicated (one node even when used by
// several VMs); an edge is drawn from each using VM to the shared node.
export function buildLayeredGraph(input: BuildInput): BuiltGraph {
  const { appID, baseNodes, baseEdges, infra, dependencies, dependents, enabled, userNetworks } = input
  const appNodeID = `app:${appID}`

  const nodes: LayoutNode[] = []
  const edges: LayoutEdge[] = []
  const nodeIds = new Set<string>()

  const push = (n: LayoutNode) => {
    if (nodeIds.has(n.id)) return
    nodeIds.add(n.id)
    nodes.push(n)
  }

  // --- Base: app node + component VMs (always drawn). ---
  const appNode = baseNodes.find((n) => n.id === appNodeID)
  push({
    id: appNodeID,
    label: appNode?.label ?? appID,
    group: 'app',
    asset_type: 'application',
  })

  const vms = baseNodes.filter((n) => n.asset_type === 'vm')
  // VM display-name → node id, for matching infra used_by labels.
  const vmByLabel = new Map<string, string>()
  for (const vm of vms) {
    push({
      id: vm.id,
      label: vm.label,
      group: 'vm',
      asset_type: vm.asset_type,
      criticality: vm.criticality,
      health: vm.health,
      backup_state: vm.backup_state,
    })
    if (!vmByLabel.has(vm.label)) vmByLabel.set(vm.label, vm.id)
  }

  // app_membership edges between the app and its VMs (from the base graph).
  // ONLY app_membership: declared app→app dependencies come from the
  // `dependencies` input (and only when they exist), never from base edges,
  // so an app_dependency base edge must not be drawn here mislabeled.
  for (const e of baseEdges) {
    if (e.kind !== 'app_membership') continue
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue
    if (e.source === e.target) continue
    edges.push({ id: e.id, source: e.source, target: e.target, relation: 'app_membership' })
  }

  // --- Dependencies (upstream apps): app → dep. ---
  if (enabled.dependencies) {
    for (const d of dependencies) {
      if (!d.application_id) continue
      const id = `app:${d.application_id}`
      if (id === appNodeID) continue
      push({ id, label: d.application_id, group: 'dependency', asset_type: 'application', criticality: d.criticality })
      edges.push({ id: `dep:${d.application_id}`, source: appNodeID, target: id, relation: 'dependency' })
    }
  }

  // --- Dependents (downstream apps): dep → app. ---
  if (enabled.dependents) {
    for (const depID of dependents) {
      if (!depID) continue
      const id = `app:${depID}`
      if (id === appNodeID) continue
      push({ id, label: depID, group: 'dependent', asset_type: 'application' })
      edges.push({ id: `dependent:${depID}`, source: id, target: appNodeID, relation: 'dependent' })
    }
  }

  // --- User networks: usernet → app ingress. Always drawn when present
  // (no toggle) so the "where users connect from" context is part of the
  // base picture; deduped by network type so several entries of the same
  // type collapse to one node. Node id mirrors the backend's
  // `usernet:<app>:<type>` so verdicts / server-emitted nodes line up.
  for (const un of userNetworks ?? []) {
    const type = (un.type ?? '').trim()
    if (!type) continue
    const id = `usernet:${appID}:${type}`
    push({ id, label: un.label || type, group: 'user_network', asset_type: 'user_network' })
    edges.push({ id: `user_access:${type}`, source: id, target: appNodeID, relation: 'user_access' })
  }

  // --- Infra layers: each entry deduped, an edge from each using VM. ---
  const addInfra = (
    cat: 'host' | 'storage' | 'switch' | 'firewall',
    entries: InfraEntry[],
    relation: RelationKind,
  ) => {
    for (const e of entries) {
      const nodeID = `${cat}:${e.id}`
      let drewAny = false
      for (const vmLabel of e.used_by) {
        const vmID = vmByLabel.get(vmLabel)
        if (!vmID) continue
        if (!drewAny) {
          push({ id: nodeID, label: e.name, group: INFRA_GROUPS[cat], asset_type: cat })
          drewAny = true
        }
        edges.push({ id: `${cat}:${e.id}->${vmID}`, source: vmID, target: nodeID, relation })
      }
    }
  }

  // Switches attach to the VM's hypervisor HOST, not to each VM — the
  // physical path is switch → host uplink → the VMs on that host, so a
  // switch/uplink failure cascades to every VM on the host. We draw
  // switch → host → VM in full (materialising the host node + host→VM edge
  // even when the Hosts layer toggle is off, since the path needs them),
  // and fall back to switch → VM only when the VM's host is unknown.
  const hostEntryByVM = new Map<string, InfraEntry>()
  for (const h of infra?.host ?? []) {
    for (const vmLabel of h.used_by) {
      if (!hostEntryByVM.has(vmLabel)) hostEntryByVM.set(vmLabel, h)
    }
  }
  if (infra) {
    if (enabled.host) addInfra('host', infra.host, 'host')
    if (enabled.storage) addInfra('storage', infra.storage, 'storage')

    // Shared dedup for the switch + firewall cascade routing. Seed from the
    // edges already drawn (incl. addInfra's host edges) so we never
    // double-draw the same connection.
    const drawnEdge = new Set<string>(edges.map((e) => e.id))
    const switchByName = new Map<string, InfraEntry>()
    for (const sw of infra.switch) switchByName.set(sw.name, sw)

    // Route one switch through its VMs' hosts (switch → host → VM), drawing
    // the host node + host→VM hop even when the Hosts toggle is off. Idempotent
    // (safe to call from both the switch loop and firewall routing); returns
    // the switch node id so a firewall can attach to it.
    const routeSwitchThroughHost = (sw: InfraEntry): string => {
      const swNodeID = `switch:${sw.id}`
      const seenTarget = new Set<string>()
      const drawSwitchEdge = (targetID: string) => {
        if (seenTarget.has(targetID)) return
        seenTarget.add(targetID)
        const id = `switch:${sw.id}->${targetID}`
        if (!drawnEdge.has(id)) {
          drawnEdge.add(id)
          edges.push({ id, source: targetID, target: swNodeID, relation: 'switch' })
        }
      }
      push({ id: swNodeID, label: sw.name, group: INFRA_GROUPS.switch, asset_type: 'switch' })
      for (const vmLabel of sw.used_by) {
        const vmID = vmByLabel.get(vmLabel)
        if (!vmID) continue
        const hostEntry = hostEntryByVM.get(vmLabel)
        if (hostEntry) {
          const hostID = `host:${hostEntry.id}`
          push({ id: hostID, label: hostEntry.name, group: INFRA_GROUPS.host, asset_type: 'host' })
          const hvID = `host:${hostEntry.id}->${vmID}`
          if (!drawnEdge.has(hvID)) {
            drawnEdge.add(hvID)
            edges.push({ id: hvID, source: vmID, target: hostID, relation: 'host' })
          }
          drawSwitchEdge(hostID)
        } else {
          drawSwitchEdge(vmID) // no known host → attach directly (fallback)
        }
      }
      return swNodeID
    }

    // Firewalls sit behind the switches (Panorama LLDP), so the physical path
    // is firewall → switch → host → VM. Attach each firewall to its bridging
    // switch(es) (via_switches) — routing the switch chain in full even when
    // the Network layer toggle is off — so a firewall failure cascades down
    // the whole path. Fall back to a direct firewall → VM edge when no
    // bridging switch is known.
    const routeFirewallThroughSwitch = (fw: InfraEntry) => {
      const fwNodeID = `firewall:${fw.id}`
      const targets: string[] = []
      for (const swName of fw.via_switches ?? []) {
        const sw = switchByName.get(swName)
        if (sw) targets.push(routeSwitchThroughHost(sw))
      }
      if (targets.length === 0) {
        let drew = false
        for (const vmLabel of fw.used_by) {
          const vmID = vmByLabel.get(vmLabel)
          if (!vmID) continue
          if (!drew) {
            push({ id: fwNodeID, label: fw.name, group: INFRA_GROUPS.firewall, asset_type: 'firewall' })
            drew = true
          }
          const id = `firewall:${fw.id}->${vmID}`
          if (!drawnEdge.has(id)) {
            drawnEdge.add(id)
            edges.push({ id, source: vmID, target: fwNodeID, relation: 'firewall' })
          }
        }
        return
      }
      push({ id: fwNodeID, label: fw.name, group: INFRA_GROUPS.firewall, asset_type: 'firewall' })
      const seen = new Set<string>()
      for (const swNodeID of targets) {
        if (seen.has(swNodeID)) continue
        seen.add(swNodeID)
        const id = `firewall:${fw.id}->${swNodeID}`
        if (!drawnEdge.has(id)) {
          drawnEdge.add(id)
          edges.push({ id, source: swNodeID, target: fwNodeID, relation: 'firewall' })
        }
      }
    }

    if (enabled.switch) for (const sw of infra.switch) routeSwitchThroughHost(sw)
    if (enabled.firewall) for (const fw of infra.firewall) routeFirewallThroughSwitch(fw)
  }

  return { nodes, edges }
}

export type Vec = { x: number; y: number }
export type LayoutOptions = {
  width: number
  height: number
  iterations?: number
}

// seedPositions places each node deterministically by group + index:
// app at centre; VMs on an inner ring; dependencies in a left arc;
// dependents in a right arc; infra on an outer ring near the centre. No
// randomness — identical inputs yield identical seeds, which keeps the
// relaxed layout stable across renders.
export function seedPositions(nodes: LayoutNode[], opts: LayoutOptions): Map<string, Vec> {
  const cx = opts.width / 2
  const cy = opts.height / 2
  const innerR = Math.min(opts.width, opts.height) * 0.22
  const outerR = Math.min(opts.width, opts.height) * 0.42

  // Stable per-group indices (insertion order is already deterministic).
  const idx: Record<string, number> = {}
  const count: Record<string, number> = {}
  for (const n of nodes) count[n.group] = (count[n.group] ?? 0) + 1

  const pos = new Map<string, Vec>()
  for (const n of nodes) {
    const i = (idx[n.group] = (idx[n.group] ?? 0) + 1) - 1
    const total = count[n.group] ?? 1
    let x = cx
    let y = cy
    switch (n.group) {
      case 'app':
        x = cx
        y = cy
        break
      case 'vm': {
        const a = (i / Math.max(total, 1)) * 2 * Math.PI - Math.PI / 2
        x = cx + Math.cos(a) * innerR
        y = cy + Math.sin(a) * innerR
        break
      }
      case 'dependency': {
        // Left arc (around 180°), spread vertically.
        const span = Math.PI * 0.6
        const a = Math.PI - span / 2 + (total > 1 ? (i / (total - 1)) * span : span / 2)
        x = cx + Math.cos(a) * outerR
        y = cy + Math.sin(a) * outerR
        break
      }
      case 'dependent': {
        // Right arc (around 0°).
        const span = Math.PI * 0.6
        const a = -span / 2 + (total > 1 ? (i / (total - 1)) * span : span / 2)
        x = cx + Math.cos(a) * outerR
        y = cy + Math.sin(a) * outerR
        break
      }
      default: {
        // Infra on an outer ring.
        const a = (i / Math.max(total, 1)) * 2 * Math.PI
        x = cx + Math.cos(a) * outerR
        y = cy + Math.sin(a) * outerR
        break
      }
    }
    pos.set(n.id, { x, y })
  }
  return pos
}

// relax runs a fixed number of iterations of a simple force model:
// inverse-distance repulsion between all node pairs, spring attraction
// along edges toward an ideal length, and a mild pull toward centre.
// Deterministic (no randomness, fixed iteration count) so the same graph
// always settles to the same layout. Positions are clamped to the box.
export function relax(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  seed: Map<string, Vec>,
  opts: LayoutOptions,
): Map<string, Vec> {
  const pos = new Map<string, Vec>()
  for (const n of nodes) {
    const s = seed.get(n.id) ?? { x: opts.width / 2, y: opts.height / 2 }
    pos.set(n.id, { x: s.x, y: s.y })
  }
  const cx = opts.width / 2
  const cy = opts.height / 2
  const iterations = opts.iterations ?? 90
  const ideal = Math.min(opts.width, opts.height) * 0.18
  const repulsion = ideal * ideal * 0.9
  const spring = 0.04
  const gravity = 0.012
  const margin = 28

  const list = nodes
  for (let it = 0; it < iterations; it++) {
    const disp = new Map<string, Vec>()
    for (const n of list) disp.set(n.id, { x: 0, y: 0 })

    // Pairwise repulsion.
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = pos.get(list[i].id)!
        const b = pos.get(list[j].id)!
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy
        if (d2 < 0.01) {
          // Deterministic tiny nudge based on index so coincident nodes
          // separate without randomness.
          dx = (i - j) * 0.01 + 0.01
          dy = (i + j) * 0.01 + 0.01
          d2 = dx * dx + dy * dy
        }
        const d = Math.sqrt(d2)
        const force = repulsion / d2
        const fx = (dx / d) * force
        const fy = (dy / d) * force
        const da = disp.get(list[i].id)!
        const db = disp.get(list[j].id)!
        da.x += fx
        da.y += fy
        db.x -= fx
        db.y -= fy
      }
    }

    // Spring attraction along edges.
    for (const e of edges) {
      const a = pos.get(e.source)
      const b = pos.get(e.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const force = (d - ideal) * spring
      const fx = (dx / d) * force
      const fy = (dy / d) * force
      const da = disp.get(e.source)
      const db = disp.get(e.target)
      if (da) {
        da.x += fx
        da.y += fy
      }
      if (db) {
        db.x -= fx
        db.y -= fy
      }
    }

    // Apply: gravity toward centre + displacement, clamped to the box.
    for (const n of list) {
      const p = pos.get(n.id)!
      const d = disp.get(n.id)!
      p.x += d.x + (cx - p.x) * gravity
      p.y += d.y + (cy - p.y) * gravity
      p.x = Math.max(margin, Math.min(opts.width - margin, p.x))
      p.y = Math.max(margin, Math.min(opts.height - margin, p.y))
    }
  }

  return pos
}

// layoutGraph: seed + relax in one call.
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: LayoutOptions,
): Map<string, Vec> {
  return relax(nodes, edges, seedPositions(nodes, opts), opts)
}
