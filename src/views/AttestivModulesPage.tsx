'use client'
// Settings ▸ Integrations — the other Attestiv modules.
//
// The CVE-scan console and Cartographer run as their own stacks next to
// the platform and integrate through documented API contracts. This
// page is the one place that says, per module: how it integrates, where
// it lives, whether the integration is live, and which platform-issued
// certificates it holds — with issue actions pre-filled for the module.
//
// Backend API:
//   GET /v1/settings/modules               -> { modules: ModuleView[] }
//   PUT /v1/settings/modules/{id}          body: { url }
//   POST /v1/settings/mtls/server-certs    body: { label, sans, validity_days, module }
//   POST /v1/settings/mtls/client-certs    body: { label, module }

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

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

type CertRecord = {
  fingerprint_sha256: string
  label: string
  common_name: string
  sans?: string[]
  expires_at: string
  module?: string
}

type ModuleView = {
  id: string
  name: string
  summary: string
  direction: 'module_to_platform' | 'platform_to_module'
  mechanism: string
  endpoints: string[]
  default_cert_label: string
  url: string
  url_updated_at?: string
  url_updated_by?: string
  status: 'connected' | 'configured' | 'not_configured'
  webhook?: { enabled: boolean; endpoint: string; last_received_at: string }
  last_client_cert_seen_at?: string
  server_certs: CertRecord[]
  client_certs: CertRecord[]
}

type IssueForm = {
  module: string
  kind: 'server' | 'client'
  label: string
  sans: string
  validity: string
}

type IssuedCert = {
  module: string
  kind: 'server' | 'client'
  label: string
  fingerprint_sha256: string
  certificate_pem: string
  private_key_pem: string
  ca_certificate_pem?: string
}

const VALIDITY_OPTIONS: { value: string; days: number }[] = [
  { value: '90', days: 90 },
  { value: '365', days: 365 },
  { value: '730', days: 730 },
  { value: '1095', days: 1095 },
]

function extractMessage(body: unknown, response: Response): string {
  const b = body as { detail?: string; error?: string } | null
  return b?.detail || b?.error || `${response.status} ${response.statusText}`
}

// The host part of a module URL, ready to be a SAN: hostname or IP,
// IPv6 brackets stripped. Empty when the URL is missing or unparsable.
function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '')
  } catch {
    return ''
  }
}

