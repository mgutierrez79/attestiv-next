// vCenter Server facts — what the vCenter connector reports about vCenter
// itself (attestiv-go internal/connectors/vcenter_server_facts.go): the
// product, version and build, and the plugins registered with it. The
// connector emits one asset of type virtualization_manager per vCenter;
// the asset page renders these facts in the vCenter Server card.

type Metadata = Record<string, unknown> | null | undefined

export type VCenterPlugin = {
  key: string
  label: string
  version: string
  company: string
  lastHeartbeat: string
  thirdParty: boolean
}

export type VCenterServerFacts = {
  productFullName: string
  productName: string
  version: string
  build: string
  patchLevel: string
  apiVersion: string
  instanceUuid: string
  managementAddress: string
  extensionCount: number
  thirdPartyCount: number
  thirdPartyPlugins: VCenterPlugin[]
  builtInPlugins: VCenterPlugin[]
}

function text(metadata: Metadata, key: string): string {
  const value = metadata?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function count(metadata: Metadata, key: string): number {
  const value = metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function isVCenterServer(assetType: string | null | undefined): boolean {
  return (assetType ?? '').trim().toLowerCase() === 'virtualization_manager'
}

export function vcenterServerFacts(metadata: Metadata): VCenterServerFacts {
  const plugins: VCenterPlugin[] = []
  const raw = metadata?.extensions
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const row = item as Record<string, unknown>
      const key = typeof row.key === 'string' ? row.key.trim() : ''
      if (!key) continue
      const str = (k: string) => (typeof row[k] === 'string' ? (row[k] as string).trim() : '')
      plugins.push({
        key,
        label: str('label'),
        version: str('version'),
        company: str('company'),
        lastHeartbeat: str('last_heartbeat'),
        thirdParty: row.third_party === true,
      })
    }
  }
  const thirdPartyPlugins = plugins.filter((p) => p.thirdParty)
  const builtInPlugins = plugins.filter((p) => !p.thirdParty)
  return {
    productFullName: text(metadata, 'product_full_name'),
    productName: text(metadata, 'product_name'),
    version: text(metadata, 'software_version'),
    build: text(metadata, 'software_build'),
    patchLevel: text(metadata, 'software_patch_level'),
    apiVersion: text(metadata, 'api_version'),
    instanceUuid: text(metadata, 'instance_uuid'),
    managementAddress: text(metadata, 'management_address'),
    // The connector counts every extension even when the list it stamps
    // is capped; fall back to what arrived when the count is missing.
    extensionCount: count(metadata, 'extension_count') || plugins.length,
    thirdPartyCount: count(metadata, 'third_party_extension_count') || thirdPartyPlugins.length,
    thirdPartyPlugins,
    builtInPlugins,
  }
}

// hasVCenterServerFacts decides whether the card has anything to show: a
// version, or at least one plugin. An older record without facts shows no
// empty card.
export function hasVCenterServerFacts(facts: VCenterServerFacts): boolean {
  return Boolean(facts.version || facts.productFullName) || facts.thirdPartyPlugins.length + facts.builtInPlugins.length > 0
}
