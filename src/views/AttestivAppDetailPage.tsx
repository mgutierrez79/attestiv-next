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

import { useEffect, useMemo, useState } from 'react'
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
  buildFlowsCsv,
  buildFlowValidationLookup,
  countFlows,
  flowValidationKey,
  validationTone,
  type DependencyFlow,
  type FlowValidation,
  type FlowValidationResponse,
} from '../lib/appFlows'
import {
  isAssetNode,
  neighboursOf,
} from '../lib/topologyNeighbours'
import {
  buildLayeredGraph,
  layoutGraph,
  type InfraCategories,
  type LayerKey,
  type LayoutNode,
  type RelationKind,
} from '../lib/topologyLayers'

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
  flows?: DependencyFlow[]
}

type InfraHost = { id: string; name: string; cluster?: string; site?: string; used_by: string[] }
type InfraStorage = {
  id: string
  name: string
  array_name?: string
  site?: string
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

const TIER_TONE: Record<string, 'red' | 'amber' | 'navy' | 'blue' | 'gray'> = {
  tier_0: 'red',
  tier_1: 'red',
  tier_2: 'amber',
  tier_3: 'navy',
  tier_4: 'blue',
  tier_5: 'gray',
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
  // Phase-2 flow-validation enrichment, keyed by flowValidationKey. Empty
  // until the best-effort /flow-validation fetch resolves; absence of a key
  // means "no badge for that flow" (the default behaviour).
  const [flowValidation, setFlowValidation] = useState<Map<string, FlowValidation>>(new Map())
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
      const [availRes, ccrRes, ovRes, flowValRes] = await Promise.allSettled([
        apiFetch(`/apps/${encodeURIComponent(id)}/availability`),
        apiFetch(`/apps/${encodeURIComponent(id)}/change-control`),
        apiFetch('/site-registry/app-site-overrides'),
        apiFetch(`/apps/${encodeURIComponent(id)}/flow-validation`),
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
      // Flow validation is best-effort: degrade silently (no badges) on any
      // failure or non-OK response.
      if (flowValRes.status === 'fulfilled' && flowValRes.value.ok) {
        const body = (await flowValRes.value.json().catch(() => null)) as FlowValidationResponse | null
        setFlowValidation(buildFlowValidationLookup(body))
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

  const flowCount = countFlows(app.dependencies)

  // Client-side CSV of every flow across all dependencies. Mirrors the
  // Blob + anchor download used elsewhere (e.g. the Risks page export).
  function exportFlows() {
    const csv = buildFlowsCsv(app?.dependencies)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `app-flows-${app?.application_id ?? 'export'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

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
          <AppTopologyEmbed
            appID={app.application_id}
            dependencies={app.dependencies ?? []}
            dependents={app.dependents ?? []}
            t={t}
          />
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {flowCount > 0 ? (
                  <GhostButton onClick={exportFlows}>
                    <i className="ti ti-download" aria-hidden="true" /> {t('Export flows (CSV)', 'Export flows (CSV)')}
                  </GhostButton>
                ) : null}
                <Badge tone="navy">{app.dependencies?.length ?? 0}</Badge>
              </div>
            }
          >
            {t('Dependencies', 'Dependencies')}
          </CardTitle>
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
                    padding: '10px 0',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
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
                  {d.flows && d.flows.length > 0 ? (
                    <FlowMatrix
                      flows={d.flows}
                      dependencyId={d.application_id}
                      validation={flowValidation}
                      t={t}
                    />
                  ) : null}
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
                    {s.array_name || s.site ? (
                      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                        {[s.array_name, s.site].filter(Boolean).join(' · ')}
                      </span>
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
                    <a href={`/inventory/${encodeURIComponent(fw.id)}`} style={{ textDecoration: 'none' }}>
                      <code style={{ fontSize: 11, fontWeight: 500, color: 'var(--color-status-blue-deep)' }}>{fw.name}</code>
                    </a>
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

// LAYER_KEYS drives both the toggle-chip row and the default state. The
// app + component VMs are ALWAYS drawn; these are the optional overlays.
// Default: the app's UPSTREAM dependencies ON, everything else OFF — keeps
// the view focused on what this app depends on. Dependents (downstream apps
// that depend on this one) are intentionally not surfaced on this map: the
// page is about the application's own dependency chain, and drawing the
// reverse direction cluttered it with unrelated apps.
const LAYER_DEFAULTS: Record<LayerKey, boolean> = {
  dependencies: true,
  dependents: false,
  host: false,
  storage: false,
  switch: false,
  firewall: false,
}

// View box is enlarged vs. the old fixed radial because layers add nodes.
const TOPO_W = 800
const TOPO_H = 500
const TOPO_ITER = 90

function AppTopologyEmbed({
  appID,
  dependencies,
  dependents,
  t,
}: {
  appID: string
  dependencies: AppDependency[]
  dependents: string[]
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
  const [infra, setInfra] = useState<InfraCategories | null>(null)
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(LAYER_DEFAULTS)
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
          // Do NOT traverse app→app dependency edges here: the per-app map
          // stays scoped to THIS application's own infrastructure. Its
          // declared dependencies are added separately (and only when they
          // exist), so the BFS must not walk through the dependency link
          // and pull other applications' VMs/infra into this app's view.
          if (e.kind === 'app_dependency') continue
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

  // Infrastructure layers: a second, best-effort fetch of the categorized
  // derived dependencies. Failure leaves infra null — the infra toggles
  // simply add nothing rather than blocking the base map.
  useEffect(() => {
    let cancelled = false
    async function loadInfra() {
      try {
        const res = await apiFetch(`/apps/${encodeURIComponent(appID)}/infrastructure`)
        if (!res.ok) return
        const body = (await res.json()) as AppInfrastructure
        if (cancelled) return
        setInfra(body.categories ?? null)
      } catch {
        if (!cancelled) setInfra(null)
      }
    }
    void loadInfra()
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

  // Build the visible (layered) graph + its deterministic layout. Recomputed
  // only when the underlying data or the enabled layers change — the force
  // relaxation is the same every time for the same inputs, so the picture is
  // stable across unrelated re-renders (e.g. selecting a node). Computed
  // before the early returns so hook order stays constant across renders.
  const { graphNodes, graphEdges, positions } = useMemo(() => {
    const built = buildLayeredGraph({
      appID,
      baseNodes: nodes,
      baseEdges: edges,
      infra,
      dependencies,
      dependents,
      enabled: layers,
    })
    const pos = layoutGraph(built.nodes, built.edges, {
      width: TOPO_W,
      height: TOPO_H,
      iterations: TOPO_ITER,
    })
    return { graphNodes: built.nodes, graphEdges: built.edges, positions: pos }
  }, [appID, nodes, edges, infra, dependencies, dependents, layers])

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

  // selectedNode / groups resolve against the FULL topology so a VM's
  // hidden storage/host/backup neighbours are still discoverable on click,
  // even when those infra layers aren't rendered on the canvas.
  const selectedNode = selectedId ? nodes.find((n) => n.id === selectedId) ?? null : null
  const groups = neighboursOf(selectedId, nodes, edges)
  const selectedPos = selectedId ? positions.get(selectedId) ?? null : null

  return (
    <div style={{ overflow: 'hidden' }}>
      {/* Layer toggle chips: app + component VMs always render; these add /
          remove their nodes + edges live. */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          flexWrap: 'wrap',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)', marginRight: 2 }}>
          {t('Layers', 'Layers')}
        </span>
        <LayerChip layer="dependencies" label={t('Dependencies', 'Dependencies')} icon="ti-arrow-up-right" swatch="var(--color-status-blue-deep)" layers={layers} setLayers={setLayers} />
        <LayerChip layer="host" label={t('Hosts', 'Hosts')} icon="ti-server" swatch="var(--color-status-amber-mid)" layers={layers} setLayers={setLayers} />
        <LayerChip layer="storage" label={t('Storage', 'Storage')} icon="ti-database" swatch="var(--color-status-green-mid)" layers={layers} setLayers={setLayers} />
        <LayerChip layer="switch" label={t('Network', 'Network')} icon="ti-router" swatch="var(--color-status-red-deep)" layers={layers} setLayers={setLayers} />
        <LayerChip layer="firewall" label={t('Firewalls', 'Firewalls')} icon="ti-shield-lock" swatch="var(--color-status-violet-mid)" layers={layers} setLayers={setLayers} />
      </div>

      <svg
        width="100%"
        height={TOPO_H}
        viewBox={`0 0 ${TOPO_W} ${TOPO_H}`}
        style={{ background: 'var(--color-background-secondary)', borderRadius: 6 }}
      >
        <defs>
          {/* Directional arrowhead for the app→dependency link. fill
              context-stroke makes the arrow take the edge's colour. */}
          <marker
            id="app-dep-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
          </marker>
        </defs>
        {/* Background rect: clicking empty canvas deselects. */}
        <rect
          x={0}
          y={0}
          width={TOPO_W}
          height={TOPO_H}
          fill="transparent"
          onClick={() => setSelectedId(null)}
        />
        {graphEdges.map((e) => {
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
              stroke={strokeForRelation(e.relation)}
              strokeWidth={isInfraRelation(e.relation) ? 1.5 : 2.25}
              opacity={isInfraRelation(e.relation) ? 0.6 : 0.9}
              strokeDasharray={dashForRelation(e.relation)}
              markerEnd={e.relation === 'dependency' ? 'url(#app-dep-arrow)' : undefined}
            />
          )
        })}
        {graphNodes.map((n) => {
          const pos = positions.get(n.id)
          if (!pos) return null
          // App node largest; dependency/dependent apps slightly smaller so
          // they read as related-but-distinct; VMs + infra compact.
          const r = n.group === 'app' ? 22 : n.group === 'dependency' || n.group === 'dependent' ? 17 : 15
          const isSelected = n.id === selectedId
          const { color, icon } = tokenForGroup(n)
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
              {/* Focal app: a pulsing green halo so the application under
                  view is unmistakable among its related app nodes. SMIL
                  <animate> is supported in all evergreen browsers. */}
              {n.group === 'app' ? (
                <circle r={r + 4} fill="none" stroke="var(--color-status-green-mid)" strokeWidth={2}>
                  <animate attributeName="r" values={`${r + 3};${r + 13};${r + 3}`} dur="1.8s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.7;0;0.7" dur="1.8s" repeatCount="indefinite" />
                </circle>
              ) : null}
              {/* Dependency / dependent apps get a double ring so they read
                  as application nodes distinct from the central app. */}
              {n.group === 'dependency' || n.group === 'dependent' ? (
                <circle r={r + 2.5} fill="none" stroke={color} strokeWidth={1} opacity={0.6} />
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
            viewW={TOPO_W}
            viewH={TOPO_H}
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
        <Legend swatch="var(--color-status-green-mid)" icon="ti-stack-2" label={t('App', 'App')} />
        <Legend swatch="var(--color-status-amber-mid)" icon="ti-device-desktop" label={t('Component VM', 'Component VM')} />
        {layers.dependencies ? (
          <Legend swatch="var(--color-status-blue-deep)" icon="ti-arrow-up-right" label={t('Dependencies', 'Dependencies')} />
        ) : null}
        {layers.host ? (
          <Legend swatch="var(--color-status-amber-mid)" icon="ti-server" label={t('Hosts', 'Hosts')} />
        ) : null}
        {layers.storage ? (
          <Legend swatch="var(--color-status-green-mid)" icon="ti-database" label={t('Storage', 'Storage')} />
        ) : null}
        {layers.switch ? (
          <Legend swatch="var(--color-status-red-deep)" icon="ti-router" label={t('Network', 'Network')} />
        ) : null}
        {layers.firewall ? (
          <Legend swatch="var(--color-status-violet-mid)" icon="ti-shield-lock" label={t('Firewalls', 'Firewalls')} />
        ) : null}
      </div>
    </div>
  )
}

// tokenForGroup maps a layout node's logical group to its disk color +
// Tabler glyph. Dependency / dependent apps share the app blue (a related
// application) but are visually set apart by a smaller radius + extra ring
// drawn at the call site.
function tokenForGroup(node: LayoutNode): { color: string; icon: string } {
  switch (node.group) {
    case 'app':
      // The app under view is the FOCAL node: green + a pulsing halo (drawn
      // at the call site) set it apart from the blue dependency/dependent apps.
      return { color: 'var(--color-status-green-mid)', icon: appIconFromLabel(node.label) }
    case 'dependency':
      return { color: 'var(--color-status-blue-deep)', icon: 'ti-arrow-up-right' }
    case 'dependent':
      return { color: 'var(--color-status-blue-deep)', icon: 'ti-arrow-down-left' }
    case 'vm':
      return { color: 'var(--color-status-amber-mid)', icon: 'ti-device-desktop' }
    case 'host':
      // Distinct per-type glyphs so hosts / storage / switches / firewalls
      // each read as their own kind of infrastructure.
      return { color: 'var(--color-status-amber-mid)', icon: 'ti-server' }
    case 'storage':
      return { color: 'var(--color-status-green-mid)', icon: 'ti-database' }
    case 'switch':
      return { color: 'var(--color-status-red-deep)', icon: 'ti-router' }
    case 'firewall':
      return { color: 'var(--color-status-violet-mid)', icon: 'ti-shield-lock' }
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

// isInfraRelation: VM→infrastructure edges (host/storage/switch/firewall),
// drawn lighter/thinner than the app↔app + app↔VM relations so the
// dependency backbone stays the visual focus.
function isInfraRelation(relation: RelationKind): boolean {
  return relation === 'host' || relation === 'storage' || relation === 'switch' || relation === 'firewall'
}

// strokeForRelation / dashForRelation colour + dash each edge by the
// relationship it represents, so the layers stay distinguishable when
// several are on at once.
function strokeForRelation(relation: RelationKind): string {
  switch (relation) {
    case 'app_membership':
      return 'var(--color-status-red-mid)'
    case 'dependency':
    case 'dependent':
      return 'var(--color-status-blue-deep)'
    case 'host':
      return 'var(--color-status-amber-mid)'
    case 'storage':
      return 'var(--color-status-green-mid)'
    case 'switch':
      return 'var(--color-status-red-deep)'
    case 'firewall':
      return 'var(--color-status-violet-mid)'
  }
  return 'var(--color-border-tertiary)'
}

function dashForRelation(relation: RelationKind): string {
  switch (relation) {
    case 'app_membership':
      return '4 2'
    case 'dependency':
      return '6 3'
    case 'dependent':
      return '2 3'
  }
  return '0'
}

// LayerChip is a small toggle pill for one optional layer, styled to mirror
// the legend swatches. Active → tinted + role-colored; inactive → muted.
function LayerChip({
  layer,
  label,
  icon,
  swatch,
  layers,
  setLayers,
}: {
  layer: LayerKey
  label: string
  icon: string
  swatch: string
  layers: Record<LayerKey, boolean>
  setLayers: React.Dispatch<React.SetStateAction<Record<LayerKey, boolean>>>
}) {
  const active = layers[layer]
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => setLayers((prev) => ({ ...prev, [layer]: !prev[layer] }))}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 11,
        fontFamily: 'inherit',
        cursor: 'pointer',
        padding: '3px 8px',
        borderRadius: 999,
        border: `1px solid ${active ? swatch : 'var(--color-border-secondary)'}`,
        background: active
          ? `color-mix(in srgb, ${swatch} 16%, var(--color-background-primary))`
          : 'transparent',
        color: active ? swatch : 'var(--color-text-tertiary)',
        lineHeight: 1.4,
      }}
    >
      <i className={`ti ${icon}`} aria-hidden="true" />
      {label}
    </button>
  )
}

// NodeDetailCard renders the selected node's details as a compact card
// inside the SVG, anchored directly beneath the node's name label so it
// reads as "<VM name> → its storage/host stacked below". Storage is the
// headline (first); host + backup follow, kept brief. The card is
// position-clamped so it never overflows the viewBox (passed in as
// viewW/viewH) — nudged left/up near the right/bottom edges.
const CARD_W = 200
const MAX_LIST = 5
function NodeDetailCard({
  node,
  groups,
  storageDetail,
  anchor,
  viewW,
  viewH,
  onClose,
  t,
}: {
  node: { id: string; label: string; asset_type: string; criticality?: string; health?: string; backup_state?: string }
  groups: ReturnType<typeof neighboursOf>
  storageDetail: { topVolumes: Array<{ name?: string; size?: string }>; volumeCount?: number } | null
  anchor: { x: number; y: number }
  viewW: number
  viewH: number
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
  const x = Math.max(4, Math.min(rawX, viewW - CARD_W - 4))
  const y = Math.max(4, Math.min(rawY, viewH - cardH - 4))

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

// FlowMatrix renders one dependency's declared network flows as a compact
// table, styled to match the Components table above. Columns: source,
// destination, protocol, ports, direction, description. When a flow carries
// the optional Phase-2 `validation` enrichment, a small status badge is
// shown next to the source; when it's absent (today's default) nothing is
// rendered — the matrix degrades gracefully.
function FlowMatrix({
  flows,
  dependencyId,
  validation,
  t,
}: {
  flows: DependencyFlow[]
  dependencyId: string
  validation: Map<string, FlowValidation>
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
}) {
  // Attach the validation enrichment onto each displayed flow by its
  // identifying tuple. A flow with no matching entry keeps validation
  // undefined → no badge (the default, graceful behaviour).
  const enriched = flows.map((f) => {
    const v = validation.get(
      flowValidationKey({
        dependency_application_id: dependencyId,
        source: f.source,
        destination: f.destination,
        protocol: f.protocol,
        ports: f.ports,
      }),
    )
    return v ? { ...f, validation: v } : f
  })
  return (
    <div style={{ marginTop: 8, marginLeft: 2, overflowX: 'auto' }}>
      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={headerRowStyle}>
            <th style={{ padding: '4px 10px 4px 0' }}>{t('Source', 'Source')}</th>
            <th style={{ padding: '4px 10px' }}>{t('Destination', 'Destination')}</th>
            <th style={{ padding: '4px 10px' }}>{t('Protocol', 'Protocol')}</th>
            <th style={{ padding: '4px 10px' }}>{t('Ports', 'Ports')}</th>
            <th style={{ padding: '4px 10px' }}>{t('Direction', 'Direction')}</th>
            <th style={{ padding: '4px 0 4px 10px' }}>{t('Description', 'Description')}</th>
          </tr>
        </thead>
        <tbody>
          {enriched.map((f, i) => (
            <tr key={i} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              <td style={{ padding: '6px 10px 6px 0' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <code style={{ fontSize: 11 }}>{f.source || '—'}</code>
                  {f.validation ? (
                    <Badge
                      tone={validationTone(f.validation.status)}
                      title={[f.validation.matched_rule, f.validation.reason].filter(Boolean).join(' — ') || undefined}
                    >
                      {f.validation.status.replace(/_/g, ' ')}
                    </Badge>
                  ) : null}
                </span>
              </td>
              <td style={{ padding: '6px 10px' }}>
                <code style={{ fontSize: 11 }}>{f.destination || '—'}</code>
              </td>
              <td style={{ padding: '6px 10px' }}>
                {f.protocol ? <Badge tone="gray">{f.protocol}</Badge> : '—'}
              </td>
              <td style={{ padding: '6px 10px', color: 'var(--color-text-secondary)' }}>
                {f.ports ? <code style={{ fontSize: 11 }}>{f.ports}</code> : '—'}
              </td>
              <td style={{ padding: '6px 10px', color: 'var(--color-text-secondary)' }}>{f.direction ?? '—'}</td>
              <td style={{ padding: '6px 0 6px 10px', color: 'var(--color-text-secondary)' }}>{f.description || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