function parseSans(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function AttestivModulesPage() {
  const { t } = useI18n()
  const router = useRouter()
  const [modules, setModules] = useState<ModuleView[] | null>(null)
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({})
  const [issueForm, setIssueForm] = useState<IssueForm | null>(null)
  const [issued, setIssued] = useState<IssuedCert | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const response = await apiFetch('/settings/modules')
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(extractMessage(body, response))
      }
      const body = await response.json()
      const list: ModuleView[] = Array.isArray(body?.modules) ? body.modules : []
      setModules(list)
      setUrlDrafts(Object.fromEntries(list.map((m) => [m.id, m.url || ''])))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load Attestiv modules')
      setModules([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function saveUrl(id: string) {
    const url = (urlDrafts[id] ?? '').trim()
    if (url && !/^https?:\/\/\S+$/i.test(url)) {
      setError(t('Module URL must be an absolute http(s) URL.', 'Module URL must be an absolute http(s) URL.'))
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch(`/settings/modules/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(extractMessage(body, response))
      setInfo(url ? t('Module URL saved.', 'Module URL saved.') : t('Module URL cleared.', 'Module URL cleared.'))
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save module URL')
    } finally {
      setBusy(false)
    }
  }

  function openIssue(m: ModuleView, kind: 'server' | 'client') {
    setIssued(null)
    setError(null)
    setInfo(null)
    setIssueForm({
      module: m.id,
      kind,
      label: kind === 'server' ? m.default_cert_label : `${m.id}-api-client`,
      sans: hostFromUrl(m.url),
      validity: '365',
    })
  }

  async function issue() {
    if (!issueForm) return
    const form = issueForm
    const sans = parseSans(form.sans)
    if (form.kind === 'server' && (!form.label.trim() || sans.length === 0)) {
      setError(t('A label and at least one DNS name or IP address are required to issue a server certificate.', 'A label and at least one DNS name or IP address are required to issue a server certificate.'))
      return
    }
    if (form.kind === 'client' && !form.label.trim()) {
      setError(t('A label is required to issue a client certificate.', 'A label is required to issue a client certificate.'))
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const path = form.kind === 'server' ? '/settings/mtls/server-certs' : '/settings/mtls/client-certs'
      const payload =
        form.kind === 'server'
          ? { label: form.label.trim(), sans, validity_days: Number(form.validity), module: form.module }
          : { label: form.label.trim(), module: form.module }
      const response = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(extractMessage(body, response))
      setIssued({ module: form.module, kind: form.kind, ...(body as Omit<IssuedCert, 'module' | 'kind'>) })
      setIssueForm(null)
      setInfo(
        form.kind === 'server'
          ? t('Server certificate issued. Download the key now — it is shown only once.', 'Server certificate issued. Download the key now — it is shown only once.')
          : t('Client certificate issued. Download the key now — it is shown only once.', 'Client certificate issued. Download the key now — it is shown only once.'),
      )
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to issue certificate')
    } finally {
      setBusy(false)
    }
  }

  function downloadText(filename: string, content: string) {
    if (typeof window === 'undefined') return
    const blob = new Blob([content], { type: 'application/x-pem-file' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  function statusBadge(status: ModuleView['status']) {
    switch (status) {
      case 'connected':
        return <Badge tone="green">{t('Connected', 'Connected')}</Badge>
      case 'configured':
        return <Badge tone="navy">{t('Configured', 'Configured')}</Badge>
      default:
        return <Badge tone="gray">{t('Not configured', 'Not configured')}</Badge>
    }
  }

  function directionLabel(direction: ModuleView['direction']) {
    return direction === 'module_to_platform'
      ? t('Module pushes to the platform', 'Module pushes to the platform')
      : t('Module reads from the platform', 'Module reads from the platform')
  }

  function formatDate(value?: string) {
    return value ? value.replace('T', ' ').slice(0, 16) + ' UTC' : t('never', 'never')
  }

  function certList(certs: CertRecord[]) {
    if (certs.length === 0) {
      return <p style={{ margin: '4px 0 8px', color: 'var(--color-text-tertiary)', fontSize: 13 }}>{t('None issued for this module.', 'None issued for this module.')}</p>
    }
    return (
      <ul style={{ margin: '4px 0 8px', paddingLeft: 18, fontSize: 13 }}>
        {certs.map((c) => (
          <li key={c.fingerprint_sha256} style={{ marginBottom: 2 }}>
            <strong>{c.label}</strong>
            {c.sans && c.sans.length ? <span style={{ fontFamily: 'monospace', marginLeft: 8 }}>{c.sans.join(', ')}</span> : null}
            <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 8 }}>
              {t('Expires', 'Expires')} {c.expires_at.slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  function renderIssueForm(m: ModuleView) {
    if (!issueForm || issueForm.module !== m.id) return null
    const isServer = issueForm.kind === 'server'
    return (
      <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 12, marginTop: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label style={{ flex: '1 1 200px' }}>
            <div className="attestiv-label">
              {isServer ? t('Label (module / service name)', 'Label (module / service name)') : t('Label (vendor / service name)', 'Label (vendor / service name)')}
            </div>
            <input
              type="text"
              value={issueForm.label}
              onChange={(e) => setIssueForm({ ...issueForm, label: e.target.value })}
              className="attestiv-input"
            />
          </label>
          {isServer ? (
            <>
              <label style={{ flex: '2 1 280px' }}>
                <div className="attestiv-label">{t('DNS names and IP addresses (SANs, comma-separated)', 'DNS names and IP addresses (SANs, comma-separated)')}</div>
                <input
                  type="text"
                  value={issueForm.sans}
                  onChange={(e) => setIssueForm({ ...issueForm, sans: e.target.value })}
                  placeholder={t('e.g. carto.pilot.local, 10.100.21.206', 'e.g. carto.pilot.local, 10.100.21.206')}
                  className="attestiv-input"
                />
              </label>
              <label style={{ flex: '0 1 130px' }}>
                <div className="attestiv-label">{t('Validity', 'Validity')}</div>
                <select value={issueForm.validity} onChange={(e) => setIssueForm({ ...issueForm, validity: e.target.value })} className="attestiv-input">
                  {VALIDITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.days === 90 ? t('90 days', '90 days') : o.days === 365 ? t('1 year', '1 year') : o.days === 730 ? t('2 years', '2 years') : t('3 years', '3 years')}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <PrimaryButton onClick={() => void issue()} disabled={busy}>
            <i className="ti ti-certificate" aria-hidden="true" />{' '}
            {isServer ? t('Issue server certificate', 'Issue server certificate') : t('Issue client certificate', 'Issue client certificate')}
          </PrimaryButton>
          <GhostButton onClick={() => setIssueForm(null)} disabled={busy}>
            {t('Cancel', 'Cancel')}
          </GhostButton>
        </div>
      </div>
    )
  }

  function renderIssued(m: ModuleView) {
    if (!issued || issued.module !== m.id) return null
    const base = issued.label || m.id
    return (
      <div style={{ border: '2px solid var(--color-accent, #2563eb)', borderRadius: 8, padding: 16, marginTop: 12, background: 'rgba(37,99,235,0.04)' }}>
        <Banner tone="warning">
          {t('Save these now — the private key is shown only once and cannot be retrieved again.', 'Save these now — the private key is shown only once and cannot be retrieved again.')}
        </Banner>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
          <GhostButton onClick={() => downloadText(`${base}.crt`, issued.certificate_pem)}>
            <i className="ti ti-download" aria-hidden="true" /> {t('Download certificate', 'Download certificate')}
          </GhostButton>
          <GhostButton onClick={() => downloadText(`${base}.key`, issued.private_key_pem)}>
            <i className="ti ti-download" aria-hidden="true" /> {t('Download private key', 'Download private key')}
          </GhostButton>
          {issued.ca_certificate_pem ? (
            <>
              <GhostButton onClick={() => downloadText('attestiv-ca.crt', issued.ca_certificate_pem!)}>
                <i className="ti ti-download" aria-hidden="true" /> {t('Download CA certificate', 'Download CA certificate')}
              </GhostButton>
              <GhostButton
                onClick={() => downloadText(`${base}-fullchain.pem`, `${issued.certificate_pem.trimEnd()}\n${issued.ca_certificate_pem!.trimEnd()}\n`)}
              >
                <i className="ti ti-download" aria-hidden="true" /> {t('Download full chain', 'Download full chain')}
              </GhostButton>
            </>
          ) : null}
          <GhostButton onClick={() => setIssued(null)}>
            <i className="ti ti-x" aria-hidden="true" /> {t('Done', 'Done')}
          </GhostButton>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
          {issued.kind === 'server'
            ? t(
                'Install the certificate and private key on the module — Cartographer: Settings → Web certificate (upload the CA certificate as the issuing CA bundle); CVE-scan: replace the gateway cert.pem and key.pem. Clients must trust the CA certificate.',
                'Install the certificate and private key on the module — Cartographer: Settings → Web certificate (upload the CA certificate as the issuing CA bundle); CVE-scan: replace the gateway cert.pem and key.pem. Clients must trust the CA certificate.',
              )
            : t(
                'Import the client certificate and private key in the module where it configures its connection to this platform (Cartographer: Settings → Integration → Use mTLS client authentication).',
                'Import the client certificate and private key in the module where it configures its connection to this platform (Cartographer: Settings → Integration → Use mTLS client authentication).',
              )}
        </p>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>
          {t('Fingerprint', 'Fingerprint')}: {issued.fingerprint_sha256}
        </div>
      </div>
    )
  }

  return (
    <>
      <Topbar
        title={t('Attestiv modules', 'Attestiv modules')}
        left={<Badge tone="navy">{t('admin only', 'admin only')}</Badge>}
        right={
          <GhostButton onClick={() => router.push('/settings/trust-store')}>
            <i className="ti ti-certificate" aria-hidden="true" /> {t('Trust store', 'Trust store')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {info ? <Banner tone="success">{info}</Banner> : null}

        <p style={{ marginBottom: 16 }}>
          {t(
            'Other Attestiv modules deployed next to this platform. Each one integrates through a documented API contract; this page shows how, where the module lives, whether the integration is live, and which platform-issued certificates it holds.',
            'Other Attestiv modules deployed next to this platform. Each one integrates through a documented API contract; this page shows how, where the module lives, whether the integration is live, and which platform-issued certificates it holds.',
          )}
        </p>

        {modules === null ? (
          <p>{t('Loading…', 'Loading…')}</p>
        ) : (
          modules.map((m) => (
            <Card key={m.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <CardTitle>{m.name}</CardTitle>
                {statusBadge(m.status)}
                {m.url ? (
                  <a href={m.url} target="_blank" rel="noreferrer noopener" className="attestiv-ghost-button" style={{ marginLeft: 'auto' }}>
                    <i className="ti ti-external-link" aria-hidden="true" /> {t('Open module', 'Open module')}
                  </a>
                ) : null}
              </div>
              <p style={{ margin: '8px 0 12px' }}>{m.summary}</p>

              <table style={{ borderCollapse: 'collapse', fontSize: 13, marginBottom: 12 }}>
                <tbody>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 16px 4px 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{t('Data flow', 'Data flow')}</th>
                    <td style={{ padding: '4px 0' }}>{directionLabel(m.direction)}</td>
                  </tr>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 16px 4px 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{t('Mechanism', 'Mechanism')}</th>
                    <td style={{ padding: '4px 0' }}>{m.mechanism}</td>
                  </tr>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '4px 16px 4px 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{t('Endpoints', 'Endpoints')}</th>
                    <td style={{ padding: '4px 0', fontFamily: 'monospace', fontSize: 12 }}>{m.endpoints.join(' · ')}</td>
                  </tr>
                  {m.webhook ? (
                    <tr>
                      <th style={{ textAlign: 'left', padding: '4px 16px 4px 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{t('Webhook', 'Webhook')}</th>
                      <td style={{ padding: '4px 0' }}>
                        <Badge tone={m.webhook.enabled ? 'green' : 'amber'}>{m.webhook.enabled ? t('enabled', 'enabled') : t('disabled', 'disabled')}</Badge>{' '}
                        <span style={{ color: 'var(--color-text-secondary)' }}>
                          {m.webhook.enabled
                            ? t('Webhook secret is set on the platform (COMPLIANCE_CVE_WEBHOOK_SECRET).', 'Webhook secret is set on the platform (COMPLIANCE_CVE_WEBHOOK_SECRET).')
                            : t('Webhook disabled: set COMPLIANCE_CVE_WEBHOOK_SECRET on the platform and restart the API.', 'Webhook disabled: set COMPLIANCE_CVE_WEBHOOK_SECRET on the platform and restart the API.')}
                        </span>
                        <div style={{ color: 'var(--color-text-tertiary)', fontSize: 12 }}>
                          {t('Last scan received', 'Last scan received')}: {formatDate(m.webhook.last_received_at)}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                  {m.id === 'cartographer' ? (
                    <tr>
                      <th style={{ textAlign: 'left', padding: '4px 16px 4px 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{t('Last mTLS client seen (any caller)', 'Last mTLS client seen (any caller)')}</th>
                      <td style={{ padding: '4px 0' }}>{formatDate(m.last_client_cert_seen_at)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>

              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
                <label style={{ flex: '1 1 320px' }}>
                  <div className="attestiv-label">{t('Module URL', 'Module URL')}</div>
                  <input
                    type="url"
                    value={urlDrafts[m.id] ?? ''}
                    onChange={(e) => setUrlDrafts({ ...urlDrafts, [m.id]: e.target.value })}
                    placeholder={t('e.g. https://10.100.21.206:9543', 'e.g. https://10.100.21.206:9543')}
                    className="attestiv-input"
                  />
                </label>
                <PrimaryButton onClick={() => void saveUrl(m.id)} disabled={busy || (urlDrafts[m.id] ?? '') === (m.url ?? '')}>
                  <i className="ti ti-device-floppy" aria-hidden="true" /> {t('Save', 'Save')}
                </PrimaryButton>
              </div>

              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                <div>
                  <div className="attestiv-label">{t('Server certificates', 'Server certificates')}</div>
                  {certList(m.server_certs)}
                  <GhostButton onClick={() => openIssue(m, 'server')} disabled={busy}>
                    <i className="ti ti-certificate" aria-hidden="true" /> {t('Issue server certificate', 'Issue server certificate')}
                  </GhostButton>
                </div>
                <div>
                  <div className="attestiv-label">{t('Client certificates', 'Client certificates')}</div>
                  {certList(m.client_certs)}
                  <GhostButton onClick={() => openIssue(m, 'client')} disabled={busy}>
                    <i className="ti ti-certificate" aria-hidden="true" /> {t('Issue client certificate', 'Issue client certificate')}
                  </GhostButton>
                </div>
              </div>

              {renderIssueForm(m)}
              {renderIssued(m)}
            </Card>
          ))
        )}

        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
          <a href="/settings/trust-store" onClick={(e) => { e.preventDefault(); router.push('/settings/trust-store') }}>
            {t('Manage all certificates in the Trust store', 'Manage all certificates in the Trust store')}
          </a>
        </p>
      </div>
    </>
  )
}
