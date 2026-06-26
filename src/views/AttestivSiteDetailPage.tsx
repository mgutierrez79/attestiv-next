'use client';
// Site detail page.
//
// Five sections in a single scroll:
//   1. Summary — name, type, location, DR partnership, capacity headroom.
//   2. Hosted CIs — list of every CI at the site with HA/replication detail.
//   3. Recovery order — the sequence the platform plans to bring the
//      DR site online if the primary fails (NTP-before-AD, etc.).
//   4. Concentration risk — DORA Art.29 share of tier-1 apps.
//   5. Cascade impact — which apps would fail if this site went down.
//
// Each panel pulls from its own endpoint and degrades to an empty
// state if unavailable; the page never blanks because one panel
// failed.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PrimaryButton,
  Select,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n';

type SiteDetail = {
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
  location?: SiteLocation
  connectivity?: SiteConnectivity
  dr_capacity?: DRCapacity
  hosted_cis?: HostedCI[]
  concentration_risk_threshold_pct?: number
}

type SiteLocation = {
  city?: string
  country?: string
  region?: string
  provider?: string
  region_code?: string
  availability_zones?: string[]
  distance_from_dr_km?: number
  distance_from_primary_km?: number
}

type SiteConnectivity = {
  wan_links?: WANLink[]
  internet?: { upstream_provider?: string; bandwidth_gbps?: number; sla_uptime_pct?: number }
  direct_connect?: WANLink[]
}

type WANLink = {
  link_id?: string
  provider?: string
  type?: string
  bandwidth_gbps?: number
  target_site?: string
  sla_uptime_pct?: number
}

type DRCapacity = {
  can_host_all_tier1?: boolean
  compute_headroom_pct?: number
  storage_headroom_pct?: number
  network_headroom_pct?: number
  last_capacity_review_date?: string
  capacity_review_frequency?: string
}

type HostedCI = {
  ci_id: string
  ci_type?: string
  connector?: string
  criticality?: string
  ha_partner_site?: string
  ha_partner_ci?: string
  depends_on?: string[]
  cluster_name?: string
  servers?: string[]
  certificate_expiry_check?: boolean
  replication_target_site?: string
  replication_target_ci?: string
  note?: string
}

type RecoveryTarget = {
  target_id: string
  target_type?: string
  ci_type?: string
  criticality_tier?: string
  max_minutes?: number
  depends_on?: string[]
  recovery_actions?: string[]
}

type RecoveryOrder = {
  failed_site?: string
  dr_site?: string
  items?: RecoveryTarget[]
  count?: number
}

type ConcentrationRisk = {
  total_tier1_apps?: number
  apps_in_site?: number
  concentration_pct?: number
  exceeds_threshold?: boolean
  threshold_pct?: number
  affected_apps?: string[]
}

type CascadeImpact = {
  failed_site_or_ci?: string
  failure_type?: string
  affected_cis?: string[]
  affected_applications?: Array<{ application_id: string; criticality_tier?: string }>
  total_tier1_affected?: number
  total_tier2_affected?: number
  estimated_scope?: string
}

const CRITICALITY_TONE: Record<string, 'red' | 'amber' | 'navy' | 'blue' | 'gray'> = {
  tier_0: 'red',
  tier_1: 'red',
  tier_2: 'amber',
  tier_3: 'navy',
  tier_4: 'blue',
  tier_5: 'gray',
  critical: 'red',
  high: 'amber',
  medium: 'navy',
  low: 'gray',
}

