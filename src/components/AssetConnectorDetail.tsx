'use client'

// AssetConnectorDetail — shared rendering of the connector-sourced
// detail an inventoried asset carries. Used in two places so the look
// stays identical:
//
//   1. Inline "look by row" expansion on the inventory list
//      (AssetExpandedPanel — lazy-fetches the enriched detail row).
//   2. The full asset detail page (HealthChips + ConnectorProvenance
//      cards rendered at the top).
//
// The headline feature is PROVENANCE: the backend cross-source merge
// folds the same physical host seen by vCenter / Veeam / PowerStore /
// SentinelOne / Active Directory into one row, and now records WHICH
// connector saw it as WHICH role in metadata.observed_by. We surface
// that here as branded chips so the unification engine is visible to
// the operator instead of hiding behind a flat "Source" CSV.

import { useEffect, useState } from 'react'

import { Badge, Skeleton } from './AttestivUi'
import { ConnectorLogo, hasConnectorLogo } from './ConnectorLogo'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

export type EnrichedAsset = {
  asset_id: string
  name?: string | null
  asset_type?: string | null
  criticality?: string | null
  datacenter_id?: string | null
  framework_evaluation_enabled?: boolean
  tags?: string[]
  present_in?: string[]
  external_refs?: Array<{ source?: string; external_id?: string }>
  metadata?: Record<string, unknown>
}

type ObservedBy = { source?: string; asset_type?: string; asset_id?: string }

// baseSource strips a "vcenter:host-9" style suffix down to the bare
// connector name, matching the backend's baseSource() so chips and
// brand-mark lookups line up across the stack.
function baseSource(s: string): string {
  const lower = String(s ?? '').trim().toLowerCase()
  const i = lower.indexOf(':')
  return i > 0 ? lower.slice(0, i) : lower
}

// Friendly display names for the connector sources the backend emits.
// Falls back to a title-cased form so a new connector still reads well.
const CONNECTOR_LABELS: Record<string, string> = {
  vcenter: 'vCenter',
  veeam_enterprise_manager: 'Veeam',
  veeam_em: 'Veeam',
  powerstore: 'PowerStore',
  dell_datadomain: 'Data Domain',
  dell_openmanage: 'Dell OpenManage',
  sentinelone: 'SentinelOne',
  active_directory: 'Active Directory',
  dnac: 'Cisco DNA Center',
  cisco: 'Cisco',
  palo_alto: 'Palo Alto',
  palo_alto_panorama: 'Panorama',
  panorama: 'Panorama',
  glpi: 'GLPI',
  servicenow: 'ServiceNow',
  dynatrace: 'Dynatrace',
  zabbix: 'Zabbix',
  advens_mysoc: 'Advens mySOC',
}

export function connectorLabel(source: string): string {
  const base = baseSource(source)
  if (CONNECTOR_LABELS[base]) return CONNECTOR_LABELS[base]
  return base
    .replace(/_/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ')
}

function roleLabel(role: string): string {
  const r = String(role ?? '').trim().toLowerCase()
  const known: Record<string, string> = {
    vm: 'Virtual machine',
    virtual_machine: 'Virtual machine',
    host: 'Hypervisor host',
    hypervisor_host: 'Hypervisor host',
    domain_controller: 'Domain controller',
    endpoint: 'Endpoint',
    server: 'Server',
    workstation: 'Workstation',
    computer: 'Computer',
    network_device: 'Network device',
    firewall: 'Firewall',
    storage_volume: 'Storage volume',
    storage_array: 'Storage array',
  }
  if (known[r]) return known[r]
  return r.replace(/_/g, ' ')
}

// ── Health chips ──────────────────────────────────────────────────
// A one-glance posture strip. Each chip only renders when the relevant
// connector telemetry is present, so a thin firewall row shows nothing
// and a fully-correlated VM shows the whole posture in a line.

type ChipTone = 'green' | 'amber' | 'red' | 'gray'

function backupTone(daysSince?: number): ChipTone {
  if (typeof daysSince !== 'number') return 'gray'
  if (daysSince <= 1) return 'green'
  if (daysSince <= 7) return 'amber'
  return 'red'
}

function restoreTone(status?: string): ChipTone {
  const s = (status ?? '').toLowerCase()
  if (s === 'healthy' || s === 'ok' || s === 'success') return 'green'
  if (s === 'warning') return 'amber'
  if (s === 'failure' || s === 'failed' || s === 'error') return 'red'
  return 'gray'
}

// daysSinceISO returns whole days between an ISO timestamp and now, or
// undefined when the value is missing/unparseable. Used for the failover
// chip, where the backend stamps an absolute timestamp (not a days_since
// that would go stale between polls).
function daysSinceISO(iso?: string): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return undefined
  return Math.max(0, Math.floor((Date.now() - ms) / 86_400_000))
}

