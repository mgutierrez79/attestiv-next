'use client';
// Per-asset detail / compliance contribution view.
//
// Operator lands here from the inventory page. Shows:
//   1. Asset header (name, type, source, scope flag)
//   2. Parent application (if any registered)
//   3. Per-VM compliance contribution — framework scores computed
//      against ONLY this asset's evidence pool (vm scope)
//
// Surfaces the auditor-attribution question: "this finding involves
// THIS specific VM — what controls is it touching, and which fail?"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  Select,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { ipSourceTag } from '../lib/ipSource'
import { displayableMetaString } from '../lib/displayMeta'
import { NetworkDeviceDetails } from './NetworkDeviceDetails'
import { HealthChips, ConnectorProvenance } from '../components/AssetConnectorDetail'

type InventoryAsset = {
  asset_id: string
  name?: string | null
  asset_type?: string | null
  datacenter_id?: string | null
  criticality?: string | null
  application_id?: string | null
  provider_id?: string | null
  framework_evaluation_enabled?: boolean
  tags?: string[]
  // present_in is set by the backend detail handler (attachPresentIn) —
  // the union of connectors whose latest poll observed this asset.
  // Powers the "Observed by" provenance panel.
  present_in?: string[]
  external_refs?: Array<{ source?: string }>
  metadata?: Record<string, unknown>
}

type AppSummary = {
  application_id: string
  display_name: string
  criticality_tier?: string
  gxp?: { validated?: boolean }
  components?: Array<{ vm_name?: string }>
  dependencies?: Array<{ application_id?: string; dependency_type?: string; criticality?: string }>
}

type DependentApp = {
  application_id: string
  display_name?: string
  dependency_type?: string
  criticality?: string
}

type DependencyItem = {
  id: string
  name: string
  asset_type: string
  site?: string
}

type DependencyGroup = {
  key: string
  label: string
  items: DependencyItem[]
}

type GuestInfo = {
  os_name?: string
  os_full_name?: string
  os_family?: string
  hostname?: string
  primary_ip?: string
  ip_addresses?: string[]
  mac_addresses?: string[]
  power_state?: any
  dns?: { servers?: string[]; search_domains?: string[] }
}

type HardwareInfo = {
  cpu?: { count?: number; cores_per_socket?: number; hot_add_enabled?: boolean }
  memory?: { size_MiB?: number; hot_add_enabled?: boolean }
  disks?: Array<{ capacity?: number; backing?: { datastore?: string } }>
  datastores?: string[]
}

type LastBackup = {
  observed_at?: string
  status?: string
  job_name?: string
  source?: string
  days_since?: number
}

type Replication = {
  state?: string
  mode?: string
  role?: string
  volume?: string
  last_sync?: string
  source?: string
}

type LastRestore = {
  observed_at?: string
  status?: string
  restore_type?: string
  source?: string
  days_since?: number
}

type FrameworkSummary = {
  framework_id: string
  framework_name?: string
  score: number
  status: string
  total_controls: number
  passing_controls: number
  review_controls: number
  warn_controls: number
  fail_controls: number
}

