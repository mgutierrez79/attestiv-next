'use client';
// Edit-application form for runtime-added apps.
//
// Mirrors AttestivAppCreatePage except:
//   1. Loads the existing app via GET /v1/apps/{id} on mount
//   2. application_id is read-only (the registry key cannot change)
//   3. PATCH /v1/apps/{id} replaces the app's data
// YAML-defined apps return 409 from the backend and we surface the
// error inline — those must be edited in git.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import {
  Banner,
  Card,
  CardTitle,
  PrimaryButton,
  GhostButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { AppDependenciesField, type Dependency } from '../components/AppDependenciesField'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useRoles } from '../lib/roles'

const CRITICALITY_TIERS = ['tier_1', 'tier_2', 'tier_3'] as const

type ComponentRow = {
  vm_name: string
  role?: string
  is_primary?: boolean
  connector?: string
  criticality?: string
}

type GxPBlock = {
  validated?: boolean
  regulation?: string
  validation_date?: string
  next_validation_due?: string
  quality_owner?: string
}

type DependencyRow = {
  application_id?: string
  dependency_type?: string
  criticality?: string
}

type AppDetail = {
  application_id: string
  display_name?: string
  description?: string
  owner_email?: string
  criticality_tier?: string
  components?: ComponentRow[]
  dependencies?: DependencyRow[]
  gxp?: GxPBlock
  runtime_managed?: boolean
}