type LastFailover = { at?: string; from_state?: string; to_state?: string; recovered?: boolean }

export function HealthChips({ asset }: { asset: EnrichedAsset }) {
  const { t } = useI18n()
  const meta = asset.metadata ?? {}
  const lastBackup = meta['last_backup'] as { status?: string; days_since?: number } | undefined
  const replication = meta['replication'] as { state?: string } | undefined
  const storageVolumes = meta['storage_volumes'] as Array<{ replicated?: boolean }> | undefined
  const lastRestore = meta['last_restore'] as { status?: string } | undefined
  const lastFailover = meta['last_failover'] as LastFailover | undefined
  const edr = meta['edr'] as
    | { installed?: boolean; health?: string; infected?: boolean }
    | undefined

  const chips: Array<{ tone: ChipTone; icon: string; label: string }> = []

  if (lastBackup) {
    const d = lastBackup.days_since
    chips.push({
      tone: backupTone(d),
      icon: 'ti-cloud-upload',
      label:
        typeof d === 'number'
          ? d <= 1
            ? t('Backed up', 'Backed up')
            : t('Backup {n}d', 'Backup {n}d', { n: d })
          : t('Backup unknown', 'Backup unknown'),
    })
  }

  const replicated =
    replication?.state === 'replicated' ||
    (Array.isArray(storageVolumes) && storageVolumes.some((v) => v.replicated))
  if (replication || (storageVolumes && storageVolumes.length > 0)) {
    chips.push({
      tone: replicated ? 'green' : 'gray',
      icon: 'ti-copy',
      label: replicated ? t('Replicated', 'Replicated') : t('Not replicated', 'Not replicated'),
    })
  }

  if (lastRestore) {
    chips.push({
      tone: restoreTone(lastRestore.status),
      icon: 'ti-restore',
      label: t('Restore tested', 'Restore tested'),
    })
  }

  // Last HA/DR failover for a firewall cluster. Red when the cluster did not
  // recover (HA still degraded), amber when the failover was recent, else a
  // neutral record that a failover happened.
  if (lastFailover?.at) {
    const days = daysSinceISO(lastFailover.at)
    const tone: ChipTone =
      lastFailover.recovered === false ? 'red' : typeof days === 'number' && days <= 7 ? 'amber' : 'gray'
    chips.push({
      tone,
      icon: 'ti-arrows-exchange',
      label:
        typeof days === 'number'
          ? t('Failover {n}d ago', 'Failover {n}d ago', { n: days })
          : t('Failover recorded', 'Failover recorded'),
    })
  }

  if (edr) {
    const tone: ChipTone = edr.infected
      ? 'red'
      : !edr.installed
        ? 'red'
        : edr.health === 'healthy'
          ? 'green'
          : 'amber'
    chips.push({
      tone,
      icon: edr.installed ? 'ti-shield-check' : 'ti-shield-off',
      label: edr.infected
        ? t('Infected', 'Infected')
        : !edr.installed
          ? t('No EDR', 'No EDR')
          : edr.health === 'healthy'
            ? t('EDR healthy', 'EDR healthy')
            : t('EDR attention', 'EDR attention'),
    })
  }

  if (asset.framework_evaluation_enabled === false) {
    chips.push({ tone: 'gray', icon: 'ti-eye-off', label: t('Out of scope', 'Out of scope') })
  }

  if (chips.length === 0) return null

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {chips.map((c, i) => (
        <Badge key={i} tone={c.tone} icon={c.icon}>
          {c.label}
        </Badge>
      ))}
    </div>
  )
}

