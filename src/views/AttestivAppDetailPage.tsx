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
      const [availRes, ccrRes] = await Promise.allSettled([
        apiFetch(`/apps/${encodeURIComponent(id)}/availability`),
        apiFetch(`/apps/${encodeURIComponent(id)}/change-control`),
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
                const {
                  t
                } = useI18n();

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
function AppTopologyEmbed({
  appID,
  t,
}: {
  appID: string
  t: (key: string, fallback?: string) => string
}) {
  type Node = {
    id: string
    label: string
    asset_type: string
    criticality?: string
    health?: string
    backup_state?: string
  }
  type Edge = { id: string; source: string; target: string; kind: string }

  const [nodes, setNodes] = useState<Node[]>([])
  const [edges, setEdges] = useState<Edge[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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

  // Lay out: app node at center, component VMs in a ring, second-hop
  // nodes (host, storage, backup) on the outer ring. Simple radial.
  const cx = 320
  const cy = 200
  const innerR = 80
  const outerR = 160
  const components = nodes.filter((n) => n.asset_type === 'vm')
  const others = nodes.filter((n) => !n.id.startsWith('app:') && n.asset_type !== 'vm')

  const positions = new Map<string, { x: number; y: number }>()
  positions.set(`app:${appID}`, { x: cx, y: cy })
  components.forEach((n, i) => {
    const angle = (i / Math.max(components.length, 1)) * 2 * Math.PI - Math.PI / 2
    positions.set(n.id, { x: cx + Math.cos(angle) * innerR, y: cy + Math.sin(angle) * innerR })
  })
  others.forEach((n, i) => {
    const angle = (i / Math.max(others.length, 1)) * 2 * Math.PI - Math.PI / 2 + Math.PI / others.length
    positions.set(n.id, { x: cx + Math.cos(angle) * outerR, y: cy + Math.sin(angle) * outerR })
  })

  function fillFor(node: Node): string {
    switch (node.asset_type) {
      case 'application':
        return 'var(--color-status-blue-mid)'
      case 'vm':
        return 'var(--color-status-amber-mid)'
      case 'host':
      case 'hypervisor_host':
        return 'var(--color-status-blue-deep)'
      case 'storage_array':
      case 'storage_volume':
        return 'var(--color-status-green-mid)'
      case 'backup_appliance':
        return 'var(--color-status-blue-deep)'
    }
    return 'var(--color-background-tertiary)'
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
    }
    return 'var(--color-border-tertiary)'
  }

  return (
    <div style={{ overflow: 'hidden' }}>
      <svg width="100%" height={400} viewBox={`0 0 640 400`} style={{ background: 'var(--color-background-secondary)', borderRadius: 6 }}>
        {edges.map((e) => {
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
        {nodes.map((n) => {
          const pos = positions.get(n.id)
          if (!pos) return null
          const r = n.id === `app:${appID}` ? 18 : 11
          return (
            <g key={n.id} transform={`translate(${pos.x},${pos.y})`}>
              <circle r={r} fill={fillFor(n)} stroke="var(--color-border-secondary)" strokeWidth={1} />
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
      </svg>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 6, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Legend swatch="var(--color-status-blue-mid)" label={t('App', 'App')} />
        <Legend swatch="var(--color-status-amber-mid)" label={t('Component VM', 'Component VM')} />
        <Legend swatch="var(--color-status-blue-deep)" label={t('Host / Backup', 'Host / Backup')} />
        <Legend swatch="var(--color-status-green-mid)" label={t('Storage', 'Storage')} />
      </div>
    </div>
  )
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <span style={{ width: 10, height: 10, borderRadius: 5, background: swatch, border: '0.5px solid var(--color-border-secondary)' }} />
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