export function AttestivSiteDetailPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id

  const [site, setSite] = useState<SiteDetail | null>(null)
  const [recovery, setRecovery] = useState<RecoveryOrder | null>(null)
  const [concentration, setConcentration] = useState<ConcentrationRisk | null>(null)
  const [impact, setImpact] = useState<CascadeImpact | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // ICT provider/carrier attribution for sites + WAN links. The site registry
  // is YAML/read-only, so these GUI overrides are kept separately (keyed
  // "site:<id>" / "link:<id>") and applied over the registry declarations.
  const [providers, setProviders] = useState<Array<{ id: string; provider_name: string }>>([])
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      apiFetch('/third-parties').then((r) => (r.ok ? r.json() : [])).catch(() => []),
      apiFetch('/site-registry/provider-overrides').then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
    ]).then(([tp, ov]: [any, any]) => {
      if (cancelled) return
      const list: any[] = Array.isArray(tp) ? tp : (tp?.items ?? tp?.providers ?? [])
      setProviders(
        list
          .map((p) => ({ id: String(p?.id ?? ''), provider_name: String(p?.provider_name ?? p?.id ?? '') }))
          .filter((p) => p.id),
      )
      setOverrides((ov?.overrides ?? {}) as Record<string, string>)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function saveOverride(scope: 'site' | 'link', ref: string, providerID: string) {
    if (!ref) return
    const key = `${scope}:${ref}`
    setSavingKey(key)
    try {
      const r = await apiFetch('/site-registry/provider-override', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, ref, provider_id: providerID }),
      })
      const b = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(b?.detail || b?.error || `${r.status} ${r.statusText}`)
      setOverrides((prev) => {
        const next = { ...prev }
        if (providerID) next[key] = providerID
        else delete next[key]
        return next
      })
    } catch (err: any) {
      setError(err?.message ?? 'Save failed')
    } finally {
      setSavingKey(null)
    }
  }

  function providerSelect(scope: 'site' | 'link', ref: string, registryName?: string) {
    const key = `${scope}:${ref}`
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Select
          value={overrides[key] ?? ''}
          disabled={savingKey === key || providers.length === 0 || !ref}
          onChange={(e) => saveOverride(scope, ref, e.target.value)}
          style={{ minWidth: 180, fontSize: 12 }}
          aria-label={t('Provider', 'Provider')}
        >
          <option value="">
            {registryName ? t('Registry: {n}', 'Registry: {n}', { n: registryName }) : t('— none —', '— none —')}
          </option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.provider_name}
            </option>
          ))}
        </Select>
        {savingKey === key ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('Saving…', 'Saving…')}</span>
        ) : null}
      </span>
    )
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const detailRes = await apiFetch(`/sites/${encodeURIComponent(id)}`).catch((err: Error) => {
        return new Response(JSON.stringify({ detail: err.message }), { status: 599 })
      })
      if (cancelled) return
      if (!detailRes.ok) {
        if (detailRes.status === 404) {
          setError('Site not found')
        } else {
          setError(`${detailRes.status} ${detailRes.statusText}`)
        }
        setLoading(false)
        return
      }
      const detail: SiteDetail = await detailRes.json()
      setSite(detail)

      // Side-panel endpoints fan out in parallel; failures degrade
      // each panel independently.
      const [recRes, concRes, impRes] = await Promise.allSettled([
        apiFetch(`/sites/${encodeURIComponent(id)}/recovery-order`),
        apiFetch(`/sites/${encodeURIComponent(id)}/concentration-risk`),
        apiFetch(`/sites/${encodeURIComponent(id)}/impact`),
      ])
      if (cancelled) return
      if (recRes.status === 'fulfilled' && recRes.value.ok) {
        setRecovery(await recRes.value.json())
      }
      if (concRes.status === 'fulfilled' && concRes.value.ok) {
        setConcentration(await concRes.value.json())
      }
      if (impRes.status === 'fulfilled' && impRes.value.ok) {
        setImpact(await impRes.value.json())
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <>
        <Topbar
          title={t('Site', 'Site')}
          left={
            <GhostButton onClick={() => router.push('/sites')}>
              <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
            </GhostButton>
          }
        />
        <div className="attestiv-content">
          <Skeleton lines={5} height={42} />
        </div>
      </>
    );
  }

  if (!site) {
    return (
      <>
        <Topbar title={t('Site', 'Site')} />
        <div className="attestiv-content">
          {error ? <Banner tone="error">{error}</Banner> : null}
          <EmptyState icon="ti-building" title={t('Site not found', 'Site not found')} description={t(
            'The site may not be registered or you may not have access.',
            'The site may not be registered or you may not have access.'
          )} />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar
        title={site.display_name}
        left={
          <GhostButton onClick={() => router.push('/sites')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
          </GhostButton>
        }
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {site.site_type ? <Badge tone="navy">{site.site_type.replace(/_/g, ' ')}</Badge> : null}
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              <code>{site.site_id}</code>
            </span>
            <PrimaryButton onClick={() => router.push(`/sites/new?edit=${encodeURIComponent(site.site_id)}`)}>
              <i className="ti ti-pencil" aria-hidden="true" /> {t('Edit', 'Edit')}
            </PrimaryButton>
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {concentration?.exceeds_threshold ? (
          <Banner tone="warning" title={`DORA Art.29 concentration breach — ${concentration.concentration_pct?.toFixed(0)}% of tier-1 apps`}>
            {t('Threshold', 'Threshold')} {concentration.threshold_pct}{t('% — actual', '% — actual')} {concentration.concentration_pct?.toFixed(0)}%.
                        {concentration.affected_apps && concentration.affected_apps.length > 0
              ? ` ${concentration.affected_apps.length} apps in scope.`
              : ''}
          </Banner>
        ) : null}

        <Card>
          <CardTitle>{t('Summary', 'Summary')}</CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Field label={t('Location', 'Location')}>
              {site.city || site.location?.city || '—'}
              {(site.country || site.location?.country) ? `, ${site.country || site.location?.country}` : ''}
            </Field>
            <Field label={t('Region', 'Region')}>{site.region || site.location?.region || '—'}</Field>
            {site.dr_site ? (
              <Field label={t('DR partner', 'DR partner')}>
                <code style={{ fontSize: 11 }}>{site.dr_site}</code>
              </Field>
            ) : null}
            {site.primary_site ? (
              <Field label={t('Primary partner', 'Primary partner')}>
                <code style={{ fontSize: 11 }}>{site.primary_site}</code>
              </Field>
            ) : null}
            <Field label={t('CIs hosted', 'CIs hosted')}>{String(site.ci_count ?? 0)}</Field>
            <Field label={t('WAN links', 'WAN links')}>{String(site.wan_link_count ?? 0)}</Field>
            {site.location?.distance_from_dr_km !== undefined ? (
              <Field label={t('Distance to DR', 'Distance to DR')}>{site.location.distance_from_dr_km} km</Field>
            ) : null}
            {site.dr_capacity?.compute_headroom_pct !== undefined ? (
              <Field label={t('Compute headroom', 'Compute headroom')}>{site.dr_capacity.compute_headroom_pct}%</Field>
            ) : null}
            {site.dr_capacity?.storage_headroom_pct !== undefined ? (
              <Field label={t('Storage headroom', 'Storage headroom')}>{site.dr_capacity.storage_headroom_pct}%</Field>
            ) : null}
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Datacenter / hosting provider', 'Datacenter / hosting provider')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            {t(
              'Link this site to its colocation / hosting operator in the DORA Art.28 register. Overrides the registry declaration; feeds the provider dependency map and facility concentration (Art.29).',
              'Link this site to its colocation / hosting operator in the DORA Art.28 register. Overrides the registry declaration; feeds the provider dependency map and facility concentration (Art.29).',
            )}
          </p>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            {(() => {
              const ov = overrides[`site:${site.site_id}`]
              const name = ov
                ? (providers.find((p) => p.id === ov)?.provider_name ?? ov)
                : (site.location?.provider ?? '')
              return name ? (
                <strong>{name}</strong>
              ) : (
                <span style={{ color: 'var(--color-text-tertiary)' }}>{t('— none —', '— none —')}</span>
              )
            })()}
            <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 8, fontSize: 12 }}>
              {t('— set on the Edit screen', '— set on the Edit screen')}
            </span>
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={recovery?.dr_site ? <Badge tone="navy">→ {recovery.dr_site}</Badge> : null}>
            {t('Recovery order', 'Recovery order')}
          </CardTitle>
          {!recovery || !recovery.items || recovery.items.length === 0 ? (
            <EmptyState
              icon="ti-route"
              title={t('No recovery sequence', 'No recovery sequence')}
              description={t(
                'The site has no DR partner configured, or the orchestrator hasn\'t computed an order yet.',
                'The site has no DR partner configured, or the orchestrator hasn\'t computed an order yet.'
              )}
            />
          ) : (
            <ol style={{ paddingLeft: 18, fontSize: 12, marginTop: 4, marginBottom: 0 }}>
              {recovery.items.map((target, i) => {
                const tone = CRITICALITY_TONE[(target.criticality_tier || '').toLowerCase()] ?? 'gray'
                return (
                  <li key={`${target.target_id}-${i}`} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <code style={{ fontSize: 11, fontWeight: 500 }}>{target.target_id}</code>
                      {target.target_type ? (
                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                          ({target.target_type}{target.ci_type ? ` · ${target.ci_type}` : ''})
                        </span>
                      ) : null}
                      {target.criticality_tier ? <Badge tone={tone}>{target.criticality_tier}</Badge> : null}
                      {target.max_minutes ? (
                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                          ≤ {target.max_minutes} min
                        </span>
                      ) : null}
                    </div>
                    {target.depends_on && target.depends_on.length > 0 ? (
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                        {t('depends on:', 'depends on:')}{' '}
                        {target.depends_on.map((d, idx) => (
                          <span key={idx}>
                            {idx > 0 ? ', ' : ''}
                            <code>{d}</code>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {target.recovery_actions && target.recovery_actions.length > 0 ? (
                      <ul style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2, paddingLeft: 16 }}>
                        {target.recovery_actions.map((action, idx) => (
                          <li key={idx}>{action}</li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              concentration ? (
                <Badge tone={concentration.exceeds_threshold ? 'red' : 'green'}>
                  {concentration.concentration_pct?.toFixed(0)}% / {concentration.threshold_pct}%
                </Badge>
              ) : null
            }
          >
            {t('DORA Art.29 concentration', 'DORA Art.29 concentration')}
          </CardTitle>
          {!concentration ? (
            <EmptyState icon="ti-circle-dashed" title={t('Concentration not computed', 'Concentration not computed')} description={t(
              'The /v1/sites/{id}/concentration-risk endpoint did not respond.',
              'The /v1/sites/{id}/concentration-risk endpoint did not respond.'
            )} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <Field label={t('Tier-1 apps total', 'Tier-1 apps total')}>{String(concentration.total_tier1_apps ?? 0)}</Field>
              <Field label={t('Apps at this site', 'Apps at this site')}>{String(concentration.apps_in_site ?? 0)}</Field>
              <Field label={t('Concentration', 'Concentration')}>{concentration.concentration_pct?.toFixed(0)}%</Field>
              <Field label={t('Threshold', 'Threshold')}>{concentration.threshold_pct}%</Field>
              {concentration.affected_apps && concentration.affected_apps.length > 0 ? (
                <Field label={t('Affected apps', 'Affected apps')}>
                  <div style={{ fontSize: 11 }}>
                    {concentration.affected_apps.slice(0, 6).map((appID, i) => (
                      <span key={i} style={{ marginRight: 6 }}>
                        <code>{appID}</code>
                      </span>
                    ))}
                    {concentration.affected_apps.length > 6 ? (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        +{concentration.affected_apps.length - 6} more
                      </span>
                    ) : null}
                  </div>
                </Field>
              ) : null}
            </div>
          )}
          {site?.primary_site ? (
            <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 10, lineHeight: 1.5 }}>
              <i className="ti ti-info-circle" aria-hidden="true" style={{ marginRight: 4 }} />
              {t(
                'DR/recovery target for {primary} — the primary tier-1 apps are hosted and scored there, so a low concentration here is expected, not a gap.',
                'DR/recovery target for {primary} — the primary tier-1 apps are hosted and scored there, so a low concentration here is expected, not a gap.',
                { primary: site.primary_site },
              )}
            </p>
          ) : null}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              impact?.estimated_scope ? <Badge tone="amber">{impact.estimated_scope}</Badge> : null
            }
          >
            {t('Cascade impact', 'Cascade impact')}
          </CardTitle>
          {!impact ? (
            <EmptyState icon="ti-circle-dashed" title={t('Impact not computed', 'Impact not computed')} description={t(
              'The /v1/sites/{id}/impact endpoint did not respond.',
              'The /v1/sites/{id}/impact endpoint did not respond.'
            )} />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              <Field label={t('Tier-1 apps affected', 'Tier-1 apps affected')}>{String(impact.total_tier1_affected ?? 0)}</Field>
              <Field label={t('Tier-2 apps affected', 'Tier-2 apps affected')}>{String(impact.total_tier2_affected ?? 0)}</Field>
              <Field label={t('CIs affected', 'CIs affected')}>{String(impact.affected_cis?.length ?? 0)}</Field>
              {impact.affected_applications && impact.affected_applications.length > 0 ? (
                <Field label={t('Apps', 'Apps')}>
                  <div style={{ fontSize: 11 }}>
                    {impact.affected_applications.slice(0, 8).map((a, i) => (
                      <span key={i} style={{ marginRight: 6 }}>
                        <code>{a.application_id}</code>
                      </span>
                    ))}
                    {impact.affected_applications.length > 8 ? (
                      <span style={{ color: 'var(--color-text-tertiary)' }}>
                        +{impact.affected_applications.length - 8} more
                      </span>
                    ) : null}
                  </div>
                </Field>
              ) : null}
            </div>
          )}
        </Card>

        {site.connectivity?.wan_links && site.connectivity.wan_links.length > 0 ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle right={<Badge tone="navy">{site.connectivity.wan_links.length}</Badge>}>{t('WAN links', 'WAN links')}</CardTitle>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={headerRowStyle}>
                  <th style={{ padding: '6px 10px 6px 0' }}>{t('Link', 'Link')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Provider', 'Provider')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Target', 'Target')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Bandwidth', 'Bandwidth')}</th>
                  <th style={{ padding: '6px 0 6px 10px', textAlign: 'right' }}>{t('SLA uptime', 'SLA uptime')}</th>
                </tr>
              </thead>
              <tbody>
                {site.connectivity.wan_links.map((link, i) => (
                  <tr key={`${link.link_id}-${i}`} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                    <td style={{ padding: '8px 10px 8px 0' }}>
                      <code style={{ fontSize: 11 }}>{link.link_id ?? '—'}</code>
                      {link.type ? (
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{link.type}</div>
                      ) : null}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {link.target_site ? (
                        providerSelect('link', link.link_id ?? '', link.provider)
                      ) : (
                        <span style={{ color: 'var(--color-text-secondary)' }}>{link.provider ?? '—'}</span>
                      )}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {link.target_site ? <code style={{ fontSize: 11 }}>{link.target_site}</code> : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', color: 'var(--color-text-secondary)' }}>
                      {link.bandwidth_gbps ? `${link.bandwidth_gbps} Gbps` : '—'}
                    </td>
                    <td style={{ padding: '8px 0 8px 10px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                      {link.sla_uptime_pct !== undefined ? `${link.sla_uptime_pct}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 13, marginTop: 2 }}>{children}</div>
    </div>
  )
}

const headerRowStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
  textAlign: 'left',
}