export function AttestivAppEditPage() {
  const { t } = useI18n()
  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const applicationId = Array.isArray(params.id) ? params.id[0] : (params.id ?? '')

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [criticalityTier, setCriticalityTier] = useState<'tier_1' | 'tier_2' | 'tier_3'>('tier_2')
  const [vmNames, setVmNames] = useState('')

  const [dependencies, setDependencies] = useState<Dependency[]>([])

  const [gxpValidated, setGxpValidated] = useState(false)
  const [gxpRegulation, setGxpRegulation] = useState('21_cfr_11')
  const [gxpValidationDate, setGxpValidationDate] = useState('')
  const [gxpNextDue, setGxpNextDue] = useState('')
  const [gxpQualityOwner, setGxpQualityOwner] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const { canWrite } = useRoles()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setLoadError(null)
      try {
        const response = await apiFetch(`/apps/${encodeURIComponent(applicationId)}`)
        const body = (await response.json().catch(() => ({}))) as AppDetail
        if (!response.ok) {
          throw new Error((body as any)?.detail || (body as any)?.error || `${response.status} ${response.statusText}`)
        }
        if (cancelled) return
        setDisplayName(body.display_name ?? '')
        setDescription(body.description ?? '')
        setOwnerEmail(body.owner_email ?? '')
        const tier = (body.criticality_tier ?? 'tier_2') as 'tier_1' | 'tier_2' | 'tier_3'
        setCriticalityTier(CRITICALITY_TIERS.includes(tier) ? tier : 'tier_2')
        setVmNames((body.components ?? []).map((c) => c.vm_name).filter(Boolean).join(', '))
        const deps: Dependency[] = (body.dependencies ?? [])
          .filter((d): d is DependencyRow => !!d?.application_id)
          .map((d) => ({
            application_id: String(d.application_id ?? ''),
            dependency_type: String(d.dependency_type ?? ''),
            criticality: (['critical', 'high', 'medium', 'low'].includes(d.criticality ?? '')
              ? (d.criticality as Dependency['criticality'])
              : 'high'),
          }))
        setDependencies(deps)
        const gxp = body.gxp ?? {}
        setGxpValidated(Boolean(gxp.validated))
        setGxpRegulation(gxp.regulation ?? '21_cfr_11')
        setGxpValidationDate(gxp.validation_date ?? '')
        setGxpNextDue(gxp.next_validation_due ?? '')
        setGxpQualityOwner(gxp.quality_owner ?? '')
      } catch (err: unknown) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load application')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [applicationId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const name = displayName.trim()
    if (!name) {
      setError(t('Display name is required.', 'Display name is required.'))
      return
    }
    const components = vmNames
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((vm) => ({
        vm_name: vm,
        role: 'component',
        is_primary: false,
        connector: 'vcenter',
        criticality: criticalityTier === 'tier_1' ? 'critical' : 'high',
      }))
    if (components.length === 0) {
      setError(t('At least one component VM name is required.', 'At least one component VM name is required.'))
      return
    }

    const cleanDeps = dependencies
      .map((d) => ({
        application_id: d.application_id.trim(),
        dependency_type: d.dependency_type.trim(),
        criticality: d.criticality,
      }))
      .filter((d) => d.application_id && d.application_id !== applicationId)
    for (const d of cleanDeps) {
      if (!d.dependency_type) {
        setError(t('Each dependency needs a dependency_type.', 'Each dependency needs a dependency_type.'))
        return
      }
    }

    const body: any = {
      application_id: applicationId,
      display_name: name,
      description: description.trim() || undefined,
      owner_email: ownerEmail.trim() || undefined,
      criticality_tier: criticalityTier,
      components,
      dependencies: cleanDeps,
    }
    if (gxpValidated) {
      body.gxp = {
        validated: true,
        regulation: gxpRegulation.trim() || undefined,
        validation_date: gxpValidationDate.trim() || undefined,
        next_validation_due: gxpNextDue.trim() || undefined,
        quality_owner: gxpQualityOwner.trim() || undefined,
      }
    } else {
      body.gxp = { validated: false }
    }

    setSubmitting(true)
    try {
      const response = await apiFetch(`/apps/${encodeURIComponent(applicationId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(responseBody?.detail || responseBody?.error || `${response.status} ${response.statusText}`)
      }
      router.push('/apps')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to update application')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <>
        <Topbar title={t('Edit application', 'Edit application')} />
        <div className="attestiv-content">
          <Card>
            <Skeleton lines={6} height={32} />
          </Card>
        </div>
      </>
    )
  }

  if (loadError) {
    return (
      <>
        <Topbar title={t('Edit application', 'Edit application')} />
        <div className="attestiv-content">
          <Banner tone="error">{loadError}</Banner>
          <div style={{ marginTop: 12 }}>
            <GhostButton onClick={() => router.push('/apps')} type="button">
              {t('Back to applications', 'Back to applications')}
            </GhostButton>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <Topbar title={t('Edit application', 'Edit application')} />
      <div className="attestiv-content">
        <form onSubmit={submit}>
          <Card>
            <CardTitle>{t('Identity', 'Identity')}</CardTitle>
            <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
              <Field
                label={t('Application ID', 'Application ID')}
                hint={t('Read-only — the registry key cannot change.', 'Read-only — the registry key cannot change.')}
              >
                <input
                  type="text"
                  value={applicationId}
                  readOnly
                  disabled
                  style={{ ...inputStyle, opacity: 0.6 }}
                />
              </Field>
              <Field label={t('Display name', 'Display name') + ' *'}>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  style={inputStyle}
                />
              </Field>
              <Field label={t('Description', 'Description')}>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </Field>
              <Field label={t('Owner email', 'Owner email')}>
                <input
                  type="email"
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  style={inputStyle}
                  placeholder="team@company.com"
                />
              </Field>
              <Field label={t('Criticality tier', 'Criticality tier')}>
                <select
                  value={criticalityTier}
                  onChange={(e) => setCriticalityTier(e.target.value as any)}
                  style={inputStyle}
                >
                  {CRITICALITY_TIERS.map((tier) => (
                    <option key={tier} value={tier}>
                      {tier}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <Card style={{ marginTop: 12 }}>
            <CardTitle>{t('Components', 'Components')}</CardTitle>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4, marginBottom: 8 }}>
              {t(
                'VM display names from your inventory. Comma-separated. Each VM should belong to only one application.',
                'VM display names from your inventory. Comma-separated. Each VM should belong to only one application.',
              )}
            </p>
            <Field label={t('Component VM names', 'Component VM names') + ' *'}>
              <input
                type="text"
                value={vmNames}
                onChange={(e) => setVmNames(e.target.value)}
                required
                style={inputStyle}
                placeholder="VRWMSQLA01, VRWMSQLA02"
              />
            </Field>
          </Card>

          <Card style={{ marginTop: 12 }}>
            <CardTitle>{t('Dependencies', 'Dependencies')}</CardTitle>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4, marginBottom: 8 }}>
              {t(
                'Other applications this one needs at runtime (e.g. an AD/LDAP service or a database backend). Cascade analysis uses these to compute blast radius.',
                'Other applications this one needs at runtime (e.g. an AD/LDAP service or a database backend). Cascade analysis uses these to compute blast radius.',
              )}
            </p>
            <AppDependenciesField value={dependencies} onChange={setDependencies} selfId={applicationId} />
          </Card>

          <Card style={{ marginTop: 12 }}>
            <CardTitle>{t('GxP validation', 'GxP validation')}</CardTitle>
            <label style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', fontSize: 13 }}>
              <input
                type="checkbox"
                checked={gxpValidated}
                onChange={(e) => setGxpValidated(e.target.checked)}
              />
              {t('Mark this app GxP-validated (FDA 21 CFR Part 11 / EU Annex 11)', 'Mark this app GxP-validated (FDA 21 CFR Part 11 / EU Annex 11)')}
            </label>
            {gxpValidated && (
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <Field label={t('Regulation', 'Regulation')}>
                  <input
                    type="text"
                    value={gxpRegulation}
                    onChange={(e) => setGxpRegulation(e.target.value)}
                    style={inputStyle}
                    placeholder="21_cfr_11"
                  />
                </Field>
                <Field label={t('Validation date (YYYY-MM-DD)', 'Validation date (YYYY-MM-DD)')}>
                  <input
                    type="text"
                    value={gxpValidationDate}
                    onChange={(e) => setGxpValidationDate(e.target.value)}
                    style={inputStyle}
                    placeholder="2024-09-15"
                  />
                </Field>
                <Field label={t('Next validation due (YYYY-MM-DD)', 'Next validation due (YYYY-MM-DD)')}>
                  <input
                    type="text"
                    value={gxpNextDue}
                    onChange={(e) => setGxpNextDue(e.target.value)}
                    style={inputStyle}
                    placeholder="2026-09-15"
                  />
                </Field>
                <Field label={t('Quality owner', 'Quality owner')}>
                  <input
                    type="text"
                    value={gxpQualityOwner}
                    onChange={(e) => setGxpQualityOwner(e.target.value)}
                    style={inputStyle}
                    placeholder="QA Director"
                  />
                </Field>
              </div>
            )}
          </Card>

          {error && (
            <div style={{ marginTop: 12 }}>
              <Banner tone="error">{error}</Banner>
            </div>
          )}

          <div style={{ display: 'flex', gap: 12, marginTop: 16, justifyContent: 'flex-end' }}>
            <GhostButton onClick={() => router.push('/apps')} type="button">
              {t('Cancel', 'Cancel')}
            </GhostButton>
            {canWrite ? (
              <PrimaryButton type="submit" disabled={submitting}>
                {submitting ? t('Saving…', 'Saving…') : t('Save changes', 'Save changes')}
              </PrimaryButton>
            ) : null}
          </div>
        </form>
      </div>
    </>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{hint}</span>}
    </label>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 4,
  border: '0.5px solid var(--color-border-tertiary)',
  background: 'var(--color-surface-primary)',
  fontSize: 13,
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}
