// Pure helpers backing the clickable application-map node-details panel
// (AppTopologyEmbed in src/views/AttestivAppDetailPage.tsx). Kept free
// of React / i18n / fetch so they can be unit-tested in the node test
// environment.
//
// The graph loads {nodes, edges} from GET /network/topology (filtered to
// one app, 2 hops). Selecting a node, we want its neighbours grouped by
// relationship — with STORAGE the headline group (the user's ask:
// clicking a host/VM shows the storage it mounts).

// Minimal shapes — a structural subset of the topology node/edge wire
// types so callers can pass their richer objects directly.
export type TopoNode = {
  id: string
  label: string
  asset_type: string
  criticality?: string
  health?: string
  backup_state?: string
}

export type TopoEdge = {
  id: string
  source: string
  target: string
  kind: string
  source_interface?: string
  target_interface?: string
  vlan?: string
}

export type NeighbourGroups = {
  storage: TopoNode[]
  host: TopoNode[]
  network: TopoNode[]
  backup: TopoNode[]
  app: TopoNode[]
  other: TopoNode[]
}

const STORAGE_TYPES = new Set(['storage_array', 'storage_volume'])
const HOST_TYPES = new Set(['host', 'hypervisor_host'])
const NETWORK_TYPES = new Set(['network_device', 'firewall', 'firewall_manager'])
const BACKUP_TYPES = new Set(['backup_appliance'])

// isStorageNeighbour: an edge counts as a storage attachment when its
// kind says so, OR when the neighbour node is itself a storage asset.
// Either signal classifies it as storage, so the host→volume link is
// caught even if the edge kind is generic.
export function isStorageNeighbour(edgeKind: string, neighbour: TopoNode): boolean {
  return edgeKind === 'storage_attachment' || STORAGE_TYPES.has(neighbour.asset_type)
}

// neighboursOf returns the direct (1-hop) neighbours of selectedId,
// grouped by relationship. Direction-agnostic (matches source OR
// target), deduplicated by node id, and skips self / dangling edges.
// Storage is resolved first so a node that is both storage-attached and
// something else lands in the storage bucket.
export function neighboursOf(
  selectedId: string | null | undefined,
  nodes: TopoNode[],
  edges: TopoEdge[],
): NeighbourGroups {
  const groups: NeighbourGroups = {
    storage: [],
    host: [],
    network: [],
    backup: [],
    app: [],
    other: [],
  }
  if (!selectedId) return groups

  const byId = new Map<string, TopoNode>()
  for (const n of nodes ?? []) byId.set(n.id, n)

  // Collect neighbour id → the edge kind(s) that connect it. We keep the
  // first edge kind seen for storage classification; dedupe by node id.
  const seen = new Set<string>()
  for (const e of edges ?? []) {
    let otherId: string | null = null
    if (e.source === selectedId) otherId = e.target
    else if (e.target === selectedId) otherId = e.source
    if (otherId === null) continue
    if (otherId === selectedId) continue // self-loop guard
    if (seen.has(otherId)) continue
    const node = byId.get(otherId)
    if (!node) continue // dangling edge into a filtered-out node
    seen.add(otherId)

    if (isStorageNeighbour(e.kind, node)) {
      groups.storage.push(node)
    } else if (HOST_TYPES.has(node.asset_type)) {
      groups.host.push(node)
    } else if (NETWORK_TYPES.has(node.asset_type)) {
      groups.network.push(node)
    } else if (BACKUP_TYPES.has(node.asset_type)) {
      groups.backup.push(node)
    } else if (node.asset_type === 'application' || node.id.startsWith('app:')) {
      groups.app.push(node)
    } else {
      groups.other.push(node)
    }
  }
  return groups
}

// isAssetNode: true when the node id is a real inventory asset id (not a
// synthetic "app:" / "synthetic:" graph node), so callers know whether
// GET /inventory/assets/{id} enrichment is worth attempting.
export function isAssetNode(node: TopoNode | null | undefined): boolean {
  if (!node) return false
  return !node.id.startsWith('app:') && !node.id.startsWith('synthetic:')
}
