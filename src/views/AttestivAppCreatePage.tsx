'use client';
// Create-application form.
//
// Operator fills in identity + criticality + (optionally) GxP fields
// + component VM names. POST /v1/apps writes the app to the runtime
// store and the registry hot-adds it. Returns to /apps on success.
//
// Components are entered as a comma-separated VM-name list to keep
// the MVP form small. Full per-component editing (role, criticality,
// site/dr_site) belongs on the detail page; this form just gets the
// app into the registry.

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Banner,
  Card,
  CardTitle,
  PrimaryButton,
  GhostButton,
  Topbar,
} from '../components/AttestivUi'
import { AppDependenciesField, type Dependency } from '../components/AppDependenciesField'
import { AppUserAccessField } from '../components/AppUserAccessField'
import { AppComponentsField, formatComponentList } from '../components/AppComponentsField'
import { cleanFlows } from '../lib/appFlows'
import { cleanUserAccess, type UserAccessNetwork } from '../lib/appUserAccess'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useRoles } from '../lib/roles'

const CRITICALITY_TIERS = ['tier_0', 'tier_1', 'tier_2', 'tier_3', 'tier_4', 'tier_5'] as const
type CriticalityTier = (typeof CRITICALITY_TIERS)[number]

// slugify turns a display name into a backend-valid application_id
// (lowercase, alphanumeric + dash). The backend regex is
// /^[a-z0-9-]+$/ so we strip everything else, fold consecutive
// dashes, and trim leading/trailing dashes.
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

export function AttestivAppCreatePage() {
  const { t } = useI18n()
  const router = useRouter()

  const [applicationId, setApplicationId] = useState('')
  const [idManuallyEdited, setIdManuallyEdited] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [criticalityTier, setCriticalityTier] = useState<CriticalityTier>('tier_2')
  const [vmNames, setVmNames] = useState<string[]>([])

  const [dependencies, setDependencies] = useState<Dependency[]>([])
  const [userAccess, setUserAccess] = useState<UserAccessNetwork[]>([])

  const [gxpValidated, setGxpValidated] = useState(false)
  const [gxpRegulation, setGxpRegulation] = useState('21_cfr_11')
  const [gxpValidationDate, setGxpValidationDate] = useState('')
  const [gxpNextDue, setGxpNextDue] = useState('')
  const [gxpQualityOwner, setGxpQualityOwner] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const { canWrite } = useRoles()
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const id = applicationId.trim().toLowerCase()
    if (!id) {
      setError(t('Application ID is required.', 'Application ID is required.'))
      return
    }
    if (!/^[a-z0-9-]+$/.test(id)) {
      setError(t('Application ID must be lowercase letters, digits, and dashes only.', 'Application ID must be lowercase letters, digits, and dashes only.'))
      return
    }
    const name = displayName.trim()
    if (!name) {
      setError(t('Display name is required.', 'Display name is required.'))
      return
    }
    const components = formatComponentList(vmNames)
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
        flows: cleanFlows(d.flows),
      }))
      .filter((d) => d.application_id && d.application_id !== id)
    for (const d of cleanDeps) {
      if (!d.dependency_type) {
        setError(t('Each dependency needs a dependency_type.', 'Each dependency needs a dependency_type.'))
        return
      }
    }

    const body: any = {
      application_id: id,
      display_name: name,
      description: description.trim() || undefined,
      owner_email: ownerEmail.trim() || undefined,
      criticality_tier: criticalityTier,
      components,
      dependencies: cleanDeps,
      user_access: cleanUserAccess(userAccess),
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
      const response = await apiFetch('/apps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(responseBody?.detail || responseBody?.error || `${response.status} ${response.statusText}`)
      }
      router.push('/apps')
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create application')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Topbar title={t('New application', 'New application')} />
      <div className="attestiv-content">
        <form onSubmit={submit}>
          <Card>
            <CardTitle>{t('Identity', 'Identity')}</CardTitle>
            <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
              <Field label={t('Display name', 'Display name') + ' *'}>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => {
                    const v = e.target.value
                    setDisplayName(v)
                    if (!idManuallyEdited) {
                      setApplicationId(slugify(v))
                    }
                  }}
                  required
                  style={inputStyle}
                  placeholder="Microsoft SQL Server — Finance"
                />
              </Field>
              <Field
                label={t('Application ID', 'Application ID')}
                hint={
                  idManuallyEdited
                    ? t('Lowercase letters, digits, dashes only.', 'Lowercase letters, digits, dashes only.')
                    : t('Auto-derived from display name. Click Edit ID to customize.', 'Auto-derived from display name. Click Edit ID to customize.')
                }
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={applicationId}
                    onChange={(e) => setApplicationId(e.target.value)}
                    readOnly={!idManuallyEdited}
                    required
                    style={{
                      ...inputStyle,
                      opacity: idManuallyEdited ? 1 : 0.7,
                      cursor: idManuallyEdited ? 'text' : 'default',
                    }}
                    placeholder="mssql-finance"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (idManuallyEdited) {
                        // Reset: re-derive from current display name.
                        setApplicationId(slugify(displayName))
                        setIdManuallyEdited(false)
                      } else {
                        setIdManuallyEdited(true)
                      }
                    }}
                    style={{
                      background: 'transparent',
                      border: '0.5px solid var(--color-border-tertiary)',
                      borderRadius: 4,
                      padding: '6px 10px',
                      fontSize: 11,
                      cursor: 'pointer',
                      color: 'var(--color-text-secondary)',
                      fontFamily: 'inherit',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {idManuallyEdited ? t('Reset', 'Reset') : t('Edit ID', 'Edit ID')}
                  </button>
                </div>
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
                'Pick assets from your inventory; multiple allowed. You can also type a VM display name that isn’t discovered yet. Each VM should belong to only one application.',
                'Pick assets from your inventory; multiple allowed. You can also type a VM display name that isn’t discovered yet. Each VM should belong to only one application.',
              )}
            </p>
            <Field label={t('Component VM names', 'Component VM names') + ' *'}>
              <AppComponentsField value={vmNames} onChange={setVmNames} />
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
            <CardTitle>{t('User access', 'User access')}</CardTitle>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4, marginBottom: 8 }}>
              {t(
                'Where users connect from (an external network, a private LAN, VPN, a partner network or the internet). Surfaced as ingress flows in the flow matrix and network topology.',
                'Where users connect from (an external network, a private LAN, VPN, a partner network or the internet). Surfaced as ingress flows in the flow matrix and network topology.',
              )}
            </p>
            <AppUserAccessField value={userAccess} onChange={setUserAccess} />
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
                {submitting ? t('Creating…', 'Creating…') : t('Create application', 'Create application')}
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
