'use client'
// Inventory / asset registry.
//
// Renders the per-tenant inventory that the connector poll loop
// populates (auto-import in compliantly-go 574ab0c). One row per
// discovered asset — firewalls, hypervisors, storage arrays, CMDB
// records — keyed by `asset_id` and tagged with the source connector
// via `external_refs[]`. The table is read-first; structural changes
// flow from upstream connectors, not from manual edits in this UI,
// which keeps the compliance audit trail intact.
//
// Backend API:
//   GET  /v1/inventory/assets
//   POST /v1/inventory/import  body: { refresh, overwrite, source? }
//
// What's intentionally NOT here (live in /apps and /sites instead):
//   - Application-aware grouping (apps page owns that)
//   - Site-level cascade analysis (sites page owns that)
//   - Per-row CRUD form — the connector is the source of truth;
//     letting the operator hand-edit asset_type/criticality would
//     drift from upstream and confuse the auditor

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  Pagination,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useBackgroundTasks } from '../components/BackgroundTasks'
import { AssetExpandedPanel, type EnrichedAsset } from '../components/AssetConnectorDetail'

import { useI18n } from '../lib/i18n'

type InventoryExternalRef = { source: string; external_id: string }

type InventoryAsset = {
  asset_id: string
  name?: string | null
  owner?: string | null
  business_unit?: string | null
  asset_type?: string | null
  criticality?: string | null
  datacenter_id?: string | null
  application_id?: string | null
  access_tier?: string | null
  framework_evaluation_enabled?: boolean
  tags?: string[]
  external_refs?: InventoryExternalRef[]
  metadata?: Record<string, unknown>
  // Set by the backend list handler from the live connector
  // snapshot cache — the union of connectors whose latest poll
  // included this asset. Independent of external_refs (which only
  // reflects the connector that originally inserted the row).
  present_in?: string[]
  // Derived by the backend from the Cisco MAC address table joined
  // against this asset's known MAC addresses. Format:
  // "<switch>:<interface>" with optional " VLAN <n>" suffix. Empty
  // when there's no Cisco connector polling the relevant switch, or
  // no MAC is known for this asset.
  switch_port?: string | null
}

type SiteOption = { site_id: string; display_name?: string }

// AppTierLink is the per-asset tier projection from the unified
// /v1/registry/items?kind=assets endpoint. An asset participates in
// an app either via its declared application_id or via its name
// matching a component's vm_name in the app registry.
type AppTierLink = { app_id: string; app_name: string; app_tier: string; criticality: string }

// ─── sort + export helpers ──────────────────────────────────────────
type SortKey = 'name' | 'asset_type' | 'criticality' | 'source' | 'datacenter_id'
type SortState = { key: SortKey; dir: 'asc' | 'desc' }

// Severity order (mirrors the backend criticalityRank) so a criticality
// sort reads critical→high→medium→low, not alphabetical.
const CRITICALITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, moderate: 2, low: 1 }

// UTF-8 byte-order mark so Excel reads accented names correctly on open.
const BOM = String.fromCharCode(0xfeff)

// assetSource derives the connector label the Source column shows: the
// first external_refs source (split on ':'), falling back to metadata.source.
function assetSource(a: InventoryAsset): string {
  for (const ref of a.external_refs ?? []) {
    const s = (ref.source ?? '').split(':')[0].trim()
    if (s) return s
  }
  const m = a.metadata?.['source']
  return typeof m === 'string' ? m : ''
}

// Columns whose first click should land on the most-useful order:
// criticality starts critical-first (desc by rank); text columns A→Z.
function defaultDir(key: SortKey): 'asc' | 'desc' {
  return key === 'criticality' ? 'desc' : 'asc'
}

function sortValue(a: InventoryAsset, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return String(a.name ?? '').toLowerCase()
    case 'asset_type':
      return String(a.asset_type ?? '').toLowerCase()
    case 'criticality':
      return CRITICALITY_RANK[String(a.criticality ?? '').trim().toLowerCase()] ?? 0
    case 'source':
      return assetSource(a).toLowerCase()
    case 'datacenter_id':
      return String(a.datacenter_id ?? '').toLowerCase()
  }
}

const TIER_TONE: Record<string, 'red' | 'amber' | 'navy' | 'blue' | 'gray'> = {
  tier_0: 'red',
  tier_1: 'red',
  tier_2: 'amber',
  tier_3: 'navy',
  tier_4: 'blue',
  tier_5: 'gray',
}

function tierLabel(tier: string): string {
  switch (tier) {
    case 'tier_0':
      return 'Tier 0'
    case 'tier_1':
      return 'Tier 1'
    case 'tier_2':
      return 'Tier 2'
    case 'tier_3':
      return 'Tier 3'
    case 'tier_4':
      return 'Tier 4'
    case 'tier_5':
      return 'Tier 5'
  }
  return tier
}

const CRITICALITY_TONE: Record<string, 'red' | 'amber' | 'green' | 'gray'> = {
  critical: 'red',
  high: 'amber',
  medium: 'amber',
  low: 'green',
}

