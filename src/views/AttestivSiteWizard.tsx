'use client'
// Sites / new — site creation wizard.
//
// Today's pilot has the site registry sourced from YAML files baked
// into the container image (policies/sites/*.yaml) plus a runtime
// store overlay. The YAML path is fine for the platform's seed data
// but the operator can't add a site without rebuilding the image.
// This wizard POSTs to /v1/sites which persists the new site to the
// runtime store; the registry rebuild after save makes the row
// appear immediately on /sites.
//
// Scope: identity tier only — site_id, display_name, site_type,
// city/country/region, optional DR pairing. The richer blocks
// (physical / connectivity / hosted_cis) live in YAML for now;
// they're the kind of fields a v2 wizard would walk the operator
// through one tab at a time. For the pilot, "list every datacenter
// we run" is the immediate need and identity fields cover it.

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type SiteType = 'primary_datacenter' | 'dr_datacenter' | 'cloud_region' | 'colocation' | 'branch_office'

type ExistingSite = {
  site_id: string
  display_name?: string
}

// SITE_TYPE_LABEL stores the canonical English label as both the
// i18n key AND the fallback literal. siteTypeOptions then routes it
// through t() so es/de/lt fall back to the English literal until a
// translator fills them in. Previously this map carried inline
// {en, fr} pairs which made French look translated but left every
// other language broken.
const SITE_TYPE_LABEL: Record<SiteType, string> = {
  primary_datacenter: 'Primary datacenter',
  dr_datacenter:      'DR datacenter',
  cloud_region:       'Cloud region',
  colocation:         'Colocation',
  branch_office:      'Branch office',
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// buildPhysicalPayload returns the nested object only when at least
// one field carries a real value. Sending an empty object would
// override an existing on-disk YAML physical block with zeros on
// edit; returning null skips the field server-side instead.
function buildPhysicalPayload(input: {
  tierCertification: string
  utilityFeeds: number
  upsRuntimeMinutes: number
  generators: number
  generatorFuelHours: number
  lastGeneratorTestDate: string
  generatorTestFrequency: string
  coolingRedundancy: string
  coolingMonitoring: boolean
  securityAccessControl: string
  securityCCTV: boolean
  securityGuard: boolean
}): Record<string, unknown> | null {
  const hasAnyValue =
    input.tierCertification.trim() !== '' ||
    input.utilityFeeds > 0 ||
    input.upsRuntimeMinutes > 0 ||
    input.generators > 0 ||
    input.generatorFuelHours > 0 ||
    input.lastGeneratorTestDate.trim() !== '' ||
    input.generatorTestFrequency.trim() !== '' ||
    input.coolingRedundancy.trim() !== '' ||
    input.coolingMonitoring ||
    input.securityAccessControl.trim() !== '' ||
    input.securityCCTV ||
    input.securityGuard
  if (!hasAnyValue) return null
  return {
    tier_certification: input.tierCertification.trim(),
    power: {
      utility_feeds: input.utilityFeeds,
      ups_runtime_minutes: input.upsRuntimeMinutes,
      generators: input.generators,
      generator_fuel_hours: input.generatorFuelHours,
      last_generator_test_date: input.lastGeneratorTestDate.trim(),
      generator_test_frequency: input.generatorTestFrequency.trim(),
    },
    cooling: {
      redundancy: input.coolingRedundancy.trim(),
      monitoring: input.coolingMonitoring,
    },
    physical_security: {
      access_control: input.securityAccessControl.trim(),
      cctv: input.securityCCTV,
      security_guard: input.securityGuard,
    },
  }
}

export function AttestivSiteWizard() {
  const { t } = useI18n()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Edit mode (?edit=<site_id>) loads the existing site and lets the
  // operator update any field. Save still POSTs to /v1/sites which is
  // an upsert on the backend — re-saving an existing site_id replaces
  // the runtime overlay in place.
  const editSiteId = searchParams?.get('edit') ?? ''
  const isEditMode = editSiteId !== ''

  const [siteId, setSiteId] = useState('')
  const [siteIdTouched, setSiteIdTouched] = useState(isEditMode)
  const [displayName, setDisplayName] = useState('')
  const [siteType, setSiteType] = useState<SiteType>('primary_datacenter')
  const [city, setCity] = useState('')
  const [country, setCountry] = useState('')
  const [region, setRegion] = useState('')
  const [drSite, setDrSite] = useState('')
  const [primarySite, setPrimarySite] = useState('')
  const [threshold, setThreshold] = useState<number>(50)

  // Physical resilience block — what the scoring engine reads for
  // DORA Art.12.7 (power redundancy, generator test cadence, UPS
  // runtime). Empty values mean "not asserted"; scoring treats that
  // as zero credit rather than failure.
  const [tierCertification, setTierCertification] = useState('')
  const [utilityFeeds, setUtilityFeeds] = useState<number>(0)
  const [upsRuntimeMinutes, setUpsRuntimeMinutes] = useState<number>(0)
  const [generators, setGenerators] = useState<number>(0)
  const [generatorFuelHours, setGeneratorFuelHours] = useState<number>(0)
  const [lastGeneratorTestDate, setLastGeneratorTestDate] = useState('')
  const [generatorTestFrequency, setGeneratorTestFrequency] = useState('')
  const [coolingRedundancy, setCoolingRedundancy] = useState('')
  const [coolingMonitoring, setCoolingMonitoring] = useState(false)
  const [securityAccessControl, setSecurityAccessControl] = useState('')
  const [securityCCTV, setSecurityCCTV] = useState(false)
  const [securityGuard, setSecurityGuard] = useState(false)

  const [existingSites, setExistingSites] = useState<ExistingSite[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editLoading, setEditLoading] = useState(isEditMode)

  // Auto-derive the site_id slug from the display name until the
  // operator types into the id field directly. Same pattern as the
  // connector wizard's name → instance_slug auto-fill.
  useEffect(() => {
    if (siteIdTouched) return
    setSiteId(slugify(displayName))
  }, [displayName, siteIdTouched])

  // Edit-mode prefill: load the existing site by id and pre-populate
  // every form field. The site_id field is treated as read-only by
  // the operator's eye but stays editable because the server upserts
  // by site_id — if someone needs to rename, that's a delete + create
  // workflow rather than an in-place rename.
  useEffect(() => {
    if (!isEditMode || !editSiteId) return
    let cancelled = false
    apiFetch(`/sites/${encodeURIComponent(editSiteId)}`)
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return
        // Detail responses sometimes nest the canonical site under a
        // "site" key alongside cascade decorations; fall back to the
        // body itself when that key is absent.
        const data = (body?.site ?? body) as any
        setSiteId(String(data.site_id ?? editSiteId))
        setDisplayName(String(data.display_name ?? ''))
        if (typeof data.site_type === 'string') setSiteType(data.site_type as SiteType)
        const loc = data.location ?? {}
        setCity(String(loc.city ?? ''))
        setCountry(String(loc.country ?? ''))
        setRegion(String(loc.region ?? ''))
        setDrSite(String(data.dr_site ?? ''))
        setPrimarySite(String(data.primary_site ?? ''))
        if (typeof data.concentration_risk_threshold_pct === 'number') {
          setThreshold(data.concentration_risk_threshold_pct)
        }
        const phys = data.physical ?? null
        if (phys) {
          setTierCertification(String(phys.tier_certification ?? ''))
          const power = phys.power ?? {}
          setUtilityFeeds(Number(power.utility_feeds) || 0)
          setUpsRuntimeMinutes(Number(power.ups_runtime_minutes) || 0)
          setGenerators(Number(power.generators) || 0)
          setGeneratorFuelHours(Number(power.generator_fuel_hours) || 0)
          setLastGeneratorTestDate(String(power.last_generator_test_date ?? ''))
          setGeneratorTestFrequency(String(power.generator_test_frequency ?? ''))
          const cooling = phys.cooling ?? {}
          setCoolingRedundancy(String(cooling.redundancy ?? ''))
          setCoolingMonitoring(Boolean(cooling.monitoring))
          const sec = phys.physical_security ?? {}
          setSecurityAccessControl(String(sec.access_control ?? ''))
          setSecurityCCTV(Boolean(sec.cctv))
          setSecurityGuard(Boolean(sec.security_guard))
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load site')
        }
      })
      .finally(() => {
        if (!cancelled) setEditLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isEditMode, editSiteId])

  // Populate the DR-site dropdown from the existing site list so
  // operators don't have to remember site_ids. Failure is non-fatal
  // — the field stays empty and the operator can still type a
  // site_id by hand.
  useEffect(() => {
    let cancelled = false
    apiFetch('/sites')
      .then((response) => response.json())
      .then((body) => {
        if (cancelled) return
        const items = Array.isArray(body?.items) ? body.items : []
        setExistingSites(items.map((s: any) => ({ site_id: String(s.site_id), display_name: s.display_name })))
      })
      .catch(() => {
        // Silent — DR pairing is optional.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const siteTypeOptions = useMemo(() => {
    const entries = Object.entries(SITE_TYPE_LABEL) as Array<[SiteType, string]>
    return entries.map(([value, label]) => ({ value, label: t(label, label) }))
  }, [t])

  const drSiteOptions = useMemo(() => {
    return existingSites
      .filter((s) => s.site_id !== siteId)
      .map((s) => ({ value: s.site_id, label: s.display_name ? `${s.display_name} (${s.site_id})` : s.site_id }))
  }, [existingSites, siteId])

  function isValid(): string | null {
    if (!siteId.trim()) return t('site_id is required', 'site_id is required')
    if (!displayName.trim()) return t('Display name is required', 'Display name is required')
    if (!siteType) return t('Site type is required', 'Site type is required')
    if (threshold < 0 || threshold > 100) return t('Concentration threshold must be 0–100', 'Concentration threshold must be 0–100')
    return null
  }

  async function save() {
    const validationError = isValid()
    if (validationError) {
      setError(validationError)
      return
    }
    setError(null)
    setSaving(true)
    try {
      const physical = buildPhysicalPayload({
        tierCertification,
        utilityFeeds,
        upsRuntimeMinutes,
        generators,
        generatorFuelHours,
        lastGeneratorTestDate,
        generatorTestFrequency,
        coolingRedundancy,
        coolingMonitoring,
        securityAccessControl,
        securityCCTV,
        securityGuard,
      })
      const body: Record<string, unknown> = {
        site_id: siteId.trim(),
        display_name: displayName.trim(),
        site_type: siteType,
        city: city.trim(),
        country: country.trim(),
        region: region.trim(),
        dr_site: drSite.trim(),
        primary_site: primarySite.trim(),
        concentration_risk_threshold_pct: threshold,
      }
      if (physical) body.physical = physical
      const response = await apiFetch('/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(responseBody?.detail || responseBody?.error || `${response.status} ${response.statusText}`)
      }
      router.push('/sites')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create site')
    } finally {
      setSaving(false)
    }
  }

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 500,
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  }
  const inputStyle: React.CSSProperties = {
    fontSize: 13,
    padding: '6px 10px',
    border: '1px solid var(--color-border-secondary)',
    borderRadius: 'var(--border-radius-md)',
    background: 'var(--color-background-primary)',
    color: 'var(--color-text-primary)',
    fontFamily: 'inherit',
    width: '100%',
  }

  return (
    <>
      <Topbar
        title={isEditMode ? t('Edit site', 'Edit site') : t('Add a site', 'Add a site')}
        left={<Badge tone="navy">{t('admin only', 'admin only')}</Badge>}
        right={
          <GhostButton onClick={() => router.push('/sites')}>
            <i className="ti ti-arrow-left" aria-hidden="true" />
            {t('Back to sites', 'Back to sites')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Card>
          <CardTitle>{t('Identity', 'Identity')}</CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Display name', 'Display name')}</label>
              <input
                style={inputStyle}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('Datacenter Paris 1', 'Datacenter Paris 1')}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Site ID (slug)', 'Site ID (slug)')}</label>
              <input
                style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                value={siteId}
                onChange={(e) => {
                  setSiteIdTouched(true)
                  setSiteId(e.target.value)
                }}
                placeholder="dc-paris-1"
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Site type', 'Site type')}</label>
              <select
                style={inputStyle}
                value={siteType}
                onChange={(e) => setSiteType(e.target.value as SiteType)}
              >
                {siteTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Concentration threshold (%)', 'Concentration threshold (%)')}</label>
              <input
                type="number"
                min={0}
                max={100}
                step={5}
                style={inputStyle}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value) || 0)}
              />
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>{t('Location', 'Location')}</CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('City', 'City')}</label>
              <input style={inputStyle} value={city} onChange={(e) => setCity(e.target.value)} placeholder="Paris" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Country (2-letter)', 'Country (2-letter)')}</label>
              <input style={inputStyle} value={country} onChange={(e) => setCountry(e.target.value.toUpperCase())} placeholder="FR" maxLength={2} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Region', 'Region')}</label>
              <input style={inputStyle} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Île-de-France" />
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>{t('DR pairing (optional)', 'DR pairing (optional)')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
            {t(
              'Link this site to its DR partner so cascade analysis and recovery-order calculation know which site to fall back to.',
              'Link this site to its DR partner so cascade analysis and recovery-order calculation know which site to fall back to.',
            )}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('DR site', 'DR site')}</label>
              <select style={inputStyle} value={drSite} onChange={(e) => setDrSite(e.target.value)}>
                <option value="">{t('— none —', '— none —')}</option>
                {drSiteOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {t('Set on a primary site to point at its DR partner.', 'Set on a primary site to point at its DR partner.')}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Primary site', 'Primary site')}</label>
              <select style={inputStyle} value={primarySite} onChange={(e) => setPrimarySite(e.target.value)}>
                <option value="">{t('— none —', '— none —')}</option>
                {drSiteOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                {t('Set on a DR site to point back at the primary it covers.', 'Set on a DR site to point back at the primary it covers.')}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>{t('Physical resilience (optional)', 'Physical resilience (optional)')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
            {t(
              'These fields drive the DORA Art.12.7 power-resilience score. Leave blank if you don\'t want to assert anything yet — scoring treats empty values as "not asserted," not "failed."',
              'These fields drive the DORA Art.12.7 power-resilience score. Leave blank if you don\'t want to assert anything yet — scoring treats empty values as "not asserted," not "failed."',
            )}
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            <label style={labelStyle}>{t('Tier certification', 'Tier certification')}</label>
            <input
              style={inputStyle}
              value={tierCertification}
              onChange={(e) => setTierCertification(e.target.value)}
              placeholder="Tier III, Tier IV, uptime-institute-certified, …"
            />
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            {t('Power', 'Power')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Utility feeds', 'Utility feeds')}</label>
              <input type="number" min={0} style={inputStyle} value={utilityFeeds} onChange={(e) => setUtilityFeeds(Number(e.target.value) || 0)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('UPS runtime (min)', 'UPS runtime (min)')}</label>
              <input type="number" min={0} style={inputStyle} value={upsRuntimeMinutes} onChange={(e) => setUpsRuntimeMinutes(Number(e.target.value) || 0)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Generators', 'Generators')}</label>
              <input type="number" min={0} style={inputStyle} value={generators} onChange={(e) => setGenerators(Number(e.target.value) || 0)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Fuel runtime (h)', 'Fuel runtime (h)')}</label>
              <input type="number" min={0} style={inputStyle} value={generatorFuelHours} onChange={(e) => setGeneratorFuelHours(Number(e.target.value) || 0)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Last generator test', 'Last generator test')}</label>
              <input type="date" style={inputStyle} value={lastGeneratorTestDate} onChange={(e) => setLastGeneratorTestDate(e.target.value)} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, gridColumn: 'span 3' }}>
              <label style={labelStyle}>{t('Generator test frequency', 'Generator test frequency')}</label>
              <input style={inputStyle} value={generatorTestFrequency} onChange={(e) => setGeneratorTestFrequency(e.target.value)} placeholder="monthly, quarterly, annual, …" />
            </div>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            {t('Cooling', 'Cooling')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Redundancy', 'Redundancy')}</label>
              <input style={inputStyle} value={coolingRedundancy} onChange={(e) => setCoolingRedundancy(e.target.value)} placeholder="N, N+1, 2N, …" />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingTop: 18 }}>
              <input type="checkbox" checked={coolingMonitoring} onChange={(e) => setCoolingMonitoring(e.target.checked)} />
              {t('Monitoring enabled', 'Monitoring enabled')}
            </label>
          </div>

          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            {t('Physical security', 'Physical security')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={labelStyle}>{t('Access control', 'Access control')}</label>
              <input style={inputStyle} value={securityAccessControl} onChange={(e) => setSecurityAccessControl(e.target.value)} placeholder="badge, mantrap, biometric, …" />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingTop: 18 }}>
              <input type="checkbox" checked={securityCCTV} onChange={(e) => setSecurityCCTV(e.target.checked)} />
              {t('CCTV', 'CCTV')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, paddingTop: 18 }}>
              <input type="checkbox" checked={securityGuard} onChange={(e) => setSecurityGuard(e.target.checked)} />
              {t('24/7 guard', '24/7 guard')}
            </label>
          </div>
        </Card>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <GhostButton onClick={() => router.push('/sites')} disabled={saving}>
            {t('Cancel', 'Cancel')}
          </GhostButton>
          <PrimaryButton onClick={save} disabled={saving || editLoading}>
            {saving ? (
              <>
                <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                {t('Saving…', 'Saving…')}
              </>
            ) : (
              <>
                <i className="ti ti-device-floppy" aria-hidden="true" />
                {isEditMode ? t('Save changes', 'Save changes') : t('Create site', 'Create site')}
              </>
            )}
          </PrimaryButton>
        </div>

        <Card>
          <CardTitle>{t('What about hosted CIs and WAN links?', 'What about hosted CIs and WAN links?')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0 }}>
            {t(
              'This wizard covers the identity tier (id, name, type, location, DR pairing). Hosted CIs, WAN links, physical power/cooling, and DORA Art.28 third-party metadata are richer blocks — they belong in YAML for now, under policies/sites/<site_id>.yaml. The runtime registry overlays whatever you save here on top of those YAML definitions, so it\'s safe to start with identity and add the deeper config later.',
              'This wizard covers the identity tier (id, name, type, location, DR pairing). Hosted CIs, WAN links, physical power/cooling, and DORA Art.28 third-party metadata are richer blocks — they belong in YAML for now, under policies/sites/<site_id>.yaml. The runtime registry overlays whatever you save here on top of those YAML definitions, so it\'s safe to start with identity and add the deeper config later.',
            )}
          </p>
        </Card>
      </div>
    </>
  )
}