// ── Connector provenance ──────────────────────────────────────────
// "Observed by" — the cross-source story. Prefers the role-precise
// observed_by block; unions in present_in (live snapshot) and
// external_refs so every connector that touched the asset appears,
// each tagged with the role it saw and the data it contributed.

type ProvEntry = { source: string; role?: string; contribution?: string }

function buildProvenance(asset: EnrichedAsset, t: (k: string, d?: string) => string): ProvEntry[] {
  const meta = asset.metadata ?? {}
  const observedBy = Array.isArray(meta['observed_by']) ? (meta['observed_by'] as ObservedBy[]) : []
  const bySource = new Map<string, ProvEntry>()

  const ensure = (source: string): ProvEntry | null => {
    const base = baseSource(source)
    if (!base || base === 'duplicate') return null
    let e = bySource.get(base)
    if (!e) {
      e = { source: base }
      bySource.set(base, e)
    }
    return e
  }

  for (const ob of observedBy) {
    const e = ensure(String(ob.source ?? ''))
    if (e && ob.asset_type) e.role = roleLabel(String(ob.asset_type))
  }
  for (const p of asset.present_in ?? []) ensure(p)
  for (const ref of asset.external_refs ?? []) ensure(String(ref.source ?? ''))

  // Tag each source with the concrete data it contributed to THIS asset.
  const tag = (source: string | undefined, label: string) => {
    if (!source) return
    const e = bySource.get(baseSource(source))
    if (e && !e.contribution) e.contribution = label
  }
  const edr = meta['edr'] as { source?: string } | undefined
  const backup = meta['last_backup'] as { source?: string } | undefined
  const replication = meta['replication'] as { source?: string } | undefined
  const restore = meta['last_restore'] as { source?: string } | undefined
  tag(edr?.source ?? 'sentinelone', t('Endpoint security', 'Endpoint security'))
  tag(backup?.source ?? 'veeam_enterprise_manager', t('Backup', 'Backup'))
  tag(replication?.source ?? 'powerstore', t('Replication', 'Replication'))
  tag(restore?.source, t('Restore test', 'Restore test'))
  const ports = meta['network_ports'] as unknown[] | undefined
  if (Array.isArray(ports) && ports.length > 0) {
    tag('dnac', t('Network port', 'Network port'))
    tag('cisco', t('Network port', 'Network port'))
  }

  return Array.from(bySource.values()).sort((a, b) => a.source.localeCompare(b.source))
}