type ScopeResult = {
  members_in_scope: number
  evidence_count: number
  frameworks_evaluated: number
  results: FrameworkSummary[]
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'gray'> = {
  PASS: 'green',
  REVIEW: 'amber',
  WARN: 'amber',
  FAIL: 'red',
}

export function AttestivAssetDetailPage({ assetID }: { assetID: string }) {
  const { t } = useI18n()
  const [asset, setAsset] = useState<InventoryAsset | null>(null)
  const [parentApp, setParentApp] = useState<AppSummary | null>(null)
  const [dependents, setDependents] = useState<DependentApp[]>([])
  const [scopeResult, setScopeResult] = useState<ScopeResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [evaluating, setEvaluating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // ICT provider attribution: the operator links this asset to a provider in
  // the DORA Art.28 register (POST /v1/inventory/provider-attribution).
  const [providers, setProviders] = useState<Array<{ id: string; provider_name: string }>>([])
  const [providerSaving, setProviderSaving] = useState(false)
  const [providerError, setProviderError] = useState<string | null>(null)
  // network_link enrichment: resolve each endpoint's friendly name +
  // type by fetching the inventory asset, and resolve each child
  // member by following metadata.member_asset_ids. Avoids the
  // "you're looking at link::host-1017::… but who/what is that?"
  // problem when the operator drills in from the inventory list.
  const [endpointAssets, setEndpointAssets] = useState<Record<string, InventoryAsset>>({})
  const [memberAssets, setMemberAssets] = useState<InventoryAsset[]>([])
  // network_device enrichment: every parent network_link that
  // references this device in metadata.endpoints. Lets the detail
  // page show how many port-channels, host trunks, and intersite
  // links touch this switch, plus the friendly names of every
  // connected non-switch host.
  const [relatedLinks, setRelatedLinks] = useState<InventoryAsset[]>([])
  // Hypervisor-host enrichment, derived on the detail page (no new
  // collection): the friendly cluster name resolved from the host's
  // vcenter_cluster MoRef, and the count of VMs that ride this host.
  const [hostClusterName, setHostClusterName] = useState<string | null>(null)
  const [hostedVMCount, setHostedVMCount] = useState<number | null>(null)
  // Upstream dependencies — the infrastructure this asset rides on (host,
  // storage, network, firewall), grouped by category. Populated from
  // /inventory/assets/{id}/dependencies for every asset type.
  const [dependencies, setDependencies] = useState<DependencyGroup[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setHostClusterName(null)
      setHostedVMCount(null)
      setDependencies([])
      try {
        const response = await apiFetch(`/inventory/assets/${encodeURIComponent(assetID)}`)
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        const body = await response.json().catch(() => ({}))
        if (cancelled) return
        setAsset(body as InventoryAsset)
        // Find parent app by checking each registered app's components
        // for a vm_name match. The /v1/apps list is small (1-10 apps)
        // so client-side search is fine.
        try {
          const appsResp = await apiFetch('/apps')
          const appsBody = await appsResp.json().catch(() => ({}))
          if (!cancelled && Array.isArray(appsBody?.items)) {
            const name = String(body.name ?? '').toLowerCase()
            const id = String(body.asset_id ?? '').toLowerCase()
            // Each app summary from /v1/apps is shallow — we need
            // dependencies + components, which only come back from
            // the detail endpoint. Fetch detail in parallel for any
            // app that might be relevant (the parent + any potential
            // dependents). Pilot has at most a handful of apps so
            // the fan-out is bounded.
            const apps = appsBody.items as AppSummary[]
            const details = await Promise.all(
              apps.map((a) =>
                apiFetch(`/apps/${encodeURIComponent(a.application_id)}`)
                  .then((r) => r.ok ? r.json() : null)
                  .catch(() => null),
              ),
            )
            const fullApps: AppSummary[] = details
              .filter((d): d is AppSummary => d && typeof d === 'object' && 'application_id' in d)
            const parent = fullApps.find((app) =>
              (app.components ?? []).some((c) => {
                const cn = String(c.vm_name ?? '').toLowerCase()
                return cn === name || cn === id
              }),
            ) ?? null
            setParentApp(parent)
            // Dependent apps: any other app whose dependencies list
            // references the parent app. Surfaces blast-radius — if
            // this VM goes down, what else fails?
            if (parent) {
              const deps = fullApps
                .filter((a) => a.application_id !== parent.application_id)
                .filter((a) => (a.dependencies ?? []).some((d) => d.application_id === parent.application_id))
                .map<DependentApp>((a) => {
                  const link = (a.dependencies ?? []).find((d) => d.application_id === parent.application_id)
                  return {
                    application_id: a.application_id,
                    display_name: a.display_name,
                    dependency_type: link?.dependency_type,
                    criticality: link?.criticality,
                  }
                })
              setDependents(deps)
            } else {
              setDependents([])
            }
          }
        } catch {
          // Apps unreachable / no apps registered — fine.
        }
        // network_device enrichment — pull every parent network_link
        // that references this device so the detail page can render
        // counts + neighbor lists without operator hunting.
        if (
          (body as InventoryAsset).asset_type === 'network_device' ||
          (body as InventoryAsset).asset_type === 'switch' ||
          (body as InventoryAsset).asset_type === 'router'
        ) {
          try {
            const linksResp = await apiFetch('/inventory/assets?asset_type=network_link&limit=2000')
            if (linksResp.ok) {
              const linksBody = await linksResp.json()
              const items = Array.isArray(linksBody?.items) ? (linksBody.items as InventoryAsset[]) : []
              const idLower = String((body as InventoryAsset).asset_id ?? '').toLowerCase()
              const nameLower = String((body as InventoryAsset).name ?? '').toLowerCase()
              const matches = items.filter((link) => {
                const endpoints = Array.isArray(link.metadata?.['endpoints'])
                  ? (link.metadata!['endpoints'] as Array<Record<string, unknown>>)
                  : []
                return endpoints.some((ep) => {
                  const epID = String(ep['asset_id'] ?? '').toLowerCase()
                  const epLabel = String(ep['label'] ?? '').toLowerCase()
                  return epID === idLower || (nameLower && epLabel === nameLower)
                })
              })
              if (!cancelled) setRelatedLinks(matches)
            }
          } catch {
            // Related links missing isn't fatal — fall back to bare detail.
          }
        }
        // network_link enrichment — resolve endpoints + members so
        // the operator sees friendly names + cross-source context
        // instead of bare asset_ids.
        if ((body as InventoryAsset).asset_type === 'network_link') {
          const metadata = (body as InventoryAsset).metadata ?? {}
          const endpoints = Array.isArray(metadata['endpoints']) ? metadata['endpoints'] as Array<Record<string, unknown>> : []
          const memberIDs = Array.isArray(metadata['member_asset_ids']) ? metadata['member_asset_ids'] as string[] : []
          // Endpoints: try to fetch each asset_id; failures are silently
          // dropped (endpoint might not be in inventory yet).
          const epIDs = endpoints
            .map((e) => String(e['asset_id'] ?? '').trim())
            .filter(Boolean)
          if (epIDs.length > 0) {
            const epResults = await Promise.all(
              epIDs.map((id) =>
                apiFetch(`/inventory/assets/${encodeURIComponent(id)}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .catch(() => null),
              ),
            )
            if (!cancelled) {
              const map: Record<string, InventoryAsset> = {}
              epResults.forEach((r, i) => {
                if (r && typeof r === 'object') {
                  map[epIDs[i]] = r as InventoryAsset
                }
              })
              setEndpointAssets(map)
            }
          }
          // Members: fetch in parallel (typical bundle has 2-4).
          if (memberIDs.length > 0 && memberIDs.length <= 20) {
            const memResults = await Promise.all(
              memberIDs.map((id) =>
                apiFetch(`/inventory/assets/${encodeURIComponent(id)}`)
                  .then((r) => (r.ok ? r.json() : null))
                  .catch(() => null),
              ),
            )
            if (!cancelled) {
              const list: InventoryAsset[] = []
              memResults.forEach((r) => {
                if (r && typeof r === 'object') {
                  list.push(r as InventoryAsset)
                }
              })
              setMemberAssets(list)
            }
          }
        }
        // hypervisor-host enrichment — resolve the vcenter_cluster MoRef
        // (e.g. "domain-c14059") to its friendly cluster name and count
        // the VMs riding this host, so the host card shows real context
        // instead of a raw MoRef. Both are best-effort; failure leaves
        // the card showing what it already has.
        const bodyType = String((body as InventoryAsset).asset_type ?? '').toLowerCase()
        if (bodyType === 'host' || bodyType === 'hypervisor_host') {
          const hostMeta = (body as InventoryAsset).metadata ?? {}
          const clusterRef = String(hostMeta['vcenter_cluster'] ?? '').trim()
          const hostMoRef = String((body as InventoryAsset).asset_id ?? '').trim().toLowerCase()
          try {
            const [clusterRes, vmsRes] = await Promise.all([
              clusterRef
                ? apiFetch(`/inventory/assets/${encodeURIComponent(clusterRef)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null)
                : Promise.resolve(null),
              apiFetch('/inventory/assets?asset_type=vm&limit=5000').then((r) => (r.ok ? r.json() : null)).catch(() => null),
            ])
            if (!cancelled) {
              const clusterName = String((clusterRes as InventoryAsset | null)?.name ?? '').trim()
              // Only adopt a resolved name that's friendlier than the MoRef.
              if (clusterName && clusterName.toLowerCase() !== clusterRef.toLowerCase()) {
                setHostClusterName(clusterName)
              }
              const vmItems = Array.isArray((vmsRes as any)?.items) ? ((vmsRes as any).items as InventoryAsset[]) : []
              if (vmItems.length > 0 && hostMoRef) {
                const count = vmItems.filter(
                  (vm) => String(vm.metadata?.['vcenter_host'] ?? '').trim().toLowerCase() === hostMoRef,
                ).length
                setHostedVMCount(count)
              }
            }
          } catch {
            // Enrichment is additive — a failure just omits the rows.
          }
        }
        // Upstream dependencies — the infrastructure this asset rides on,
        // resolved from the cross-source topology graph. Works for every
        // asset type; an unwired asset comes back empty (card hides).
        try {
          const depRes = await apiFetch(`/inventory/assets/${encodeURIComponent(assetID)}/dependencies`)
          if (depRes.ok) {
            const depBody = await depRes.json()
            const groups = Array.isArray(depBody?.categories) ? (depBody.categories as DependencyGroup[]) : []
            if (!cancelled) setDependencies(groups)
          }
        } catch {
          // Dependencies are additive — a failure just hides the card.
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load asset')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [assetID])

  // Load the Art.28 third-party register once for the provider picker.
  useEffect(() => {
    let cancelled = false
    apiFetch('/third-parties')
      .then((r) => (r.ok ? r.json() : []))
      .then((body) => {
        if (cancelled) return
        const list: any[] = Array.isArray(body) ? body : (body?.items ?? body?.providers ?? [])
        setProviders(
          list
            .map((p) => ({ id: String(p?.id ?? ''), provider_name: String(p?.provider_name ?? p?.id ?? '') }))
            .filter((p) => p.id),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function saveProvider(providerId: string) {
    if (!asset) return
    setProviderSaving(true)
    setProviderError(null)
    try {
      const response = await apiFetch('/inventory/provider-attribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_ids: [asset.asset_id], provider_id: providerId }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
      }
      setAsset({ ...asset, provider_id: providerId || null })
    } catch (err: any) {
      setProviderError(err?.message ?? 'Save failed')
    } finally {
      setProviderSaving(false)
    }
  }

  async function evaluateScope() {
    if (!asset) return
    setEvaluating(true)
    setError(null)
    try {
      const response = await apiFetch('/scoring/evaluate-scope', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope_type: 'vm', scope_id: asset.asset_id }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
      }
      setScopeResult(body as ScopeResult)
    } catch (err: any) {
      setError(err?.message ?? 'Evaluation failed')
    } finally {
      setEvaluating(false)
    }
  }

  const sortedResults = useMemo(() => {
    if (!scopeResult?.results) return []
    return [...scopeResult.results].sort((a, b) => a.framework_id.localeCompare(b.framework_id))
  }, [scopeResult])

  const guest = (asset?.metadata?.['guest'] as GuestInfo | undefined) ?? undefined
  const hardware = (asset?.metadata?.['hardware'] as HardwareInfo | undefined) ?? undefined
  // power_state is meant to be a word ("on"/"off"); a bare enum code (e.g. "17")
  // or a leaked structured value is junk — sanitize so the field omits instead.
  const powerState = displayableMetaString(asset?.metadata?.['power_state'], { digitsAreJunk: true })
  const vcenterHost = String(asset?.metadata?.['vcenter_host'] ?? '')
  const vcenterCluster = String(asset?.metadata?.['vcenter_cluster'] ?? '')
  // Whether this asset is a VM, so VM-specific wording (and the VM-details card)
  // only show for VMs — not firewalls / network devices / storage. Note
  // metadata.hardware is reused by non-VM assets (e.g. firewall environmentals),
  // so the VM-details gate checks for actual VM hardware/guest fields, not just
  // the presence of a hardware object.
  const isVM =
    ['vm', 'virtual_machine'].includes(String(asset?.asset_type ?? '').toLowerCase()) ||
    Boolean(guest) ||
    Boolean(vcenterHost) ||
    Boolean(hardware?.cpu) ||
    Boolean(hardware?.memory)
  const hasVMDetails =
    Boolean(guest) ||
    Boolean(powerState) ||
    Boolean(vcenterHost) ||
    Boolean(hardware?.cpu) ||
    Boolean(hardware?.memory) ||
    Boolean(hardware?.disks && hardware.disks.length > 0)
  const lastBackup = (asset?.metadata?.['last_backup'] as LastBackup | undefined) ?? undefined
  const replication = (asset?.metadata?.['replication'] as Replication | undefined) ?? undefined
  const lastRestore = (asset?.metadata?.['last_restore'] as LastRestore | undefined) ?? undefined
  // Cross-connector correlation surfaced by the inventory detail API:
  // EDR posture (SentinelOne), switch ports (DNAC), backing SAN volumes
  // (PowerStore). All optional — only render the card when present.
  const edr = (asset?.metadata?.['edr'] as
    | { installed?: boolean; source?: string; agent_version?: string; health?: string; active?: boolean; infected?: boolean; threats?: number; max_threat_severity?: string; last_active?: string }
    | undefined) ?? undefined
  const networkPorts = (asset?.metadata?.['network_ports'] as
    | Array<{ switch?: string; interface?: string; vlan?: string; auth_method?: string; sub_type?: string; site_id?: string }>
    | undefined) ?? undefined
  const storageVolumes = (asset?.metadata?.['storage_volumes'] as
    | Array<{ volume?: string; wwn?: string; replicated?: boolean; mode?: string; role?: string; last_sync?: string }>
    | undefined) ?? undefined
  // Storage-array network identity + headline capacity, stamped by the
  // PowerStore connector onto the array's own metadata (not under a guest).
  const arrayIPs = (asset?.metadata?.['ip_addresses'] as string[] | undefined) ?? undefined
  const topVolumes = (asset?.metadata?.['top_volumes'] as
    | Array<{ name?: string; size?: string; size_bytes?: number; replicated?: boolean; replication_mode?: string }>
    | undefined) ?? undefined
  const volumeCount = (asset?.metadata?.['volume_count'] as number | undefined) ?? undefined
  // LLDP uplinks: which switch + port each array NIC is cabled to, reported
  // by the array itself (independent of DNAC's switch-port MAC table).
  const arrayUplinks = (asset?.metadata?.['uplinks'] as
    | Array<{ interface?: string; switch?: string; switch_port?: string; remote_mac?: string; vlan?: string; local_mac?: string }>
    | undefined) ?? undefined
  // Storage array management endpoint + space utilisation. The array carries
  // many data-path IPs/MACs (iSCSI/NVMe targets per node) that aren't useful
  // here — surface only the management address. Capacity (total/used) +
  // data-reduction come from the PowerStore space-metrics enrichment.
  const arrayMgmtIP = String(asset?.metadata?.['management_address'] ?? '').trim()
  const capacityTotal = Number(asset?.metadata?.['capacity_total_bytes'] ?? 0)
  const capacityUsed = Number(asset?.metadata?.['capacity_used_bytes'] ?? 0)
  const dataReduction = Number(asset?.metadata?.['data_reduction_ratio'] ?? 0)
  const hasCapacity = capacityTotal > 0
  const usedPct = hasCapacity ? Math.min(100, Math.round((capacityUsed / capacityTotal) * 100)) : 0

  // Physical host / server enrichment, stamped onto the asset's own
  // metadata (Dell OpenManage hardware + a parallel host-metadata pass).
  // All fields are optional — render each row only when present, and
  // never under the VM-details card (a server is not a VM guest).
  const manufacturer = String(asset?.metadata?.['manufacturer'] ?? '')
  const model = String(asset?.metadata?.['model'] ?? '')
  const serviceTag = String(asset?.metadata?.['service_tag'] ?? '')
  // health is meant to be a word ("normal"/"degraded"); a bare code or a leaked
  // array/object (seen in pilot as "[1 2 3 …]") is junk — sanitize it away.
  const health = displayableMetaString(asset?.metadata?.['health'], { digitsAreJunk: true })
  // OS string: prefer the generic metadata.os, then PowerStore's
  // os_type_l10n / os_type fallbacks.
  const hostOS = String(
    asset?.metadata?.['os'] ??
      asset?.metadata?.['os_type_l10n'] ??
      asset?.metadata?.['os_type'] ??
      '',
  )
  // metadata.ip_addresses is shared with the storage-array card (arrayIPs);
  // reuse the same parsed list for the server-details IP rows.
  const hostIPs = arrayIPs
  // metadata.ip_sources records the provenance of each host IP:
  // { "<ip>": "connector" | "ad_dns" | "dns_lookup" }. Optional — older
  // assets won't have it. DNS-sourced IPs get a muted "DNS" badge in the
  // Server-details IP list (see ipSourceTag); connector-sourced or
  // unmapped IPs get none.
  const ipSources = (asset?.metadata?.['ip_sources'] as Record<string, string> | undefined) ?? undefined
  // Gate the Server-details card to a NON-VM physical host: an explicit
  // server/host asset_type, OR a box stamped with manufacturer/service_tag
  // that is not a vCenter VM (no metadata.guest, not VM-shaped).
  const assetTypeLower = String(asset?.asset_type ?? '').toLowerCase()
  // A vCenter-collected ESXi hypervisor host: asset_type host/hypervisor_host
  // carrying a vcenter_cluster. These get a dedicated Hypervisor-host card
  // (cluster, connection, hosted VMs) rather than the VM-details card (they
  // aren't VMs) or the Server-details card (which targets Dell/physical
  // boxes with manufacturer/model/service-tag). A bare physical host with no
  // vcenter_cluster still flows to the Server-details path below.
  const isHypervisorHost =
    !isVM &&
    ['host', 'hypervisor_host'].includes(assetTypeLower) &&
    Boolean(vcenterCluster)
  // connection_state is meant to be a word ("CONNECTED"/"DISCONNECTED"); a
  // bare code or leaked structure is junk — sanitize so the field omits.
  const connectionState = displayableMetaString(asset?.metadata?.['connection_state'], { digitsAreJunk: true })
  // Friendly cluster name resolved from the MoRef (hostClusterName), falling
  // back to the raw vcenter_cluster MoRef when the cluster asset wasn't found.
  const clusterDisplay = hostClusterName ?? (vcenterCluster || '')
  const isPhysicalHost =
    !isVM &&
    !isHypervisorHost &&
    (['server', 'host', 'hypervisor_host'].includes(assetTypeLower) ||
      ((Boolean(manufacturer) || Boolean(serviceTag)) && !guest))
  const hasServerDetails =
    isPhysicalHost &&
    (Boolean(hostOS) ||
      (hostIPs && hostIPs.length > 0) ||
      Boolean(manufacturer) ||
      Boolean(model) ||
      Boolean(serviceTag) ||
      Boolean(powerState) ||
      Boolean(health))

  return (
    <>
      <Topbar title={asset?.name ?? assetID} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '0 0 24px' }}>
        <nav aria-label={t('Breadcrumb', 'Breadcrumb')} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--color-text-tertiary)', flexWrap: 'wrap' }}>
          <Link href="/inventory" style={{ color: 'var(--color-status-blue-deep)', textDecoration: 'none' }}>
            {t('Inventory', 'Inventory')}
          </Link>
          {asset?.asset_type ? (
            <>
              <i className="ti ti-chevron-right" aria-hidden="true" style={{ fontSize: 12 }} />
              <a
                href={`/inventory?asset_type=${encodeURIComponent(String(asset.asset_type).toLowerCase())}`}
                style={{ color: 'var(--color-status-blue-deep)', textDecoration: 'none' }}
              >
                {asset.asset_type}
              </a>
            </>
          ) : null}
          <i className="ti ti-chevron-right" aria-hidden="true" style={{ fontSize: 12 }} />
          <span style={{ color: 'var(--color-text-secondary)' }}>{asset?.name ?? assetID}</span>
        </nav>
        {error && <Banner tone="error">{error}</Banner>}

        {loading ? (
          <Skeleton lines={4} height={36} />
        ) : !asset ? (
          <EmptyState
            icon="ti-database-off"
            title={t('Asset not found', 'Asset not found')}
            description={t('The asset id is unknown to the inventory store.', 'The asset id is unknown to the inventory store.')}
          />
        ) : (
          <>
            <Card>
              <CardTitle>{t('Asset', 'Asset')}</CardTitle>
              <div style={{ marginTop: 8 }}>
                <HealthChips asset={asset} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 12, fontSize: 13 }}>
                <Stat label={t('Asset id', 'Asset id')} value={asset.asset_id} mono />
                <Stat label={t('Type', 'Type')} value={asset.asset_type ?? '—'} />
                <Stat label={t('Datacenter', 'Datacenter')} value={asset.datacenter_id ?? '—'} />
                <Stat label={t('Criticality', 'Criticality')} value={asset.criticality ?? '—'} />
                <Stat
                  label={t('Scope', 'Scope')}
                  value={
                    asset.framework_evaluation_enabled === false
                      ? t('Out of scope', 'Out of scope')
                      : t('In scope', 'In scope')
                  }
                />
                <Stat
                  label={t('Source', 'Source')}
                  value={(asset.external_refs ?? []).map((r) => r.source).filter(Boolean).join(', ') || '—'}
                />
              </div>
            </Card>

            <Card>
              <CardTitle>{t('Observed by', 'Observed by')}</CardTitle>
              <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '4px 0 10px' }}>
                {t(
                  'Every connector that reported this physical asset, and the role each one observed it as. One host, correlated across sources.',
                  'Every connector that reported this physical asset, and the role each one observed it as. One host, correlated across sources.',
                )}
              </p>
              <ConnectorProvenance asset={asset} />
            </Card>

            {/* Inter-DC links carry per-cable carriers in the Members
                table below, so the link-level (whole-link) carrier control
                is hidden. This card stays for other assets as the
                Hosting/ICT provider attribution. */}
            {asset.asset_type !== 'network_link' ? (
            <Card>
              <CardTitle>
                {asset.asset_type === 'network_link'
                  ? t('Carrier', 'Carrier')
                  : t('Hosting / ICT provider', 'Hosting / ICT provider')}
              </CardTitle>
              <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                {asset.asset_type === 'network_link'
                  ? t(
                      'Carrier for this inter-DC link as a whole. For per-cable carriers — e.g. two cables on different carriers — set them in the Carrier column of the Members table below.',
                      'Carrier for this inter-DC link as a whole. For per-cable carriers — e.g. two cables on different carriers — set them in the Carrier column of the Members table below.',
                    )
                  : t(
                      'Link this asset to an ICT third-party provider in the DORA Art.28 register — its hosting/cloud provider. Feeds the provider dependency map and the Art.29 hosting-concentration control.',
                      'Link this asset to an ICT third-party provider in the DORA Art.28 register — its hosting/cloud provider. Feeds the provider dependency map and the Art.29 hosting-concentration control.',
                    )}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                <Select
                  value={asset.provider_id ?? ''}
                  disabled={providerSaving || providers.length === 0}
                  onChange={(e) => saveProvider(e.target.value)}
                  style={{ minWidth: 240 }}
                  aria-label={t('Provider', 'Provider')}
                >
                  <option value="">{t('— none —', '— none —')}</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.provider_name}
                    </option>
                  ))}
                </Select>
                {providerSaving ? (
                  <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>{t('Saving…', 'Saving…')}</span>
                ) : null}
                {providers.length === 0 ? (
                  <span style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                    {t(
                      'No providers registered yet — add them under Third parties.',
                      'No providers registered yet — add them under Third parties.',
                    )}
                  </span>
                ) : null}
              </div>
              {providerError ? (
                <div style={{ marginTop: 8 }}>
                  <Banner tone="error">{providerError}</Banner>
                </div>
              ) : null}
            </Card>
            ) : null}

            {isVM && hasVMDetails ? (
              <Card>
                <CardTitle>{t('VM details', 'VM details')}</CardTitle>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 8, fontSize: 13 }}>
                  {powerState ? <Stat label={t('Power state', 'Power state')} value={powerState} /> : null}
                  {guest?.hostname ? <Stat label={t('Guest hostname', 'Guest hostname')} value={guest.hostname} mono /> : null}
                  {guest?.primary_ip ? <Stat label={t('Primary IP', 'Primary IP')} value={guest.primary_ip} mono /> : null}
                  {guest?.os_full_name || guest?.os_name ? (
                    <Stat label={t('Guest OS', 'Guest OS')} value={guest.os_full_name ?? guest.os_name ?? '—'} />
                  ) : null}
                  {guest?.os_family ? <Stat label={t('OS family', 'OS family')} value={guest.os_family} /> : null}
                  {hardware?.cpu?.count ? <Stat label={t('vCPUs', 'vCPUs')} value={String(hardware.cpu.count)} /> : null}
                  {hardware?.memory?.size_MiB ? (
                    <Stat
                      label={t('Memory', 'Memory')}
                      value={`${Math.round((hardware.memory.size_MiB ?? 0) / 1024)} GiB`}
                    />
                  ) : null}
                  {hardware?.disks?.length ? (
                    <Stat
                      label={t('Disks', 'Disks')}
                      value={`${hardware.disks.length} (${Math.round(hardware.disks.reduce((s, d) => s + (Number(d.capacity) || 0), 0) / 1024 ** 3)} GiB)`}
                    />
                  ) : null}
                  {vcenterHost ? <Stat label={t('vCenter host', 'vCenter host')} value={vcenterHost} mono /> : null}
                  {vcenterCluster ? <Stat label={t('vCenter cluster', 'vCenter cluster')} value={vcenterCluster} mono /> : null}
                </div>
                {(guest?.ip_addresses && guest.ip_addresses.length > 0) || (guest?.mac_addresses && guest.mac_addresses.length > 0) ? (
                  <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                    {guest?.ip_addresses && guest.ip_addresses.length > 0 ? (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {t('IP addresses', 'IP addresses')}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {guest.ip_addresses.map((ip) => (
                            <code
                              key={ip}
                              style={{
                                fontSize: 11,
                                padding: '2px 6px',
                                background: 'var(--color-background-secondary)',
                                borderRadius: 'var(--border-radius-sm)',
                              }}
                            >
                              {ip}
                            </code>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {guest?.mac_addresses && guest.mac_addresses.length > 0 ? (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {t('MAC addresses', 'MAC addresses')}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {guest.mac_addresses.map((mac) => (
                            <code
                              key={mac}
                              style={{
                                fontSize: 11,
                                padding: '2px 6px',
                                background: 'var(--color-background-secondary)',
                                borderRadius: 'var(--border-radius-sm)',
                              }}
                            >
                              {mac}
                            </code>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    {hardware?.datastores && hardware.datastores.length > 0 ? (
                      <div>
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                          {t('Datastores', 'Datastores')}
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                          {hardware.datastores.map((ds) => (
                            <code
                              key={ds}
                              style={{
                                fontSize: 11,
                                padding: '2px 6px',
                                background: 'var(--color-background-secondary)',
                                borderRadius: 'var(--border-radius-sm)',
                              }}
                            >
                              {ds}
                            </code>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </Card>
            ) : null}

            {isHypervisorHost ? (
              <Card>
                <CardTitle
                  right={
                    connectionState ? (
                      <Badge tone={connectionState.toLowerCase() === 'connected' ? 'green' : 'amber'}>
                        {connectionState}
                      </Badge>
                    ) : null
                  }
                >
                  {t('Hypervisor host', 'Hypervisor host')}
                </CardTitle>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 8, fontSize: 13 }}>
                  {clusterDisplay ? <Stat label={t('Cluster', 'Cluster')} value={clusterDisplay} mono /> : null}
                  {powerState ? <Stat label={t('Power state', 'Power state')} value={powerState} /> : null}
                  {connectionState ? <Stat label={t('Connection state', 'Connection state')} value={connectionState} /> : null}
                  {asset?.datacenter_id ? <Stat label={t('Site', 'Site')} value={String(asset.datacenter_id)} mono /> : null}
                  {hostedVMCount !== null ? (
                    <Stat label={t('VMs hosted', 'VMs hosted')} value={String(hostedVMCount)} />
                  ) : null}
                </div>
              </Card>
            ) : null}

            {hasServerDetails ? (
              <Card>
                <CardTitle
                  right={
                    health ? (
                      <Badge tone={healthTone(health)}>{health}</Badge>
                    ) : null
                  }
                >
                  {t('Server details', 'Server details')}
                </CardTitle>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 8, fontSize: 13 }}>
                  {hostOS ? <Stat label={t('OS', 'OS')} value={hostOS} /> : null}
                  {manufacturer ? <Stat label={t('Manufacturer', 'Manufacturer')} value={manufacturer} /> : null}
                  {model ? <Stat label={t('Model', 'Model')} value={model} /> : null}
                  {serviceTag ? <Stat label={t('Service tag', 'Service tag')} value={serviceTag} mono /> : null}
                  {powerState ? <Stat label={t('Power state', 'Power state')} value={powerState} /> : null}
                  {health ? <Stat label={t('Health', 'Health')} value={health} /> : null}
                </div>
                {hostIPs && hostIPs.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {t('IP addresses', 'IP addresses')}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
                      {hostIPs.map((ip) => {
                        // DNS-sourced IPs are weaker than connector-reported
                        // ones — badge them so the distinction is visible. The
                        // tooltip (on the wrapper) explains AD-record vs live
                        // lookup. Connector / unmapped IPs render bare.
                        const tag = ipSourceTag(ipSources?.[ip])
                        return (
                          <span
                            key={ip}
                            title={tag ? t(tag.tooltip, tag.tooltip) : undefined}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          >
                            <code
                              style={{
                                fontSize: 11,
                                padding: '2px 6px',
                                background: 'var(--color-background-secondary)',
                                borderRadius: 'var(--border-radius-sm)',
                              }}
                            >
                              {ip}
                            </code>
                            {tag ? <Badge tone="gray">{t(tag.label, tag.label)}</Badge> : null}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </Card>
            ) : null}

            {arrayMgmtIP ||
            hasCapacity ||
            (arrayUplinks && arrayUplinks.length > 0) ||
            (topVolumes && topVolumes.length > 0) ? (
              <Card>
                <CardTitle>{t('Storage array', 'Storage array')}</CardTitle>
                {arrayMgmtIP ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 8, fontSize: 13 }}>
                    <Stat label={t('Management IP', 'Management IP')} value={arrayMgmtIP} mono />
                  </div>
                ) : null}
                {hasCapacity ? (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', fontSize: 12 }}>
                      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {t('Capacity used', 'Capacity used')}
                      </span>
                      <span style={{ color: 'var(--color-text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
                        {formatBytes(capacityUsed)} / {formatBytes(capacityTotal)} ({usedPct}%)
                      </span>
                    </div>
                    <div style={{ marginTop: 6, height: 8, borderRadius: 999, background: 'var(--color-background-secondary)', overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${usedPct}%`,
                          height: '100%',
                          background:
                            usedPct >= 90
                              ? 'var(--color-status-red-mid)'
                              : usedPct >= 75
                                ? 'var(--color-status-amber-mid)'
                                : 'var(--color-status-green-mid)',
                        }}
                      />
                    </div>
                    <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                      <span>{t('Free', 'Free')}: {formatBytes(Math.max(0, capacityTotal - capacityUsed))}</span>
                      {dataReduction > 0 ? (
                        <span>{t('Data reduction', 'Data reduction')}: {dataReduction.toFixed(1)}:1</span>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {arrayUplinks && arrayUplinks.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {t('Switch uplinks (LLDP)', 'Switch uplinks (LLDP)')}
                    </div>
                    <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                      {arrayUplinks.map((u, i) => (
                        <div
                          key={`${u.switch ?? 'sw'}-${u.switch_port ?? i}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--color-border-subtle)' }}
                        >
                          <i className="ti ti-plug-connected" aria-hidden="true" style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }} />
                          <span style={{ fontWeight: 500 }}>{u.switch ?? '—'}</span>
                          {u.switch_port ? (
                            <code style={{ fontSize: 11, padding: '2px 6px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-sm)' }}>
                              {u.switch_port}
                            </code>
                          ) : null}
                          {u.vlan ? (
                            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('VLAN {v}', 'VLAN {v}', { v: u.vlan })}</span>
                          ) : null}
                          {u.interface ? (
                            <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }} title={u.interface}>
                              {u.interface}
                            </span>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {topVolumes && topVolumes.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {typeof volumeCount === 'number'
                        ? t('Top volumes (of {n})', 'Top volumes (of {n})', { n: volumeCount })
                        : t('Top volumes', 'Top volumes')}
                    </div>
                    <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                      {topVolumes.map((vol, i) => (
                        <div
                          key={`${vol.name ?? 'vol'}-${i}`}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, padding: '4px 0', borderBottom: '1px solid var(--color-border-subtle)' }}
                        >
                          <code style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {vol.name ?? '—'}
                          </code>
                          {vol.size ? (
                            <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--color-text-secondary)' }}>{vol.size}</span>
                          ) : null}
                          {vol.replicated ? (
                            <Badge tone="green">{vol.replication_mode ? vol.replication_mode : t('Replicated', 'Replicated')}</Badge>
                          ) : (
                            <Badge tone="gray">{t('Not replicated', 'Not replicated')}</Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </Card>
            ) : null}

            {asset.asset_type === 'network_link' ? (
              <NetworkLinkDetails
                asset={asset}
                endpointAssets={endpointAssets}
                memberAssets={memberAssets}
              />
            ) : null}

            {asset.asset_type === 'network_device' || asset.asset_type === 'switch' || asset.asset_type === 'router' ? (
              <NetworkDeviceDetails asset={asset} relatedLinks={relatedLinks} />
            ) : null}

            {lastBackup || replication || lastRestore ? (
              <Card>
                <CardTitle>{t('Protection', 'Protection')}</CardTitle>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 16, marginTop: 8 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      {t('Last backup', 'Last backup')}
                    </div>
                    {lastBackup ? (
                      <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Badge tone={backupTone(lastBackup.days_since)}>
                            {typeof lastBackup.days_since === 'number'
                              ? lastBackup.days_since === 0
                                ? t('Today', 'Today')
                                : t('{n}d ago', '{n}d ago', { n: lastBackup.days_since })
                              : (lastBackup.status ?? '—')}
                          </Badge>
                          {lastBackup.observed_at ? (
                            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                              {new Date(lastBackup.observed_at).toLocaleString()}
                            </span>
                          ) : null}
                        </div>
                        {lastBackup.job_name ? (
                          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                            {t('Job', 'Job')}: {lastBackup.job_name}
                          </div>
                        ) : null}
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                          {t('Source', 'Source')}: {lastBackup.source ?? 'veeam_enterprise_manager'}
                        </div>
                      </>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                        {t('No successful backup recorded.', 'No successful backup recorded.')}
                      </span>
                    )}
                  </div>

                  {replication ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {t('Storage replication', 'Storage replication')}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Badge tone={replication.state === 'replicated' ? 'green' : 'gray'}>
                          {replication.state === 'replicated'
                            ? t('Replicated', 'Replicated')
                            : t('Not replicated', 'Not replicated')}
                        </Badge>
                        {replication.mode ? (
                          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{replication.mode}</span>
                        ) : null}
                        {replication.role ? (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>({replication.role})</span>
                        ) : null}
                      </div>
                      {replication.volume ? (
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                          {replication.volume}
                        </div>
                      ) : null}
                      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                        {t('Source', 'Source')}: {replication.source ?? 'powerstore'}
                      </div>
                    </div>
                  ) : null}

                  {lastRestore ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {t('Last restore', 'Last restore')}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Badge tone={restoreTone(lastRestore.status)}>
                          {typeof lastRestore.days_since === 'number'
                            ? lastRestore.days_since === 0
                              ? t('Today', 'Today')
                              : t('{n}d ago', '{n}d ago', { n: lastRestore.days_since })
                            : (lastRestore.status ?? '—')}
                        </Badge>
                        {lastRestore.observed_at ? (
                          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                            {new Date(lastRestore.observed_at).toLocaleString()}
                          </span>
                        ) : null}
                      </div>
                      {lastRestore.restore_type ? (
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                          {t('Type', 'Type')}: {lastRestore.restore_type}
                          {lastRestore.status && lastRestore.status !== 'healthy' && lastRestore.status !== 'ok'
                            ? ` · ${lastRestore.status}`
                            : ''}
                        </div>
                      ) : null}
                      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                        {t('Source', 'Source')}: {lastRestore.source ?? 'veeam_enterprise_manager'}
                      </div>
                    </div>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {edr ? (
              <Card>
                <CardTitle
                  right={
                    edr.installed ? (
                      <Badge tone={edr.infected ? 'red' : edr.health === 'healthy' ? 'green' : 'amber'}>
                        {edr.infected ? t('Infected', 'Infected') : edr.health ? edr.health : t('Installed', 'Installed')}
                      </Badge>
                    ) : (
                      <Badge tone="red">{t('No EDR agent', 'No EDR agent')}</Badge>
                    )
                  }
                >
                  {t('Endpoint security (EDR)', 'Endpoint security (EDR)')}
                </CardTitle>
                {edr.installed ? (
                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 20 }}>
                    <Stat label={t('Source', 'Source')} value={edr.source ?? 'sentinelone'} />
                    {edr.agent_version ? <Stat label={t('Agent version', 'Agent version')} value={edr.agent_version} /> : null}
                    {edr.health ? <Stat label={t('Health', 'Health')} value={edr.health} /> : null}
                    <Stat label={t('Active', 'Active')} value={edr.active ? t('yes', 'yes') : t('no', 'no')} />
                    <Stat label={t('Threats', 'Threats')} value={String(edr.threats ?? 0)} />
                    {edr.max_threat_severity ? <Stat label={t('Max severity', 'Max severity')} value={edr.max_threat_severity} /> : null}
                    {edr.last_active ? <Stat label={t('Last active', 'Last active')} value={edr.last_active} /> : null}
                  </div>
                ) : (
                  <div style={{ marginTop: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {t(
                      'No EDR agent detected on this host (EDR is being collected for the fleet) — a coverage gap to remediate.',
                      'No EDR agent detected on this host (EDR is being collected for the fleet) — a coverage gap to remediate.',
                    )}
                  </div>
                )}
              </Card>
            ) : null}

            {networkPorts && networkPorts.length > 0 ? (
              <Card>
                <CardTitle right={<Badge tone="navy">{networkPorts.length}</Badge>}>
                  {t('Network ports', 'Network ports')}
                </CardTitle>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {networkPorts.map((p, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{p.switch}</span>
                      <code style={{ fontSize: 12 }}>{p.interface}</code>
                      {p.vlan ? <Badge tone="gray">VLAN {p.vlan}</Badge> : null}
                      {p.sub_type ? <Badge tone="navy">{p.sub_type}</Badge> : null}
                      {p.auth_method ? (
                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{p.auth_method}</span>
                      ) : null}
                      {p.site_id ? (
                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                          <i className="ti ti-map-pin" aria-hidden="true" style={{ marginRight: 3 }} />
                          {p.site_id}
                        </span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {storageVolumes && storageVolumes.length > 0 ? (
              <Card>
                <CardTitle right={<Badge tone="navy">{storageVolumes.length}</Badge>}>
                  {t('Mapped / backing storage volumes', 'Mapped / backing storage volumes')}
                </CardTitle>
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {storageVolumes.map((v, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', fontSize: 13 }}>
                      <span style={{ fontWeight: 600 }}>{v.volume}</span>
                      <Badge tone={v.replicated ? 'green' : 'gray'}>
                        {v.replicated ? t('replicated', 'replicated') : t('not replicated', 'not replicated')}
                      </Badge>
                      {v.mode ? <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{v.mode}</span> : null}
                      {v.role ? <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>({v.role})</span> : null}
                      {v.last_sync ? (
                        <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('synced', 'synced')} {v.last_sync}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            {dependencies.length > 0 ? (
              <Card>
                <CardTitle
                  right={
                    <Badge tone="navy">{dependencies.reduce((n, g) => n + g.items.length, 0)}</Badge>
                  }
                >
                  {t('Depends on', 'Depends on')}
                </CardTitle>
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                  {t(
                    'Infrastructure this asset rides on, from the cross-source topology graph.',
                    'Infrastructure this asset rides on, from the cross-source topology graph.',
                  )}
                </p>
                <div style={{ display: 'grid', gap: 14, marginTop: 10 }}>
                  {dependencies.map((group) => (
                    <div key={group.key}>
                      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        {t(group.label, group.label)} ({group.items.length})
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                        {group.items.map((item) => (
                          <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                            <a href={`/inventory/${encodeURIComponent(item.id)}`} style={{ fontWeight: 500 }}>
                              {item.name}
                            </a>
                            <Badge tone="gray">{item.asset_type}</Badge>
                            {item.site ? (
                              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{item.site}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ) : null}

            <Card>
              <CardTitle>{t('Parent application', 'Parent application')}</CardTitle>
              {parentApp ? (
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <a href={`/apps/${parentApp.application_id}`} style={{ fontWeight: 500 }}>
                      {parentApp.display_name}
                    </a>
                    {parentApp.gxp?.validated && <Badge tone="amber">GxP</Badge>}
                    {parentApp.criticality_tier && <Badge tone="navy">{parentApp.criticality_tier}</Badge>}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                    {t('See app-scope compliance', 'See app-scope compliance')}:{' '}
                    <a href={`/scoring/scope?type=application&id=${parentApp.application_id}`}>
                      /scoring/scope
                    </a>
                  </div>
                </div>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
                  {t(
                    'This asset is not registered as a component of any application. Register it in /apps to get a parent-app compliance view.',
                    'This asset is not registered as a component of any application. Register it in /apps to get a parent-app compliance view.',
                  )}
                </p>
              )}
            </Card>

            {parentApp && dependents.length > 0 ? (
              <Card>
                <CardTitle>{t('Apps that depend on this VM', 'Apps that depend on this VM')}</CardTitle>
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                  {t(
                    'Through {app}: if this VM goes down, the apps below lose a declared dependency.',
                    'Through {app}: if this VM goes down, the apps below lose a declared dependency.',
                    { app: parentApp.display_name },
                  )}
                </p>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '6px 10px 6px 0' }}>{t('Application', 'Application')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Dependency type', 'Dependency type')}</th>
                      <th style={{ padding: '6px 0 6px 10px' }}>{t('Criticality', 'Criticality')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dependents.map((d) => (
                      <tr key={d.application_id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                        <td style={{ padding: '8px 10px 8px 0' }}>
                          <a href={`/apps/${d.application_id}`} style={{ fontWeight: 500 }}>
                            {d.display_name ?? d.application_id}
                          </a>
                          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{d.application_id}</div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>{d.dependency_type ?? '—'}</td>
                        <td style={{ padding: '8px 0 8px 10px' }}>
                          {d.criticality ? <Badge tone={d.criticality === 'critical' ? 'red' : d.criticality === 'high' ? 'amber' : 'gray'}>{d.criticality}</Badge> : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ) : null}

            <Card>
              <CardTitle
                right={
                  <button
                    type="button"
                    onClick={() => void evaluateScope()}
                    disabled={evaluating || asset.framework_evaluation_enabled === false}
                    style={{
                      padding: '4px 12px',
                      borderRadius: 4,
                      border: '0.5px solid var(--color-border-tertiary)',
                      background: 'var(--color-surface-secondary)',
                      cursor: evaluating ? 'wait' : 'pointer',
                      fontSize: 12,
                    }}
                  >
                    {evaluating
                      ? t('Evaluating…', 'Evaluating…')
                      : isVM
                        ? t('Evaluate per-VM scope', 'Evaluate per-VM scope')
                        : t('Evaluate asset scope', 'Evaluate asset scope')}
                  </button>
                }
              >
                {isVM
                  ? t('Per-VM compliance contribution', 'Per-VM compliance contribution')
                  : t('Per-asset compliance contribution', 'Per-asset compliance contribution')}
              </CardTitle>
              {asset.framework_evaluation_enabled === false ? (
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
                  {t(
                    'This asset is marked out of scope. Mark it in scope from the inventory page to score it.',
                    'This asset is marked out of scope. Mark it in scope from the inventory page to score it.',
                  )}
                </p>
              ) : !scopeResult ? (
                <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
                  {isVM
                    ? t(
                        'Click Evaluate to compute framework scores against ONLY this VM\'s evidence. Useful for finding which controls this asset contributes to or fails for.',
                        'Click Evaluate to compute framework scores against ONLY this VM\'s evidence. Useful for finding which controls this asset contributes to or fails for.',
                      )
                    : t(
                        'Click Evaluate to compute framework scores against ONLY this asset\'s evidence. Useful for finding which controls this asset contributes to or fails for.',
                        'Click Evaluate to compute framework scores against ONLY this asset\'s evidence. Useful for finding which controls this asset contributes to or fails for.',
                      )}
                </p>
              ) : (
                <>
                  <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                    <span>{t('Members in scope: {n}', 'Members in scope: {n}', { n: scopeResult.members_in_scope })}</span>
                    <span>{t('Evidence records: {n}', 'Evidence records: {n}', { n: scopeResult.evidence_count })}</span>
                    <span>{t('Frameworks: {n}', 'Frameworks: {n}', { n: scopeResult.frameworks_evaluated })}</span>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 12 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        <th style={{ padding: '6px 10px 6px 0' }}>{t('Framework', 'Framework')}</th>
                        <th style={{ padding: '6px 10px' }}>{t('Score', 'Score')}</th>
                        <th style={{ padding: '6px 10px' }}>{t('Status', 'Status')}</th>
                        <th style={{ padding: '6px 10px' }}>{t('Pass', 'Pass')}</th>
                        <th style={{ padding: '6px 10px' }}>{t('Review', 'Review')}</th>
                        <th style={{ padding: '6px 10px' }}>{t('Warn', 'Warn')}</th>
                        <th style={{ padding: '6px 10px' }}>{t('Fail', 'Fail')}</th>
                        <th style={{ padding: '6px 0 6px 10px' }}>{t('Total', 'Total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedResults.map((f) => (
                        <tr key={f.framework_id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                          <td style={{ padding: '8px 10px 8px 0' }}>
                            <div style={{ fontWeight: 500 }}>{f.framework_name || f.framework_id}</div>
                            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{f.framework_id}</div>
                          </td>
                          <td style={{ padding: '8px 10px', fontFamily: 'var(--font-mono)' }}>{(f.score * 100).toFixed(1)}%</td>
                          <td style={{ padding: '8px 10px' }}>
                            <Badge tone={STATUS_TONE[f.status] ?? 'gray'}>{f.status}</Badge>
                          </td>
                          <td style={{ padding: '8px 10px' }}>{f.passing_controls}</td>
                          <td style={{ padding: '8px 10px' }}>{f.review_controls}</td>
                          <td style={{ padding: '8px 10px' }}>{f.warn_controls}</td>
                          <td style={{ padding: '8px 10px' }}>{f.fail_controls}</td>
                          <td style={{ padding: '8px 0 8px 10px' }}>{f.total_controls}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  )
}

function backupTone(daysSince?: number): 'green' | 'amber' | 'red' | 'gray' {
  if (typeof daysSince !== 'number') return 'gray'
  if (daysSince <= 1) return 'green'
  if (daysSince <= 7) return 'amber'
  return 'red'
}

// A restore's tone is driven by outcome, not recency: a successful
// recovery is green however long ago it ran; a failed one is red.
function restoreTone(status?: string): 'green' | 'amber' | 'red' | 'gray' {
  const s = (status ?? '').toLowerCase()
  if (s === 'healthy' || s === 'ok' || s === 'success') return 'green'
  if (s === 'warning') return 'amber'
  if (s === 'failure' || s === 'failed' || s === 'error') return 'red'
  return 'gray'
}

// Health badge tone for physical-host hardware health (Dell OpenManage
// reports values like "ok" / "healthy" / "warning" / "critical").
function healthTone(status?: string): 'green' | 'amber' | 'red' | 'gray' {
  const s = (status ?? '').toLowerCase()
  if (s === 'ok' || s === 'healthy' || s === 'normal' || s === 'good') return 'green'
  if (s === 'warning' || s === 'degraded') return 'amber'
  if (s === 'critical' || s === 'error' || s === 'failed' || s === 'fault') return 'red'
  return 'gray'
}

// formatBytes renders a byte count in binary units (KiB/MiB/GiB/TiB/PiB),
// one decimal below 100 in the chosen unit and whole numbers above, so a
// capacity reads "12.4 TiB" / "340 GiB" rather than a raw byte figure.
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  const rendered = i === 0 || value >= 100 ? Math.round(value).toString() : value.toFixed(1)
  return `${rendered} ${units[i]}`
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : undefined }}>
        {value}
      </span>
    </div>
  )
}

// NetworkLinkDetails renders the bundle classification + per-side
// bundle names + endpoints (with cross-source enrichment from their
// own inventory rows) + per-cable member list. Each endpoint and
// each member is a clickable link to its own asset detail page so
// the operator can drill through the topology naturally.
function NetworkLinkDetails({
  asset,
  endpointAssets,
  memberAssets,
}: {
  asset: InventoryAsset
  endpointAssets: Record<string, InventoryAsset>
  memberAssets: InventoryAsset[]
}) {
  const { t } = useI18n()
  // Per-member (per-cable) carrier attribution: each bundle member is its own
  // inventory asset, so a bundle whose cables run over different carriers gets
  // one picker per cable. Saves via the inventory provider-attribution endpoint.
  const [providers, setProviders] = useState<Array<{ id: string; provider_name: string }>>([])
  const [memberProviders, setMemberProviders] = useState<Record<string, string>>({})
  const [savingMember, setSavingMember] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    apiFetch('/third-parties')
      .then((r) => (r.ok ? r.json() : []))
      .then((body) => {
        if (cancelled) return
        const list: any[] = Array.isArray(body) ? body : (body?.items ?? body?.providers ?? [])
        setProviders(
          list
            .map((p) => ({ id: String(p?.id ?? ''), provider_name: String(p?.provider_name ?? p?.id ?? '') }))
            .filter((p) => p.id),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  async function saveMemberProvider(memberID: string, providerID: string) {
    if (!memberID) return
    setSavingMember(memberID)
    try {
      const r = await apiFetch('/inventory/provider-attribution', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_ids: [memberID], provider_id: providerID }),
      })
      if (!r.ok) {
        const b = await r.json().catch(() => ({}))
        throw new Error(b?.detail || b?.error || `${r.status} ${r.statusText}`)
      }
      setMemberProviders((prev) => ({ ...prev, [memberID]: providerID }))
    } catch {
      /* a failed save just leaves the prior value; the table stays usable */
    } finally {
      setSavingMember(null)
    }
  }
  const metadata = asset.metadata ?? {}
  const label = String(metadata['link_type_label'] ?? '').trim()
  const correlation = String(metadata['correlation'] ?? '').trim()
  const verified = Boolean(metadata['verified'])
  const memberCount = Number(metadata['member_count'] ?? 0)
  const bundleA = String(metadata['bundle_a'] ?? '').trim()
  const bundleB = String(metadata['bundle_b'] ?? '').trim()
  const neighborKind = String(metadata['neighbor_kind'] ?? '').trim()
  const mixedVlan = Boolean(metadata['mixed_vlan'])
  const sites = Array.isArray(metadata['sites']) ? (metadata['sites'] as string[]) : []
  const siteA = String(metadata['site_a'] ?? '').trim()
  const siteB = String(metadata['site_b'] ?? '').trim()
  const endpoints = Array.isArray(metadata['endpoints']) ? (metadata['endpoints'] as Array<Record<string, unknown>>) : []
  const memberSummaries = Array.isArray(metadata['members']) ? (metadata['members'] as Array<Record<string, unknown>>) : []
  return (
    <>
      <Card>
        <CardTitle right={<Badge tone={verified ? 'green' : 'amber'}>{verified ? t('Bidirectional', 'Bidirectional') : t('Single-sided', 'Single-sided')}</Badge>}>
          {label ? t(label.replace(/_/g, ' '), label.replace(/_/g, ' ')) : t('Network link', 'Network link')}
        </CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 8 }}>
          {correlation && <Stat label={t('Correlation', 'Correlation')} value={correlation} mono />}
          <Stat label={t('Members', 'Members')} value={String(memberCount || memberSummaries.length || '—')} />
          {/* Two-site fields: always render Site A / Site B explicitly
              so the operator sees both endpoints at a glance. Falls
              back to the metadata.sites array (legacy field) when
              site_a / site_b are missing. */}
          <Stat label={t('Site A', 'Site A')} value={siteA || (sites[0] ?? '—')} />
          <Stat label={t('Site B', 'Site B')} value={siteB || (sites[1] ?? '—')} />
          {bundleA && <Stat label={t('Bundle A', 'Bundle A')} value={bundleA} mono />}
          {bundleB && <Stat label={t('Bundle B', 'Bundle B')} value={bundleB} mono />}
          {neighborKind && <Stat label={t('Neighbor kind', 'Neighbor kind')} value={neighborKind} />}
          {mixedVlan && (
            <Stat label={t('Segregation flag', 'Segregation flag')} value={t('mixed VLAN trunk', 'mixed VLAN trunk')} />
          )}
        </div>
      </Card>

      <Card>
        <CardTitle>{t('Endpoints', 'Endpoints')}</CardTitle>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginTop: 8 }}>
          {endpoints.map((ep, i) => {
            const epID = String(ep['asset_id'] ?? '').trim()
            const epLabel = String(ep['label'] ?? '').trim()
            const epSite = String(ep['site'] ?? '').trim()
            const enriched = epID ? endpointAssets[epID] : null
            const enrichedType = String(enriched?.asset_type ?? '').toLowerCase()
            const enrichedCrit = String(enriched?.criticality ?? '').toLowerCase()
            const enrichedTags = enriched?.tags ?? []
            return (
              <div
                key={epID || i}
                style={{
                  border: '0.5px solid var(--color-border-tertiary)',
                  borderRadius: 6,
                  padding: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {i === 0 ? t('Endpoint A', 'Endpoint A') : t('Endpoint B', 'Endpoint B')}
                </div>
                <a
                  href={epID ? `/inventory/${encodeURIComponent(epID)}` : undefined}
                  style={{ fontSize: 14, fontWeight: 500, textDecoration: 'none', color: 'var(--color-text-primary)' }}
                >
                  {enriched?.name || epLabel || epID || '—'}
                </a>
                <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  {epID}
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                  {enrichedType && <Badge tone="navy">{enrichedType}</Badge>}
                  {enrichedCrit && <Badge tone={enrichedCrit === 'critical' ? 'red' : enrichedCrit === 'high' ? 'amber' : 'gray'}>{enrichedCrit}</Badge>}
                  {epSite && <Badge tone="gray">{epSite}</Badge>}
                </div>
                {enrichedTags.length > 0 && (
                  <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                    {enrichedTags.slice(0, 6).join(' · ')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {memberSummaries.length > 0 && (
        <Card>
          <CardTitle right={<Badge tone="navy">{memberSummaries.length}</Badge>}>{t('Members (per cable)', 'Members (per cable)')}</CardTitle>
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '6px 8px 6px 0' }}>{t('Interface A', 'Interface A')}</th>
                  <th style={{ padding: '6px 8px' }}>{t('Parent A', 'Parent A')}</th>
                  <th style={{ padding: '6px 8px' }}>{t('Interface B', 'Interface B')}</th>
                  <th style={{ padding: '6px 8px' }}>{t('Parent B', 'Parent B')}</th>
                  <th style={{ padding: '6px 8px' }}>{t('Status', 'Status')}</th>
                  <th style={{ padding: '6px 8px' }}>{t('VLANs', 'VLANs')}</th>
                  <th style={{ padding: '6px 8px' }}>{t('Carrier', 'Carrier')}</th>
                  <th style={{ padding: '6px 0 6px 8px' }}>{t('Asset', 'Asset')}</th>
                </tr>
              </thead>
              <tbody>
                {memberSummaries.map((m, i) => {
                  const memberID = String(m['asset_id'] ?? '').trim()
                  const enrichedMember = memberAssets.find((ma) => ma.asset_id === memberID)
                  const memberMeta = enrichedMember?.metadata ?? {}
                  const ifaceA = String(m['interface_a'] ?? memberMeta['interface_a'] ?? '').trim()
                  const ifaceB = String(m['interface_b'] ?? memberMeta['interface_b'] ?? '').trim()
                  const parentA = String(m['parent_a'] ?? memberMeta['parent_a'] ?? '').trim()
                  const parentB = String(m['parent_b'] ?? memberMeta['parent_b'] ?? '').trim()
                  const status = String(m['link_status'] ?? memberMeta['link_status'] ?? '').trim()
                  const allowed = Array.isArray(memberMeta['allowed_vlans']) ? (memberMeta['allowed_vlans'] as string[]) : []
                  const native = String(memberMeta['native_vlan'] ?? '').trim()
                  const vlanCell = (() => {
                    if (allowed.length > 0) return `${allowed.length} (${native || allowed[0]})`
                    if (native) return native
                    return '—'
                  })()
                  const statusTone: 'green' | 'amber' | 'red' | 'gray' = status === 'up' ? 'green' : status === 'down' ? 'red' : status ? 'amber' : 'gray'
                  return (
                    <tr key={memberID || i} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={{ padding: '8px 8px 8px 0', fontFamily: 'var(--font-mono)' }}>{ifaceA || '—'}</td>
                      <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{parentA || '—'}</td>
                      <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{ifaceB || '—'}</td>
                      <td style={{ padding: '8px', fontFamily: 'var(--font-mono)' }}>{parentB || '—'}</td>
                      <td style={{ padding: '8px' }}>{status ? <Badge tone={statusTone}>{status}</Badge> : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}</td>
                      <td style={{ padding: '8px' }}>{vlanCell}</td>
                      <td style={{ padding: '8px' }}>
                        {memberID ? (
                          <Select
                            value={memberProviders[memberID] ?? enrichedMember?.provider_id ?? ''}
                            disabled={savingMember === memberID || providers.length === 0}
                            onChange={(e) => saveMemberProvider(memberID, e.target.value)}
                            style={{ minWidth: 140, fontSize: 11 }}
                            aria-label={t('Carrier', 'Carrier')}
                          >
                            <option value="">{t('— none —', '— none —')}</option>
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.provider_name}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '8px 0 8px 8px' }}>
                        {memberID ? (
                          <a href={`/inventory/${encodeURIComponent(memberID)}`} style={{ fontSize: 10, color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
                            {memberID.length > 40 ? memberID.slice(0, 40) + '…' : memberID}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}
