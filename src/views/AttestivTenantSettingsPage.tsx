'use client';
// Tenant settings page.
//
// Single-pane form for the tenant profile: identity, branding bits,
// and the RTO/RPO targets the DR pages compare runs against. (Data
// residency was removed — this deployment stores evidence locally, so a
// cloud-region picker was misleading.) The targets are stored in localStorage today because the
// backend has no tenant-profile endpoint yet — when 4b's tenant API
// lands, swap the persistence layer; the form shape stays.
//
// Why RTO and RPO live here, not on the DR page: targets are a
// property of the tenant's compliance posture (a SOC 2 Availability
// or DORA Art. 12 commitment), not of any individual schedule. The
// DR page consumes them; this page sets them.

import { useEffect, useState } from 'react'

import {
  Badge,
  Card,
  CardTitle,
  FormField,
  GhostButton,
  PrimaryButton,
  Select,
  TextInput,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { fetchAuthConfig } from '../lib/auth'
import { loadSettings, saveSettings } from '../lib/settings'

import { useI18n } from '../lib/i18n';

type TenantProfile = {
  tenant_id: string
  display_name: string
  // `demo` unlocks the sample-data fallbacks across the console
  // (DLQ inbox, audit trail, framework posture, etc.). `pilot` and
  // `production` keep those views truthful — empty rows render as
  // real "no data" states instead of fabricated fixtures.
  environment: 'demo' | 'pilot' | 'production'
  industry: string
  rto_minutes: number
  rpo_minutes: number
  dr_frequency: 'monthly' | 'quarterly' | 'biannual' | 'annual'
}

const PROFILE_KEY = 'compliantly.tenant.profile'

const INDUSTRIES = ['Financial services', 'Healthcare', 'SaaS', 'Manufacturing', 'Public sector', 'Other']

export function AttestivTenantSettingsPage() {
  const {
    t
  } = useI18n();

  const [profile, setProfile] = useState<TenantProfile>(emptyProfile())
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The deployment environment is owned by the SERVER (COMPLIANCE_PROFILE),
  // not this per-browser form — demo data is server-authoritative. Show it
  // read-only so there's a single source of truth instead of a local
  // dropdown that the server overrides.
  const [deployProfile, setDeployProfile] = useState<{ profile: string; demo: boolean } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchAuthConfig()
      .then((cfg) => {
        if (!cancelled) setDeployProfile({ profile: cfg.profile || '', demo: Boolean(cfg.demo) })
      })
      .catch(() => {
        if (!cancelled) setDeployProfile(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false
    async function load() {
      const settings = loadSettings()
      const stored = readStoredProfile()
      // Optimistic local hydrate so the form is interactive while the
      // backend round-trip completes.
      setProfile({
        ...emptyProfile(),
        tenant_id: stored?.tenant_id || settings.tenantId || '',
        display_name: stored?.display_name ?? '',
        environment: stored?.environment ?? 'pilot',
        industry: stored?.industry ?? INDUSTRIES[0],
        rto_minutes: stored?.rto_minutes ?? 30,
        rpo_minutes: stored?.rpo_minutes ?? 15,
        dr_frequency: stored?.dr_frequency ?? 'quarterly',
      })
      try {
        const response = await apiFetch('/tenant/profile')
        if (!response.ok) throw new Error(`${response.status}`)
        const body = await response.json().catch(() => ({}))
        const remote = body?.profile ?? {}
        if (!cancelled && Object.keys(remote).length > 0) {
          setProfile((current) => ({
            ...current,
            tenant_id: typeof body?.tenant_id === 'string' ? body.tenant_id : current.tenant_id,
            display_name: typeof remote.display_name === 'string' ? remote.display_name : current.display_name,
            environment:
              remote.environment === 'production'
                ? 'production'
                : remote.environment === 'demo'
                  ? 'demo'
                  : 'pilot',
            industry: typeof remote.industry === 'string' && remote.industry ? remote.industry : current.industry,
            rto_minutes: typeof remote.rto_minutes === 'number' ? remote.rto_minutes : current.rto_minutes,
            rpo_minutes: typeof remote.rpo_minutes === 'number' ? remote.rpo_minutes : current.rpo_minutes,
            dr_frequency: ['monthly', 'quarterly', 'biannual', 'annual'].includes(remote.dr_frequency)
              ? remote.dr_frequency
              : current.dr_frequency,
          }))
        }
      } catch {
        // Backend unreachable or no profile yet — local state stands.
      } finally {
        if (!cancelled) setLoaded(true)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  function update<K extends keyof TenantProfile>(key: K, value: TenantProfile[K]) {
    setProfile((current) => ({ ...current, [key]: value }))
  }

  async function persist() {
    setSaving(true)
    setError(null)
    setInfo(null)
    try {
      const tenant = profile.tenant_id.trim()
      if (!tenant) {
        throw new Error('Tenant slug is required.')
      }
      const settings = loadSettings()
      saveSettings({ ...settings, tenantId: tenant })
      writeStoredProfile(profile)
      const response = await apiFetch('/tenant/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display_name: profile.display_name,
          environment: profile.environment,
          industry: profile.industry,
          rto_minutes: profile.rto_minutes,
          rpo_minutes: profile.rpo_minutes,
          dr_frequency: profile.dr_frequency,
        }),
      })
      if (response.ok) {
        setInfo('Tenant profile saved. RTO/RPO targets feed the DR schedules page.')
      } else if (response.status === 401 || response.status === 403) {
        setInfo('Saved locally; backend rejected the write (need an admin role with this tenant binding).')
      } else {
        setInfo('Saved locally; backend persistence failed and will retry on next save.')
      }
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save tenant profile')
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setProfile(emptyProfile())
    setInfo('Form reset to defaults. Click Save to persist.')
  }

  return (
    <>
      <Topbar
        title={t('Tenant settings', 'Tenant settings')}
        left={loaded ? null : <Badge tone="gray">{t('Loading…', 'Loading…')}</Badge>}
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <GhostButton onClick={reset} disabled={!loaded || saving}>
              {t('Reset', 'Reset')}
            </GhostButton>
            <PrimaryButton onClick={persist} disabled={!loaded || saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </PrimaryButton>
          </div>
        }
      />
      <div className="attestiv-content">
        {info ? <FlashBanner tone="blue" text={info} /> : null}
        {error ? <FlashBanner tone="red" text={error} /> : null}

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: 12,
          }}
        >
          <Card>
            <CardTitle>{t('Identity', 'Identity')}</CardTitle>
            {/* Phase 2B multi-tenancy removal: the editable tenant
                slug field is gone. The slug is pinned by the server
                via COMPLIANCE_DEFAULT_TENANT and cannot be changed
                from the UI — single-instance per customer means
                there's nothing to choose. The slug value is still
                in profile.tenant_id for legacy backwards-compat. */}
            <FormField label={t('Display name', 'Display name')}>
              <TextInput
                value={profile.display_name}
                onChange={(event) => update('display_name', event.target.value)}
                placeholder={t('Acme Corp', 'Acme Corp')}
              />
            </FormField>
            <FormField
              label={t('Environment', 'Environment')}
              hint={t(
                'Set by the server (COMPLIANCE_PROFILE), not per-browser. Demo fabricates sample data for screenshots; production/pilot never do. Read-only here so there is one source of truth.',
                'Set by the server (COMPLIANCE_PROFILE), not per-browser. Demo fabricates sample data for screenshots; production/pilot never do. Read-only here so there is one source of truth.',
              )}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
                <Badge tone={deployProfile?.demo ? 'amber' : deployProfile?.profile === 'production' ? 'green' : 'gray'}>
                  {deployProfile ? (deployProfile.profile || t('unset', 'unset')) : t('loading…', 'loading…')}
                </Badge>
                {deployProfile?.demo ? (
                  <span style={{ fontSize: 12, color: 'var(--color-status-amber-mid)' }}>
                    {t('demo data ON', 'demo data ON')}
                  </span>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                    {t('real data only', 'real data only')}
                  </span>
                )}
              </div>
            </FormField>
            <FormField label={t('Industry', 'Industry')}>
              <Select value={profile.industry} onChange={(event) => update('industry', event.target.value)}>
                {INDUSTRIES.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </FormField>
          </Card>

          <Card>
            <CardTitle right={<Badge tone="navy">{t('Compliance commitment', 'Compliance commitment')}</Badge>}>
              {t('Recovery objectives', 'Recovery objectives')}
            </CardTitle>
            <FormField
              label={t('RTO target (minutes)', 'RTO target (minutes)')}
              hint={t(
                'Maximum acceptable time to restore service. DR runs that exceed this fail.',
                'Maximum acceptable time to restore service. DR runs that exceed this fail.'
              )}
            >
              <TextInput
                type="number"
                inputMode="numeric"
                value={profile.rto_minutes}
                onChange={(event) => update('rto_minutes', clampInt(event.target.value, 1, 1440))}
              />
            </FormField>
            <FormField
              label={t('RPO target (minutes)', 'RPO target (minutes)')}
              hint={t(
                'Maximum acceptable data loss expressed in minutes of recent activity.',
                'Maximum acceptable data loss expressed in minutes of recent activity.'
              )}
            >
              <TextInput
                type="number"
                inputMode="numeric"
                value={profile.rpo_minutes}
                onChange={(event) => update('rpo_minutes', clampInt(event.target.value, 0, 1440))}
              />
            </FormField>
            <FormField label={t('DR test frequency', 'DR test frequency')} hint={t(
              'Audit frameworks (DORA Art. 12, ISO 27001 A.17) require regular DR exercises.',
              'Audit frameworks (DORA Art. 12, ISO 27001 A.17) require regular DR exercises.'
            )}>
              <Select
                value={profile.dr_frequency}
                onChange={(event) => update('dr_frequency', event.target.value as TenantProfile['dr_frequency'])}
              >
                <option value="monthly">{t('Monthly', 'Monthly')}</option>
                <option value="quarterly">{t('Quarterly', 'Quarterly')}</option>
                <option value="biannual">{t('Bi-annual', 'Bi-annual')}</option>
                <option value="annual">{t('Annual', 'Annual')}</option>
              </Select>
            </FormField>
            <RecoveryPosture profile={profile} />
          </Card>
        </div>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Where these settings show up', 'Where these settings show up')}</CardTitle>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              lineHeight: 1.7,
            }}
          >
            <li>
              <strong>{t('Tenant slug', 'Tenant slug')}</strong> {t(
                'is pinned by the server (COMPLIANCE_DEFAULT_TENANT) and embedded in every audit-trail entry. Not editable from this page in single-instance deployments.',
                'is pinned by the server (COMPLIANCE_DEFAULT_TENANT) and embedded in every audit-trail entry. Not editable from this page in single-instance deployments.',
              )}
            </li>
            <li>
              <strong>{t('RTO/RPO targets', 'RTO/RPO targets')}</strong> {t(
                'feed the DR schedules page — runs that exceed the target are marked failed; trends roll up into the dashboard\'s posture card.',
                'feed the DR schedules page — runs that exceed the target are marked failed; trends roll up into the dashboard\'s posture card.'
              )}
            </li>
            <li>
              <strong>{t('DR frequency', 'DR frequency')}</strong> {t(
                'determines reminder cadence and is read by the framework engines (DORA Art. 12, ISO 27001 A.17) to grade the tenant\'s posture.',
                'determines reminder cadence and is read by the framework engines (DORA Art. 12, ISO 27001 A.17) to grade the tenant\'s posture.'
              )}
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function RecoveryPosture({ profile }: { profile: TenantProfile }) {
  const {
    t
  } = useI18n();

  const tier =
    profile.rto_minutes <= 15 && profile.rpo_minutes <= 5
      ? { name: 'Elite', tone: 'green' as const }
      : profile.rto_minutes <= 60 && profile.rpo_minutes <= 30
        ? { name: 'High', tone: 'green' as const }
        : profile.rto_minutes <= 240
          ? { name: 'Medium', tone: 'amber' as const }
          : { name: 'Low', tone: 'red' as const }
  return (
    <div
      style={{
        background: 'var(--color-background-secondary)',
        borderRadius: 'var(--border-radius-md)',
        padding: '10px 12px',
        marginTop: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {t('Implied DORA tier', 'Implied DORA tier')}
      </span>
      <Badge tone={tier.tone}>{tier.name}</Badge>
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>RTO {profile.rto_minutes}{t('m · RPO', 'm · RPO')} {profile.rpo_minutes}m
              </span>
    </div>
  );
}

function FlashBanner({ tone, text }: { tone: 'blue' | 'red'; text: string }) {
  const palette = tone === 'red'
    ? { bg: 'var(--color-status-red-bg)', fg: 'var(--color-status-red-deep)' }
    : { bg: 'var(--color-status-blue-bg)', fg: 'var(--color-status-blue-deep)' }
  return (
    <div
      style={{
        fontSize: 12,
        color: palette.fg,
        background: palette.bg,
        padding: '8px 12px',
        borderRadius: 'var(--border-radius-md)',
        marginBottom: 12,
      }}
    >
      {text}
    </div>
  )
}

function emptyProfile(): TenantProfile {
  return {
    tenant_id: '',
    display_name: '',
    environment: 'pilot',
    industry: INDUSTRIES[0],
    rto_minutes: 30,
    rpo_minutes: 15,
    dr_frequency: 'quarterly',
  }
}

function clampInt(raw: string, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) return min
  if (parsed < min) return min
  if (parsed > max) return max
  return parsed
}

function readStoredProfile(): TenantProfile | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TenantProfile>
    return { ...emptyProfile(), ...parsed }
  } catch {
    return null
  }
}

function writeStoredProfile(profile: TenantProfile) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile))
}

