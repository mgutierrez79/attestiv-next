'use client';
// Application detail page.
//
// One scrollable view, four sections:
//   1. Summary — name, criticality, GxP flag, owner, DR requirements.
//   2. Components — VMs that make up the app, with site + DR site.
//   3. Dependencies — declared + resolved chain (transitive close).
//   4. Availability — latest probe results per component + dependency.
//   5. Change-control records — CCRs, with the GxP quality-approval badge.
//
// Each section degrades gracefully when its endpoint is unavailable
// or returns no_data; the page never blanks because one panel failed.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import {
  isAssetNode,
  neighboursOf,
} from '../lib/topologyNeighbours'

import { useI18n } from '../lib/i18n';

type AppDetail = {
  application_id: string
  display_name: string
  description?: string
  owner_email?: string
  criticality_tier?: string
  gxp_validated?: boolean
  component_count?: number
  dependency_count?: number
  components?: AppComponent[]
  dependencies?: AppDependency[]
  dependency_chain?: string
  dependents?: string[]
  dr_requirements?: { rto_minutes?: number; rpo_minutes?: number; tier?: string; classification?: string }
}

type AppComponent = {
  vm_name: string
  role?: string
  is_primary?: boolean
  connector?: string
  criticality?: string
  site?: string
  dr_site?: string
  dr_site_vm?: string
}

type AppDependency = {
  application_id: string
  dependency_type?: string
  criticality?: string
  description?: string
}

type InfraHost = { id: string; name: string; cluster?: string; site?: string; used_by: string[] }
type InfraStorage = {
  id: string
  name: string
  array_name?: string
  replication_mode?: string
  replication_role?: string
  replicated?: boolean
  lag_ms?: number
  wwn?: string
  used_by: string[]
}
type InfraSwitch = { id: string; name: string; used_by: string[] }
type InfraFirewall = { id: string; name: string; via_switches?: string[]; used_by: string[] }

type AppInfrastructure = {
  application_id: string
  categories: {
    host: InfraHost[]
    storage: InfraStorage[]
    switch: InfraSwitch[]
    firewall: InfraFirewall[]
  }
  counts: { host: number; storage: number; switch: number; firewall: number; total: number }
}

type AvailabilityResult = {
  application_id?: string
  status?: string // "no_data" | undefined
  message?: string
  all_components_available?: boolean
  all_dependencies_healthy?: boolean
  overall_available?: boolean
  component_results?: Array<{ vm_name?: string; available?: boolean; reason?: string }>
  dependency_results?: Array<{ application_id?: string; healthy?: boolean; reason?: string }>
  checked_at?: string
}

type CCR = {
  id: string
  change_ref?: string
  change_type?: string
  description?: string
  impact_assessment?: string
  test_protocol?: string
  gxp_revalidation_required?: boolean
  requested_by?: string
  approved_by?: string
  quality_approved_by?: string
  approved_at?: string
  implemented_at?: string
  evidence_id?: string
  created_at?: string
}

const TIER_TONE: Record<string, 'red' | 'amber' | 'navy' | 'gray'> = {
  tier_1: 'red',
  tier_2: 'amber',
  tier_3: 'navy',
}