export function ConnectorProvenance({ asset }: { asset: EnrichedAsset }) {
  const { t } = useI18n()
  const entries = buildProvenance(asset, t)
  if (entries.length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {entries.map((e) => {
        const sub = e.role || e.contribution || t('Discovered', 'Discovered')
        return (
          <div
            key={e.source}
            title={`${connectorLabel(e.source)}${e.role ? ` — ${e.role}` : ''}${e.contribution ? ` · ${e.contribution}` : ''}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px 6px 8px',
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-background-secondary)',
            }}
          >
            <span
              style={{
                display: 'inline-flex',
                width: 22,
                height: 22,
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {hasConnectorLogo(e.source) ? (
                <ConnectorLogo name={e.source} size={20} />
              ) : (
                <i className="ti ti-plug" aria-hidden="true" style={{ fontSize: 16, color: 'var(--color-text-tertiary)' }} />
              )}
            </span>
            <span style={{ display: 'inline-flex', flexDirection: 'column', minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-primary)', whiteSpace: 'nowrap' }}>
                {connectorLabel(e.source)}
              </span>
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
                {sub}
              </span>
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ── Compact fact grid ─────────────────────────────────────────────

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span
        style={{
          fontSize: 12,
          fontWeight: 500,
          fontFamily: mono ? 'var(--font-mono)' : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

function compactFacts(asset: EnrichedAsset, t: (k: string, d?: string) => string): Array<{ label: string; value: string; mono?: boolean }> {
  const meta = asset.metadata ?? {}
  const guest = meta['guest'] as { os_full_name?: string; os_name?: string; primary_ip?: string; hostname?: string } | undefined
  const hardware = meta['hardware'] as { cpu?: { count?: number }; memory?: { size_MiB?: number } } | undefined
  const facts: Array<{ label: string; value: string; mono?: boolean }> = []
  const powerState = String(meta['power_state'] ?? '')
  if (powerState) facts.push({ label: t('Power', 'Power'), value: powerState })
  if (guest?.primary_ip) facts.push({ label: t('Primary IP', 'Primary IP'), value: guest.primary_ip, mono: true })
  if (guest?.os_full_name || guest?.os_name) facts.push({ label: t('Guest OS', 'Guest OS'), value: guest.os_full_name ?? guest.os_name ?? '' })
  if (hardware?.cpu?.count) facts.push({ label: t('vCPU', 'vCPU'), value: String(hardware.cpu.count) })
  if (hardware?.memory?.size_MiB) facts.push({ label: t('Memory', 'Memory'), value: `${Math.round((hardware.memory.size_MiB ?? 0) / 1024)} GiB` })
  const cluster = String(meta['vcenter_cluster'] ?? '')
  if (cluster) facts.push({ label: t('Cluster', 'Cluster'), value: cluster, mono: true })
  const host = String(meta['vcenter_host'] ?? '')
  if (host) facts.push({ label: t('Host', 'Host'), value: host, mono: true })
  if (asset.criticality) facts.push({ label: t('Criticality', 'Criticality'), value: asset.criticality })
  if (asset.datacenter_id) facts.push({ label: t('Site', 'Site'), value: asset.datacenter_id })
  const lastFailover = meta['last_failover'] as { at?: string; from_state?: string; to_state?: string } | undefined
  if (lastFailover?.at) {
    const when = String(lastFailover.at).slice(0, 10)
    const transition =
      lastFailover.from_state && lastFailover.to_state ? ` · ${lastFailover.from_state}→${lastFailover.to_state}` : ''
    facts.push({ label: t('Last failover', 'Last failover'), value: `${when}${transition}` })
  }
  return facts
}

// ── AssetExpandedPanel ────────────────────────────────────────────
// The inline "look by row" body. Lazy-loads the enriched single-asset
// payload (the list rows are not enriched), then renders the posture
// strip, the key facts, and the provenance — a compact mirror of the
// full detail page so the operator never has to leave the table.

export function AssetExpandedPanel({
  assetID,
  cached,
  onLoaded,
}: {
  assetID: string
  cached?: EnrichedAsset
  onLoaded?: (asset: EnrichedAsset) => void
}) {
  const { t } = useI18n()
  const [asset, setAsset] = useState<EnrichedAsset | null>(cached ?? null)
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cached) {
      setAsset(cached)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    apiFetch(`/inventory/assets/${encodeURIComponent(assetID)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((body: EnrichedAsset) => {
        if (cancelled) return
        setAsset(body)
        onLoaded?.(body)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load detail')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // onLoaded intentionally omitted — parent passes a stable callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetID, cached])

  if (loading) {
    return (
      <div style={{ padding: '4px 0' }}>
        <Skeleton lines={3} height={28} />
      </div>
    )
  }
  if (error || !asset) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-status-red-mid, #c73030)' }}>
        {error ?? t('No detail available', 'No detail available')}
      </div>
    )
  }

  const facts = compactFacts(asset, t)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <HealthChips asset={asset} />

      {facts.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 12,
          }}
        >
          {facts.map((f) => (
            <Fact key={f.label} label={f.label} value={f.value} mono={f.mono} />
          ))}
        </div>
      ) : null}

      <div>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
          {t('Observed by', 'Observed by')}
        </div>
        <ConnectorProvenance asset={asset} />
      </div>

      <a
        href={`/inventory/${encodeURIComponent(asset.asset_id)}`}
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--color-status-blue-deep)',
          textDecoration: 'none',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {t('Open full detail', 'Open full detail')} <i className="ti ti-arrow-right" aria-hidden="true" />
      </a>
    </div>
  )
}