export function InventoryPage() {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [assets, setAssets] = useState<InventoryAsset[]>([])
  const [sites, setSites] = useState<SiteOption[]>([])
  // tierByAssetID is the per-asset application tier projection, fed
  // by /v1/registry/items?kind=assets. Populated in parallel with
  // /inventory/assets so the table can show a Tier column without
  // blocking the primary asset fetch.
  const [tierByAssetID, setTierByAssetID] = useState<Record<string, AppTierLink>>({})
  // CMDB gap count for the summary tile. Pulled separately so the
  // chip is present even before the main asset list loads. 30s
  // refresh cadence matches the rest of the page's polling.
  const [cmdbGapCount, setCmdbGapCount] = useState<number | null>(null)
  // Monitoring gap count for the second summary tile. Same shape as
  // the CMDB one but cross-referenced against observability
  // connectors (Dynatrace, Zabbix, …) instead of CMDBs (GLPI etc.).
  const [monitoringGapCount, setMonitoringGapCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const { run: runTask, isRunning } = useBackgroundTasks()
  // Derived from the GLOBAL task registry so the button still shows "Updating…"
  // if you navigate away and return while the update is in flight.
  const importing = isRunning('inventory-refresh')
  // assetId currently mid-patch; suppresses concurrent edits to the
  // same row and shows a small busy state on the dropdown.
  const [assigningAssetId, setAssigningAssetId] = useState<string | null>(null)
  // Bulk-select state for compliance-scope toggle. The operator can
  // pick test/dev/decommissioned VMs and mark them out of evaluation
  // scope (PCI CDE segmentation, GxP scope rules etc.).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [sortState, setSortState] = useState<SortState | null>(null)
  // Inline "look by row" expansion. expanded holds the asset_ids whose
  // detail panel is open; detailCache memoises the enriched detail
  // payload so re-expanding a row is instant and doesn't refetch.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [detailCache, setDetailCache] = useState<Record<string, EnrichedAsset>>({})
  const toggleExpand = (assetID: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(assetID)) next.delete(assetID)
      else next.add(assetID)
      return next
    })

  // URL drives the filter so a sidebar link like
  // /inventory?asset_type=firewall lands on the right slice without
  // any in-page UI gymnastics.
  const assetTypeFilter = (searchParams?.get('asset_type') ?? '').toLowerCase()
  const sourceFilter = (searchParams?.get('source') ?? '').toLowerCase()
  const criticalityFilter = (searchParams?.get('criticality') ?? '').toLowerCase()
  const search = (searchParams?.get('q') ?? '').toLowerCase()
  // not_in_cmdb shortcut filter — backend cross-references each
  // asset against the cached CMDB connector snapshot (GLPI etc.)
  // and drops rows already registered. Drives the Evidence stream's
  // "Not in CMDB" hero pill click-through and a visible chip on this
  // page so the operator knows the table is filtered.
  const notInCMDB = String(searchParams?.get('not_in_cmdb') ?? '').toLowerCase() === 'true'
  // not_in_monitoring mirrors not_in_cmdb but cross-references against
  // observability connector hosts (Dynatrace, Zabbix). Answers the
  // "which discovered assets are NOT being observed?" question.
  const notInMonitoring = String(searchParams?.get('not_in_monitoring') ?? '').toLowerCase() === 'true'

  // tab drives the registry view: 'assets' is the existing rich
  // asset table; 'applications' and 'sites' surface the operator-
  // declared registries that an auditor wants in the same place
  // without forcing a sidebar trip. Default 'assets' preserves
  // every existing bookmark/deep-link to /inventory.
  const tab = ((searchParams?.get('tab') ?? 'assets').toLowerCase() as 'assets' | 'applications' | 'sites')
  function pushTab(next: 'assets' | 'applications' | 'sites') {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (next === 'assets') params.delete('tab')
    else params.set('tab', next)
    const qs = params.toString()
    router.push(qs ? `/inventory?${qs}` : '/inventory')
  }

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      // The backend caps each response at 1000 rows, so a single fetch
      // silently drops everything past 1000 once a fleet gets large
      // (switches + firewalls + CMDB CIs easily exceed that, and rows
      // that sort later — clusters, hosts — fall off the page). Walk
      // ALL pages via offset until we've pulled the full count, so the
      // view never hides assets. Hard stop at 50k as a runaway guard.
      const PAGE = 1000
      const MAX = 50000
      const all: InventoryAsset[] = []
      let offset = 0
      let total = Infinity
      const filterParts: string[] = []
      if (notInCMDB) filterParts.push('not_in_cmdb=true')
      if (notInMonitoring) filterParts.push('not_in_monitoring=true')
      const filterSuffix = filterParts.length ? '&' + filterParts.join('&') : ''
      while (offset < total && offset < MAX) {
        const response = await apiFetch(`/inventory/assets?limit=${PAGE}&offset=${offset}${filterSuffix}`)
        if (!response.ok) {
          const body = await response.json().catch(() => ({}))
          throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
        }
        const body = await response.json()
        const items: InventoryAsset[] = Array.isArray(body?.items) ? body.items : []
        all.push(...items)
        total = typeof body?.count === 'number' ? body.count : all.length
        if (items.length === 0) break // safety: server returned nothing
        offset += items.length
      }
      setAssets(all)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory')
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [notInCMDB, notInMonitoring])

  useEffect(() => {
    void load()
  }, [load])

  // Poll the CMDB gap count for the summary tile. Server-side filter
  // is cheap (one boolean check per asset) so 30s cadence is comfy.
  useEffect(() => {
    let cancelled = false
    async function pull() {
      try {
        const response = await apiFetch('/inventory/assets?not_in_cmdb=true&limit=1')
        if (!response.ok) {
          if (!cancelled) setCmdbGapCount(null)
          return
        }
        const body = await response.json()
        if (!cancelled) setCmdbGapCount(typeof body?.count === 'number' ? body.count : 0)
      } catch {
        if (!cancelled) setCmdbGapCount(null)
      }
    }
    void pull()
    const handle = window.setInterval(() => void pull(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  // Mirror poll for the Monitoring gap tile — same cadence + same
  // failure handling as the CMDB gap. Hitting the same /inventory/
  // assets endpoint with a different filter param means we don't add
  // a route or build a parallel computation path.
  useEffect(() => {
    let cancelled = false
    async function pull() {
      try {
        const response = await apiFetch('/inventory/assets?not_in_monitoring=true&limit=1')
        if (!response.ok) {
          if (!cancelled) setMonitoringGapCount(null)
          return
        }
        const body = await response.json()
        if (!cancelled) setMonitoringGapCount(typeof body?.count === 'number' ? body.count : 0)
      } catch {
        if (!cancelled) setMonitoringGapCount(null)
      }
    }
    void pull()
    const handle = window.setInterval(() => void pull(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  // Populate tier-by-asset map from the unified registry endpoint.
  // Failure is silent — the Tier column degrades to "—" but the
  // page is still usable. Pulled in parallel with the primary
  // /inventory/assets fetch so neither blocks the other.
  useEffect(() => {
    let cancelled = false
    const map: Record<string, AppTierLink> = {}
    async function load() {
      // The registry endpoint caps a single response at 500, so
      // paginate until we've pulled the full asset list. Hard stop
      // at 10k as a runaway guard.
      const PAGE = 500
      const MAX = 10000
      let offset = 0
      let total = Infinity
      while (offset < total && offset < MAX) {
        const response = await apiFetch(`/registry/items?kind=assets&limit=${PAGE}&offset=${offset}`)
        if (!response.ok) return
        const body = await response.json().catch(() => null)
        if (!body) return
        const items: any[] = Array.isArray(body?.items) ? body.items : []
        for (const item of items) {
          const tier = String(item?.app_tier ?? '').trim()
          if (!tier) continue
          map[String(item.id)] = {
            app_id: String(item?.app_id ?? ''),
            app_name: String(item?.app_name ?? item?.app_id ?? ''),
            app_tier: tier,
            criticality: String(item?.app_criticality ?? ''),
          }
        }
        total = typeof body?.total === 'number' ? body.total : items.length
        if (items.length === 0) break
        offset += items.length
      }
      if (!cancelled) setTierByAssetID(map)
    }
    load().catch(() => {
      // No-op: assets table still renders without the Tier column.
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Populate the per-row "Site" dropdown options from /v1/sites.
  // Failure is silent — the dropdown just stays empty and the
  // assignment column shows a chip with the current datacenter_id.
  useEffect(() => {
    let cancelled = false
    apiFetch('/sites')
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return
        const items = Array.isArray(body?.items) ? body.items : []
        setSites(
          items.map((s: any) => ({
            site_id: String(s.site_id ?? ''),
            display_name: typeof s.display_name === 'string' ? s.display_name : undefined,
          })),
        )
      })
      .catch(() => {
        // No-op: assignment column degrades to read-only when sites
        // can't be loaded.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // assignSite is the per-row site assignment handler. For cluster
  // rows it offers a cascade-to-hosts confirm so the operator
  // doesn't have to click each host one at a time; VMs inherit
  // their site from their current host on the next poll (or
  // immediately after a host PATCH), so a direct cluster→VM
  // cascade isn't needed and would be wrong in stretched-cluster
  // topologies. Host rows don't trigger a cascade — the backend
  // derives VM sites automatically when a host's site changes.
  async function assignSite(asset: InventoryAsset, siteID: string) {
    if (assigningAssetId) return
    setError(null)

    let cascade = false
    const assetType = String(asset.asset_type ?? '').toLowerCase()
    if (siteID && assetType === 'cluster') {
      const descendants = countCascadeDescendants(asset, assetType, assets)
      if (descendants.hosts > 0) {
        const siteLabel = sites.find((s) => s.site_id === siteID)?.display_name ?? siteID
        const what = t(
          'Apply "{site}" to {hosts} host(s) in this cluster that have no site set? (VMs will inherit from their host.)',
          'Apply "{site}" to {hosts} host(s) in this cluster that have no site set? (VMs will inherit from their host.)',
          { site: siteLabel, hosts: descendants.hosts },
        )
        cascade = window.confirm(what)
      }
    }

    setAssigningAssetId(asset.asset_id)
    try {
      const body: Record<string, unknown> = { datacenter_id: siteID }
      if (cascade) body.cascade = 'descendants'
      const response = await apiFetch(`/inventory/assets/${encodeURIComponent(asset.asset_id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(responseBody?.detail || responseBody?.error || `${response.status} ${response.statusText}`)
      }
      const cascadeUpdated: string[] = Array.isArray(responseBody?.descendants_updated)
        ? responseBody.descendants_updated
        : []
      // Optimistic local update: avoid waiting for the full /assets
      // reload. Update the parent row immediately + every cascaded
      // descendant the server reported.
      setAssets((current) =>
        current.map((a) => {
          if (a.asset_id === asset.asset_id) return { ...a, datacenter_id: siteID || null }
          if (cascadeUpdated.includes(a.asset_id)) return { ...a, datacenter_id: siteID || null }
          return a
        }),
      )
      if (cascadeUpdated.length > 0) {
        setInfo(
          t(
            'Cascaded site assignment to {count} descendant asset(s).',
            'Cascaded site assignment to {count} descendant asset(s).',
            { count: cascadeUpdated.length },
          ),
        )
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to assign site')
    } finally {
      setAssigningAssetId(null)
    }
  }

  // bulkScopeToggle sends a single bulk PATCH for the selected asset
  // ids, marking them in/out of compliance evaluation scope. Used
  // for PCI CDE segmentation, GxP scope rules, ISO27001 SoA scope.
  async function bulkScopeToggle(inScope: boolean) {
    if (selected.size === 0) return
    setBulkBusy(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch('/inventory/scope-toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_ids: Array.from(selected),
          framework_evaluation_enabled: inScope,
        }),
      })
      const responseBody = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(responseBody?.detail || responseBody?.error || `${response.status} ${response.statusText}`)
      }
      const updated = Number(responseBody?.updated ?? 0)
      const ids = new Set(selected)
      setAssets((current) =>
        current.map((a) =>
          ids.has(a.asset_id) ? { ...a, framework_evaluation_enabled: inScope } : a,
        ),
      )
      setInfo(
        inScope
          ? t('{count} asset(s) marked in scope.', '{count} asset(s) marked in scope.', { count: updated })
          : t('{count} asset(s) marked out of scope.', '{count} asset(s) marked out of scope.', { count: updated }),
      )
      setSelected(new Set())
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Bulk update failed')
    } finally {
      setBulkBusy(false)
    }
  }

  // countCascadeDescendants walks the in-memory asset list and tallies
  // how many hosts would be touched by a cluster cascade. Counts
  // ONLY hosts that don't already have a datacenter_id set, matching
  // the server-side rule. The operator's confirm dialog uses this
  // count to make the impact of the action visible up front. VMs
  // are no longer counted because they inherit from their host
  // automatically — the post-PATCH derivation step (or the next
  // poll) handles VM site updates.
  function countCascadeDescendants(
    parent: InventoryAsset,
    parentType: string,
    allAssets: InventoryAsset[],
  ): { hosts: number; vms: number; total: number } {
    const parentClusterID = (parent.metadata?.['vcenter_cluster'] as string | undefined)?.trim() || parent.asset_id
    let hosts = 0
    if (parentType === 'cluster') {
      for (const candidate of allAssets) {
        if (candidate.asset_id === parent.asset_id) continue
        if (String(candidate.datacenter_id ?? '').trim()) continue
        const childType = String(candidate.asset_type ?? '').toLowerCase()
        const childCluster = String(candidate.metadata?.['vcenter_cluster'] ?? '').trim()
        if (childType === 'host' && childCluster === parentClusterID) hosts++
      }
    }
    return { hosts, vms: 0, total: hosts }
  }

  async function refreshFromConnectors() {
    setError(null)
    setInfo(null)
    try {
      // Run as a GLOBAL background task so the running indicator survives
      // navigation and the button reflects "still updating" if you come back.
      const body = await runTask('inventory-refresh', t('Updating inventory…', 'Updating inventory…'), async () => {
        const response = await apiFetch('/inventory/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh: true, overwrite: false }),
        })
        const b = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(b?.detail || b?.error || `${response.status} ${response.statusText}`)
        }
        return b
      })
      if (body === undefined) return // an update was already running
      const imported = body?.imported ?? 0
      const updated = body?.updated ?? 0
      const skipped = body?.skipped ?? 0
      setInfo(
        t(
          '{imported} new, {updated} updated, {skipped} unchanged.',
          '{imported} new, {updated} updated, {skipped} unchanged.',
          { imported, updated, skipped },
        ),
      )
      await load()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to refresh inventory')
    }
  }

  const sources = useMemo(() => {
    const set = new Set<string>()
    for (const asset of assets) {
      for (const ref of asset.external_refs ?? []) {
        if (ref.source) set.add(ref.source.split(':')[0])
      }
    }
    return Array.from(set).sort()
  }, [assets])

  const assetTypes = useMemo(() => {
    const set = new Set<string>()
    for (const asset of assets) {
      const value = String(asset.asset_type ?? '').trim().toLowerCase()
      if (value) set.add(value)
    }
    return Array.from(set).sort()
  }, [assets])

  const filtered = useMemo(() => {
    return assets.filter((asset) => {
      const assetTypeRaw = String(asset.asset_type ?? '').toLowerCase()
      // Hide network_link_member child rows by default so the list
      // stays clean (one parent bundle = one visible row). Operators
      // can drill into members from the bundle's detail page; the
      // explicit asset_type=network_link_member filter reveals them
      // in the list when needed.
      if (assetTypeRaw === 'network_link_member' && assetTypeFilter !== 'network_link_member') {
        return false
      }
      if (assetTypeFilter && assetTypeRaw !== assetTypeFilter) return false
      if (criticalityFilter && String(asset.criticality ?? '').toLowerCase() !== criticalityFilter) return false
      if (sourceFilter) {
        const refs = (asset.external_refs ?? []).map((r) => r.source.toLowerCase().split(':')[0])
        if (!refs.includes(sourceFilter)) return false
      }
      if (search) {
        const haystack = [
          asset.asset_id,
          asset.name,
          asset.asset_type,
          asset.owner,
          asset.business_unit,
          asset.datacenter_id,
          asset.application_id,
        ]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase())
          .join(' ')
        if (!haystack.includes(search)) return false
      }
      return true
    })
  }, [assets, assetTypeFilter, sourceFilter, criticalityFilter, search])

  // Client-side sort over the filtered set. The whole page is fetched up
  // front and filtered locally, so sorting here (rather than re-querying)
  // is instant and keeps the CSV export an exact match of what's on screen.
  const sorted = useMemo(() => {
    if (!sortState) return filtered
    const { key, dir } = sortState
    const arr = [...filtered]
    arr.sort((a, b) => {
      const va = sortValue(a, key)
      const vb = sortValue(b, key)
      let cmp: number
      if (typeof va === 'number' && typeof vb === 'number') cmp = va - vb
      else cmp = String(va).localeCompare(String(vb))
      // Stable tiebreak on name so equal keys keep a predictable order.
      if (cmp === 0) cmp = String(a.name ?? '').toLowerCase().localeCompare(String(b.name ?? '').toLowerCase())
      return dir === 'asc' ? cmp : -cmp
    })
    return arr
  }, [filtered, sortState])

  function toggleSort(key: SortKey) {
    setSortState((cur) => (cur?.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: defaultDir(key) }))
  }

  // Clickable sortable column header. Shows ↕ when inactive, ▲/▼ when it
  // drives the current sort.
  const sortableTh = (label: string, key: SortKey, style: CSSProperties) => {
    const active = sortState?.key === key
    const arrow = active ? (sortState?.dir === 'asc' ? '▲' : '▼') : '↕'
    return (
      <th
        style={{ ...style, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
        onClick={() => toggleSort(key)}
        aria-sort={active ? (sortState?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
        title={t('Click to sort', 'Click to sort')}
      >
        {label}
        <span style={{ marginLeft: 4, fontSize: '0.85em', color: active ? 'var(--color-status-blue-deep)' : 'var(--color-text-tertiary)' }}>{arrow}</span>
      </th>
    )
  }

  // Export the current filtered + sorted view to CSV, client-side, so the
  // file is an exact copy of what's on screen (the backend list endpoint
  // doesn't apply the criticality/source/search filters that run here).
  // Columns mirror the table; a UTF-8 BOM keeps Excel happy with accents.
  function exportCSV() {
    const headers = ['Asset', 'Asset ID', 'Type', 'Criticality', 'Source', 'Site', 'Switch Port', 'In Scope', 'Present In', 'Tags']
    const esc = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }
    const lines = [headers.join(',')]
    for (const a of sorted) {
      lines.push(
        [
          a.name ?? '',
          a.asset_id,
          a.asset_type ?? '',
          a.criticality ?? '',
          assetSource(a),
          a.datacenter_id ?? '',
          a.switch_port ?? '',
          a.framework_evaluation_enabled === false ? 'false' : 'true',
          (a.present_in ?? []).join('; '),
          (a.tags ?? []).join('; '),
        ]
          .map(esc)
          .join(','),
      )
    }
    const blob = new Blob([BOM + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'inventory.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  // Reset to the first page when the filter criteria, sort, or page size
  // change — but NOT on a plain data refresh, so a scope toggle doesn't
  // bounce the operator back to page 1.
  useEffect(() => {
    setPage(0)
  }, [assetTypeFilter, sourceFilter, criticalityFilter, search, pageSize, sortState])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const paged = useMemo(
    () => sorted.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [sorted, currentPage, pageSize],
  )

  const counts = useMemo(() => {
    const byType: Record<string, number> = {}
    for (const asset of assets) {
      const key = String(asset.asset_type ?? 'unknown').toLowerCase()
      byType[key] = (byType[key] ?? 0) + 1
    }
    return byType
  }, [assets])

  function pushFilter(key: 'asset_type' | 'source' | 'criticality', value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (value) params.set(key, value)
    else params.delete(key)
    const qs = params.toString()
    router.push(qs ? `/inventory?${qs}` : '/inventory')
  }

  function pushSearch(value: string) {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (value) params.set('q', value)
    else params.delete('q')
    const qs = params.toString()
    router.push(qs ? `/inventory?${qs}` : '/inventory')
  }

  return (
    <>
      <Topbar
        title={t('Inventory', 'Inventory')}
        left={
          tab === 'assets' ? (
            <Badge tone="navy">
              {t('{count} assets', '{count} assets', { count: assets.length })}
            </Badge>
          ) : null
        }
        right={
          tab === 'assets' ? (
            <>
              <FilterBar
                assetTypeFilter={assetTypeFilter}
                criticalityFilter={criticalityFilter}
                sourceFilter={sourceFilter}
                search={search}
                assetTypes={assetTypes}
                sources={sources}
                onAssetType={(v) => pushFilter('asset_type', v)}
                onCriticality={(v) => pushFilter('criticality', v)}
                onSource={(v) => pushFilter('source', v)}
                onSearch={pushSearch}
              />
              <GhostButton onClick={exportCSV} disabled={sorted.length === 0}>
                <i className="ti ti-download" aria-hidden="true" />
                {t('Export CSV', 'Export CSV')}
              </GhostButton>
              <PrimaryButton onClick={refreshFromConnectors} disabled={importing}>
                {importing ? (
                  <>
                    <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                    {t('Updating…', 'Updating…')}
                  </>
                ) : (
                  <>
                    <i className="ti ti-refresh" aria-hidden="true" />
                    {t('Update', 'Update')}
                  </>
                )}
              </PrimaryButton>
            </>
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {info ? <Banner tone="success">{info}</Banner> : null}

        <RegistryTabs tab={tab} onTab={pushTab} />

        {notInCMDB ? (
          <Banner tone="warning" title={t('Filtered: assets NOT registered in CMDB', 'Filtered: assets NOT registered in CMDB')}>
            {t(
              'Showing inventory rows discovered by connectors (vCenter, PowerStore, Cisco, etc.) that no CMDB source (GLPI, ServiceNow) has observed. These are the registration gaps an auditor will flag.',
              'Showing inventory rows discovered by connectors (vCenter, PowerStore, Cisco, etc.) that no CMDB source (GLPI, ServiceNow) has observed. These are the registration gaps an auditor will flag.',
            )}
            {' '}
            <Link href="/inventory" style={{ color: 'var(--color-status-blue-deep)', textDecoration: 'underline' }}>{t('Clear filter', 'Clear filter')}</Link>
          </Banner>
        ) : null}

        {notInMonitoring ? (
          <Banner tone="warning" title={t('Filtered: assets NOT under monitoring', 'Filtered: assets NOT under monitoring')}>
            {t(
              'Showing inventory rows discovered by connectors that no observability source (Dynatrace, Zabbix) has observed. These hosts are running without telemetry — auditor question: "what is watching this?"',
              'Showing inventory rows discovered by connectors that no observability source (Dynatrace, Zabbix) has observed. These hosts are running without telemetry — auditor question: "what is watching this?"',
            )}
            {' '}
            <Link href="/inventory" style={{ color: 'var(--color-status-blue-deep)', textDecoration: 'underline' }}>{t('Clear filter', 'Clear filter')}</Link>
          </Banner>
        ) : null}

        {tab === 'applications' ? <ApplicationsTab /> : null}
        {tab === 'sites' ? <SitesTab /> : null}
        {tab === 'assets' ? (
          <>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <SummaryTile label={t('Total assets', 'Total assets')} value={assets.length} active={!assetTypeFilter} onClick={() => pushFilter('asset_type', '')} />
          {cmdbGapCount !== null ? (
            <CMDBGapTile
              count={cmdbGapCount}
              active={notInCMDB}
              onClick={() => {
                const params = new URLSearchParams(searchParams?.toString() ?? '')
                if (notInCMDB) params.delete('not_in_cmdb')
                else params.set('not_in_cmdb', 'true')
                params.delete('not_in_monitoring')
                const qs = params.toString()
                router.push(qs ? `/inventory?${qs}` : '/inventory')
              }}
              t={t}
            />
          ) : null}
          {monitoringGapCount !== null ? (
            <MonitoringGapTile
              count={monitoringGapCount}
              active={notInMonitoring}
              onClick={() => {
                const params = new URLSearchParams(searchParams?.toString() ?? '')
                if (notInMonitoring) params.delete('not_in_monitoring')
                else params.set('not_in_monitoring', 'true')
                params.delete('not_in_cmdb')
                const qs = params.toString()
                router.push(qs ? `/inventory?${qs}` : '/inventory')
              }}
              t={t}
            />
          ) : null}
          <AssetTypeTiles
            tiles={orderedAssetTypeTiles(counts)}
            assetTypeFilter={assetTypeFilter}
            onPick={(type) => pushFilter('asset_type', assetTypeFilter === type ? '' : type)}
            t={t}
          />
        </div>

        <Card>
          <CardTitle
            right={
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {t('{count} shown', '{count} shown', { count: filtered.length })}
              </span>
            }
          >
            {t('Asset registry', 'Asset registry')}
          </CardTitle>
          {selected.size > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '8px 12px',
                marginBottom: 8,
                borderRadius: 6,
                background: 'var(--color-surface-secondary)',
                border: '0.5px solid var(--color-border-tertiary)',
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 500 }}>
                {t('{count} selected', '{count} selected', { count: selected.size })}
              </span>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void bulkScopeToggle(false)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: '0.5px solid var(--color-border-tertiary)',
                  background: 'var(--color-surface-primary)',
                  cursor: bulkBusy ? 'wait' : 'pointer',
                  fontSize: 12,
                }}
              >
                {t('Mark out of scope', 'Mark out of scope')}
              </button>
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => void bulkScopeToggle(true)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: '0.5px solid var(--color-border-tertiary)',
                  background: 'var(--color-surface-primary)',
                  cursor: bulkBusy ? 'wait' : 'pointer',
                  fontSize: 12,
                }}
              >
                {t('Mark in scope', 'Mark in scope')}
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--color-text-tertiary)',
                }}
              >
                {t('Clear', 'Clear')}
              </button>
            </div>
          )}
          {loading ? (
            <Skeleton lines={6} height={36} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="ti-database-off"
              title={
                assets.length === 0
                  ? t('No assets in inventory yet', 'No assets in inventory yet')
                  : t('No matches', 'No matches')
              }
              description={
                assets.length === 0
                  ? t(
                      'Assets appear here automatically after each connector poll. Click "Refresh from connectors" to pull immediately, or wait for the next 5-minute cycle.',
                      'Assets appear here automatically after each connector poll. Click "Refresh from connectors" to pull immediately, or wait for the next 5-minute cycle.',
                    )
                  : t(
                      'No assets match the current filters. Clear them to see the full inventory.',
                      'No assets match the current filters. Clear them to see the full inventory.',
                    )
              }
            />
          ) : (
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-tertiary)',
                    textAlign: 'left',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--color-background-primary)',
                    zIndex: 1,
                  }}
                >
                  <th style={{ padding: '6px 0', width: 22 }} aria-hidden="true" />
                  <th style={{ padding: '6px 4px 6px 0', width: 24 }}>
                    <input
                      type="checkbox"
                      title={t('Select all visible', 'Select all visible')}
                      checked={paged.length > 0 && paged.every((a) => selected.has(a.asset_id))}
                      ref={(el) => {
                        if (!el) return
                        const allSelected = paged.length > 0 && paged.every((a) => selected.has(a.asset_id))
                        const someSelected = paged.some((a) => selected.has(a.asset_id))
                        el.indeterminate = someSelected && !allSelected
                      }}
                      onChange={(e) => {
                        const next = new Set(selected)
                        if (e.target.checked) {
                          paged.forEach((a) => next.add(a.asset_id))
                        } else {
                          paged.forEach((a) => next.delete(a.asset_id))
                        }
                        setSelected(next)
                      }}
                    />
                  </th>
                  {sortableTh(t('Asset', 'Asset'), 'name', { padding: '6px 10px 6px 0' })}
                  {sortableTh(t('Type', 'Type'), 'asset_type', { padding: '6px 10px' })}
                  {sortableTh(t('Criticality', 'Criticality'), 'criticality', { padding: '6px 10px' })}
                  {sortableTh(t('Source', 'Source'), 'source', { padding: '6px 10px' })}
                  {sortableTh(t('Site', 'Site'), 'datacenter_id', { padding: '6px 0 6px 10px' })}
                </tr>
              </thead>
              <tbody>
                {paged.map((asset) => (
                  <AssetRow
                    key={asset.asset_id}
                    asset={asset}
                    sites={sites}
                    tier={tierByAssetID[asset.asset_id]}
                    busy={assigningAssetId === asset.asset_id}
                    onAssign={(siteID) => void assignSite(asset, siteID)}
                    selected={selected.has(asset.asset_id)}
                    onToggleSelect={(checked) => {
                      const next = new Set(selected)
                      if (checked) next.add(asset.asset_id)
                      else next.delete(asset.asset_id)
                      setSelected(next)
                    }}
                    expanded={expanded.has(asset.asset_id)}
                    onToggleExpand={() => toggleExpand(asset.asset_id)}
                    colSpan={7}
                    cachedDetail={detailCache[asset.asset_id]}
                    onDetailLoaded={(detail) =>
                      setDetailCache((prev) => ({ ...prev, [asset.asset_id]: detail }))
                    }
                  />
                ))}
              </tbody>
            </table>
            </div>
          )}
          {filtered.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <Pagination
                page={currentPage}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s)
                  setPage(0)
                }}
                label={t('Inventory', 'Inventory')}
              />
            </div>
          ) : null}
        </Card>
          </>
        ) : null}
      </div>
    </>
  )
}

function AssetRow({
  asset,
  sites,
  tier,
  busy,
  onAssign,
  selected,
  onToggleSelect,
  expanded,
  onToggleExpand,
  colSpan,
  cachedDetail,
  onDetailLoaded,
}: {
  asset: InventoryAsset
  sites: SiteOption[]
  tier?: AppTierLink
  busy: boolean
  onAssign: (siteID: string) => void
  selected: boolean
  onToggleSelect: (checked: boolean) => void
  expanded: boolean
  onToggleExpand: () => void
  colSpan: number
  cachedDetail?: EnrichedAsset
  onDetailLoaded: (detail: EnrichedAsset) => void
}) {
  const { t } = useI18n()
  const displayName = (asset.name && asset.name.trim()) || asset.asset_id
  const assetType = String(asset.asset_type ?? '').toLowerCase()
  // network_link assets are EDGES between two real assets, so the
  // primary row label should visually express the A ↔ B relationship
  // rather than just a single device:interface. Endpoints ride on
  // metadata.endpoints; older single-sided observations (created
  // before commit 143fca9) only have one entry and render as
  // "A ↔ (peer pending discovery)".
  const isLinkAsset = assetType === 'network_link'
  const linkEndpoints = isLinkAsset
    ? (Array.isArray(asset.metadata?.['endpoints']) ? asset.metadata!['endpoints'] as Array<Record<string, unknown>> : [])
    : []
  const linkMembers = isLinkAsset
    ? (Array.isArray(asset.metadata?.['members']) ? asset.metadata!['members'] as Array<Record<string, unknown>> : [])
    : []
  const linkMemberCount = isLinkAsset
    ? Number(asset.metadata?.['member_count'] ?? linkMembers.length ?? 0)
    : 0
  const criticality = String(asset.criticality ?? '').toLowerCase()
  // Source pills: prefer the backend's cross-referenced present_in
  // list (built from the live connector snapshot — shows every
  // connector that observed this asset). Fall back to external_refs
  // for offline / cold-cache states. Dedupe + sort so the badge
  // order stays stable across refreshes.
  const externalRefSources = (asset.external_refs ?? []).map((ref) => ref.source?.split(':')[0]).filter(Boolean) as string[]
  const presentIn = (asset.present_in ?? []) as string[]
  const sources = Array.from(new Set([...presentIn, ...externalRefSources])).sort()
  const tags = asset.tags ?? []
  const currentSite = String(asset.datacenter_id ?? '').trim()
  const [overrideVMSite, setOverrideVMSite] = useState(false)
  // VM "location" is cluster-first, not site-first. A VM never
  // leaves its cluster, so cluster is the stable identity. Site
  // is only an honest claim when the cluster isn't stretched —
  // stretched clusters span 2+ sites and vMotion moves VMs
  // between them constantly, so any per-VM site assertion would
  // be stale within minutes.
  const siteOrigin = String(asset.metadata?.['site_origin'] ?? '').toLowerCase()
  const isVM = assetType === 'vm'
  const isDerivedVMSite = isVM && siteOrigin !== 'explicit'
  const vmClusterName =
    String(asset.metadata?.['cluster_name'] ?? '').trim() ||
    String(asset.metadata?.['vcenter_cluster'] ?? '').trim()
  const vmIsStretched = Boolean(asset.metadata?.['is_stretched_cluster'])
  // Storage volume "location" is the parent array's name, not a
  // physical site. The site already lives on the storage_array row;
  // repeating it across 100+ volumes adds noise. Operator's mental
  // model is "this volume belongs to POWERSTOREA01" — surface that
  // directly. Collector stamps metadata.array_name at emission.
  const isStorageVolume = assetType === 'storage_volume'
  const storageVolumeArrayName = String(asset.metadata?.['array_name'] ?? '').trim()
  // Storage array: surface its provisioned-volume count as a one-line
  // capacity hint under the name. Backend stamps metadata.volume_count
  // (full Primary count) alongside top_volumes during the PowerStore poll.
  const isStorageArray = assetType === 'storage_array'
  const arrayVolumeCount = isStorageArray ? Number(asset.metadata?.['volume_count'] ?? 0) : 0
  // Cluster row metadata: effective_sites + stretched flag the
  // backend recomputes after every poll.
  const isCluster = assetType === 'cluster'
  const effectiveSites = Array.isArray(asset.metadata?.['effective_sites'])
    ? (asset.metadata?.['effective_sites'] as unknown[]).map((v) => String(v))
    : []
  const isStretched = Boolean(asset.metadata?.['stretched']) || effectiveSites.length > 1
  // Criticality enum is fixed; translate via i18n. Unknown values
  // (a connector emitting something off-vocabulary) fall back to
  // the raw value via t()'s default-literal mechanism.
  const criticalityLabel = criticality
    ? t(criticality.charAt(0).toUpperCase() + criticality.slice(1), criticality)
    : ''
  // Out-of-scope assets get visually dimmed so the operator can see
  // at a glance which rows aren't being graded by the compliance
  // engine. opacity 0.55 reads as "muted but still legible".
  const outOfScope = asset.framework_evaluation_enabled === false
  return (
    <>
    <tr
      style={{
        borderTop: '0.5px solid var(--color-border-tertiary)',
        opacity: outOfScope ? 0.55 : 1,
        background: expanded ? 'var(--color-background-secondary)' : undefined,
      }}
    >
      <td style={{ padding: '10px 0', verticalAlign: 'top' }}>
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? t('Collapse detail', 'Collapse detail') : t('Expand detail', 'Expand detail')}
          title={expanded ? t('Hide connector detail', 'Hide connector detail') : t('Show connector detail', 'Show connector detail')}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'var(--color-text-tertiary)',
            padding: 0,
          }}
        >
          <i
            className="ti ti-chevron-right"
            aria-hidden="true"
            style={{
              fontSize: 15,
              transition: 'transform 0.14s ease',
              transform: expanded ? 'rotate(90deg)' : 'none',
            }}
          />
        </button>
      </td>
      <td style={{ padding: '10px 4px 10px 0', verticalAlign: 'top' }}>
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(e.target.checked)}
          aria-label={`Select ${displayName}`}
        />
      </td>
      <td style={{ padding: '10px 10px 10px 0' }}>
        <a
          href={`/inventory/${encodeURIComponent(asset.asset_id)}`}
          style={{ fontWeight: 500, textDecoration: 'none', color: 'var(--color-text-primary)' }}
        >
          {isLinkAsset ? (
            // Network-link rows fold the A ↔ B relationship into the
            // single Asset cell now that the dedicated partner column
            // is gone — link identity stays legible on one line.
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <LinkAssetEndpoint
                endpoint={linkEndpoints[0]}
                members={linkMembers}
                memberCount={linkMemberCount}
                side="a"
              />
              <span style={{ color: 'var(--color-text-tertiary)' }}>↔</span>
              <LinkAssetEndpoint
                endpoint={linkEndpoints[1]}
                members={linkMembers}
                memberCount={linkMemberCount}
                side="b"
              />
            </span>
          ) : (
            displayName
          )}
        </a>
        {outOfScope && (
          <span
            style={{
              marginLeft: 8,
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 4,
              background: 'var(--color-surface-secondary)',
              color: 'var(--color-text-tertiary)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {t('Out of scope', 'Out of scope')}
          </span>
        )}
        {/* asset_id de-emphasised to a tertiary, smaller subline so the
            row scans on the name first. Full id stays visible (and in
            the CSV / detail page). */}
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', opacity: 0.8 }}>
          {asset.asset_id}
        </div>
        {isStorageArray && arrayVolumeCount > 0 ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            <i className="ti ti-stack-2" aria-hidden="true" style={{ fontSize: 11, marginRight: 4 }} />
            {t('{n} volumes', '{n} volumes', { n: arrayVolumeCount })}
          </div>
        ) : null}
      </td>
      <td style={{ padding: '10px' }}>
        {assetType ? <Badge tone="navy">{translatedAssetTypeLabel(t, assetType)}</Badge> : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
      </td>
      <td style={{ padding: '10px' }}>
        {criticality ? (
          <Badge tone={CRITICALITY_TONE[criticality] ?? 'gray'}>{criticalityLabel}</Badge>
        ) : (
          <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        )}
      </td>
      <td style={{ padding: '10px' }}>
        {sources.length === 0 ? (
          <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }} title={sources.join(', ')}>
            {sources.slice(0, 3).map((src) => (
              <span
                key={src}
                style={{
                  fontSize: 10,
                  padding: '2px 6px',
                  background: 'var(--color-background-secondary)',
                  borderRadius: 'var(--border-radius-sm)',
                  fontFamily: 'var(--font-mono)',
                }}
                title={src}
              >
                {src}
              </span>
            ))}
            {sources.length > 3 ? (
              <span
                style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}
                title={sources.slice(3).join(', ')}
              >
                +{sources.length - 3}
              </span>
            ) : null}
          </span>
        )}
      </td>
      <td style={{ padding: '10px 0 10px 10px' }}>
        {isCluster && isStretched ? (
          // Stretched cluster: multiple member-host sites. The
          // cluster has no single canonical site; the badge lists
          // every site the cluster spans plus a "stretched" flag.
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge tone="amber" icon="ti-arrows-shuffle">
              {t('Stretched', 'Stretched')}
            </Badge>
            {effectiveSites.map((siteID) => {
              const label = sites.find((s) => s.site_id === siteID)?.display_name ?? siteID
              return (
                <span
                  key={siteID}
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    background: 'var(--color-background-secondary)',
                    borderRadius: 'var(--border-radius-sm)',
                    fontFamily: 'var(--font-mono)',
                  }}
                  title={siteID}
                >
                  {label}
                </span>
              )
            })}
          </span>
        ) : isLinkAsset ? (
          // Network link: render BOTH endpoint sites with an arrow
          // so the operator immediately sees "paris ↔ lyon" for
          // intersite bundles. Same-site bundles collapse to a
          // single label. Empty side renders as "?".
          (() => {
            const siteA = String(asset.metadata?.['site_a'] ?? '').trim()
            const siteB = String(asset.metadata?.['site_b'] ?? '').trim()
            if (!siteA && !siteB) {
              return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
            }
            if (siteA && siteB && siteA === siteB) {
              return (
                <span style={{ fontSize: 11, padding: '2px 6px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-sm)', fontFamily: 'var(--font-mono)' }}>
                  {siteA}
                </span>
              )
            }
            return (
              <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                <span style={{ padding: '2px 6px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-sm)' }}>
                  {siteA || '?'}
                </span>
                <span style={{ color: 'var(--color-text-tertiary)' }}>↔</span>
                <span style={{ padding: '2px 6px', background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-sm)' }}>
                  {siteB || '?'}
                </span>
              </span>
            )
          })()
        ) : isStorageVolume ? (
          // Storage volume: its datacenter is INHERITED from the hosts
          // running its VMs (deriveStorageVolumeSites). Show that real
          // site when resolved, with the parent array name as a secondary
          // identity; fall back to the array name alone before the
          // derivation has a site (e.g. an unmounted / cross-DC volume).
          currentSite ? (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  background: 'var(--color-background-secondary)',
                  borderRadius: 'var(--border-radius-sm)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-primary)',
                }}
                title={t('Site', 'Site')}
              >
                {currentSite}
              </span>
              {storageVolumeArrayName ? (
                <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{storageVolumeArrayName}</span>
              ) : null}
            </span>
          ) : storageVolumeArrayName ? (
            <span
              style={{
                fontSize: 11,
                padding: '2px 6px',
                background: 'var(--color-background-secondary)',
                borderRadius: 'var(--border-radius-sm)',
                fontFamily: 'var(--font-mono)',
                color: 'var(--color-text-primary)',
              }}
              title={t('Storage array', 'Storage array')}
            >
              {storageVolumeArrayName}
            </span>
          ) : (
            <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
          )
        ) : isDerivedVMSite && !overrideVMSite ? (
          // VM with derived location: cluster is the primary,
          // stable identity (VM never leaves its cluster). Site
          // shown only when the cluster is non-stretched, since
          // stretched clusters span 2+ sites and per-VM site is
          // misleading there. Override link lets the operator
          // pin a manual site if they need one anyway — with a
          // tooltip warning about vMotion staleness.
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, flexWrap: 'wrap' }}>
            {vmClusterName ? (
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 6px',
                  background: 'var(--color-background-secondary)',
                  borderRadius: 'var(--border-radius-sm)',
                  fontFamily: 'var(--font-mono)',
                  color: 'var(--color-text-primary)',
                }}
                title={t('Cluster', 'Cluster')}
              >
                {vmClusterName}
              </span>
            ) : (
              <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
            )}
            {vmIsStretched ? (
              <Badge tone="amber" icon="ti-arrows-shuffle">
                {t('Stretched', 'Stretched')}
              </Badge>
            ) : currentSite ? (
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                ↳ {currentSite}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setOverrideVMSite(true)}
              style={{
                fontSize: 10,
                color: 'var(--color-text-tertiary)',
                background: 'transparent',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                textDecoration: 'underline',
              }}
              title={t(
                'Override with a manual site. Stretched-cluster VMs vMotion between sites; a pinned value will go stale.',
                'Override with a manual site. Stretched-cluster VMs vMotion between sites; a pinned value will go stale.',
              )}
            >
              {t('Override', 'Override')}
            </button>
          </span>
        ) : (
          <select
            value={currentSite}
            onChange={(e) => onAssign(e.target.value)}
            disabled={busy || sites.length === 0}
            style={{
              fontSize: 11,
              padding: '4px 6px',
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-sm)',
              background: 'var(--color-background-primary)',
              color: currentSite ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              fontFamily: 'inherit',
              minWidth: 120,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            <option value="">— —</option>
            {/* Surface the current value even if it isn't in the
                loaded sites list (e.g. a legacy datacenter_id that
                no longer maps to a registered site). */}
            {currentSite && !sites.some((s) => s.site_id === currentSite) ? (
              <option value={currentSite}>{currentSite} (not registered)</option>
            ) : null}
            {sites.map((s) => (
              <option key={s.site_id} value={s.site_id}>
                {s.display_name ? `${s.display_name} (${s.site_id})` : s.site_id}
              </option>
            ))}
          </select>
        )}
      </td>
    </tr>
    {expanded ? (
      <tr>
        <td
          colSpan={colSpan}
          style={{
            padding: '4px 12px 16px 30px',
            background: 'var(--color-background-secondary)',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
          }}
        >
          {/* Attributes block — surfaces the App tier / Switch port /
              Tags details that used to have their own table columns.
              They moved here (not removed) so the default table scans
              lighter while nothing becomes unreachable; these also
              stay in the CSV export and on the asset detail page. */}
          <RowAttributes tier={tier} switchPort={asset.switch_port} tags={tags} />
          <AssetExpandedPanel
            assetID={asset.asset_id}
            cached={cachedDetail}
            onLoaded={onDetailLoaded}
          />
        </td>
      </tr>
    ) : null}
    </>
  )
}

// RowAttributes renders the niche attributes (app tier, switch port,
// tags) that were trimmed from the default table columns. It only
// renders the fields that have a value, so a thin row shows nothing
// and the panel stays compact. Sourced from the list row's own props
// (not the lazy-fetched detail) so the values are always present the
// moment the row expands.
function RowAttributes({
  tier,
  switchPort,
  tags,
}: {
  tier?: AppTierLink
  switchPort?: string | null
  tags: string[]
}) {
  const { t } = useI18n()
  const hasTier = Boolean(tier)
  const hasSwitchPort = Boolean(switchPort && switchPort.trim())
  const hasTags = tags.length > 0
  if (!hasTier && !hasSwitchPort && !hasTags) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 10,
          color: 'var(--color-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          marginBottom: 6,
        }}
      >
        {t('Attributes', 'Attributes')}
      </div>
      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {hasTier ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('App tier', 'App tier')}</span>
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <Badge tone={TIER_TONE[tier!.app_tier] ?? 'gray'}>{tierLabel(tier!.app_tier)}</Badge>
              <a
                href={`/apps/${encodeURIComponent(tier!.app_id)}`}
                style={{
                  fontSize: 11,
                  color: 'var(--color-text-tertiary)',
                  textDecoration: 'none',
                  fontFamily: 'var(--font-mono)',
                }}
                title={t('Open application', 'Open application')}
              >
                {tier!.app_name || tier!.app_id}
              </a>
            </span>
          </div>
        ) : null}
        {hasSwitchPort ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('Switch port', 'Switch port')}</span>
            <span
              style={{
                fontSize: 11,
                padding: '2px 6px',
                background: 'var(--color-status-blue-bg)',
                color: 'var(--color-status-blue-deep)',
                borderRadius: 'var(--border-radius-sm)',
                fontFamily: 'var(--font-mono)',
                display: 'inline-block',
                alignSelf: 'flex-start',
              }}
              title={t('Discovered via Cisco MAC address table', 'Discovered via Cisco MAC address table')}
            >
              {switchPort}
            </span>
          </div>
        ) : null}
        {hasTags ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('Tags', 'Tags')}</span>
            <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
              {tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    fontSize: 10,
                    padding: '2px 6px',
                    background: 'var(--color-background-tertiary)',
                    borderRadius: 'var(--border-radius-sm)',
                    color: 'var(--color-text-secondary)',
                  }}
                >
                  {tag}
                </span>
              ))}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// CMDBGapTile is a special SummaryTile variant for the "Not in CMDB"
// filter — amber when there's a registration gap, green when every
// discovered asset is also in GLPI / ServiceNow. Active state pins
// the tile background so it's clear the table below is filtered.
function CMDBGapTile({
  count,
  active,
  onClick,
  t,
}: {
  count: number
  active: boolean
  onClick: () => void
  t: (key: string, defaultText?: string, vars?: Record<string, string | number>) => string
}) {
  const tone = count > 0 ? 'amber' : 'green'
  const bgColor = active
    ? tone === 'amber'
      ? 'var(--color-status-amber-bg)'
      : 'var(--color-status-green-bg)'
    : 'var(--color-background-primary)'
  const valueColor = tone === 'amber'
    ? 'var(--color-status-amber-mid)'
    : 'var(--color-status-green-deep)'
  return (
    <button
      type="button"
      onClick={onClick}
      title={t(
        'Click to toggle filter: assets discovered by connectors but NOT observed by any CMDB source (GLPI, ServiceNow). Registration gap.',
        'Click to toggle filter: assets discovered by connectors but NOT observed by any CMDB source (GLPI, ServiceNow). Registration gap.',
      )}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        border: `1px solid ${tone === 'amber' ? 'var(--color-status-amber-mid)' : 'var(--color-border-tertiary)'}`,
        borderRadius: 'var(--border-radius-md)',
        background: bgColor,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
        {t('Not in CMDB', 'Not in CMDB')}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: valueColor, marginTop: 4 }}>{count}</div>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
        {count > 0 ? t('registration gap', 'registration gap') : t('all registered', 'all registered')}
      </div>
    </button>
  )
}

// MonitoringGapTile mirrors CMDBGapTile but cross-references against
// observability connectors (Dynatrace, Zabbix, ...). Same amber/green
// tone logic — amber when there's a monitoring gap, green when every
// monitorable discovered asset is also under observation.
function MonitoringGapTile({
  count,
  active,
  onClick,
  t,
}: {
  count: number
  active: boolean
  onClick: () => void
  t: (key: string, defaultText?: string, vars?: Record<string, string | number>) => string
}) {
  const tone = count > 0 ? 'amber' : 'green'
  const bgColor = active
    ? tone === 'amber'
      ? 'var(--color-status-amber-bg)'
      : 'var(--color-status-green-bg)'
    : 'var(--color-background-primary)'
  const valueColor = tone === 'amber'
    ? 'var(--color-status-amber-mid)'
    : 'var(--color-status-green-deep)'
  return (
    <button
      type="button"
      onClick={onClick}
      title={t(
        'Click to toggle filter: assets discovered by connectors but NOT observed by any monitoring source (Dynatrace, Zabbix). Observability gap.',
        'Click to toggle filter: assets discovered by connectors but NOT observed by any monitoring source (Dynatrace, Zabbix). Observability gap.',
      )}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        border: `1px solid ${tone === 'amber' ? 'var(--color-status-amber-mid)' : 'var(--color-border-tertiary)'}`,
        borderRadius: 'var(--border-radius-md)',
        background: bgColor,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
        {t('Not in Monitoring', 'Not in Monitoring')}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: valueColor, marginTop: 4 }}>{count}</div>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
        {count > 0 ? t('observability gap', 'observability gap') : t('all observed', 'all observed')}
      </div>
    </button>
  )
}

function SummaryTile({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        padding: '10px 12px',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-md)',
        background: active ? 'var(--color-status-blue-bg)' : 'var(--color-background-primary)',
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 4 }}>{value}</div>
    </button>
  )
}

// AssetTypeTiles renders the per-asset-type summary tiles with a
// "top N" cap so the tile wall stays light. The remaining types fold
// behind a subtle "+N more types" affordance that expands the rest
// inline — every type is still reachable here (and via the Type
// filter), so nothing is lost. The currently-filtered type is always
// kept visible above the fold so the active selection never hides.
const ASSET_TYPE_TILE_CAP = 6
function AssetTypeTiles({
  tiles,
  assetTypeFilter,
  onPick,
  t,
}: {
  tiles: Array<[string, number]>
  assetTypeFilter: string
  onPick: (type: string) => void
  t: (key: string, defaultText?: string, vars?: Record<string, string | number>) => string
}) {
  const [showAll, setShowAll] = useState(false)
  // Keep the first ASSET_TYPE_TILE_CAP tiles, but always surface the
  // active-filter tile even if its count would push it below the fold.
  const head: Array<[string, number]> = tiles.slice(0, ASSET_TYPE_TILE_CAP)
  const tail: Array<[string, number]> = tiles.slice(ASSET_TYPE_TILE_CAP)
  const activeInTail =
    assetTypeFilter && tail.find(([type]) => type === assetTypeFilter)
  const visible: Array<[string, number]> =
    showAll || tail.length === 0
      ? tiles
      : activeInTail
        ? [...head, activeInTail]
        : head
  const hiddenCount = tiles.length - visible.length
  return (
    <>
      {visible.map(([type, count]) => (
        <SummaryTile
          key={type}
          label={translatedAssetTypeLabel(t, type)}
          value={count}
          active={assetTypeFilter === type}
          onClick={() => onPick(type)}
        />
      ))}
      {tail.length > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            padding: '10px 12px',
            border: '0.5px dashed var(--color-border-tertiary)',
            borderRadius: 'var(--border-radius-md)',
            background: 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 11,
            color: 'var(--color-text-tertiary)',
          }}
        >
          <i
            className={`ti ${showAll ? 'ti-chevron-up' : 'ti-chevron-down'}`}
            aria-hidden="true"
            style={{ fontSize: 13 }}
          />
          {showAll
            ? t('Show fewer types', 'Show fewer types')
            : t('+{n} more types', '+{n} more types', { n: hiddenCount })}
        </button>
      ) : null}
    </>
  )
}

function FilterBar({
  assetTypeFilter,
  criticalityFilter,
  sourceFilter,
  search,
  assetTypes,
  sources,
  onAssetType,
  onCriticality,
  onSource,
  onSearch,
}: {
  assetTypeFilter: string
  criticalityFilter: string
  sourceFilter: string
  search: string
  assetTypes: string[]
  sources: string[]
  onAssetType: (v: string) => void
  onCriticality: (v: string) => void
  onSource: (v: string) => void
  onSearch: (v: string) => void
}) {
  const { t } = useI18n()
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
      <input
        type="search"
        value={search}
        placeholder={t('Search…', 'Search…')}
        onChange={(e) => onSearch(e.target.value)}
        style={{
          fontSize: 11,
          padding: '4px 8px',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 'var(--border-radius-md)',
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-primary)',
          fontFamily: 'inherit',
          width: 160,
        }}
      />
      <SelectChip label={t('Type', 'Type')} value={assetTypeFilter} options={assetTypes} onChange={onAssetType} />
      <SelectChip
        label={t('Criticality', 'Criticality')}
        value={criticalityFilter}
        options={['critical', 'high', 'medium', 'low']}
        onChange={onCriticality}
      />
      <SelectChip label={t('Source', 'Source')} value={sourceFilter} options={sources} onChange={onSource} />
    </div>
  )
}

function SelectChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (next: string) => void
}) {
  const { t } = useI18n()
  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      style={{
        fontSize: 11,
        padding: '4px 8px',
        border: '0.5px solid var(--color-border-secondary)',
        borderRadius: 'var(--border-radius-md)',
        background: 'var(--color-background-primary)',
        color: 'var(--color-text-primary)',
        fontFamily: 'inherit',
      }}
    >
      <option value="">{label}{t(': any', ': any')}</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {label}: {translatedAssetTypeLabel(t, opt)}
        </option>
      ))}
    </select>
  )
}

// formatAssetTypeLabel is the pure fallback used when no translation
// hook is available (e.g. in option arrays computed outside a
// component). It just title-cases the raw value. For per-row /
// per-option rendering, prefer translatedAssetTypeLabel(t, value)
// which routes through i18n so dropdown options show in the user's
// language.
function formatAssetTypeLabel(value: string): string {
  return value
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

// LinkAssetEndpoint renders ONE side of a network_link asset. The
// inventory table places both sides inline in the Asset cell as
// "A ↔ B" (side "a" then side "b") so the link relationship stays
// legible on one line now that the dedicated partner column is gone.
//
// Each side shows the friendly asset name on top and, beneath it,
// either the physical interface name (1-member bundle) or
// "<N> members" (multi-member bundle). Per-cable detail lives in
// metadata.members and renders in the asset detail page.
//
// When the side is missing (legacy single-sided observation, the
// 130 old assets), the "b" side renders italic "(peer pending)"
// so the gap stays visible.
function LinkAssetEndpoint({
  endpoint,
  members,
  memberCount,
  side,
}: {
  endpoint: Record<string, unknown> | undefined
  members: Array<Record<string, unknown>>
  memberCount: number
  side: 'a' | 'b'
}) {
  const { t } = useI18n()
  if (!endpoint) {
    return (
      <span style={{ fontStyle: 'italic', color: 'var(--color-text-tertiary)' }}>
        {t('peer pending', 'peer pending')}
      </span>
    )
  }
  const ifaceKey = side === 'a' ? 'interface_a' : 'interface_b'
  const ifaceSummary = (() => {
    if (memberCount > 1) return `${memberCount} ${t('members', 'members')}`
    if (members[0]) return String(members[0][ifaceKey] ?? '')
    return ''
  })()
  const label = String(endpoint['label'] ?? '').trim()
  const assetID = String(endpoint['asset_id'] ?? endpoint['device'] ?? '').trim()
  const shown = label || assetID || '(unknown)'
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0 }}>
      <span style={{ fontWeight: 500 }}>{shown}</span>
      {ifaceSummary && (
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {ifaceSummary}
        </span>
      )}
    </span>
  )
}

// translatedAssetTypeLabel maps the backend's asset_type string to a
// localised label. The English form is the i18n key; t() handles the
// per-language lookup. Falls through to the title-cased raw value
// when the type is one the dictionary doesn't know yet — so a new
// connector emitting an unmapped asset_type still renders something
// readable instead of "??firewall??".
function translatedAssetTypeLabel(
  t: (key: string, defaultText?: string) => string,
  value: string,
): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized) return ''
  const known: Record<string, string> = {
    firewall: 'Firewall',
    firewall_manager: 'Firewall manager',
    server: 'Server',
    host: 'Hypervisor host',
    vm: 'Virtual machine',
    cluster: 'Cluster',
    storage: 'Storage',
    storage_array: 'Storage array',
    storage_volume: 'Storage volume',
    storage_host: 'Storage host',
    backup_appliance: 'Backup appliance',
    repository: 'Repository',
    datacenter: 'Datacenter',
    network_device: 'Network device',
    network: 'Network',
    application: 'Application',
    service: 'Service',
    computer: 'Computer',
    device: 'Device',
    ec2: 'EC2 instance',
    other: 'Other',
    unknown: 'Unknown',
  }
  const englishLabel = known[normalized]
  if (englishLabel) return t(englishLabel, englishLabel)
  return formatAssetTypeLabel(value)
}

// orderedAssetTypeTiles decides which asset_type tiles get a summary
// tile and in what order. The naive "top 6 by count desc" approach
// hides sparse infrastructure types (storage_array, firewall_manager,
// cluster) the moment the inventory is dominated by VMs — an operator
// looking at 200+ VMs may genuinely not realize their 4 PowerStore
// arrays are in inventory because the tile fell off the list.
//
// Fix: pin the well-known infrastructure types in a stable order so
// they always appear if at least one asset of that type exists, then
// append any remaining types (in count-desc order) up to a generous
// cap. Operator scans down a predictable layout instead of having
// the tile grid reshuffle itself every poll.
function orderedAssetTypeTiles(counts: Record<string, number>): Array<[string, number]> {
  const pinned = [
    'vm',
    'host',
    'cluster',
    'storage_array',
    'firewall',
    'firewall_manager',
    'network_device',
    'server',
    'backup_appliance',
  ]
  const seen = new Set<string>()
  const out: Array<[string, number]> = []
  for (const type of pinned) {
    if (counts[type] !== undefined && counts[type] > 0) {
      out.push([type, counts[type]])
      seen.add(type)
    }
  }
  const rest = Object.entries(counts)
    .filter(([type, count]) => !seen.has(type) && count > 0 && !TILE_HIDDEN_TYPES.has(type))
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12 - out.length)
  return out.concat(rest)
}

// TILE_HIDDEN_TYPES are platform-synthesised topology / storage
// artefact rows that exist as inventory entries (for graph rendering,
// per-LUN storage drill-down, etc.) but are NOT what an auditor or
// operator thinks of as "an asset on the estate". Showing them as
// summary tiles inflates the dashboard with high-count noise
// (`network_link_member` alone can be ~3× the real asset count on a
// fully-cabled site) and pushes the actually-registerable types off
// the breakdown.
//
// Mirrors the backend isCMDBRegisterableType exclusion list — same
// rationale: a CMDB does not register cables or per-LUN volumes, so
// the inventory dashboard shouldn't headline them either.
const TILE_HIDDEN_TYPES = new Set<string>([
  'network_link',
  'network_link_member',
  'network_adjacency',
  'storage_volume',
  'storage_snapshot',
  'storage_clone',
])

// RegistryTabs — sits at the top of /inventory and gives the auditor
// a one-glance view of EVERYTHING in scope: physical assets +
// declared applications + declared sites. Clicking a chip switches
// the tab pane in-place (no route change) so the operator stays
// anchored to the unified registry view. Counts come from
// /v1/registry/overview.
type RegistryOverview = {
  assets?: { count?: number; by_type?: Record<string, number> }
  applications?: { count?: number; gxp_validated?: number }
  sites?: { count?: number; with_dr?: number }
}

function RegistryTabs({
  tab,
  onTab,
}: {
  tab: 'assets' | 'applications' | 'sites'
  onTab: (next: 'assets' | 'applications' | 'sites') => void
}) {
  const { t } = useI18n()
  const [overview, setOverview] = useState<RegistryOverview | null>(null)
  useEffect(() => {
    let cancelled = false
    apiFetch('/registry/overview')
      .then((r) => (r.ok ? r.json() : null))
      .then((body: RegistryOverview | null) => {
        if (!cancelled && body) setOverview(body)
      })
      .catch(() => {
        // Endpoint is brand-new; older backends 404. Silent failure
        // keeps the page functional on a partial deploy.
      })
    return () => {
      cancelled = true
    }
  }, [])
  const chips: Array<{
    key: 'assets' | 'applications' | 'sites'
    label: string
    count: number
    sub: string
    icon: string
  }> = [
    {
      key: 'assets',
      label: t('Assets', 'Assets'),
      count: overview?.assets?.count ?? 0,
      sub: t('Discovered by connectors', 'Discovered by connectors'),
      icon: 'ti-stack',
    },
    {
      key: 'applications',
      label: t('Applications', 'Applications'),
      count: overview?.applications?.count ?? 0,
      sub:
        (overview?.applications?.gxp_validated ?? 0) > 0
          ? t('{n} GxP-validated', '{n} GxP-validated', { n: overview?.applications?.gxp_validated ?? 0 })
          : t('Operator-declared', 'Operator-declared'),
      icon: 'ti-apps',
    },
    {
      key: 'sites',
      label: t('Sites', 'Sites'),
      count: overview?.sites?.count ?? 0,
      sub:
        (overview?.sites?.with_dr ?? 0) > 0
          ? t('{n} with DR pair', '{n} with DR pair', { n: overview?.sites?.with_dr ?? 0 })
          : t('Operator-declared', 'Operator-declared'),
      icon: 'ti-building',
    },
  ]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 10,
        marginBottom: 14,
      }}
    >
      {chips.map((c) => {
        const active = c.key === tab
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => onTab(c.key)}
            aria-pressed={active}
            title={active ? undefined : t('Click to view', 'Click to view') + ' ' + c.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '12px 16px',
              background: active
                ? 'var(--color-status-blue-bg)'
                : 'var(--color-background-primary)',
              border: `1px solid ${active ? 'var(--color-status-blue-mid)' : 'var(--color-border-soft, rgba(0,0,0,0.10))'}`,
              // Tab-like underline on the active chip so the user can
              // immediately see which view they're on.
              borderBottom: active
                ? `3px solid var(--color-status-blue-deep)`
                : `1px solid var(--color-border-soft, rgba(0,0,0,0.10))`,
              borderRadius: 6,
              cursor: active ? 'default' : 'pointer',
              textAlign: 'left',
              color: 'inherit',
              fontFamily: 'inherit',
              transition: 'background 0.12s',
            }}
          >
            <i
              className={`ti ${c.icon}`}
              aria-hidden="true"
              style={{
                fontSize: 22,
                color: active ? 'var(--color-status-blue-deep)' : 'var(--color-text-secondary)',
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    color: 'var(--color-text-primary)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {c.count}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    color: 'var(--color-text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {c.label}
                </span>
              </div>
              <div
                style={{
                  fontSize: 10.5,
                  color: 'var(--color-text-tertiary)',
                  marginTop: 2,
                }}
              >
                {c.sub}
              </div>
            </div>
            {!active ? (
              <i
                className="ti ti-arrow-right"
                aria-hidden="true"
                style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}
              />
            ) : (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '3px 7px',
                  borderRadius: 4,
                  background: 'var(--color-status-blue-deep)',
                  color: '#fff',
                }}
              >
                {t('Viewing', 'Viewing')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// RegistryItem is the unified row shape returned by
// /v1/registry/items. Each kind populates a kind-specific subset of
// fields; we render only the columns relevant to the active tab.
type RegistryItem = {
  kind: string
  id: string
  name: string
  criticality?: string
  // application
  app_tier?: string
  owner_team?: string
  owner_email?: string
  gxp_validated?: boolean
  component_count?: number
  dependency_count?: number
  // site
  site_type?: string
  city?: string
  country?: string
  dr_site?: string
  ci_count?: number
}

function useRegistryItems(kind: 'applications' | 'sites') {
  const [items, setItems] = useState<RegistryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const PAGE = 500
        const MAX = 5000
        const all: RegistryItem[] = []
        let offset = 0
        let total = Infinity
        while (offset < total && offset < MAX) {
          const response = await apiFetch(`/registry/items?kind=${kind}&limit=${PAGE}&offset=${offset}`)
          if (!response.ok) {
            const body = await response.json().catch(() => ({}))
            throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
          }
          const body = await response.json()
          const got: RegistryItem[] = Array.isArray(body?.items) ? body.items : []
          all.push(...got)
          total = typeof body?.total === 'number' ? body.total : all.length
          if (got.length === 0) break
          offset += got.length
        }
        if (!cancelled) setItems(all)
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
  }, [kind])
  return { items, loading, error }
}

function ApplicationsTab() {
  const { t } = useI18n()
  const router = useRouter()
  const { items, loading, error } = useRegistryItems('applications')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const paged = items.slice(current * pageSize, current * pageSize + pageSize)
  return (
    <Card>
      <CardTitle
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {t('{count} applications', '{count} applications', { count: items.length })}
            </span>
            <PrimaryButton onClick={() => router.push('/apps/new')}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Add application', 'Add application')}
            </PrimaryButton>
            <GhostButton onClick={() => router.push('/apps')}>
              {t('Manage applications', 'Manage applications')} →
            </GhostButton>
          </div>
        }
      >
        {t('Applications', 'Applications')}
      </CardTitle>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading ? (
        <Skeleton lines={6} height={36} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="ti-apps"
          title={t('No applications declared', 'No applications declared')}
          description={t(
            'Applications live in policies/applications/*.yaml. Add one to model the blast radius of a service across its VMs and dependencies.',
            'Applications live in policies/applications/*.yaml. Add one to model the blast radius of a service across its VMs and dependencies.',
          )}
        />
      ) : (
        <div style={{ maxHeight: 560, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--color-text-tertiary)',
                  textAlign: 'left',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--color-background-primary)',
                  zIndex: 1,
                }}
              >
                <th style={{ padding: '6px 10px 6px 0' }}>{t('Application', 'Application')}</th>
                <th style={{ padding: '6px 10px' }}>{t('Tier', 'Tier')}</th>
                <th style={{ padding: '6px 10px' }}>{t('Owner', 'Owner')}</th>
                <th style={{ padding: '6px 10px' }}>{t('Components', 'Components')}</th>
                <th style={{ padding: '6px 10px' }}>{t('Dependencies', 'Dependencies')}</th>
                <th style={{ padding: '6px 0 6px 10px' }}>{t('GxP', 'GxP')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((item) => (
                <tr
                  key={item.id}
                  style={{ borderTop: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }}
                  onClick={() => router.push(`/apps/${encodeURIComponent(item.id)}`)}
                >
                  <td style={{ padding: '10px 10px 10px 0' }}>
                    <div style={{ fontWeight: 500 }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                      {item.id}
                    </div>
                  </td>
                  <td style={{ padding: '10px' }}>
                    {item.app_tier ? (
                      <Badge tone={TIER_TONE[item.app_tier] ?? 'gray'}>{tierLabel(item.app_tier)}</Badge>
                    ) : (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                    )}
                  </td>
                  <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                    {item.owner_team || item.owner_email || '—'}
                  </td>
                  <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                    {item.component_count ?? 0}
                  </td>
                  <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                    {item.dependency_count ?? 0}
                  </td>
                  <td style={{ padding: '10px 0 10px 10px' }}>
                    {item.gxp_validated ? (
                      <Badge tone="green">validated</Badge>
                    ) : (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <Pagination
            page={current}
            pageSize={pageSize}
            total={items.length}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s)
              setPage(0)
            }}
            label={t('Applications', 'Applications')}
          />
        </div>
      ) : null}
    </Card>
  )
}

function SitesTab() {
  const { t } = useI18n()
  const router = useRouter()
  const { items, loading, error } = useRegistryItems('sites')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const paged = items.slice(current * pageSize, current * pageSize + pageSize)
  return (
    <Card>
      <CardTitle
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {t('{count} sites', '{count} sites', { count: items.length })}
            </span>
            <PrimaryButton onClick={() => router.push('/sites/new')}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Add site', 'Add site')}
            </PrimaryButton>
            <GhostButton onClick={() => router.push('/sites')}>
              {t('Manage sites', 'Manage sites')} →
            </GhostButton>
          </div>
        }
      >
        {t('Sites', 'Sites')}
      </CardTitle>
      {error ? <Banner tone="error">{error}</Banner> : null}
      {loading ? (
        <Skeleton lines={6} height={36} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="ti-building"
          title={t('No sites declared', 'No sites declared')}
          description={t(
            'Use "Add site" above (or declare in policies/sites/*.yaml) to register DCs and map hosted CIs, DR pairs, and concentration-risk geography.',
            'Use "Add site" above (or declare in policies/sites/*.yaml) to register DCs and map hosted CIs, DR pairs, and concentration-risk geography.',
          )}
        />
      ) : (
        <div style={{ maxHeight: 560, overflowY: 'auto' }}>
          <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
            <thead>
              <tr
                style={{
                  fontSize: 10,
                  textTransform: 'uppercase',
                  letterSpacing: '0.04em',
                  color: 'var(--color-text-tertiary)',
                  textAlign: 'left',
                  position: 'sticky',
                  top: 0,
                  background: 'var(--color-background-primary)',
                  zIndex: 1,
                }}
              >
                <th style={{ padding: '6px 10px 6px 0' }}>{t('Site', 'Site')}</th>
                <th style={{ padding: '6px 10px' }}>{t('Type', 'Type')}</th>
                <th style={{ padding: '6px 10px' }}>{t('Location', 'Location')}</th>
                <th style={{ padding: '6px 10px' }}>{t('DR pair', 'DR pair')}</th>
                <th style={{ padding: '6px 0 6px 10px' }}>{t('Hosted CIs', 'Hosted CIs')}</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((item) => (
                <tr
                  key={item.id}
                  style={{ borderTop: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }}
                  onClick={() => router.push(`/sites/${encodeURIComponent(item.id)}`)}
                >
                  <td style={{ padding: '10px 10px 10px 0' }}>
                    <div style={{ fontWeight: 500 }}>{item.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                      {item.id}
                    </div>
                  </td>
                  <td style={{ padding: '10px' }}>
                    {item.site_type ? <Badge tone="navy">{item.site_type}</Badge> : <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                    {[item.city, item.country].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td style={{ padding: '10px', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                    {item.dr_site || '—'}
                  </td>
                  <td style={{ padding: '10px 0 10px 10px', color: 'var(--color-text-secondary)' }}>
                    {item.ci_count ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {items.length > 0 ? (
        <div style={{ marginTop: 8 }}>
          <Pagination
            page={current}
            pageSize={pageSize}
            total={items.length}
            onPageChange={setPage}
            onPageSizeChange={(s) => {
              setPageSize(s)
              setPage(0)
            }}
            label={t('Sites', 'Sites')}
          />
        </div>
      ) : null}
    </Card>
  )
}