export function AttestivAppDetailPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id

  const [app, setApp] = useState<AppDetail | null>(null)
  const [availability, setAvailability] = useState<AvailabilityResult | null>(null)
  const [ccrs, setCCRs] = useState<CCR[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hostingSite, setHostingSite] = useState('')

  useEffect(() => {
    if (!id) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      const detailRes = await apiFetch(`/apps/${encodeURIComponent(id)}`).catch((err: Error) => {
        return new Response(JSON.stringify({ detail: err.message }), { status: 599 })
      })
      if (cancelled) return
      if (!detailRes.ok) {
        if (detailRes.status === 404) {
          setError('Application not found')
        } else {
          setError(`${detailRes.status} ${detailRes.statusText}`)
        }
        setLoading(false)
        return
      }
      const detail: AppDetail = await detailRes.json()
      setApp(detail)

      // Availability + CCRs are best-effort. They run AFTER the
      // detail loads so the page can render the summary even if
      // these endpoints are temporarily unavailable.
      const [availRes, ccrRes, ovRes] = await Promise.allSettled([
        apiFetch(`/apps/${encodeURIComponent(id)}/availability`),
        apiFetch(`/apps/${encodeURIComponent(id)}/change-control`),
        apiFetch('/site-registry/app-site-overrides'),
      ])
      if (cancelled) return
      if (availRes.status === 'fulfilled' && availRes.value.ok) {
        const body = await availRes.value.json()
        setAvailability(body)
      }
      if (ccrRes.status === 'fulfilled' && ccrRes.value.ok) {
        const body = await ccrRes.value.json()
        setCCRs(Array.isArray(body?.items) ? body.items : [])
      }
      if (ovRes.status === 'fulfilled' && ovRes.value.ok) {
        const body = await ovRes.value.json()
        const overrides = (body?.overrides ?? {}) as Record<string, string>
        setHostingSite(overrides[id] ?? '')
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
          title={t('Application', 'Application')}
          left={
            <GhostButton onClick={() => router.push('/apps')}>
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

  if (!app) {
    return (
      <>
        <Topbar title={t('Application', 'Application')} />
        <div className="attestiv-content">
          {error ? <Banner tone="error">{error}</Banner> : null}
          <EmptyState icon="ti-apps" title={t('Application not found', 'Application not found')} description={t(
            'The application may not be registered or you may not have access.',
            'The application may not be registered or you may not have access.'
          )} />
        </div>
      </>
    );
  }

  const tier = (app.criticality_tier ?? '').toLowerCase()
  const tierTone = TIER_TONE[tier] ?? 'gray'

  return (
    <>
      <Topbar
        title={app.display_name}
        left={
          <GhostButton onClick={() => router.push('/apps')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
          </GhostButton>
        }
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {app.criticality_tier ? <Badge tone={tierTone}>{app.criticality_tier}</Badge> : null}
            {app.gxp_validated ? <Badge tone="navy" icon="ti-flask">{t('GxP', 'GxP')}</Badge> : null}
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              <code>{app.application_id}</code>
            </span>
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Card>
          <CardTitle>{t('Summary', 'Summary')}</CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <Field label={t('Owner', 'Owner')}>{app.owner_email || '—'}</Field>
            <Field label={t('Hosting site', 'Hosting site')}>{hostingSite || '—'}</Field>
            <Field label={t('Components', 'Components')}>{String(app.component_count ?? 0)}</Field>
            <Field label={t('Dependencies', 'Dependencies')}>{String(app.dependency_count ?? 0)}</Field>
            {app.dr_requirements?.rto_minutes !== undefined ? (
              <Field label={t('RTO target', 'RTO target')}>{app.dr_requirements.rto_minutes} min</Field>
            ) : null}
            {app.dr_requirements?.rpo_minutes !== undefined ? (
              <Field label={t('RPO target', 'RPO target')}>{app.dr_requirements.rpo_minutes} min</Field>
            ) : null}
          </div>
          {app.description ? (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 12, marginBottom: 0 }}>
              {app.description}
            </p>
          ) : null}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<Badge tone="navy">{app.components?.length ?? 0}</Badge>}>{t('Components', 'Components')}</CardTitle>
          {!app.components || app.components.length === 0 ? (
            <EmptyState icon="ti-server-cog" title={t('No components', 'No components')} description={t(
              'The application\'s component list is empty in the YAML registry.',
              'The application\'s component list is empty in the YAML registry.'
            )} />
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={headerRowStyle}>
                  <th style={{ padding: '6px 10px 6px 0' }}>VM</th>
                  <th style={{ padding: '6px 10px' }}>{t('Role', 'Role')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Site', 'Site')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('DR site', 'DR site')}</th>
                  <th style={{ padding: '6px 0 6px 10px' }}>{t('Connector', 'Connector')}</th>
                </tr>
              </thead>
              <tbody>
                {app.components.map((c, i) => (
                  <tr key={`${c.vm_name}-${i}`} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                    <td style={{ padding: '8px 10px 8px 0' }}>
                      <code style={{ fontSize: 11 }}>{c.vm_name}</code>
                      {c.is_primary ? <Badge tone="navy" icon="ti-star">primary</Badge> : null}
                    </td>
                    <td style={{ padding: '8px 10px', color: 'var(--color-text-secondary)' }}>{c.role ?? '—'}</td>
                    <td style={{ padding: '8px 10px' }}>
                      {c.site ? <code style={{ fontSize: 11 }}>{c.site}</code> : '—'}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {c.dr_site ? <code style={{ fontSize: 11 }}>{c.dr_site}</code> : '—'}
                    </td>
                    <td style={{ padding: '8px 0 8px 10px', color: 'var(--color-text-secondary)' }}>
                      {c.connector ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <GhostButton onClick={() => router.push(`/network/topology?app=${encodeURIComponent(app.application_id)}`)}>
                <i className="ti ti-affiliate" aria-hidden="true" /> {t('Open full map', 'Open full map')}
              </GhostButton>
            }
          >
            {t('Network topology', 'Network topology')}
          </CardTitle>
          <AppTopologyEmbed appID={app.application_id} t={t} />
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<Badge tone="navy">{app.dependencies?.length ?? 0}</Badge>}>{t('Dependencies', 'Dependencies')}</CardTitle>
          {!app.dependencies || app.dependencies.length === 0 ? (
            <EmptyState icon="ti-link-off" title={t('No declared dependencies', 'No declared dependencies')} description={t(
              'The application has no upstream dependency declarations.',
              'The application has no upstream dependency declarations.'
            )} />
          ) : (
            <div>
              {app.dependencies.map((d, i) => (
                <div
                  key={`${d.application_id}-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                    fontSize: 12,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => router.push(`/apps/${encodeURIComponent(d.application_id)}`)}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      color: 'var(--color-text-primary)',
                      padding: 0,
                    }}
                  >
                    <div style={{ fontWeight: 500 }}>
                      <code>{d.application_id}</code>
                    </div>
                    {d.description ? (
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{d.description}</div>
                    ) : null}
                  </button>
                  {d.dependency_type ? (
                    <Badge tone="gray">{d.dependency_type.replace(/_/g, ' ')}</Badge>
                  ) : null}
                  {d.criticality ? <Badge tone="amber">{d.criticality}</Badge> : null}
                </div>
              ))}
            </div>
          )}
          {app.dependency_chain ? (
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 10 }}>
              {t('Resolved chain:', 'Resolved chain:')} <code>{app.dependency_chain}</code>
            </div>
          ) : null}
        </Card>

        <AppInfrastructureDeps appID={app.application_id} t={t} />

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              availability?.overall_available !== undefined ? (
                <Badge tone={availability.overall_available ? 'green' : 'red'}>
                  {availability.overall_available ? 'available' : 'degraded'}
                </Badge>
              ) : null
            }
          >
            {t('Availability snapshot', 'Availability snapshot')}
          </CardTitle>
          {availability?.status === 'no_data' ? (
            <EmptyState
              icon="ti-circle-dashed"
              title={t('No availability data yet', 'No availability data yet')}
              description={availability.message || 'The platform hasn\'t computed availability for this application yet.'}
            />
          ) : !availability ? (
            <EmptyState icon="ti-circle-dashed" title={t('Availability not loaded', 'Availability not loaded')} description={t(
              'The /v1/apps/{id}/availability endpoint did not respond.',
              'The /v1/apps/{id}/availability endpoint did not respond.'
            )} />
          ) : (
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 8 }}>
                {t('Checked at', 'Checked at')} {availability.checked_at ? availability.checked_at.slice(0, 19).replace('T', ' ') + 'Z' : '—'}{t('.\n                Components:', '.\n                Components:')} {availability.all_components_available ? 'all available' : 'some unavailable'} {t('·\n                Dependencies:', '·\n                Dependencies:')} {availability.all_dependencies_healthy ? 'all healthy' : 'some degraded'}
              </div>
              {availability.component_results && availability.component_results.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {availability.component_results.map((c, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                      <Badge tone={c.available ? 'green' : 'red'}>
                        {c.available ? 'up' : 'down'}
                      </Badge>
                      <code style={{ fontSize: 11 }}>{c.vm_name ?? '—'}</code>
                      {c.reason ? <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{c.reason}</span> : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<Badge tone="navy">{ccrs.length}</Badge>}>{t('Change-control records', 'Change-control records')}</CardTitle>
          {ccrs.length === 0 ? (
            <EmptyState icon="ti-stamp" title={t('No change-control records', 'No change-control records')} description={t(
              'CCRs link approved changes to evidence. They appear here once filed via the API or admin UI.',
              'CCRs link approved changes to evidence. They appear here once filed via the API or admin UI.'
            )} />
          ) : (
            <div>
              {ccrs.map(ccr => {
                // `t` comes from the component scope above — calling
                // useI18n() inside this .map callback violated the rules of
                // hooks (and was redundant).
                return (
                  <div
                    key={ccr.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 130px 130px 100px',
                      gap: 10,
                      alignItems: 'center',
                      padding: '8px 0',
                      borderBottom: '0.5px solid var(--color-border-tertiary)',
                      fontSize: 12,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 500, marginBottom: 2 }}>
                        {ccr.change_ref || ccr.id.slice(0, 12)}
                        {ccr.gxp_revalidation_required ? (
                          <Badge tone="navy" icon="ti-flask">{t('GxP revalidation', 'GxP revalidation')}</Badge>
                        ) : null}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {ccr.description || ccr.change_type || '—'}
                      </div>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      {ccr.requested_by || '—'}
                      {ccr.approved_by ? (
                        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                          ✓ {ccr.approved_by}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                      {ccr.quality_approved_by ? (
                        <Badge tone="green" icon="ti-circle-check">{ccr.quality_approved_by}</Badge>
                      ) : ccr.gxp_revalidation_required ? (
                        <Badge tone="amber">{t('QA pending', 'QA pending')}</Badge>
                      ) : (
                        '—'
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
                      {ccr.approved_at ? ccr.approved_at.slice(0, 10) : ccr.created_at ? ccr.created_at.slice(0, 10) : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

// AppTopologyEmbed renders a small graph of this app's components +
// their cross-source neighbours (hosts they ride, storage they
// mount, backup source, network adjacency). Reuses /v1/network/
// topology and applies the app filter client-side.
// AppInfrastructureDeps renders the application-level rollup of DERIVED
// infrastructure dependencies: across all of the app's component VMs,
// which compute hosts / storage / switches / firewalls they collectively
// depend on. Distinct from the declared app→app "Dependencies" card above
// (which reads the YAML registry). Data comes from the dedicated
// GET /v1/apps/{id}/infrastructure endpoint, which performs the topology
// rollup server-side and enriches storage (PowerStore array name +
// replication) and firewall (reachability via switches). Self-contained
// fetch so the card degrades on its own without touching the working map.
function AppInfrastructureDeps({
  appID,
  t,
}: {
  appID: string
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
}) {
  const [infra, setInfra] = useState<AppInfrastructure | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await apiFetch(`/apps/${encodeURIComponent(appID)}/infrastructure`)
        if (!response.ok) throw new Error(`${response.status}`)
        const body = (await response.json()) as AppInfrastructure
        if (cancelled) return
        setInfra(body)
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
  }, [appID])

  const total = infra?.counts.total ?? 0

  // Shared "used by <vm names>" line: label + first 4 names + "+N".
  const usedBy = (names: string[]) => (
    <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
      {t('used by', 'used by')}{' '}
      {names.slice(0, 4).join(', ')}
      {names.length > 4 ? ` +${names.length - 4}` : ''}
    </span>
  )

  // Category header: swatch + uppercase label + count badge.
  const groupHeader = (swatch: string, label: string, count: number) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span
        style={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          background: swatch,
          display: 'inline-block',
        }}
      />
      <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3, color: 'var(--color-text-secondary)' }}>
        {label}
      </span>
      <Badge tone="gray">{count}</Badge>
    </div>
  )

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
    padding: '6px 0',
    borderTop: '0.5px solid var(--color-border-tertiary)',
    fontSize: 12,
  }

  const cats = infra?.categories

  return (
    <Card style={{ marginTop: 12 }}>
      <CardTitle right={<Badge tone="navy">{total}</Badge>}>
        {t('Infrastructure dependencies', 'Infrastructure dependencies')}
      </CardTitle>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 0, marginBottom: 12 }}>
        {t(
          'Derived from the vCenter, storage, network and firewall connectors — not declared dependencies.',
          'Derived from the vCenter, storage, network and firewall connectors — not declared dependencies.',
        )}
      </p>
      {loading ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '12px 0' }}>
          {t('Loading…', 'Loading…')}
        </div>
      ) : error ? (
        <EmptyState
          icon="ti-server-off"
          title={t('Infrastructure not loaded', 'Infrastructure not loaded')}
          description={t(
            'Could not load infrastructure dependencies.',
            'Could not load infrastructure dependencies.',
          )}
        />
      ) : total === 0 || !cats ? (
        <EmptyState
          icon="ti-server-off"
          title={t('No infrastructure resolved', 'No infrastructure resolved')}
          description={t(
            'Connect the vCenter, storage and backup connectors so the component VMs resolve to their hosts, datastores and backup coverage.',
            'Connect the vCenter, storage and backup connectors so the component VMs resolve to their hosts, datastores and backup coverage.',
          )}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {cats.host.length > 0 ? (
            <div>
              {groupHeader('var(--color-status-amber-mid)', t('Compute hosts', 'Compute hosts'), cats.host.length)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cats.host.map((h) => (
                  <div key={h.id} style={rowStyle}>
                    <code style={{ fontSize: 11, fontWeight: 500 }}>{h.name}</code>
                    {h.cluster || h.site ? (
                      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                        {[h.cluster, h.site].filter(Boolean).join(' · ')}
                      </span>
                    ) : null}
                    {usedBy(h.used_by)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {cats.storage.length > 0 ? (
            <div>
              {groupHeader('var(--color-status-green-mid)', t('Storage', 'Storage'), cats.storage.length)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cats.storage.map((s) => (
                  <div key={s.id} style={rowStyle}>
                    <code style={{ fontSize: 11, fontWeight: 500 }}>{s.name}</code>
                    {s.array_name ? (
                      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{s.array_name}</span>
                    ) : null}
                    {s.replication_mode ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Badge tone={s.replicated ? 'green' : 'gray'}>
                          {s.replication_mode}
                          {s.replication_role ? ` · ${s.replication_role}` : ''}
                        </Badge>
                        {s.lag_ms ? (
                          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                            {t('lag {n} ms', 'lag {n} ms', { n: s.lag_ms })}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                    {usedBy(s.used_by)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {cats.switch.length > 0 ? (
            <div>
              {groupHeader('var(--color-status-red-deep)', t('Switches', 'Switches'), cats.switch.length)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cats.switch.map((sw) => (
                  <div key={sw.id} style={rowStyle}>
                    <code style={{ fontSize: 11, fontWeight: 500 }}>{sw.name}</code>
                    {usedBy(sw.used_by)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {cats.firewall.length > 0 ? (
            <div>
              {groupHeader('var(--color-status-red-deep)', t('Firewalls', 'Firewalls'), cats.firewall.length)}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {cats.firewall.map((fw) => (
                  <div key={fw.id} style={rowStyle}>
                    <code style={{ fontSize: 11, fontWeight: 500 }}>{fw.name}</code>
                    {fw.via_switches && fw.via_switches.length > 0 ? (
                      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                        {t('via', 'via')} {fw.via_switches.join(', ')}
                      </span>
                    ) : null}
                    {usedBy(fw.used_by)}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}

function AppTopologyEmbed({
  appID,
  t,
}: {
  appID: string
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
}) {
  type Node = {
    id: string
    label: string
    asset_type: string
    criticality?: string
    health?: string
    backup_state?: string
  }
  type Edge = {
    id: string
    source: string
    target: string
    kind: string
    source_interface?: string
    target_interface?: string
    vlan?: string
  }

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Optional storage-capacity enrichment for the selected node, keyed by
  // node id. Best-effort: GET /inventory/assets/{id} → metadata.top_volumes
  // / volume_count. Absent → the panel falls back to graph data only.
  const [storageDetail, setStorageDetail] = useState<{
    id: string
    topVolumes: Array<{ name?: string; size?: string }>
    volumeCount?: number
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const response = await apiFetch('/network/topology')
        if (!response.ok) throw new Error(`${response.status}`)
        const body = (await response.json()) as { nodes: Node[]; edges: Edge[] }
        if (cancelled) return
        const appNodeID = `app:${appID}`
        const adj = new Map<string, string[]>()
        for (const e of body.edges) {
          if (!adj.has(e.source)) adj.set(e.source, [])
          adj.get(e.source)!.push(e.target)
          if (!adj.has(e.target)) adj.set(e.target, [])
          adj.get(e.target)!.push(e.source)
        }
        const keep = new Set<string>()
        const queue: Array<{ id: string; depth: number }> = [{ id: appNodeID, depth: 0 }]
        while (queue.length > 0) {
          const { id, depth } = queue.shift()!
          if (keep.has(id)) continue
          keep.add(id)
          if (depth >= 2) continue
          for (const n of adj.get(id) || []) queue.push({ id: n, depth: depth + 1 })
        }
        setNodes(body.nodes.filter((n) => keep.has(n.id)))
        setEdges(body.edges.filter((e) => keep.has(e.source) && keep.has(e.target)))
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
  }, [appID])

  // Enrichment: when a real inventory asset is selected, pull its
  // storage-capacity detail so each volume row can show array name +
  // size. Best-effort and non-blocking — failures leave the panel on
  // graph-only data. Synthetic ("app:" / "synthetic:") nodes are skipped.
  useEffect(() => {
    const selected = selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null
    if (!selected || !isAssetNode(selected)) {
      setStorageDetail(null)
      return
    }
    let cancelled = false
    async function loadDetail(id: string) {
      try {
        const res = await apiFetch(`/inventory/assets/${encodeURIComponent(id)}`)
        if (!res.ok) return
        const body = (await res.json()) as {
          metadata?: {
            top_volumes?: Array<{ name?: string; size?: string }>
            volume_count?: number
          }
        }
        if (cancelled) return
        const top = body.metadata?.top_volumes
        if (Array.isArray(top) && top.length > 0) {
          setStorageDetail({ id, topVolumes: top, volumeCount: body.metadata?.volume_count })
        } else {
          setStorageDetail(null)
        }
      } catch {
        if (!cancelled) setStorageDetail(null)
      }
    }
    void loadDetail(selected.id)
    return () => {
      cancelled = true
    }
  }, [selectedId, nodes])

  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '20px 0' }}>{t('Loading…', 'Loading…')}</div>
  }
  if (error) {
    return <Banner tone="error">{error}</Banner>
  }
  if (nodes.length === 0) {
    return (
      <EmptyState
        icon="ti-affiliate-off"
        title={t('No topology data yet', 'No topology data yet')}
        description={t(
          "No network_adjacency or cross-source edges connect this application's components. Configure Cisco / DNA / vCenter connectors and refresh.",
          "No network_adjacency or cross-source edges connect this application's components. Configure Cisco / DNA / vCenter connectors and refresh.",
        )}
      />
    )
  }

  // DRAW only the application + its component VMs. The full topology
  // (nodes/edges) is still fetched and kept in state so neighboursOf()
  // can resolve a VM's storage/host/backup on click — we just don't
  // render the storage/host/network/backup nodes (decluttered map).
  const appNodeID = `app:${appID}`
  const components = nodes.filter((n) => n.asset_type === 'vm')
  const drawnNodes = nodes.filter((n) => n.id === appNodeID || n.asset_type === 'vm')
  const drawnIds = new Set(drawnNodes.map((n) => n.id))
  // Edges drawn: only those whose endpoints are both drawn (app↔VM
  // membership). Storage/host/network edges are hidden by construction.
  const drawnEdges = edges.filter((e) => drawnIds.has(e.source) && drawnIds.has(e.target))

  // Lay out: app node at center, component VMs in a ring. Simple radial.
  const cx = 320
  const cy = 200
  const innerR = 110

  const positions = new Map<string, { x: number; y: number }>()
  positions.set(appNodeID, { x: cx, y: cy })
  components.forEach((n, i) => {
    const angle = (i / Math.max(components.length, 1)) * 2 * Math.PI - Math.PI / 2
    positions.set(n.id, { x: cx + Math.cos(angle) * innerR, y: cy + Math.sin(angle) * innerR })
  })

  // Token = role color + matching Tabler icon for a node. Keeping the
  // color separate from the icon lets the disk render as a soft tint and
  // the ring/glyph share the saturated tone, instead of one flat fill.
  type Token = { color: string; icon: string }
  function tokenFor(node: Node): Token {
    switch (node.asset_type) {
      case 'application':
        return { color: 'var(--color-status-blue-mid)', icon: appIconFromLabel(node.label) }
      case 'vm':
      case 'virtual_machine':
        return { color: 'var(--color-status-amber-mid)', icon: 'ti-device-desktop' }
      case 'host':
      case 'hypervisor_host':
        return { color: 'var(--color-status-blue-deep)', icon: 'ti-server' }
      case 'cluster':
        return { color: 'var(--color-status-blue-deep)', icon: 'ti-servers' }
      case 'storage_array':
        return { color: 'var(--color-status-green-mid)', icon: 'ti-database' }
      case 'storage_volume':
        return { color: 'var(--color-status-green-mid)', icon: 'ti-disc' }
      case 'backup_appliance':
        return { color: 'var(--color-status-blue-deep)', icon: 'ti-history' }
      case 'network_device':
      case 'switch':
      case 'router':
        return { color: 'var(--color-status-red-deep)', icon: 'ti-router' }
      case 'firewall':
      case 'firewall_manager':
        return { color: 'var(--color-status-red-deep)', icon: 'ti-shield-lock' }
    }
    return { color: 'var(--color-text-tertiary)', icon: 'ti-circle' }
  }

  // appIconFromLabel infers a meaningful icon from the application name as
  // a free upgrade over a generic stack glyph: Active Directory → key,
  // anything containing "database" → database, etc. Operators can later
  // override per-app via a YAML `icon:` field (small backend addition).
  function appIconFromLabel(label: string): string {
    const s = label.toLowerCase()
    if (/\b(active directory|domain controller|\bad\b|ldap|identity)\b/.test(s)) return 'ti-key'
    if (/\b(database|sql|oracle|postgres|mysql|mongo)\b/.test(s)) return 'ti-database'
    if (/\b(dns)\b/.test(s)) return 'ti-world'
    if (/\b(mail|exchange|smtp|imap)\b/.test(s)) return 'ti-mail'
    if (/\b(web|portal|frontend|nginx|apache)\b/.test(s)) return 'ti-world-www'
    if (/\b(mes|scada|manufacturing|plc)\b/.test(s)) return 'ti-building-factory-2'
    if (/\b(network|firewall|vpn|edge)\b/.test(s)) return 'ti-network'
    if (/\b(backup|recovery|veeam)\b/.test(s)) return 'ti-history'
    if (/\b(monitor|grafana|prometheus|telemetry|observ)\b/.test(s)) return 'ti-chart-line'
    if (/\b(siem|sentinel|log|audit)\b/.test(s)) return 'ti-shield-lock'
    return 'ti-stack-2'
  }

  function strokeFor(kind: string): string {
    switch (kind) {
      case 'app_membership':
        return 'var(--color-status-red-mid)'
      case 'hypervisor_host':
        return 'var(--color-status-amber-mid)'
      case 'storage_attachment':
        return 'var(--color-status-green-mid)'
      case 'backup_coverage':
        return 'var(--color-status-blue-deep)'
      case 'network_port':
        return 'var(--color-status-red-deep)'
    }
    return 'var(--color-border-tertiary)'
  }

  // selectedNode / groups resolve against the FULL topology so a VM's
  // hidden storage/host/backup neighbours are still discoverable on click.
  const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null
  const groups = neighboursOf(selectedId, nodes, edges)
  const selectedPos = selectedId ? positions.get(selectedId) ?? null : null

  return (
    <div style={{ overflow: 'hidden' }}>
      <svg
        width="100%"
        height={400}
        viewBox={`0 0 640 400`}
        style={{ background: 'var(--color-background-secondary)', borderRadius: 6 }}
      >
        {/* Background rect: clicking empty canvas deselects. */}
        <rect
          x={0}
          y={0}
          width={640}
          height={400}
          fill="transparent"
          onClick={() => setSelectedId(null)}
        />
        {drawnEdges.map((e) => {
          const a = positions.get(e.source)
          const b = positions.get(e.target)
          if (!a || !b) return null
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={strokeFor(e.kind)}
              strokeWidth={1.5}
              opacity={0.7}
              strokeDasharray={e.kind === 'app_membership' ? '4 2' : '0'}
            />
          )
        })}
        {drawnNodes.map((n) => {
          const pos = positions.get(n.id)
          if (!pos) return null
          // App nodes get a larger disk so the glyph reads at canvas scale;
          // component VMs stay compact so a fan-out of 6–8 doesn't crowd.
          const r = n.id === appNodeID ? 22 : 16
          const isSelected = n.id === selectedId
          const { color, icon } = tokenFor(n)
          // Glyph size = ~58% of disk diameter — the sweet spot where the
          // icon dominates visually without crowding the ring.
          const iconPx = Math.round(r * 1.15)
          return (
            <g
              key={n.id}
              transform={`translate(${pos.x},${pos.y})`}
              role="button"
              tabIndex={0}
              aria-label={n.label}
              style={{ cursor: 'pointer' }}
              onClick={() => setSelectedId(n.id)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter' || ev.key === ' ') {
                  ev.preventDefault()
                  setSelectedId(n.id)
                }
              }}
            >
              {isSelected ? (
                <circle
                  r={r + 5}
                  fill="none"
                  stroke="var(--color-status-blue-deep)"
                  strokeWidth={2.5}
                />
              ) : null}
              {/* Soft tinted disk: role color washed against the card
                  background. color-mix keeps the look consistent across
                  light/dark themes without precomputing tints. */}
              <circle
                r={r}
                fill={`color-mix(in srgb, ${color} 18%, var(--color-background-primary))`}
                stroke={color}
                strokeWidth={isSelected ? 2.25 : 1.5}
              />
              {/* Tabler glyph centered in the disk via foreignObject so
                  we reuse the same icon-font class used everywhere else
                  in the app — one visual vocabulary across the product. */}
              <foreignObject
                x={-r}
                y={-r}
                width={r * 2}
                height={r * 2}
                style={{ pointerEvents: 'none' }}
              >
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color,
                    fontSize: iconPx,
                    lineHeight: 1,
                  }}
                >
                  <i className={`ti ${icon}`} aria-hidden="true" />
                </div>
              </foreignObject>
              <text
                y={r + 14}
                textAnchor="middle"
                fontSize={10}
                fill="var(--color-text-primary)"
              >
                {n.label.length > 22 ? n.label.slice(0, 20) + '…' : n.label}
              </text>
            </g>
          )
        })}
        {/* Inline detail: a compact card anchored directly under the
            selected node's name label, so its storage/host read as a
            stack beneath the name. Position-clamped to the viewBox. */}
        {selectedNode && selectedPos ? (
          <NodeDetailCard
            node={selectedNode}
            groups={groups}
            storageDetail={storageDetail && storageDetail.id === selectedNode.id ? storageDetail : null}
            anchor={selectedPos}
            onClose={() => setSelectedId(null)}
            t={t}
          />
        ) : null}
      </svg>
      {!selectedNode ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
          {t('Select a node to see its attached storage.', 'Select a node to see its attached storage.')}
        </div>
      ) : null}
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Legend swatch="var(--color-status-blue-mid)" icon="ti-stack-2" label={t('App', 'App')} />
        <Legend swatch="var(--color-status-amber-mid)" icon="ti-device-desktop" label={t('Component VM', 'Component VM')} />
      </div>
    </div>
  )
}

// NodeDetailCard renders the selected node's details as a compact card
// inside the SVG, anchored directly beneath the node's name label so it
// reads as "<VM name> → its storage/host stacked below". Storage is the
// headline (first); host + backup follow, kept brief. The card is
// position-clamped so it never overflows the 640×400 viewBox — nudged
// left/up near the right/bottom edges.
const VIEW_W = 640
const VIEW_H = 400
const CARD_W = 200
const MAX_LIST = 5
function NodeDetailCard({
  node,
  groups,
  storageDetail,
  anchor,
  onClose,
  t,
}: {
  node: { id: string; label: string; asset_type: string; criticality?: string; health?: string; backup_state?: string }
  groups: ReturnType<typeof neighboursOf>
  storageDetail: { topVolumes: Array<{ name?: string; size?: string }>; volumeCount?: number } | null
  anchor: { x: number; y: number }
  onClose: () => void
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
}) {
  // Capacity enrichment keyed by volume name; falls back to graph data.
  const sizeByName = new Map<string, string>()
  for (const v of storageDetail?.topVolumes ?? []) {
    if (v.name && v.size) sizeByName.set(v.name, v.size)
  }

  const storage = groups.storage.slice(0, MAX_LIST)
  const storageMore = groups.storage.length - storage.length
  const host = groups.host.slice(0, MAX_LIST)
  const backup = groups.backup.slice(0, MAX_LIST)

  // Estimate card height from its rows so the up-nudge clamp is accurate.
  const rows =
    1 /* header */ +
    1 /* storage label */ +
    Math.max(storage.length, 1) +
    (storageMore > 0 ? 1 : 0) +
    (host.length > 0 ? 1 + host.length : 0) +
    (backup.length > 0 ? 1 + backup.length : 0)
  const cardH = 24 + rows * 16

  // Anchor below the node's label (label sits ~r+14 below centre; use a
  // fixed offset that clears the largest node radius + its text).
  const rawX = anchor.x - CARD_W / 2
  const rawY = anchor.y + 32
  const x = Math.max(4, Math.min(rawX, VIEW_W - CARD_W - 4))
  const y = Math.max(4, Math.min(rawY, VIEW_H - cardH - 4))

  const line = (
    key: string,
    label: string,
    value: string,
    color = 'var(--color-text-secondary)',
  ) => (
    <div key={key} style={{ display: 'flex', gap: 6, fontSize: 11, lineHeight: '15px' }}>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span style={{ color, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {value}
      </span>
    </div>
  )

  return (
    <foreignObject x={x} y={y} width={CARD_W} height={cardH} style={{ overflow: 'visible' }}>
      <div
        style={{
          boxSizing: 'border-box',
          width: CARD_W,
          padding: '8px 10px',
          border: '0.5px solid var(--color-border-secondary)',
          borderRadius: 6,
          background: 'var(--color-background-primary)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
        }}
        // Keep clicks inside the card from bubbling to the background
        // deselect handler.
        onClick={(ev) => ev.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {node.label}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close', 'Close')}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              padding: 0,
              fontSize: 13,
              lineHeight: 1,
            }}
          >
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>

        {/* Storage — the headline, stacked first. */}
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {t('Storage', 'Storage')}
        </div>
        {storage.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', lineHeight: '15px' }}>
            {t('No storage attached.', 'No storage attached.')}
          </div>
        ) : (
          <>
            {storage.map((s) => {
              const size = sizeByName.get(s.label)
              return line(s.id, '·', size ? `${s.label} (${size})` : s.label, 'var(--color-status-green-mid)')
            })}
            {storageMore > 0 ? (
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', lineHeight: '15px' }}>
                {t('+{n} more', '+{n} more', { n: storageMore })}
              </div>
            ) : null}
          </>
        )}

        {/* Host + backup — brief, below storage. */}
        {host.length > 0 ? (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('Runs on host', 'Runs on host')}
            </div>
            {host.map((h) => line(h.id, '·', h.label))}
          </div>
        ) : null}
        {backup.length > 0 ? (
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('Backup', 'Backup')}
            </div>
            {backup.map((b) => line(b.id, '·', b.label))}
          </div>
        ) : null}
      </div>
    </foreignObject>
  )
}

// Legend renders one entry under the topology canvas. The swatch is the
// role color (matches the node's ring); `icon` overlays the role glyph in
// that color so the legend mirrors the actual node design 1:1 rather than
// being a plain colored dot. icon is optional for callers that haven't
// migrated yet.
function Legend({ swatch, label, icon }: { swatch: string; label: string; icon?: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <span
        style={{
          width: 14,
          height: 14,
          borderRadius: 7,
          background: `color-mix(in srgb, ${swatch} 18%, var(--color-background-primary))`,
          border: `1px solid ${swatch}`,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: swatch,
          fontSize: 10,
          lineHeight: 1,
        }}
      >
        {icon ? <i className={`ti ${icon}`} aria-hidden="true" /> : null}
      </span>
      {label}
    </span>
  )
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
