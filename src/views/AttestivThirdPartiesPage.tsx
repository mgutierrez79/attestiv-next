'use client';
// DORA Art.28 ICT third-party register (Phase-2 GRC, chunk 6).
//
// What's on screen:
//   - Banner alert when providers are overdue for assessment.
//   - 4 summary cards: total, critical, important, overdue.
//   - "DORA RoI export" download buttons (JSON + CSV).
//   - Provider list with criticality, contract end, last assessment, RoI flag.
//   - "Add provider" modal with the core DORA fields.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PaginatedList,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n';
import { useRoles } from '../lib/roles'

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
}

const CRITICALITY_TONE: Record<string, 'red' | 'amber' | 'gray' | 'navy'> = {
  critical: 'red',
  important: 'amber',
  standard: 'gray',
}

const STATUS_TONE: Record<string, 'amber' | 'green' | 'gray'> = {
  active: 'green',
  under_review: 'amber',
  exited: 'gray',
}

const CRITICALITIES = ['critical', 'important', 'standard'] as const
const STATUSES = ['active', 'under_review', 'exited'] as const

export function AttestivThirdPartiesPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const [providers, setProviders] = useState<Provider[]>([])
  const [overdue, setOverdue] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createBusy, setCreateBusy] = useState(false)
  const { canWrite } = useRoles()
  const [filter, setFilter] = useState<{ criticality?: string; status?: string }>({})

  async function refresh() {
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter.criticality) params.set('criticality', filter.criticality)
      if (filter.status) params.set('status', filter.status)
      params.set('limit', '500')
      const [listRes, dueRes] = await Promise.all([
        apiFetch(`/third-parties?${params.toString()}`),
        apiFetch('/third-parties/due-review'),
      ])
      if (!listRes.ok) throw new Error(`${listRes.status} ${listRes.statusText}`)
      const listBody = await listRes.json()
      setProviders(Array.isArray(listBody?.items) ? listBody.items : [])
      if (dueRes.ok) {
        const dueBody = await dueRes.json()
        setOverdue(Array.isArray(dueBody?.items) ? dueBody.items : [])
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load providers'
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setLoading(true)
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter.criticality, filter.status])

  async function createProvider(payload: Record<string, unknown>) {
    setCreateBusy(true)
    try {
      const response = await apiFetch('/third-parties', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      setShowCreate(false)
      await refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add provider'
      setError(message)
    } finally {
      setCreateBusy(false)
    }
  }

  async function downloadROI(format: 'csv' | 'json') {
    // The export endpoint streams the file with a Content-Disposition
    // header. We fetch via apiFetch (so session/auth headers come
    // along) and then trigger the download client-side from the blob.
    setError(null)
    try {
      const response = await apiFetch(`/third-parties/roi-export?format=${format}`)
      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(body || `${response.status} ${response.statusText}`)
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `dora_roi.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to download RoI export'
      setError(message)
    }
  }

  const summary = useMemo(() => {
    const totals = { total: providers.length, critical: 0, important: 0, standard: 0, exited: 0 }
    for (const p of providers) {
      const c = (p.criticality || '').toLowerCase() as keyof typeof totals
      if (c in totals) totals[c]++
      if (p.status === 'exited') totals.exited++
    }
    return totals
  }, [providers])

  const roiEligible = providers.filter((p) => p.roi_included).length

  return (
    <>
      <Topbar
        title={t(
          'ICT third-party register (DORA Art.28)',
          'ICT third-party register (DORA Art.28)'
        )}
        left={<Badge tone="navy">{providers.length} providers</Badge>}
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <GhostButton onClick={() => downloadROI('csv')}>
              <i className="ti ti-file-spreadsheet" aria-hidden="true" /> {t('RoI CSV', 'RoI CSV')}
            </GhostButton>
            <GhostButton onClick={() => downloadROI('json')}>
              <i className="ti ti-file-code" aria-hidden="true" /> {t('RoI JSON', 'RoI JSON')}
            </GhostButton>
            {canWrite ? (
              <PrimaryButton onClick={() => setShowCreate(true)}>
                <i className="ti ti-plus" aria-hidden="true" /> {t('Add provider', 'Add provider')}
              </PrimaryButton>
            ) : null}
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {overdue.length > 0 ? (
          <Banner tone="warning" title={`${overdue.length} provider${overdue.length === 1 ? '' : 's'} overdue for assessment`}>
            {t(
              'DORA Art.28(1) requires periodic monitoring of ICT third-party arrangements. Schedule\n            reassessment for these providers before submitting the next RoI.',
              'DORA Art.28(1) requires periodic monitoring of ICT third-party arrangements. Schedule\n            reassessment for these providers before submitting the next RoI.'
            )}
          </Banner>
        ) : null}
        <Banner tone="info" title={`RoI export covers ${roiEligible} provider${roiEligible === 1 ? '' : 's'}`}>
          {t(
            'Core RoI fields only — review against the latest EBA RoI ITS before submission to your\n          competent authority. Sector-specific fields (B_02 governance, B_04 contractual provisions,\n          B_06 dependency assessment) are out of scope for the chunk-1 export.',
            'Core RoI fields only — review against the latest EBA RoI ITS before submission to your\n          competent authority. Sector-specific fields (B_02 governance, B_04 contractual provisions,\n          B_06 dependency assessment) are out of scope for the chunk-1 export.'
          )}
        </Banner>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: 10,
          }}
        >
          <SummaryCard label={t('Total', 'Total')} value={summary.total} icon="ti-building" tone="navy" />
          <SummaryCard label={t('Critical', 'Critical')} value={summary.critical} icon="ti-flame" tone="red" />
          <SummaryCard label={t('Important', 'Important')} value={summary.important} icon="ti-alert-triangle" tone="amber" />
          <SummaryCard label={t('Overdue', 'Overdue')} value={overdue.length} icon="ti-clock-exclamation" tone="red" />
        </div>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<FilterBar value={filter} onChange={setFilter} />}>{t('Providers', 'Providers')}</CardTitle>
          {loading ? (
            <Skeleton lines={5} height={42} />
          ) : providers.length === 0 ? (
            <EmptyState
              icon="ti-building"
              title={t('No providers', 'No providers')}
              description={t(
                'Add your ICT third-party providers — at minimum the ones supporting critical or important functions. The register feeds the DORA RoI export.',
                'Add your ICT third-party providers — at minimum the ones supporting critical or important functions. The register feeds the DORA RoI export.'
              )}
              action={
                <PrimaryButton onClick={() => setShowCreate(true)}>
                  <i className="ti ti-plus" aria-hidden="true" /> {t('Add provider', 'Add provider')}
                </PrimaryButton>
              }
            />
          ) : (
            <PaginatedList
              items={providers}
              itemKey={(p) => p.id}
              renderItem={(p) => (
                <ProviderRow
                  provider={p}
                  onOpen={() => router.push(`/third-parties/${encodeURIComponent(p.id)}`)}
                />
              )}
              label={t('Providers', 'Providers')}
            />
          )}
        </Card>
      </div>
      {showCreate ? (
        <CreateProviderModal busy={createBusy} onCancel={() => setShowCreate(false)} onSubmit={createProvider} />
      ) : null}
    </>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string
  value: number
  tone: 'red' | 'amber' | 'navy' | 'green'
  icon: string
}) {
  const palette: Record<typeof tone, string> = {
    red: 'var(--color-status-red-mid)',
    amber: 'var(--color-status-amber-mid)',
    navy: 'var(--color-brand-blue)',
    green: 'var(--color-status-green-mid)',
  }
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: `${palette[tone]}1A`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: palette[tone],
          }}
        >
          <i className={`ti ${icon}`} aria-hidden="true" />
        </div>
        <div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</div>
          <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
        </div>
      </div>
    </Card>
  )
}

function FilterBar({
  value,
  onChange,
}: {
  value: { criticality?: string; status?: string }
  onChange: (next: { criticality?: string; status?: string }) => void
}) {
  const {
    t
  } = useI18n();

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
      <SelectChip
        label={t('Criticality', 'Criticality')}
        value={value.criticality}
        options={CRITICALITIES.slice()}
        onChange={(v) => onChange({ ...value, criticality: v })}
      />
      <SelectChip
        label={t('Status', 'Status')}
        value={value.status}
        options={STATUSES.slice()}
        onChange={(v) => onChange({ ...value, status: v })}
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

function ProviderRow({ provider, onOpen }: { provider: Provider; onOpen: () => void }) {
  const {
    t
  } = useI18n();

  const criticality = (provider.criticality || 'standard').toLowerCase()
  const status = (provider.status || 'active').toLowerCase()
  const critTone = CRITICALITY_TONE[criticality] ?? 'gray'
  const statusTone = STATUS_TONE[status] ?? 'gray'
  const overdue = provider.next_assessment_due && new Date(provider.next_assessment_due).getTime() < Date.now()
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 110px 110px 130px 130px 90px',
        gap: 10,
        alignItems: 'center',
        padding: '10px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        background: 'transparent',
        border: 'none',
        borderTop: 'none',
        borderLeft: 'none',
        borderRight: 'none',
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: 'var(--color-text-primary)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <span style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {provider.provider_name}
          </span>
          {provider.provider_country ? (
            <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>· {provider.provider_country}</span>
          ) : null}
          {overdue ? <Badge tone="red" icon="ti-clock-exclamation">overdue</Badge> : null}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {provider.services_provided}
        </div>
      </div>
      <div>
        <Badge tone={critTone}>{criticality}</Badge>
      </div>
      <div>
        <Badge tone={statusTone}>{status.replace(/_/g, ' ')}</Badge>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        {t('end:', 'end:')} {provider.contract_end_date ? provider.contract_end_date.slice(0, 10) : '—'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        {t('last:', 'last:')} {provider.last_assessment_date ? provider.last_assessment_date.slice(0, 10) : '—'}
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
        {provider.roi_included ? <Badge tone="navy">{t('RoI', 'RoI')}</Badge> : <span>—</span>}
      </div>
    </button>
  );
}

function CreateProviderModal({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean
  onCancel: () => void
  onSubmit: (payload: Record<string, unknown>) => void
}) {
  const {
    t
  } = useI18n();

  const [name, setName] = useState('')
  const [country, setCountry] = useState('')
  const [services, setServices] = useState('')
  const [criticality, setCriticality] = useState<typeof CRITICALITIES[number]>('important')
  const [contractEnd, setContractEnd] = useState('')
  const [lei, setLei] = useState('')
  const [roiIncluded, setRoiIncluded] = useState(true)
  const [subOutsourcing, setSubOutsourcing] = useState(false)
  const [exitPlan, setExitPlan] = useState(false)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.32)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--color-background-primary)',
          padding: 18,
          borderRadius: 'var(--border-radius-lg)',
          width: 'min(560px, 92vw)',
          maxHeight: '88vh',
          overflowY: 'auto',
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 12, fontSize: 15, fontWeight: 500 }}>{t('Add ICT provider', 'Add ICT provider')}</h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
          {t(
            'Captures the core RoI fields. Detail page lets you fill data-processing locations, exit\n          plan, sub-outsourcing details, and assessment cadence.',
            'Captures the core RoI fields. Detail page lets you fill data-processing locations, exit\n          plan, sub-outsourcing details, and assessment cadence.'
          )}
        </p>
        <FormRow label={t('Provider name', 'Provider name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('e.g. Acme Cloud Services', 'e.g. Acme Cloud Services')} style={inputStyle} />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormRow label={t('Country (ISO 3166)', 'Country (ISO 3166)')}>
            <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="IE" style={inputStyle} />
          </FormRow>
          <FormRow label={t('LEI (optional)', 'LEI (optional)')}>
            <input value={lei} onChange={(e) => setLei(e.target.value)} placeholder={t('20-char identifier', '20-char identifier')} style={inputStyle} />
          </FormRow>
        </div>
        <FormRow label={t('Services provided', 'Services provided')}>
          <textarea value={services} onChange={(e) => setServices(e.target.value)} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
        </FormRow>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <FormRow label={t('Criticality', 'Criticality')}>
            <select value={criticality} onChange={(e) => setCriticality(e.target.value as typeof CRITICALITIES[number])} style={inputStyle}>
              {CRITICALITIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label={t('Contract end (optional)', 'Contract end (optional)')}>
            <input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} style={inputStyle} />
          </FormRow>
        </div>
        <div style={{ display: 'flex', gap: 16, fontSize: 12, marginTop: 4 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={roiIncluded} onChange={(e) => setRoiIncluded(e.target.checked)} />
            {t('Include in RoI export', 'Include in RoI export')}
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={subOutsourcing} onChange={(e) => setSubOutsourcing(e.target.checked)} />
            {t('Sub-outsourcing', 'Sub-outsourcing')}
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={exitPlan} onChange={(e) => setExitPlan(e.target.checked)} />
            {t('Exit plan documented', 'Exit plan documented')}
          </label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 12 }}>
          <GhostButton onClick={onCancel} disabled={busy}>{t('Cancel', 'Cancel')}</GhostButton>
          <PrimaryButton
            onClick={() =>
              onSubmit({
                provider_name: name,
                provider_country: country || undefined,
                services_provided: services,
                criticality,
                contract_end_date: contractEnd || undefined,
                roi_included: roiIncluded,
                roi_entity_identifier: lei || undefined,
                sub_outsourcing: subOutsourcing,
                exit_plan_documented: exitPlan,
              })
            }
            disabled={busy || !name.trim() || !services.trim()}
          >
            {busy ? 'Saving…' : 'Add provider'}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
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
