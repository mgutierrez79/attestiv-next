import { describe, it, expect } from 'vitest'
import {
  isAssetNode,
  isStorageNeighbour,
  neighboursOf,
  type TopoEdge,
  type TopoNode,
} from './topologyNeighbours'

// These helpers back the clickable node-details panel on the app map.
// The headline behaviour: clicking a host/VM node surfaces the storage
// volumes it mounts (storage_attachment edges), direction-agnostic and
// deduplicated.

function node(id: string, asset_type: string, label = id): TopoNode {
  return { id, label, asset_type }
}

describe('neighboursOf — storage', () => {
  it('returns the two storage_volume neighbours of a host with 2 storage edges', () => {
    const nodes = [
      node('vm:web01', 'vm'),
      node('vol:a', 'storage_volume', 'Vol A'),
      node('vol:b', 'storage_volume', 'Vol B'),
    ]
    const edges: TopoEdge[] = [
      { id: 'e1', source: 'vm:web01', target: 'vol:a', kind: 'storage_attachment' },
      { id: 'e2', source: 'vm:web01', target: 'vol:b', kind: 'storage_attachment' },
    ]
    const g = neighboursOf('vm:web01', nodes, edges)
    expect(g.storage.map((n) => n.id)).toEqual(['vol:a', 'vol:b'])
  })

  it('classifies a storage_array neighbour as storage even when the edge kind is generic', () => {
    const nodes = [node('vm:web01', 'vm'), node('arr:1', 'storage_array', 'Array 1')]
    const edges: TopoEdge[] = [{ id: 'e1', source: 'vm:web01', target: 'arr:1', kind: 'other' }]
    const g = neighboursOf('vm:web01', nodes, edges)
    expect(g.storage.map((n) => n.id)).toEqual(['arr:1'])
  })

  it('is direction-agnostic: matches the selected id as edge.target too', () => {
    const nodes = [node('vol:a', 'storage_volume'), node('vm:web01', 'vm')]
    // edge points volume -> vm; selecting the vm must still find the volume
    const edges: TopoEdge[] = [
      { id: 'e1', source: 'vol:a', target: 'vm:web01', kind: 'storage_attachment' },
    ]
    const g = neighboursOf('vm:web01', nodes, edges)
    expect(g.storage.map((n) => n.id)).toEqual(['vol:a'])
  })

  it('dedupes a neighbour reachable by more than one edge', () => {
    const nodes = [node('vm:web01', 'vm'), node('vol:a', 'storage_volume')]
    const edges: TopoEdge[] = [
      { id: 'e1', source: 'vm:web01', target: 'vol:a', kind: 'storage_attachment' },
      { id: 'e2', source: 'vol:a', target: 'vm:web01', kind: 'storage_attachment' },
    ]
    const g = neighboursOf('vm:web01', nodes, edges)
    expect(g.storage).toHaveLength(1)
    expect(g.storage[0].id).toBe('vol:a')
  })

  it('returns empty storage for a node with no storage edges', () => {
    const nodes = [node('vm:web01', 'vm'), node('host:esx1', 'host')]
    const edges: TopoEdge[] = [
      { id: 'e1', source: 'vm:web01', target: 'host:esx1', kind: 'hypervisor_host' },
    ]
    const g = neighboursOf('vm:web01', nodes, edges)
    expect(g.storage).toEqual([])
    expect(g.host.map((n) => n.id)).toEqual(['host:esx1'])
  })
})

describe('neighboursOf — other groups', () => {
  it('buckets host, network, backup and app neighbours', () => {
    const nodes = [
      node('vm:web01', 'vm'),
      node('host:esx1', 'hypervisor_host'),
      node('sw:1', 'network_device'),
      node('fw:1', 'firewall'),
      node('bk:1', 'backup_appliance'),
      node('app:billing', 'application'),
    ]
    const edges: TopoEdge[] = [
      { id: 'e1', source: 'vm:web01', target: 'host:esx1', kind: 'hypervisor_host' },
      { id: 'e2', source: 'vm:web01', target: 'sw:1', kind: 'network_port' },
      { id: 'e3', source: 'vm:web01', target: 'fw:1', kind: 'network_port' },
      { id: 'e4', source: 'vm:web01', target: 'bk:1', kind: 'backup_coverage' },
      { id: 'e5', source: 'app:billing', target: 'vm:web01', kind: 'app_membership' },
    ]
    const g = neighboursOf('vm:web01', nodes, edges)
    expect(g.host.map((n) => n.id)).toEqual(['host:esx1'])
    expect(g.network.map((n) => n.id)).toEqual(['sw:1', 'fw:1'])
    expect(g.backup.map((n) => n.id)).toEqual(['bk:1'])
    expect(g.app.map((n) => n.id)).toEqual(['app:billing'])
  })

  it('ignores self-loops and dangling edges into filtered-out nodes', () => {
    const nodes = [node('vm:web01', 'vm')]
    const edges: TopoEdge[] = [
      { id: 'e1', source: 'vm:web01', target: 'vm:web01', kind: 'x' }, // self
      { id: 'e2', source: 'vm:web01', target: 'gone:1', kind: 'storage_attachment' }, // dangling
    ]
    const g = neighboursOf('vm:web01', nodes, edges)
    expect(g.storage).toEqual([])
    expect(g.other).toEqual([])
  })

  it('returns all-empty groups for a null selection', () => {
    const g = neighboursOf(null, [node('a', 'vm')], [])
    expect(g.storage).toEqual([])
    expect(g.host).toEqual([])
    expect(g.network).toEqual([])
    expect(g.backup).toEqual([])
    expect(g.app).toEqual([])
    expect(g.other).toEqual([])
  })
})

describe('isStorageNeighbour', () => {
  it('true for storage_attachment kind regardless of node type', () => {
    expect(isStorageNeighbour('storage_attachment', { id: 'x', label: 'x', asset_type: 'vm' })).toBe(true)
  })
  it('true when the neighbour is a storage asset type', () => {
    expect(isStorageNeighbour('other', { id: 'x', label: 'x', asset_type: 'storage_volume' })).toBe(true)
    expect(isStorageNeighbour('other', { id: 'x', label: 'x', asset_type: 'storage_array' })).toBe(true)
  })
  it('false otherwise', () => {
    expect(isStorageNeighbour('network_port', { id: 'x', label: 'x', asset_type: 'host' })).toBe(false)
  })
})

describe('isAssetNode', () => {
  it('true for a real inventory asset id', () => {
    expect(isAssetNode(node('vm:web01', 'vm'))).toBe(true)
  })
  it('false for synthetic app / veeam nodes', () => {
    expect(isAssetNode(node('app:billing', 'application'))).toBe(false)
    expect(isAssetNode(node('synthetic:veeam', 'backup_appliance'))).toBe(false)
  })
  it('false for null', () => {
    expect(isAssetNode(null)).toBe(false)
  })
})
