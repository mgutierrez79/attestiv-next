'use client'

// NetworkDeviceDetails renders the rich data we already collect for
// switches / routers: hardware + software metadata from the
// Catalyst Center / RESTCONF inventory pulls, plus a derived view
// of every link bundle that touches this device — port-channels,
// host trunks, intersite links — with neighbor names and counts.
//
// The metadata layout varies by connector source (dnac vs restconf
// vs panorama for firewall_manager), so we accept candidates per
// field rather than hard-coding a single key.

import { Badge, Card, CardTitle } from '../components/AttestivUi'
import { useI18n } from '../lib/i18n'

type InventoryAsset = {
  asset_id: string
  name?: string | null
  asset_type?: string | null
  datacenter_id?: string | null
  criticality?: string | null
  tags?: string[]
  metadata?: Record<string, unknown>
}

export function NetworkDeviceDetails({
  asset,
  relatedLinks,
}: {
  asset: InventoryAsset
  relatedLinks: InventoryAsset[]
}) {
  const { t } = useI18n()
  const metadata = asset.metadata ?? {}
  const raw = (metadata['raw'] as Record<string, unknown> | undefined) ?? {}

  // Pull every field from the connector source, falling back across
  // candidate keys. dnacAsset sets platform/software_version/serial/
  // family/role/management_ip; restconf uses platform_id, serial-
  // number, software-version, etc.
  const pickStr = (...keys: string[]): string => {
    for (const k of keys) {
      const v = metadata[k] ?? raw[k]
      if (typeof v === 'string' && v.trim() !== '') return v.trim()
      if (typeof v === 'number') return String(v)
    }
    return ''
  }
  const platform = pickStr('platform', 'platform_id', 'platformId', 'model')
  // 'sw-version' / 'software-version' are the Panorama (Palo Alto firewall)
  // spellings; 'esxi_version' / 'build' / 'full_name' cover vCenter hosts;
  // the camelCase / underscore variants cover DNAC / RESTCONF.
  const software = pickStr('software_version', 'softwareVersion', 'software-version', 'sw-version', 'esxi_version', 'esx_version', 'build', 'full_name', 'osVersion', 'iosXeVersion', 'version')
  // 'service_tag' is the Dell OpenManage serial cross-referenced onto the
  // ESXi host when its hardware record merges in.
  const serial = pickStr('serial', 'serialNumber', 'serial_number', 'serial-number', 'service_tag')
  const family = pickStr('family', 'product_family')
  // 'manufacturer' (Dell OME) / 'vendor' for the hardware vendor.
  const vendor = pickStr('manufacturer', 'vendor')
  const role = pickStr('role', 'deviceRole', 'roleSource')
  // 'ip-address' is the Panorama management-IP key; 'management_address'
  // is the PowerStore/host-enricher key.
  const mgmtIP = pickStr('management_ip', 'managementIpAddress', 'mgmt_ip', 'management_address', 'ip-address', 'ip_address', 'ip')
  const hostname = pickStr('hostname', 'name', 'displayName')
  // 'ha-state' is the Panorama HA role (active / passive); the others cover
  // Catalyst Center redundancy state.
  const haState = pickStr('ha-state', 'ha_state', 'haState', 'redundancyState', 'redundancy_state')
  // Hardware health for physical hosts (Dell OpenManage / Redfish): normal
  // / warning / critical.
  const health = pickStr('health', 'health_state', 'hardware_health')
  const power = pickStr('power_state', 'powerState')
  const cluster = pickStr('cluster_id', 'cluster')
  const connected = pickStr('connected')
  const uptime = pickStr('uptime', 'upTime', 'lastReachableUptime')
  const reachability = pickStr('reachability', 'reachabilityStatus', 'connection_status', 'reachabilityFailureReason')
  const collectionStatus = pickStr('collectionStatus', 'collection_status')

  const healthTone = (h: string): 'green' | 'amber' | 'red' | 'gray' => {
    const v = h.toLowerCase()
    if (['normal', 'ok', 'healthy', 'green', 'good'].some((s) => v.includes(s))) return 'green'
    if (['warning', 'degraded', 'amber', 'yellow'].some((s) => v.includes(s))) return 'amber'
    if (['critical', 'error', 'fail', 'red'].some((s) => v.includes(s))) return 'red'
    return 'gray'
  }
  // Posture badge in the card title: HA role for firewalls, hardware health
  // for hosts.
  const postureBadge = haState
    ? <Badge tone={haState.toLowerCase().includes('active') ? 'green' : 'amber'}>{haState}</Badge>
    : health
      ? <Badge tone={healthTone(health)}>{health}</Badge>
      : undefined

  // Firewall LLDP/CDP switch adjacency (metadata.switch_connections,
  // attached server-side from the device_link network_adjacency rows) and
  // the per-interface inventory (metadata.interfaces, stamped by the
  // Panorama connector). Both arrays of plain objects; tolerate absence.
  const switchConnections = Array.isArray(metadata['switch_connections'])
    ? (metadata['switch_connections'] as Array<Record<string, unknown>>)
    : []
  const interfaces = Array.isArray(metadata['interfaces'])
    ? (metadata['interfaces'] as Array<Record<string, unknown>>)
    : []

  // Bundle related links by classification so we can show "5 host
  // trunks, 2 port-channels, 1 intersite link" plus per-category
  // neighbor lists.
  type Bucket = { type: string; links: InventoryAsset[] }
  const byType = new Map<string, Bucket>()
  for (const link of relatedLinks) {
    const label = String(link.metadata?.['link_type_label'] ?? '').trim() || 'Other'
    const existing = byType.get(label)
    if (existing) existing.links.push(link)
    else byType.set(label, { type: label, links: [link] })
  }
  const buckets = Array.from(byType.values()).sort((a, b) => b.links.length - a.links.length)

  // Neighbor names: for each related link, the OTHER endpoint
  // (whichever endpoint isn't this device).
  const neighbors: Array<{ name: string; site: string; linkType: string; linkID: string }> = []
  const idLower = String(asset.asset_id ?? '').toLowerCase()
  const nameLower = String(asset.name ?? '').toLowerCase()
  for (const link of relatedLinks) {
    const endpoints = Array.isArray(link.metadata?.['endpoints'])
      ? (link.metadata!['endpoints'] as Array<Record<string, unknown>>)
      : []
    for (const ep of endpoints) {
      const epID = String(ep['asset_id'] ?? '').toLowerCase()
      const epLabel = String(ep['label'] ?? '').toLowerCase()
      if (epID === idLower || (nameLower && epLabel === nameLower)) continue
      neighbors.push({
        name: String(ep['label'] ?? ep['asset_id'] ?? '—'),
        site: String(ep['site'] ?? ''),
        linkType: String(link.metadata?.['link_type_label'] ?? ''),
        linkID: link.asset_id,
      })
    }
  }
  // Deduplicate by neighbor name (a switch may have many port-channel
  // members back to the same peer — count once in the list).
  const neighborsSeen = new Set<string>()
  const uniqueNeighbors = neighbors.filter((n) => {
    const key = n.name.toLowerCase()
    if (neighborsSeen.has(key)) return false
    neighborsSeen.add(key)
    return true
  })

  return (
    <>
      <Card>
        <CardTitle right={postureBadge}>
          {t('Device', 'Device')}
        </CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 8 }}>
          {hostname && <DeviceStat label={t('Hostname', 'Hostname')} value={hostname} mono />}
          {vendor && <DeviceStat label={t('Vendor', 'Vendor')} value={vendor} />}
          {platform && <DeviceStat label={t('Model', 'Model')} value={platform} mono />}
          {family && <DeviceStat label={t('Family', 'Family')} value={family} />}
          {software && <DeviceStat label={t('Software', 'Software')} value={software} mono />}
          {serial && <DeviceStat label={t('Serial', 'Serial')} value={serial} mono />}
          {role && <DeviceStat label={t('HA role', 'HA role')} value={role} />}
          {power && <DeviceStat label={t('Power', 'Power')} value={power} />}
          {mgmtIP && <DeviceStat label={t('Management IP', 'Management IP')} value={mgmtIP} mono />}
          {cluster && <DeviceStat label={t('HA cluster', 'HA cluster')} value={cluster} mono />}
          {connected && <DeviceStat label={t('Connected', 'Connected')} value={connected} />}
          {uptime && <DeviceStat label={t('Uptime', 'Uptime')} value={uptime} />}
          {reachability && <DeviceStat label={t('Reachability', 'Reachability')} value={reachability} />}
          {collectionStatus && <DeviceStat label={t('Collection', 'Collection')} value={collectionStatus} />}
        </div>
      </Card>

      {switchConnections.length > 0 && (
        <Card>
          <CardTitle right={<Badge tone="navy">{switchConnections.length}</Badge>}>
            {t('Switch connectivity', 'Switch connectivity')}
          </CardTitle>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            {t(
              'LLDP/CDP neighbours — which local interface reaches which switch port (cross-referenced from the network connectors).',
              'LLDP/CDP neighbours — which local interface reaches which switch port (cross-referenced from the network connectors).',
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginTop: 8 }}>
            {switchConnections.slice(0, 48).map((c, i) => {
              const local = String(c['local_interface'] ?? '—')
              const peer = String(c['peer_device'] ?? '—')
              const peerIface = String(c['peer_interface'] ?? '')
              const discovery = String(c['discovery'] ?? '').replace(/_/g, ' ')
              const vlan = String(c['vlan'] ?? '')
              return (
                <div
                  key={`${local}-${peer}-${peerIface}-${i}`}
                  style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 6, padding: '8px 10px', fontSize: 12 }}
                >
                  <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{local}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    → <span style={{ fontWeight: 500 }}>{peer}</span>
                    {peerIface && <span style={{ fontFamily: 'var(--font-mono)' }}> : {peerIface}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                    {vlan && <span>VLAN {vlan}</span>}
                    {discovery && <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{vlan ? '· ' : ''}{discovery}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {interfaces.length > 0 && (
        <Card>
          <CardTitle right={<Badge tone="navy">{interfaces.length}</Badge>}>
            {t('Interfaces', 'Interfaces')}
          </CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8, marginTop: 8 }}>
            {interfaces.slice(0, 60).map((iface, i) => {
              const name = String(iface['name'] ?? '—')
              const zone = String(iface['zone'] ?? '')
              const ip = String(iface['ip'] ?? '')
              const vlanRaw = iface['vlan']
              const vlan = typeof vlanRaw === 'number' && vlanRaw > 0 ? String(vlanRaw) : ''
              const state = String(iface['state'] ?? '')
              return (
                <div
                  key={`${name}-${i}`}
                  style={{ border: '0.5px solid var(--color-border-tertiary)', borderRadius: 6, padding: '8px 10px', fontSize: 12 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{name}</span>
                    {state && (
                      <Badge tone={state.toLowerCase() === 'up' ? 'green' : 'gray'}>{state}</Badge>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 3 }}>
                    {zone && <span>{t('zone', 'zone')} {zone}</span>}
                    {vlan && <span>· VLAN {vlan}</span>}
                    {ip && <span style={{ fontFamily: 'var(--font-mono)' }}>· {ip}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      <Card>
        <CardTitle right={<Badge tone="navy">{relatedLinks.length}</Badge>}>
          {t('Connectivity', 'Connectivity')}
        </CardTitle>
        {relatedLinks.length === 0 ? (
          <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {t(
              'No link bundles reference this device yet. Catalyst Center /topology + per-device CDP/LLDP populate this.',
              'No link bundles reference this device yet. Catalyst Center /topology + per-device CDP/LLDP populate this.',
            )}
          </span>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {buckets.map((b) => (
                <span
                  key={b.type}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 12,
                    background: 'var(--color-surface-secondary)',
                    fontSize: 12,
                  }}
                >
                  <strong>{b.links.length}</strong>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{b.type.replace(/_/g, ' ')}</span>
                </span>
              ))}
            </div>
            {uniqueNeighbors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                  {t('Neighbors', 'Neighbors')} ({uniqueNeighbors.length})
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
                  {uniqueNeighbors.slice(0, 24).map((n) => (
                    <a
                      key={n.linkID + n.name}
                      href={`/inventory/${encodeURIComponent(n.linkID)}`}
                      style={{
                        textDecoration: 'none',
                        color: 'var(--color-text-primary)',
                        border: '0.5px solid var(--color-border-tertiary)',
                        borderRadius: 6,
                        padding: '8px 10px',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ fontWeight: 500 }}>{n.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
                        {n.linkType && <span>{n.linkType.replace(/_/g, ' ')}</span>}
                        {n.site && <span>· {n.site}</span>}
                      </div>
                    </a>
                  ))}
                </div>
                {uniqueNeighbors.length > 24 && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
                    {t('+ {n} more — see Inventory → Network', '+ {n} more — see Inventory → Network', { n: uniqueNeighbors.length - 24 })}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Card>

      {Object.keys(raw).length > 0 && (
        <Card>
          <CardTitle>{t('Connector source data', 'Connector source data')}</CardTitle>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            {t(
              'Raw record from the connector — surfaces fields the structured view above does not yet display.',
              'Raw record from the connector — surfaces fields the structured view above does not yet display.',
            )}
          </div>
          <pre
            style={{
              marginTop: 8,
              padding: 10,
              background: 'var(--color-surface-secondary)',
              borderRadius: 6,
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              maxHeight: 280,
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            {JSON.stringify(raw, null, 2)}
          </pre>
        </Card>
      )}
    </>
  )
}

function DeviceStat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : undefined }}>{value}</span>
    </div>
  )
}
