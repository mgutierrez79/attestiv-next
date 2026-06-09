'use client'
// Bulk-import Cisco RESTCONF from inventory.
//
// Operator wants to enable per-switch MAC-table pulls across the
// fleet DNA Center already discovered. Hand-configuring one wizard
// pass per switch is painful (17+ rows on the pilot). This view
// drives the /v1/admin/connectors/cisco-restconf/bulk-from-inventory
// endpoint: dry-run first to preview the device list, then commit
// with credentials.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  FormField,
  GhostButton,
  PrimaryButton,
  Skeleton,
  TextInput,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n } from '../lib/i18n'

type Device = {
  name: string
  base_url: string
}

type BulkResult = {
  connector_id: string
  slug: string
  dry_run: boolean
  source: string
  total: number
  devices: Device[]
  skipped_no_management_ip?: string[]
}

type Source = 'inventory' | 'snapshot'

type DNACProbe = {
  source?: string
  base_url?: string
  auth_ok?: boolean
  auth_mode?: string
  status_code?: number
  host_count?: number
  sample_macs?: string[]
  error?: string
  hint?: string
}

export function AttestivConnectorBulkRestconfPage() {
  const { t } = useI18n()
  const router = useRouter()
  const [slug, setSlug] = useState('fleet')
  const [displayName, setDisplayName] = useState('Cisco RESTCONF fleet')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [verifyTLS, setVerifyTLS] = useState(false)
  const [excludeIds, setExcludeIds] = useState('')
  // Source: "snapshot" reads the freshest DNAC/Panorama poll directly
  // (no inventory-import lag) — default. "inventory" hits the deduped
  // persisted store — better when you have multiple connectors
  // discovering the same switches.
  const [source, setSource] = useState<Source>('snapshot')
  const [dnacProbe, setDnacProbe] = useState<DNACProbe | null>(null)
  const [dnacProbing, setDnacProbing] = useState(false)
  const [dnacProbeError, setDnacProbeError] = useState<string | null>(null)
  const [preview, setPreview] = useState<BulkResult | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<BulkResult | null>(null)

  // Auto dry-run on mount AND whenever the source flips so the
  // operator sees the right candidate list without clicking refresh.
  // No-secret call, harmless to re-issue.
  useEffect(() => {
    void runDryRun()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source])

  async function runDryRun() {
    setPreviewLoading(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { dry_run: true, slug, source }
      const excluded = excludeIds
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (excluded.length > 0) body.exclude_asset_ids = excluded
      const resp = await apiFetch('/admin/connectors/cisco-restconf/bulk-from-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      const data: BulkResult = await resp.json()
      setPreview(data)
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.bodyText || err.message)
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Failed to preview device list')
      }
    } finally {
      setPreviewLoading(false)
    }
  }

  async function probeDNAC() {
    setDnacProbing(true)
    setDnacProbeError(null)
    setDnacProbe(null)
    try {
      const resp = await apiFetch('/admin/connectors/cisco-dna/host-probe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!resp.ok) {
        let detail = `${resp.status} ${resp.statusText}`
        try {
          const data = await resp.json()
          if (data?.detail) detail = data.detail
        } catch {
          /* ignore */
        }
        throw new Error(detail)
      }
      const data: DNACProbe = await resp.json()
      setDnacProbe(data)
    } catch (err) {
      if (err instanceof Error) setDnacProbeError(err.message)
      else setDnacProbeError('DNAC probe failed')
    } finally {
      setDnacProbing(false)
    }
  }

  async function commit() {
    setSaving(true)
    setError(null)
    try {
      const body: Record<string, unknown> = {
        slug,
        source,
        name: displayName,
        username,
        password,
        verify_tls: verifyTLS,
      }
      const excluded = excludeIds
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      if (excluded.length > 0) body.exclude_asset_ids = excluded
      const resp = await apiFetch('/admin/connectors/cisco-restconf/bulk-from-inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        let detail = `${resp.status} ${resp.statusText}`
        try {
          const data = await resp.json()
          if (data?.detail) detail = data.detail
        } catch {
          /* ignore */
        }
        throw new Error(detail)
      }
      const data: BulkResult = await resp.json()
      setSaved(data)
    } catch (err) {
      if (err instanceof Error) setError(err.message)
      else setError('Bulk import failed')
    } finally {
      setSaving(false)
    }
  }

  const canCommit =
    !!preview && preview.total > 0 && username.trim().length > 0 && password.length > 0 && !saving

  return (
    <>
      <Topbar
        title={t('Bulk-import Cisco RESTCONF', 'Bulk-import Cisco RESTCONF')}
        left={
          <GhostButton onClick={() => router.push('/connectors/new')}>
            <i className="ti ti-arrow-left" aria-hidden="true" />{' '}
            {t('Back to wizard', 'Back to wizard')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        <Card>
          <CardTitle>{t('What this does', 'What this does')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
            {t(
              "Scans every network_device asset already in inventory (the switches DNA Center / Panorama discovered) and creates a single cisco_restconf connector whose devices array references each one. The credentials you enter here apply to every device; you can override individual entries later by editing the connector row. After the next poll, each switch's MAC table feeds VM↔switch edges on the per-application topology view.",
              "Scans every network_device asset already in inventory (the switches DNA Center / Panorama discovered) and creates a single cisco_restconf connector whose devices array references each one. The credentials you enter here apply to every device; you can override individual entries later by editing the connector row. After the next poll, each switch's MAC table feeds VM↔switch edges on the per-application topology view.",
            )}
          </p>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <GhostButton onClick={() => void probeDNAC()} disabled={dnacProbing}>
                <i
                  className={dnacProbing ? 'ti ti-loader' : 'ti ti-stethoscope'}
                  aria-hidden="true"
                />{' '}
                {dnacProbing
                  ? t('Probing…', 'Probing…')
                  : t('Probe DNA Center', 'Probe DNA Center')}
              </GhostButton>
            }
          >
            {t('Diagnose DNA Center first', 'Diagnose DNA Center first')}
          </CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
            {t(
              'Before adding RESTCONF rows per switch, check whether DNAC already has the host-to-port mapping you need. If DNAC reports hosts, you do not need RESTCONF at all — refresh the cisco_dna_center connector and the topology will populate from that single source.',
              'Before adding RESTCONF rows per switch, check whether DNAC already has the host-to-port mapping you need. If DNAC reports hosts, you do not need RESTCONF at all — refresh the cisco_dna_center connector and the topology will populate from that single source.',
            )}
          </p>
          {dnacProbeError ? (
            <div style={{ marginTop: 10 }}>
              <Banner tone="error">{dnacProbeError}</Banner>
            </div>
          ) : null}
          {dnacProbe ? (
            <div style={{ marginTop: 10 }}>
              <Banner
                tone={
                  !dnacProbe.auth_ok
                    ? 'error'
                    : (dnacProbe.host_count ?? 0) > 0
                      ? 'success'
                      : 'warning'
                }
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Badge tone={dnacProbe.auth_ok ? 'green' : 'red'}>
                      {dnacProbe.auth_ok
                        ? t('Auth OK', 'Auth OK')
                        : t('Auth failed', 'Auth failed')}
                    </Badge>
                    <Badge tone={(dnacProbe.host_count ?? 0) > 0 ? 'green' : 'amber'}>
                      {t('{n} hosts', '{n} hosts', { n: dnacProbe.host_count ?? 0 })}
                    </Badge>
                    {dnacProbe.source ? (
                      <code style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {dnacProbe.source}
                      </code>
                    ) : null}
                  </div>
                  {dnacProbe.error ? (
                    <div style={{ fontSize: 12 }}>{dnacProbe.error}</div>
                  ) : null}
                  {dnacProbe.hint ? (
                    <div style={{ fontSize: 12 }}>{dnacProbe.hint}</div>
                  ) : null}
                  {dnacProbe.sample_macs && dnacProbe.sample_macs.length > 0 ? (
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                      {t('Sample MACs:', 'Sample MACs:')}{' '}
                      <code>{dnacProbe.sample_macs.join(', ')}</code>
                    </div>
                  ) : null}
                </div>
              </Banner>
            </div>
          ) : null}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div
                  role="tablist"
                  style={{
                    display: 'inline-flex',
                    border: '0.5px solid var(--color-border-tertiary)',
                    borderRadius: 'var(--border-radius-md)',
                    overflow: 'hidden',
                  }}
                >
                  {(
                    [
                      { key: 'snapshot', label: t('Live connector', 'Live connector') },
                      { key: 'inventory', label: t('Inventory store', 'Inventory store') },
                    ] as Array<{ key: Source; label: string }>
                  ).map((opt) => {
                    const active = source === opt.key
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setSource(opt.key)}
                        style={{
                          fontSize: 11,
                          padding: '4px 10px',
                          background: active
                            ? 'var(--color-status-blue-bg)'
                            : 'var(--color-background-primary)',
                          color: active
                            ? 'var(--color-status-blue-deep)'
                            : 'var(--color-text-secondary)',
                          border: 'none',
                          cursor: 'pointer',
                          fontFamily: 'inherit',
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <GhostButton onClick={() => void runDryRun()} disabled={previewLoading}>
                  <i
                    className={previewLoading ? 'ti ti-loader' : 'ti ti-refresh'}
                    aria-hidden="true"
                  />{' '}
                  {t('Refresh', 'Refresh')}
                </GhostButton>
              </div>
            }
          >
            {t('Device list', 'Device list')}
          </CardTitle>
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-tertiary)',
              marginBottom: 10,
              lineHeight: 1.5,
            }}
          >
            {source === 'snapshot'
              ? t(
                  'Reading the latest connector poll (DNAC / Panorama / RESTCONF) directly — no inventory-import lag.',
                  'Reading the latest connector poll (DNAC / Panorama / RESTCONF) directly — no inventory-import lag.',
                )
              : t(
                  'Reading the inventory store — deduped across every source but lags one import job behind the connector poll.',
                  'Reading the inventory store — deduped across every source but lags one import job behind the connector poll.',
                )}
          </div>
          {previewLoading ? (
            <Skeleton lines={4} height={28} />
          ) : !preview ? (
            <EmptyState
              icon="ti-circle-dashed"
              title={t('Preview not loaded', 'Preview not loaded')}
              description={t(
                'Click Refresh preview to fetch the candidate device list.',
                'Click Refresh preview to fetch the candidate device list.',
              )}
            />
          ) : preview.total === 0 ? (
            <EmptyState
              icon="ti-info-circle"
              title={t('No candidates found', 'No candidates found')}
              description={t(
                'No network_device inventory rows currently carry a management IP. Refresh the DNA Center / RESTCONF poll first, then come back. If the issue persists, the discovered devices may be missing managementIpAddress in their metadata.',
                'No network_device inventory rows currently carry a management IP. Refresh the DNA Center / RESTCONF poll first, then come back. If the issue persists, the discovered devices may be missing managementIpAddress in their metadata.',
              )}
            />
          ) : (
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
                <Badge tone="navy">{preview.total}</Badge>{' '}
                {t('devices will be added to', 'devices will be added to')}{' '}
                <code>{preview.connector_id}</code>
              </div>
              <div
                style={{
                  border: '0.5px solid var(--color-border-tertiary)',
                  borderRadius: 'var(--border-radius-md)',
                  maxHeight: 320,
                  overflowY: 'auto',
                }}
              >
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={headerRowStyle}>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                        {t('Name', 'Name')}
                      </th>
                      <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                        {t('Base URL', 'Base URL')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.devices.map((d, i) => (
                      <tr
                        key={`${d.base_url}-${i}`}
                        style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}
                      >
                        <td style={{ padding: '6px 10px' }}>
                          <code style={{ fontSize: 11 }}>{d.name}</code>
                        </td>
                        <td style={{ padding: '6px 10px' }}>
                          <code style={{ fontSize: 11 }}>{d.base_url}</code>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.skipped_no_management_ip &&
              preview.skipped_no_management_ip.length > 0 ? (
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-tertiary)',
                    marginTop: 8,
                  }}
                >
                  {t('Skipped (no management IP):', 'Skipped (no management IP):')}{' '}
                  {preview.skipped_no_management_ip.length}{' '}
                  {t('rows', 'rows')}
                </div>
              ) : null}
            </div>
          )}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Fleet credentials', 'Fleet credentials')}</CardTitle>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            <FormField label={t('Connector display name', 'Connector display name')}>
              <TextInput
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Cisco RESTCONF fleet"
              />
            </FormField>
            <FormField label={t('Slug (row suffix)', 'Slug (row suffix)')}>
              <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="fleet" />
            </FormField>
            <FormField label={t('Username', 'Username')}>
              <TextInput
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="attestiv"
                autoComplete="off"
              />
            </FormField>
            <FormField label={t('Password', 'Password')}>
              <TextInput
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
            </FormField>
            <FormField label={t('Exclude asset IDs', 'Exclude asset IDs')}>
              <TextInput
                value={excludeIds}
                onChange={(e) => setExcludeIds(e.target.value)}
                placeholder="comma or whitespace separated"
              />
            </FormField>
            <FormField label={t('Verify TLS', 'Verify TLS')}>
              <label
                style={{
                  display: 'inline-flex',
                  gap: 6,
                  alignItems: 'center',
                  fontSize: 12,
                  padding: '6px 0',
                }}
              >
                <input
                  type="checkbox"
                  checked={verifyTLS}
                  onChange={(e) => setVerifyTLS(e.target.checked)}
                />
                {verifyTLS
                  ? t('Strict — reject self-signed', 'Strict — reject self-signed')
                  : t('Skip (lab / self-signed)', 'Skip (lab / self-signed)')}
              </label>
            </FormField>
          </div>
          {error ? (
            <div style={{ marginTop: 10 }}>
              <Banner tone="error">{error}</Banner>
            </div>
          ) : null}
          {saved ? (
            <div style={{ marginTop: 10 }}>
              <Banner tone="success">
                {t(
                  'Connector saved with {n} devices. Next poll will produce VM↔switch edges.',
                  'Connector saved with {n} devices. Next poll will produce VM↔switch edges.',
                  { n: saved.total },
                )}
              </Banner>
            </div>
          ) : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
            <GhostButton onClick={() => router.push('/connectors')}>
              {t('Cancel', 'Cancel')}
            </GhostButton>
            <PrimaryButton onClick={() => void commit()} disabled={!canCommit}>
              <i className={saving ? 'ti ti-loader' : 'ti ti-rocket'} aria-hidden="true" />{' '}
              {saving
                ? t('Saving…', 'Saving…')
                : t(
                    'Save connector for {n} devices',
                    'Save connector for {n} devices',
                    { n: preview?.total ?? 0 },
                  )}
            </PrimaryButton>
          </div>
        </Card>
      </div>
    </>
  )
}

const headerRowStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
  background: 'var(--color-background-secondary)',
}
