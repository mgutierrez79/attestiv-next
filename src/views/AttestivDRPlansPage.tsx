'use client'
// DR Plans — list of sites + entry into the per-site wizard.
//
// Backed by /v1/dr/plans (GAP "DR Plans wizard"). One row per site
// in the registry; each shows the inferred global strategy + a
// per-layer status badge so the operator sees at a glance which
// sites are well-protected and which need attention. Click a site
// to open the wizard at /dr/plans/{site_id}.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type DRPlanSummary = {
  site_id: string
  site_name: string
  site_type?: string
  global_strategy: string
  global_summary: string
  dr_site_pair?: string
  ransomware_score: number
  layer_status_network: string
  layer_status_storage: string
  layer_status_virtualization: string
  layer_status_backup: string
}

export function AttestivDRPlansPage() {
  const { t } = useI18n()
  const router = useRouter()
  const [items, setItems] = useState<DRPlanSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const resp = await apiFetch('/dr/plans')
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
        const data = (await resp.json()) as { items: DRPlanSummary[] }
        if (!cancelled) setItems(data.items || [])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load DR plans')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Topbar
        title={t('DR Plans', 'DR Plans')}
        right={<Badge tone="navy">{t('{n} sites', '{n} sites', { n: items.length })}</Badge>}
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        <Card>
          <CardTitle>{t('Per-site disaster-recovery posture', 'Per-site disaster-recovery posture')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
            {t(
              'The platform infers each site\'s DR strategy from observed signals: inter-DC links, storage replication mode (sync/async/none), VM-level replication (SRM/Zerto), backup coverage, immutable snapshots, and recent restore tests. Click a site to open the layered wizard.',
              'The platform infers each site\'s DR strategy from observed signals: inter-DC links, storage replication mode (sync/async/none), VM-level replication (SRM/Zerto), backup coverage, immutable snapshots, and recent restore tests. Click a site to open the layered wizard.',
            )}
          </p>
          {loading ? (
            <Skeleton lines={4} height={48} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="ti-building-off"
              title={t('No sites registered', 'No sites registered')}
              description={t(
                'Sites come from the YAML registry under policies/sites. Add a site definition and re-deploy to see it here.',
                'Sites come from the YAML registry under policies/sites. Add a site definition and re-deploy to see it here.',
              )}
            />
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={headerRowStyle}>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Site', 'Site')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Strategy', 'Strategy')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>Network</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>Storage</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>Virt</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>Backup</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('Ransomware', 'Ransomware')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr
                    key={p.site_id}
                    onClick={() => router.push(`/dr/plans/${encodeURIComponent(p.site_id)}`)}
                    style={{ borderTop: '0.5px solid var(--color-border-tertiary)', cursor: 'pointer' }}
                  >
                    <td style={{ padding: '8px 10px' }}>
                      <div style={{ fontWeight: 600 }}>{p.site_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                        {p.site_type ?? '—'}
                        {p.dr_site_pair ? ` · ${t('DR pair', 'DR pair')}: ${p.dr_site_pair}` : ''}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <Badge tone={strategyTone(p.global_strategy)}>{strategyLabel(p.global_strategy, t)}</Badge>
                      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 3, maxWidth: 380 }}>
                        {p.global_summary}
                      </div>
                    </td>
                    <td style={{ padding: '8px 10px' }}><Badge tone={statusTone(p.layer_status_network)}>{p.layer_status_network}</Badge></td>
                    <td style={{ padding: '8px 10px' }}><Badge tone={statusTone(p.layer_status_storage)}>{p.layer_status_storage}</Badge></td>
                    <td style={{ padding: '8px 10px' }}><Badge tone={statusTone(p.layer_status_virtualization)}>{p.layer_status_virtualization}</Badge></td>
                    <td style={{ padding: '8px 10px' }}><Badge tone={statusTone(p.layer_status_backup)}>{p.layer_status_backup}</Badge></td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      <Badge tone={ransomwareTone(p.ransomware_score)}>
                        {Math.round(p.ransomware_score * 100)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  )
}

function statusTone(s: string): 'green' | 'amber' | 'red' | 'gray' {
  switch (s) {
    case 'ok': return 'green'
    case 'warning': return 'amber'
    case 'critical': return 'red'
    default: return 'gray'
  }
}

function strategyTone(strategy: string): 'green' | 'amber' | 'red' | 'navy' {
  switch (strategy) {
    case 'active_active_metro_cluster':
    case 'active_passive_with_async_storage_replication':
    case 'srm_orchestrated_failover':
    case 'vm_level_replication':
      return 'green'
    case 'backup_only_recovery':
    case 'async_replication_without_network_proof':
      return 'amber'
    case 'no_dr_strategy':
      return 'red'
    default:
      return 'navy'
  }
}

function strategyLabel(strategy: string, t: (k: string, fb?: string) => string): string {
  switch (strategy) {
    case 'active_active_metro_cluster':
      return t('Active/Active metro cluster', 'Active/Active metro cluster')
    case 'active_passive_with_async_storage_replication':
      return t('Active/Passive · async storage', 'Active/Passive · async storage')
    case 'async_replication_without_network_proof':
      return t('Async replication · no proven path', 'Async replication · no proven path')
    case 'vm_level_replication':
      return t('VM-level replication (Zerto)', 'VM-level replication (Zerto)')
    case 'srm_orchestrated_failover':
      return t('SRM orchestrated', 'SRM orchestrated')
    case 'backup_only_recovery':
      return t('Backup-only recovery', 'Backup-only recovery')
    case 'no_dr_strategy':
      return t('No DR strategy detected', 'No DR strategy detected')
    default:
      return strategy
  }
}

function ransomwareTone(score: number): 'green' | 'amber' | 'red' {
  if (score >= 0.7) return 'green'
  if (score >= 0.4) return 'amber'
  return 'red'
}

const headerRowStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
  background: 'var(--color-background-secondary)',
}
