'use client';
// Third-party provider detail page — full DORA Art.28 record.
//
// Two blocks:
//   1. Summary + assessment cadence + RoI inclusion flags.
//   2. Edit form covering every field (sub-outsourcing details,
//      data processing locations, exit plan, compliance evidence,
//      assessment dates, LEI).

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
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n';

type Provider = {
  id: string
  provider_name: string
  provider_country?: string
  services_provided: string
  criticality: string
  functions_supported?: string[]
  contract_start_date?: string
  contract_end_date?: string
  sub_outsourcing?: boolean
  sub_outsourcing_details?: string
  data_processing_locations?: string[]
  exit_plan_documented?: boolean
  provider_compliance_evidence?: string[]
  last_assessment_date?: string
  next_assessment_due?: string
  roi_included?: boolean
  roi_entity_identifier?: string
  status: string
  dependencies?: ProviderDependency[]
}

// Platform-derived infrastructure that depends on this provider (carrier
// inter-DC links, colo sites, and operator-attributed inventory assets such
// as inter-site links / VMs / hosts). Read-only overlay from the backend.
type ProviderDependency = {
  asset_type: string
  asset_ref: string
  function?: string
}

const CRITICALITIES = ['critical', 'important', 'standard'] as const
const STATUSES = ['active', 'under_review', 'exited'] as const

const CRITICALITY_TONE: Record<string, 'red' | 'amber' | 'gray'> = {
  critical: 'red',
  important: 'amber',
  standard: 'gray',
}

export function AttestivThirdPartyDetailPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const id = Array.isArray(params.id) ? params.id[0] : params.id

  const [provider, setProvider] = useState<Provider | null>(null)
  const [dependencies, setDependencies] = useState<ProviderDependency[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Editable fields (mirror persisted state until user changes them).
  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [services, setServices] = useState('')
  const [criticality, setCriticality] = useState<typeof CRITICALITIES[number]>('important')
  const [status, setStatus] = useState<typeof STATUSES[number]>('active')
  const [contractStart, setContractStart] = useState('')
  const [contractEnd, setContractEnd] = useState('')
  const [functions, setFunctions] = useState('')
  const [subOutsourcing, setSubOutsourcing] = useState(false)
  const [subDetails, setSubDetails] = useState('')
  const [locations, setLocations] = useState('')
  const [exitPlan, setExitPlan] = useState(false)
  const [evidence, setEvidence] = useState('')
  const [lastAssessment, setLastAssessment] = useState('')
  const [nextAssessment, setNextAssessment] = useState('')
  const [roiIncluded, setRoiIncluded] = useState(true)
  const [lei, setLei] = useState('')

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(`/third-parties/${encodeURIComponent(id)}`)
      if (!response.ok) {
        if (response.status === 404) throw new Error('Provider not found')
        throw new Error(`${response.status} ${response.statusText}`)
      }
      const body: Provider = await response.json()
      setProvider(body)
      setDependencies(Array.isArray(body.dependencies) ? body.dependencies : [])
      setName(body.provider_name)
      setCountry(body.provider_country || '')
      setServices(body.services_provided)
      setCriticality((CRITICALITIES.includes(body.criticality as typeof CRITICALITIES[number]) ? body.criticality : 'important') as typeof CRITICALITIES[number])
      setStatus((STATUSES.includes(body.status as typeof STATUSES[number]) ? body.status : 'active') as typeof STATUSES[number])
      setContractStart(body.contract_start_date ? body.contract_start_date.slice(0, 10) : '')
      setContractEnd(body.contract_end_date ? body.contract_end_date.slice(0, 10) : '')
      setFunctions((body.functions_supported || []).join(', '))
      setSubOutsourcing(!!body.sub_outsourcing)
      setSubDetails(body.sub_outsourcing_details || '')
      setLocations((body.data_processing_locations || []).join(', '))
      setExitPlan(!!body.exit_plan_documented)
      setEvidence((body.provider_compliance_evidence || []).join('\n'))
      setLastAssessment(body.last_assessment_date ? body.last_assessment_date.slice(0, 10) : '')
      setNextAssessment(body.next_assessment_due ? body.next_assessment_due.slice(0, 10) : '')
      setRoiIncluded(body.roi_included !== false)
      setLei(body.roi_entity_identifier || '')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load provider'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function save() {
    if (!id) return
    setBusy(true)
    setError(null)
    try {
      const updates: Record<string, unknown> = {
        provider_name: name,
        provider_country: country || undefined,
        services_provided: services,
        criticality,
        status,
        contract_start_date: contractStart || undefined,
        contract_end_date: contractEnd || undefined,
        functions_supported: functions.split(',').map((s) => s.trim()).filter(Boolean),
        sub_outsourcing: subOutsourcing,
        sub_outsourcing_details: subDetails || undefined,
        data_processing_locations: locations.split(',').map((s) => s.trim()).filter(Boolean),
        exit_plan_documented: exitPlan,
        provider_compliance_evidence: evidence.split('\n').map((s) => s.trim()).filter(Boolean),
        last_assessment_date: lastAssessment || undefined,
        next_assessment_due: nextAssessment || undefined,
        roi_included: roiIncluded,
        roi_entity_identifier: lei || undefined,
      }
      const response = await apiFetch(`/third-parties/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      await load()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save'
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <>
        <Topbar
          title={t('Provider', 'Provider')}
          left={
            <GhostButton onClick={() => router.push('/third-parties')}>
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

  if (!provider) {
    return (
      <>
        <Topbar title={t('Provider', 'Provider')} />
        <div className="attestiv-content">
          <EmptyState icon="ti-building" title={t('Provider not found', 'Provider not found')} description={t(
            'The provider may have been deleted or you may not have access.',
            'The provider may have been deleted or you may not have access.'
          )} />
        </div>
      </>
    );
  }

  const overdue = provider.next_assessment_due && new Date(provider.next_assessment_due).getTime() < Date.now()
  const critTone = CRITICALITY_TONE[(provider.criticality || '').toLowerCase()] ?? 'gray'

  return (
    <>
      <Topbar
        title={provider.provider_name}
        left={
          <GhostButton onClick={() => router.push('/third-parties')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back', 'Back')}
          </GhostButton>
        }
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Badge tone={critTone}>{provider.criticality}</Badge>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              <code>{provider.id.slice(0, 12)}…</code>
            </span>
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {overdue ? (
          <Banner tone="warning" title={t('Overdue for assessment', 'Overdue for assessment')}>
            {t(
              'DORA Art.28(1) requires periodic monitoring. Update the assessment date once you\'ve\n            reviewed the provider.',
              'DORA Art.28(1) requires periodic monitoring. Update the assessment date once you\'ve\n            reviewed the provider.'
            )}
          </Banner>
        ) : null}

        <Card>
          <CardTitle right={<Badge tone="navy">{dependencies.length}</Badge>}>
            {t('Dependent infrastructure', 'Dependent infrastructure')}
          </CardTitle>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
            {t(
              'Carrier inter-DC links, colocation sites, and inventory assets (inter-site links, VMs, hosts) attributed to this provider. Read-only — derived from site connectivity + per-asset provider attribution.',
              'Carrier inter-DC links, colocation sites, and inventory assets (inter-site links, VMs, hosts) attributed to this provider. Read-only — derived from site connectivity + per-asset provider attribution.',
            )}
          </div>
          {dependencies.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 10 }}>
              {t(
                'No dependent infrastructure yet. Attribute assets to this provider from an asset detail page, or declare a carrier on a site’s WAN links.',
                'No dependent infrastructure yet. Attribute assets to this provider from an asset detail page, or declare a carrier on a site’s WAN links.',
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    <th style={{ padding: '4px 8px' }}>{t('Type', 'Type')}</th>
                    <th style={{ padding: '4px 8px' }}>{t('Reference', 'Reference')}</th>
                    <th style={{ padding: '4px 8px' }}>{t('Function', 'Function')}</th>
                  </tr>
                </thead>
                <tbody>
                  {dependencies.map((d, i) => (
                    <tr key={`${d.asset_type}-${d.asset_ref}-${i}`} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={{ padding: '6px 8px' }}>
                        <Badge tone="gray">{(d.asset_type || 'asset').replace(/_/g, ' ')}</Badge>
                      </td>
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--font-mono)' }}>{d.asset_ref}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--color-text-secondary)' }}>{d.function || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>{t('Edit', 'Edit')}</CardTitle>
          <FormGrid>
            <FormRow label={t('Provider name', 'Provider name')}>
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </FormRow>
            <FormRow label={t('Country (ISO 3166)', 'Country (ISO 3166)')}>
              <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="IE" style={inputStyle} />
            </FormRow>
            <FormRow label={t('Criticality', 'Criticality')}>
              <select value={criticality} onChange={(e) => setCriticality(e.target.value as typeof CRITICALITIES[number])} style={inputStyle}>
                {CRITICALITIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </FormRow>
            <FormRow label={t('Status', 'Status')}>
              <select value={status} onChange={(e) => setStatus(e.target.value as typeof STATUSES[number])} style={inputStyle}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </FormRow>
          </FormGrid>
          <FormRow label={t('Services provided', 'Services provided')}>
            <textarea value={services} onChange={(e) => setServices(e.target.value)} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
          </FormRow>
          <FormRow label={t(
            'Functions supported (comma-separated)',
            'Functions supported (comma-separated)'
          )}>
            <input value={functions} onChange={(e) => setFunctions(e.target.value)} placeholder={t('payments, transaction-history', 'payments, transaction-history')} style={inputStyle} />
          </FormRow>
          <FormGrid>
            <FormRow label={t('Contract start', 'Contract start')}>
              <input type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} style={inputStyle} />
            </FormRow>
            <FormRow label={t('Contract end', 'Contract end')}>
              <input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} style={inputStyle} />
            </FormRow>
            <FormRow label={t('Last assessment', 'Last assessment')}>
              <input type="date" value={lastAssessment} onChange={(e) => setLastAssessment(e.target.value)} style={inputStyle} />
            </FormRow>
            <FormRow label={t('Next assessment due', 'Next assessment due')}>
              <input type="date" value={nextAssessment} onChange={(e) => setNextAssessment(e.target.value)} style={inputStyle} />
            </FormRow>
          </FormGrid>
          <FormRow label={t(
            'Data processing locations (comma-separated)',
            'Data processing locations (comma-separated)'
          )}>
            <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder={t('IE, DE', 'IE, DE')} style={inputStyle} />
          </FormRow>
          <FormRow label={t(
            'Provider compliance evidence (one URL per line)',
            'Provider compliance evidence (one URL per line)'
          )}>
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              rows={3}
              placeholder="https://provider.example/soc2-2026.pdf"
              style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
            />
          </FormRow>
          <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={subOutsourcing} onChange={(e) => setSubOutsourcing(e.target.checked)} />
              {t('Sub-outsourcing', 'Sub-outsourcing')}
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={exitPlan} onChange={(e) => setExitPlan(e.target.checked)} />
              {t('Exit plan documented', 'Exit plan documented')}
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={roiIncluded} onChange={(e) => setRoiIncluded(e.target.checked)} />
              {t('Include in RoI export', 'Include in RoI export')}
            </label>
          </div>
          {subOutsourcing ? (
            <FormRow label={t('Sub-outsourcing details', 'Sub-outsourcing details')}>
              <textarea value={subDetails} onChange={(e) => setSubDetails(e.target.value)} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
            </FormRow>
          ) : null}
          <FormRow label={t(
            'LEI (entity identifier — for RoI submission)',
            'LEI (entity identifier — for RoI submission)'
          )}>
            <input value={lei} onChange={(e) => setLei(e.target.value)} placeholder={t('20-character LEI', '20-character LEI')} style={inputStyle} />
          </FormRow>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <PrimaryButton onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
          </div>
        </Card>
      </div>
    </>
  );
}

function FormGrid({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
      {children}
    </div>
  )
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 8 }}>
      <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 3 }}>
        {label}
      </span>
      {children}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  fontSize: 12,
  padding: '6px 8px',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--border-radius-md)',
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  fontFamily: 'inherit',
}
