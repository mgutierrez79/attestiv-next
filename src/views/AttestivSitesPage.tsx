'use client';
// Sites registry page.
//
// One row per registered site. Renders the site identity (city,
// country, region), the count of hosted CIs, and a concentration
// indicator if the site exceeds its DORA Art.29 threshold.
// Concentration data is fetched separately and joined client-side.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n';

type SiteSummary = {
  site_id: string
  display_name: string
  site_type?: string
  city?: string
  country?: string
  region?: string
  dr_site?: string
  primary_site?: string
  ci_count?: number
  wan_link_count?: number
}

type ConcentrationRisk = {
  site_id: string
  total_tier1_apps?: number
  apps_in_site?: number
  concentration_pct?: number
  exceeds_threshold?: boolean
  threshold_pct?: number
}

export function AttestivSitesPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const [sites, setSites] = useState<SiteSummary[]>([])
  const [concentration, setConcentration] = useState<Map<string, ConcentrationRisk>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<{ region?: string; type?: string }>({})

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [sitesRes, concentrationRes] = await Promise.allSettled([
          apiFetch('/sites'),
          apiFetch('/concentration-risk'),
        ])
        if (cancelled) return
        if (sitesRes.status === 'fulfilled') {
          if (!sitesRes.value.ok) {
            throw new Error(`${sitesRes.value.status} ${sitesRes.value.statusText}`)
          }
          const body = await sitesRes.value.json()
          setSites(Array.isArray(body?.items) ? body.items : [])
        } else {
          throw sitesRes.reason
        }
        if (concentrationRes.status === 'fulfilled' && concentrationRes.value.ok) {
          const body = await concentrationRes.value.json()
          const items: ConcentrationRisk[] = Array.isArray(body?.items) ? body.items : []
          const map = new Map<string, ConcentrationRisk>()
          for (const c of items) {
            if (c.site_id) map.set(c.site_id, c)
          }
          setConcentration(map)
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load sites')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const regions = useMemo(() => {
    return Array.from(new Set(sites.map((s) => s.region).filter(Boolean))).sort() as string[]
  }, [sites])

  const types = useMemo(() => {
    return Array.from(new Set(sites.map((s) => s.site_type).filter(Boolean))).sort() as string[]
  }, [sites])

  const filtered = useMemo(() => {
    return sites.filter((site) => {
      if (filter.region && site.region !== filter.region) return false
      if (filter.type && site.site_type !== filter.type) return false
      return true
    })
  }, [sites, filter])

  const exceedingThreshold = useMemo(() => {
    let count = 0
    for (const c of concentration.values()) {
      if (c.exceeds_threshold) count++
    }
    return count
  }, [concentration])

  // deleteSite issues a DELETE on the backend. YAML-defined sites
  // are rejected with a 409 — the error banner relays the server
  // message so the operator knows to remove the YAML file instead
  // of pestering this UI.
  async function deleteSite(siteID: string, displayName?: string) {
    const label = displayName || siteID
    const confirmation = t(
      'Delete "{label}"? This removes the runtime-overlay definition; YAML-defined sites can\'t be deleted here.',
      'Delete "{label}"? This removes the runtime-overlay definition; YAML-defined sites can\'t be deleted here.',
      { label },
    )
    if (!window.confirm(confirmation)) return
    setError(null)
    try {
      const response = await apiFetch(`/sites/${encodeURIComponent(siteID)}`, {
        method: 'DELETE',
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
      }
      // Optimistic local update so the row disappears immediately; the
      // next /sites poll re-syncs from server truth either way.
      setSites((current) => current.filter((s) => s.site_id !== siteID))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete site')
    }
  }

  return (
    <>
      <Topbar
        title={t('Sites', 'Sites')}
        left={<Badge tone="navy">{t('{count} registered', '{count} registered', { count: sites.length })}</Badge>}
        right={
          <>
            <FilterBar value={filter} onChange={setFilter} regions={regions} types={types} />
            <PrimaryButton onClick={() => router.push('/sites/new')}>
              <i className="ti ti-plus" aria-hidden="true" />
              {t('Add site', 'Add site')}
            </PrimaryButton>
          </>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {exceedingThreshold > 0 ? (
          <Banner
            tone="warning"
            title={t(
              '{count} site(s) exceeding DORA Art.29 concentration threshold',
              '{count} site(s) exceeding DORA Art.29 concentration threshold',
              { count: exceedingThreshold },
            )}
          >
            {t(
              'A site holding too high a share of tier-1 apps becomes a single point of failure. Move workloads or document compensating controls.',
              'A site holding too high a share of tier-1 apps becomes a single point of failure. Move workloads or document compensating controls.'
            )}
          </Banner>
        ) : null}

        <Card>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('{count} shown', '{count} shown', { count: filtered.length })}</span>}>
            {t('Site registry', 'Site registry')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={5} height={42} />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon="ti-building"
              title={t('No sites', 'No sites')}
              description={t(
                'Sites are configured via YAML in the policies/sites/ directory. Once registered they show up here for cascade + concentration analysis.',
                'Sites are configured via YAML in the policies/sites/ directory. Once registered they show up here for cascade + concentration analysis.'
              )}
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
                  <th style={{ padding: '6px 10px 6px 0' }}>{t('Site', 'Site')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Type', 'Type')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Region', 'Region')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right' }}>CIs</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('WAN links', 'WAN links')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Concentration', 'Concentration')}</th>
                  <th style={{ padding: '6px 0 6px 10px', textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((site) => {
                  const {
                    t
                  } = useI18n();

                  const conc = concentration.get(site.site_id)
                  return (
                    <tr
                      key={site.site_id}
                      onClick={() => router.push(`/sites/${encodeURIComponent(site.site_id)}`)}
                      style={{
                        borderTop: '0.5px solid var(--color-border-tertiary)',
                        cursor: 'pointer',
                      }}
                    >
                      <td style={{ padding: '10px 10px 10px 0' }}>
                        <div style={{ fontWeight: 500 }}>{site.display_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                          <code>{site.site_id}</code>
                          {site.city ? ` · ${site.city}` : ''}
                          {site.country ? `, ${site.country}` : ''}
                        </div>
                      </td>
                      <td style={{ padding: '10px' }}>
                        {site.site_type ? <Badge tone="navy">{site.site_type.replace(/_/g, ' ')}</Badge> : '—'}
                      </td>
                      <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                        {site.region || '—'}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                        {site.ci_count ?? '—'}
                      </td>
                      <td style={{ padding: '10px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                        {site.wan_link_count ?? '—'}
                      </td>
                      <td style={{ padding: '10px' }}>
                        {conc?.exceeds_threshold ? (
                          <Badge tone="red" icon="ti-alert-triangle">
                            {conc.concentration_pct?.toFixed(0)}{t('% of tier-1', '% of tier-1')}
                          </Badge>
                        ) : conc?.concentration_pct !== undefined ? (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                            {conc.concentration_pct.toFixed(0)}%
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 0 10px 10px', textAlign: 'right' }}>
                        <div style={{ display: 'inline-flex', gap: 4 }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              // Row click navigates to the detail view;
                              // action buttons must stop propagation so
                              // we don't trigger both.
                              e.stopPropagation()
                              router.push(`/sites/new?edit=${encodeURIComponent(site.site_id)}`)
                            }}
                            style={{
                              fontSize: 11,
                              padding: '4px 8px',
                              border: '0.5px solid var(--color-border-secondary)',
                              borderRadius: 'var(--border-radius-sm)',
                              background: 'var(--color-background-primary)',
                              color: 'var(--color-text-primary)',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                            title={t('Edit site', 'Edit site')}
                          >
                            <i className="ti ti-edit" aria-hidden="true" /> {t('Edit', 'Edit')}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              void deleteSite(site.site_id, site.display_name)
                            }}
                            style={{
                              fontSize: 11,
                              padding: '4px 8px',
                              border: '0.5px solid var(--color-border-secondary)',
                              borderRadius: 'var(--border-radius-sm)',
                              background: 'var(--color-background-primary)',
                              color: 'var(--color-status-red-deep)',
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                            title={t('Delete site', 'Delete site')}
                          >
                            <i className="ti ti-trash" aria-hidden="true" /> {t('Delete', 'Delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}

function FilterBar({
  value,
  onChange,
  regions,
  types,
}: {
  value: { region?: string; type?: string }
  onChange: (next: { region?: string; type?: string }) => void
  regions: string[]
  types: string[]
}) {
  const {
    t
  } = useI18n();

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
      <SelectChip
        label={t('Region', 'Region')}
        value={value.region}
        options={regions}
        onChange={(v) => onChange({ ...value, region: v })}
      />
      <SelectChip
        label={t('Type', 'Type')}
        value={value.type}
        options={types}
        onChange={(v) => onChange({ ...value, type: v })}
      />
    </div>
  );
}

function SelectChip({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value?: string
  options: string[]
  onChange: (next: string | undefined) => void
}) {
  const {
    t
  } = useI18n();

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
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
          {label}: {opt.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}
