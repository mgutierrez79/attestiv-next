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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

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
}

type SiteOption = { site_id: string; display_name?: string }

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  // assetId currently mid-patch; suppresses concurrent edits to the
  // same row and shows a small busy state on the dropdown.
  const [assigningAssetId, setAssigningAssetId] = useState<string | null>(null)
  // Bulk-select state for compliance-scope toggle. The operator can
  // pick test/dev/decommissioned VMs and mark them out of evaluation
  // scope (PCI CDE segmentation, GxP scope rules etc.).
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  // URL drives the filter so a sidebar link like
  // /inventory?asset_type=firewall lands on the right slice without
  // any in-page UI gymnastics.
  const assetTypeFilter = (searchParams?.get('asset_type') ?? '').toLowerCase()
  const sourceFilter = (searchParams?.get('source') ?? '').toLowerCase()
  const criticalityFilter = (searchParams?.get('criticality') ?? '').toLowerCase()
  const search = (searchParams?.get('q') ?? '').toLowerCase()

  const load = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      // Default backend limit is 500; pilot inventories regularly
      // exceed that once cross-source emissions land (VMs from both
      // vCenter and PowerStore, hosts, volumes, clusters, etc.).
      // Without a higher cap the page silently drops rows — e.g.
      // entire clusters disappear because they sort after VMs by
      // asset_id. 5000 is the next reasonable ceiling for pilot-
      // scale tenants; tenants beyond that need a paginated view.
      const response = await apiFetch('/inventory/assets?limit=5000')
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
      }
      const body = await response.json()
      const items: InventoryAsset[] = Array.isArray(body?.items) ? body.items : []
      setAssets(items)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory')
      setAssets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
    setImporting(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch('/inventory/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: true, overwrite: false }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
      }
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
    } finally {
      setImporting(false)
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
      if (assetTypeFilter && String(asset.asset_type ?? '').toLowerCase() !== assetTypeFilter) return false
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
          <Badge tone="navy">
            {t('{count} assets', '{count} assets', { count: assets.length })}
          </Badge>
        }
        right={
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
            <PrimaryButton onClick={refreshFromConnectors} disabled={importing}>
              {importing ? (
                <>
                  <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                  {t('Refreshing…', 'Refreshing…')}
                </>
              ) : (
                <>
                  <i className="ti ti-refresh" aria-hidden="true" />
                  {t('Refresh from connectors', 'Refresh from connectors')}
                </>
              )}
            </PrimaryButton>
          </>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {info ? <Banner tone="success">{info}</Banner> : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: 8,
            marginBottom: 12,
          }}
        >
          <SummaryTile label={t('Total assets', 'Total assets')} value={assets.length} active={!assetTypeFilter} onClick={() => pushFilter('asset_type', '')} />
          {orderedAssetTypeTiles(counts).map(([type, count]) => (
            <SummaryTile
              key={type}
              label={translatedAssetTypeLabel(t, type)}
              value={count}
              active={assetTypeFilter === type}
              onClick={() => pushFilter('asset_type', assetTypeFilter === type ? '' : type)}
            />
          ))}
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
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-tertiary)',
                    textAlign: 'left',
                  }}
                >
                  <th style={{ padding: '6px 4px 6px 0', width: 24 }}>
                    <input
                      type="checkbox"
                      title={t('Select all visible', 'Select all visible')}
                      checked={filtered.length > 0 && filtered.every((a) => selected.has(a.asset_id))}
                      ref={(el) => {
                        if (!el) return
                        const allSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.asset_id))
                        const someSelected = filtered.some((a) => selected.has(a.asset_id))
                        el.indeterminate = someSelected && !allSelected
                      }}
                      onChange={(e) => {
                        const next = new Set(selected)
                        if (e.target.checked) {
                          filtered.forEach((a) => next.add(a.asset_id))
                        } else {
                          filtered.forEach((a) => next.delete(a.asset_id))
                        }
                        setSelected(next)
                      }}
                    />
                  </th>
                  <th style={{ padding: '6px 10px 6px 0' }}>{t('Asset', 'Asset')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Type', 'Type')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Criticality', 'Criticality')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Source', 'Source')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Location', 'Location')}</th>
                  <th style={{ padding: '6px 0 6px 10px' }}>{t('Tags', 'Tags')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((asset) => (
                  <AssetRow
                    key={asset.asset_id}
                    asset={asset}
                    sites={sites}
                    busy={assigningAssetId === asset.asset_id}
                    onAssign={(siteID) => void assignSite(asset, siteID)}
                    selected={selected.has(asset.asset_id)}
                    onToggleSelect={(checked) => {
                      const next = new Set(selected)
                      if (checked) next.add(asset.asset_id)
                      else next.delete(asset.asset_id)
                      setSelected(next)
                    }}
                  />
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  )
}

function AssetRow({
  asset,
  sites,
  busy,
  onAssign,
  selected,
  onToggleSelect,
}: {
  asset: InventoryAsset
  sites: SiteOption[]
  busy: boolean
  onAssign: (siteID: string) => void
  selected: boolean
  onToggleSelect: (checked: boolean) => void
}) {
  const { t } = useI18n()
  const displayName = (asset.name && asset.name.trim()) || asset.asset_id
  const assetType = String(asset.asset_type ?? '').toLowerCase()
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
    <tr
      style={{
        borderTop: '0.5px solid var(--color-border-tertiary)',
        opacity: outOfScope ? 0.55 : 1,
      }}
    >
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
          {displayName}
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
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>
          {asset.asset_id}
        </div>
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
      <td style={{ padding: '10px' }}>
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
        ) : isStorageVolume ? (
          // Storage volume: render the parent array's name (e.g.
          // "POWERSTOREA01") as the location identity. Backend
          // stamps metadata.array_name at emission time. Site lives
          // on the array row itself; repeating it 100+ times per
          // volume isn't useful.
          storageVolumeArrayName ? (
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
      <td style={{ padding: '10px 0 10px 10px' }}>
        {tags.length === 0 ? (
          <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
            {tags.slice(0, 3).map((tag) => (
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
            {tags.length > 3 ? (
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>+{tags.length - 3}</span>
            ) : null}
          </span>
        )}
      </td>
    </tr>
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
    .filter(([type, count]) => !seen.has(type) && count > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 12 - out.length)
  return out.concat(rest)
}
