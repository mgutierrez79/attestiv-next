'use client';
// Trust store page — Settings ▸ Trust store.
//
// Per-tenant root CA bundles for the connector pipeline. Pilots that
// run connectors against internal appliances (Palo Alto Panorama,
// vCenter, PowerStore, ...) signed by a private CA upload that root
// here so verify_tls stays meaningful end-to-end — instead of
// telling users to disable TLS verification, the backend layers
// these CAs on top of the system trust store at probe time.
//
// Backend API:
//   GET    /v1/settings/trust-store/cas
//   POST   /v1/settings/trust-store/cas      body: {label, pem}
//   GET    /v1/settings/trust-store/cas/{id}
//   DELETE /v1/settings/trust-store/cas/{id}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PrimaryButton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n'

type CABundleSummary = {
  id: string
  tenant_id?: string
  label: string
  fingerprint_sha256: string
  subject: string
  issuer: string
  not_before: string
  not_after: string
  created_at: string
  created_by?: string
}

// Read-only view of the platform's OWN TLS/mTLS bundle (the API
// server cert, internal CA, frontend server cert, proxy client cert).
// Served by GET /v1/settings/tls-certificates — public certs only,
// never private keys. Rotation stays with gentls + redeploy.
type PlatformCert = {
  role: string
  file: string
  description: string
  subject: string
  issuer: string
  is_ca: boolean
  self_signed: boolean
  sans: string[]
  not_before: string
  not_after: string
  days_until_expiry: number
  expiry_status: 'ok' | 'warning' | 'critical' | 'expired'
  fingerprint_sha256: string
  key_usage: string[]
}

type TlsCertsResponse = {
  tls_enabled: boolean
  mtls: {
    client_ca_configured: boolean
    require_client_cert: boolean
    mode: string
  }
  certificates: PlatformCert[]
}

const CERT_ROLE_LABELS: Record<string, string> = {
  api_server: 'API server (backend HTTPS)',
  internal_ca: 'Internal CA',
  frontend_server: 'Frontend server (browser → Next.js)',
  proxy_client: 'Proxy client (Next.js → API, mTLS)',
}

// One issued mTLS client cert (metadata only — the private key is never
// stored, it's returned once at issuance). GET/DELETE
// /v1/settings/mtls/client-certs.
type ClientCertRecord = {
  fingerprint_sha256: string
  label: string
  common_name: string
  issued_at: string
  expires_at: string
  issued_by?: string
  revoked: boolean
  revoked_at?: string
}

// The one-time issue response — carries the cert AND private key, shown
// once for download and never retrievable again.
type IssuedClientCert = {
  fingerprint_sha256: string
  label: string
  common_name: string
  expires_at: string
  certificate_pem: string
  private_key_pem: string
}

// A staged custom cert awaiting apply (GET/POST/DELETE
// /v1/settings/tls-certificates/staged). Metadata only — keys are
// staged server-side, never returned.
type StagedTLSCert = {
  role: string
  label: string
  subject: string
  not_after: string
  fingerprint_sha256: string
  staged_at: string
  staged_by?: string
}

const STAGED_ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'api_server', label: 'API server (backend HTTPS)' },
  { value: 'frontend_server', label: 'Frontend server (browser → Next.js)' },
  { value: 'proxy_client', label: 'Proxy client (Next.js → API)' },
]

// Roughly how long before expiry we surface a warning chip. Same
// heuristic as the cert-expiry helpers in siteregistry — 30 days
// is the "renew now" window, 90 is "plan ahead."
const EXPIRY_WARNING_DAYS = 30
const EXPIRY_NOTICE_DAYS = 90

export function AttestivTrustStorePage() {
  const { t } = useI18n()
  const router = useRouter()
  const [bundles, setBundles] = useState<CABundleSummary[] | null>(null)
  const [platformCerts, setPlatformCerts] = useState<TlsCertsResponse | null>(null)
  const [activeTab, setActiveTab] = useState<'mtls' | 'ca'>('mtls')
  const [clientCerts, setClientCerts] = useState<ClientCertRecord[] | null>(null)
  const [clientCertLabel, setClientCertLabel] = useState('')
  const [issuedCert, setIssuedCert] = useState<IssuedClientCert | null>(null)
  const [stagedCerts, setStagedCerts] = useState<StagedTLSCert[] | null>(null)
  const [stageRole, setStageRole] = useState('api_server')
  const [stageCertPem, setStageCertPem] = useState('')
  const [stageKeyPem, setStageKeyPem] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [labelInput, setLabelInput] = useState('')
  const [pemInput, setPemInput] = useState('')
  // Track which file the user actually picked so the drop zone can
  // show "Selected: auxia-root-ca.pem (2.4 KB)" feedback instead of
  // leaving the operator wondering whether their click did anything.
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null)
  const [selectedFileSize, setSelectedFileSize] = useState<number | null>(null)
  // Visual highlight on the drop zone while a file is being dragged
  // over it. Without this state the zone looks identical whether
  // the dragged file will be accepted or not.
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const response = await apiFetch('/settings/trust-store/cas')
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(extractMessage(body, response))
      }
      const body = await response.json()
      const list = Array.isArray(body?.bundles) ? body.bundles : []
      setBundles(list)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load trust store')
      setBundles([])
    }
  }, [])

  const refreshPlatformCerts = useCallback(async () => {
    try {
      const response = await apiFetch('/settings/tls-certificates')
      if (!response.ok) return
      const body = (await response.json()) as TlsCertsResponse
      setPlatformCerts(body)
    } catch {
      // Non-fatal: the platform-cert panel is informational. The CA
      // upload below is the page's primary function and must still load.
    }
  }, [])

  const refreshClientCerts = useCallback(async () => {
    try {
      const response = await apiFetch('/settings/mtls/client-certs')
      if (!response.ok) return
      const body = await response.json()
      setClientCerts(Array.isArray(body?.client_certs) ? body.client_certs : [])
    } catch {
      setClientCerts([])
    }
  }, [])

  const refreshStaged = useCallback(async () => {
    try {
      const response = await apiFetch('/settings/tls-certificates/staged')
      if (!response.ok) return
      const body = await response.json()
      setStagedCerts(Array.isArray(body?.staged) ? body.staged : [])
    } catch {
      setStagedCerts([])
    }
  }, [])

  useEffect(() => {
    void refresh()
    void refreshPlatformCerts()
    void refreshClientCerts()
    void refreshStaged()
  }, [refresh, refreshPlatformCerts, refreshClientCerts, refreshStaged])

  async function stageCustomCert() {
    if (!stageCertPem.trim() || !stageKeyPem.trim()) {
      setError(t('Both the certificate and private key (PEM) are required.', 'Both the certificate and private key (PEM) are required.'))
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch('/settings/tls-certificates/staged', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: stageRole, certificate_pem: stageCertPem, private_key_pem: stageKeyPem }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(extractMessage(body, response))
      setStageCertPem('')
      setStageKeyPem('')
      setInfo(t('Certificate staged. It is NOT live yet — apply it from the runner (apply_staged_tls) to swap it in and restart.', 'Certificate staged. It is NOT live yet — apply it from the runner (apply_staged_tls) to swap it in and restart.'))
      await refreshStaged()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to stage certificate')
    } finally {
      setBusy(false)
    }
  }

  async function discardStaged(role: string) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch(`/settings/tls-certificates/staged/${encodeURIComponent(role)}`, { method: 'DELETE' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(extractMessage(body, response))
      }
      setInfo(t('Staged certificate discarded.', 'Staged certificate discarded.'))
      await refreshStaged()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to discard staged certificate')
    } finally {
      setBusy(false)
    }
  }

  async function issueClientCert() {
    if (!clientCertLabel.trim()) {
      setError(t('A label is required to issue a client certificate.', 'A label is required to issue a client certificate.'))
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    setIssuedCert(null)
    try {
      const response = await apiFetch('/settings/mtls/client-certs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: clientCertLabel.trim() }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(extractMessage(body, response))
      setIssuedCert(body as IssuedClientCert)
      setClientCertLabel('')
      setInfo(t('Client certificate issued. Download the key now — it is shown only once.', 'Client certificate issued. Download the key now — it is shown only once.'))
      await refreshClientCerts()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to issue client certificate')
    } finally {
      setBusy(false)
    }
  }

  async function revokeClientCert(fingerprint: string, label: string) {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        t('Revoke client certificate "{label}"? Any caller presenting it will be rejected at the TLS handshake.', 'Revoke client certificate "{label}"? Any caller presenting it will be rejected at the TLS handshake.').replace('{label}', label),
      )
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch(`/settings/mtls/client-certs/${encodeURIComponent(fingerprint)}`, { method: 'DELETE' })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(extractMessage(body, response))
      }
      setInfo(t('Client certificate revoked.', 'Client certificate revoked.'))
      await refreshClientCerts()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to revoke client certificate')
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

  // Read a .pem / .crt file directly so the operator does not have
  // to copy-paste a multi-line PEM into the textarea. We never read
  // anything beyond the chosen file, and the binary preview stays
  // client-side — the upload still flows through our normal
  // apiFetch + auth headers.
  function ingestFile(file: File) {
    setSelectedFileName(file.name)
    setSelectedFileSize(file.size)
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      setPemInput(text)
      if (!labelInput.trim()) {
        // Convenience: use the filename (minus extension) as the
        // default label so a user dropping in "auxia-root-ca.pem"
        // doesn't have to type "Auxia root CA" twice.
        setLabelInput(file.name.replace(/\.[^.]+$/, ''))
      }
    }
    reader.readAsText(file)
  }

  function onFileSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) ingestFile(file)
  }

  // Drop-zone event handlers. We keep these simple — the
  // "dragActive" boolean controls the highlight, dropEffect signals
  // to the OS that we'll accept the drop, and ingestFile takes the
  // first File in the transfer. Multiple files are deliberately
  // ignored: each bundle row in the trust store is one CA.
  function onDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'copy'
    setDragActive(true)
  }
  function onDragLeave(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
  }
  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    const file = event.dataTransfer.files?.[0]
    if (file) ingestFile(file)
  }

  function clearSelectedFile() {
    setSelectedFileName(null)
    setSelectedFileSize(null)
    setPemInput('')
    // The hidden <input> needs its value reset so picking the same
    // file twice in a row still fires onChange.
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Human-readable byte size for the "(2.4 KB)" suffix next to the
  // selected filename. Capped at MB because no real CA bundle is
  // larger than that, and the server enforces a 64 KiB limit anyway.
  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / 1024 / 1024).toFixed(1)} MB`
  }

  async function upload() {
    if (!labelInput.trim() || !pemInput.trim()) {
      setError(t('Label and PEM are required.', 'Label and PEM are required.'))
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch('/settings/trust-store/cas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: labelInput.trim(), pem: pemInput }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(extractMessage(body, response))
      }
      setLabelInput('')
      setPemInput('')
      setSelectedFileName(null)
      setSelectedFileSize(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setInfo(t('Root CA uploaded.', 'Root CA uploaded.'))
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to upload CA')
    } finally {
      setBusy(false)
    }
  }

  async function remove(bundleID: string, label: string) {
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        t('Remove the CA "{label}"? Connectors that relied on it will fail TLS verification again.', 'Remove the CA "{label}"? Connectors that relied on it will fail TLS verification again.').replace('{label}', label),
      )
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch(`/settings/trust-store/cas/${encodeURIComponent(bundleID)}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(extractMessage(body, response))
      }
      setInfo(t('Root CA removed.', 'Root CA removed.'))
      await refresh()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete CA')
    } finally {
      setBusy(false)
    }
  }

  const now = useMemo(() => new Date(), [])

  return (
    <>
      <Topbar
        title={t('Trust store', 'Trust store')}
        left={<Badge tone="navy">{t('admin only', 'admin only')}</Badge>}
        right={
          <GhostButton onClick={() => router.push('/settings')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Settings', 'Settings')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {info ? <Banner tone="success">{info}</Banner> : null}

        <div role="tablist" style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--color-border)' }}>
          {([
            ['mtls', t('Platform TLS & mTLS', 'Platform TLS & mTLS')],
            ['ca', t('CA trust store', 'CA trust store')],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={activeTab === key}
              onClick={() => setActiveTab(key)}
              style={{
                padding: '8px 16px',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                fontWeight: activeTab === key ? 700 : 500,
                color: activeTab === key ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                borderBottom: activeTab === key ? '2px solid var(--color-accent, #2563eb)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'mtls' ? (
        <>
        <Card>
          <CardTitle>{t('Platform TLS certificates', 'Platform TLS certificates')}</CardTitle>
          <p style={{ marginBottom: 12 }}>
            {t(
              'The certificates securing the frontend and backend, including the mutual-TLS channel between the Next.js proxy and the API. These are managed via the cert bundle (gentls) and applied on deploy — this view is read-only and never exposes private keys.',
              'The certificates securing the frontend and backend, including the mutual-TLS channel between the Next.js proxy and the API. These are managed via the cert bundle (gentls) and applied on deploy — this view is read-only and never exposes private keys.',
            )}
          </p>
          {platformCerts === null ? (
            <p>{t('Loading…', 'Loading…')}</p>
          ) : !platformCerts.tls_enabled ? (
            <Banner tone="warning">
              {t('TLS is not configured on the API (no server certificate).', 'TLS is not configured on the API (no server certificate).')}
            </Banner>
          ) : (
            <>
              <div style={{ marginBottom: 12, fontSize: 13 }}>
                <Badge tone={platformCerts.mtls.require_client_cert ? 'navy' : 'amber'}>
                  {t('mTLS mode', 'mTLS mode')}: {platformCerts.mtls.mode}
                </Badge>{' '}
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                  {platformCerts.mtls.require_client_cert
                    ? t('Client certificate required for API connections.', 'Client certificate required for API connections.')
                    : t('Client certificate verified when presented, but not required.', 'Client certificate verified when presented, but not required.')}
                </span>
              </div>
              {platformCerts.certificates.length === 0 ? (
                <EmptyState
                  icon="ti-certificate"
                  title={t('No platform certificates found.', 'No platform certificates found.')}
                  description={t('The TLS bundle directory has no readable certificates.', 'The TLS bundle directory has no readable certificates.')}
                />
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      <th style={{ padding: '8px 12px' }}>{t('Role', 'Role')}</th>
                      <th style={{ padding: '8px 12px' }}>{t('Subject', 'Subject')}</th>
                      <th style={{ padding: '8px 12px' }}>{t('SANs', 'SANs')}</th>
                      <th style={{ padding: '8px 12px' }}>{t('Expires', 'Expires')}</th>
                      <th style={{ padding: '8px 12px' }}>{t('Fingerprint (SHA-256)', 'Fingerprint (SHA-256)')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {platformCerts.certificates.map((cert) => {
                      const tone: 'red' | 'amber' | 'navy' =
                        cert.expiry_status === 'expired' || cert.expiry_status === 'critical'
                          ? 'red'
                          : cert.expiry_status === 'warning'
                            ? 'amber'
                            : 'navy'
                      return (
                        <tr key={cert.role + cert.fingerprint_sha256} style={{ borderTop: '1px solid var(--color-border)' }}>
                          <td style={{ padding: '8px 12px' }}>
                            <div style={{ fontWeight: 600 }}>{CERT_ROLE_LABELS[cert.role] ?? cert.role}</div>
                            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>{cert.file}</div>
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 13 }}>{cert.subject}</td>
                          <td style={{ padding: '8px 12px', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                            {cert.sans.length ? cert.sans.join(', ') : '—'}
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 13 }}>
                            <Badge tone={tone}>
                              {cert.days_until_expiry <= 0
                                ? t('Expired', 'Expired')
                                : t('{n} days', '{n} days').replace('{n}', String(cert.days_until_expiry))}
                            </Badge>
                            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                              {cert.not_after.slice(0, 10)}
                            </div>
                          </td>
                          <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>
                            {cert.fingerprint_sha256.slice(0, 16)}…{cert.fingerprint_sha256.slice(-8)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </>
          )}
        </Card>

        <Card>
          <CardTitle>{t('Client certificates (mTLS)', 'Client certificates (mTLS)')}</CardTitle>
          <p style={{ marginBottom: 12 }}>
            {t(
              'Issue client certificates signed by the internal CA for callers that must present one when "Require client certificate" is enabled (vendors, CLIs). The private key is shown only once at issuance and never stored. Revoking a certificate blocks it at the TLS handshake even though it is CA-signed.',
              'Issue client certificates signed by the internal CA for callers that must present one when "Require client certificate" is enabled (vendors, CLIs). The private key is shown only once at issuance and never stored. Revoking a certificate blocks it at the TLS handshake even though it is CA-signed.',
            )}
          </p>

          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
            <label style={{ flex: '1 1 280px' }}>
              <div className="attestiv-label">{t('Label (vendor / service name)', 'Label (vendor / service name)')}</div>
              <input
                type="text"
                value={clientCertLabel}
                onChange={(e) => setClientCertLabel(e.target.value)}
                placeholder={t('e.g. acme-siem-collector', 'e.g. acme-siem-collector')}
                className="attestiv-input"
              />
            </label>
            <PrimaryButton onClick={() => void issueClientCert()} disabled={busy || !clientCertLabel.trim()}>
              <i className="ti ti-certificate" aria-hidden="true" /> {t('Issue client certificate', 'Issue client certificate')}
            </PrimaryButton>
          </div>

          {issuedCert ? (
            <div style={{ border: '2px solid var(--color-accent, #2563eb)', borderRadius: 8, padding: 16, marginBottom: 16, background: 'rgba(37,99,235,0.04)' }}>
              <Banner tone="warning">
                {t('Save these now — the private key is shown only once and cannot be retrieved again.', 'Save these now — the private key is shown only once and cannot be retrieved again.')}
              </Banner>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0' }}>
                <GhostButton onClick={() => downloadText(`${issuedCert!.label || 'client'}.crt`, issuedCert!.certificate_pem)}>
                  <i className="ti ti-download" aria-hidden="true" /> {t('Download certificate', 'Download certificate')}
                </GhostButton>
                <GhostButton onClick={() => downloadText(`${issuedCert!.label || 'client'}.key`, issuedCert!.private_key_pem)}>
                  <i className="ti ti-download" aria-hidden="true" /> {t('Download private key', 'Download private key')}
                </GhostButton>
                <GhostButton onClick={() => setIssuedCert(null)}>
                  <i className="ti ti-x" aria-hidden="true" /> {t('Done', 'Done')}
                </GhostButton>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'monospace' }}>
                {t('Fingerprint', 'Fingerprint')}: {issuedCert.fingerprint_sha256}
              </div>
            </div>
          ) : null}

          {clientCerts === null ? (
            <p>{t('Loading…', 'Loading…')}</p>
          ) : clientCerts.length === 0 ? (
            <EmptyState
              icon="ti-certificate"
              title={t('No client certificates issued yet.', 'No client certificates issued yet.')}
              description={t('Issue one above for any caller that must present a client cert under mTLS.', 'Issue one above for any caller that must present a client cert under mTLS.')}
            />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px' }}>{t('Label', 'Label')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('Status', 'Status')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('Expires', 'Expires')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('Fingerprint (SHA-256)', 'Fingerprint (SHA-256)')}</th>
                  <th style={{ padding: '8px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {clientCerts.map((cert) => (
                  <tr key={cert.fingerprint_sha256} style={{ borderTop: '1px solid var(--color-border)' }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                      {cert.label}
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{cert.common_name}</div>
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      <Badge tone={cert.revoked ? 'red' : 'navy'}>
                        {cert.revoked ? t('Revoked', 'Revoked') : t('Active', 'Active')}
                      </Badge>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13 }}>{cert.expires_at.slice(0, 10)}</td>
                    <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>
                      {cert.fingerprint_sha256.slice(0, 16)}…{cert.fingerprint_sha256.slice(-8)}
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      {cert.revoked ? null : (
                        <GhostButton onClick={() => void revokeClientCert(cert.fingerprint_sha256, cert.label)} disabled={busy}>
                          <i className="ti ti-ban" aria-hidden="true" /> {t('Revoke', 'Revoke')}
                        </GhostButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardTitle>{t('Install custom certificates', 'Install custom certificates')}</CardTitle>
          <Banner tone="warning">
            {t(
              'Advanced. Upload your own CA-issued certificate + private key to REPLACE the platform server / frontend / proxy identity. Uploads are STAGED only — they are validated (key must match the certificate) and held aside, never written to the live bundle here. Applying them swaps the bundle and RESTARTS both stacks; run it from the pilot-diagnostic workflow with apply_staged_tls=true, which backs up the current bundle and auto-rolls-back if the API does not come back. The internal CA is not replaceable here.',
              'Advanced. Upload your own CA-issued certificate + private key to REPLACE the platform server / frontend / proxy identity. Uploads are STAGED only — they are validated (key must match the certificate) and held aside, never written to the live bundle here. Applying them swaps the bundle and RESTARTS both stacks; run it from the pilot-diagnostic workflow with apply_staged_tls=true, which backs up the current bundle and auto-rolls-back if the API does not come back. The internal CA is not replaceable here.',
            )}
          </Banner>

          <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            <label style={{ display: 'block' }}>
              <div className="attestiv-label">{t('Role to replace', 'Role to replace')}</div>
              <select value={stageRole} onChange={(e) => setStageRole(e.target.value)} className="attestiv-input">
                {STAGED_ROLE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block' }}>
              <div className="attestiv-label">{t('Certificate (PEM)', 'Certificate (PEM)')}</div>
              <textarea
                rows={5}
                value={stageCertPem}
                onChange={(e) => setStageCertPem(e.target.value)}
                placeholder={'-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----'}
                className="attestiv-input"
                style={{ fontFamily: 'monospace', fontSize: 12, width: '100%' }}
              />
            </label>
            <label style={{ display: 'block' }}>
              <div className="attestiv-label">{t('Private key (PEM)', 'Private key (PEM)')}</div>
              <textarea
                rows={5}
                value={stageKeyPem}
                onChange={(e) => setStageKeyPem(e.target.value)}
                placeholder={'-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----'}
                className="attestiv-input"
                style={{ fontFamily: 'monospace', fontSize: 12, width: '100%' }}
              />
            </label>
            <div>
              <PrimaryButton onClick={() => void stageCustomCert()} disabled={busy || !stageCertPem.trim() || !stageKeyPem.trim()}>
                <i className="ti ti-upload" aria-hidden="true" /> {t('Stage certificate', 'Stage certificate')}
              </PrimaryButton>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <div className="attestiv-label">{t('Staged (pending apply)', 'Staged (pending apply)')}</div>
            {stagedCerts === null ? (
              <p>{t('Loading…', 'Loading…')}</p>
            ) : stagedCerts.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }}>
                {t('Nothing staged.', 'Nothing staged.')}
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={{ padding: '8px 12px' }}>{t('Role', 'Role')}</th>
                    <th style={{ padding: '8px 12px' }}>{t('Subject', 'Subject')}</th>
                    <th style={{ padding: '8px 12px' }}>{t('Expires', 'Expires')}</th>
                    <th style={{ padding: '8px 12px' }} />
                  </tr>
                </thead>
                <tbody>
                  {stagedCerts.map((cert) => (
                    <tr key={cert.role} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{cert.label || cert.role}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13 }}>{cert.subject}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13 }}>{(cert.not_after || '').slice(0, 10)}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <GhostButton onClick={() => void discardStaged(cert.role)} disabled={busy}>
                          <i className="ti ti-x" aria-hidden="true" /> {t('Discard', 'Discard')}
                        </GhostButton>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
        </>
        ) : (
        <>
        <Card>
          <CardTitle>{t('Why this matters', 'Why this matters')}</CardTitle>
          <p>
            {t(
              'Upload your corporate root CAs so connectors can verify internal appliances (Palo Alto Panorama, vCenter, PowerStore, etc.) without disabling TLS verification.',
              'Upload your corporate root CAs so connectors can verify internal appliances (Palo Alto Panorama, vCenter, PowerStore, etc.) without disabling TLS verification.',
            )}
          </p>
          <p style={{ marginTop: 8 }}>
            {t(
              'CAs are stored per tenant. They are layered on top of the system trust store at probe time, so verify_tls=true keeps its meaning against private CAs.',
              'CAs are stored per tenant. They are layered on top of the system trust store at probe time, so verify_tls=true keeps its meaning against private CAs.',
            )}
          </p>
        </Card>

        <Card>
          <CardTitle>{t('Upload a root CA', 'Upload a root CA')}</CardTitle>
          <div style={{ display: 'grid', gap: 16 }}>
            {/* Step 1: Label. Numbered so the user follows a sequence
                instead of guessing which field to fill first. */}
            <label style={{ display: 'block' }}>
              <div className="attestiv-label">
                <strong>1.</strong> {t('Label', 'Label')}
              </div>
              <input
                type="text"
                value={labelInput}
                onChange={(event) => setLabelInput(event.target.value)}
                placeholder={t('Auxia Internal Root 2024', 'Auxia Internal Root 2024')}
                className="attestiv-input"
              />
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                {t('Display name shown in the list below. Free text.', 'Display name shown in the list below. Free text.')}
              </div>
            </label>

            {/* Step 2: PEM source. The drop zone is a clickable div
                that triggers a hidden <input type="file"> via a ref.
                The bare <input type="file"> from before gave no visual
                affordance — operators asked "where do I click?".
                Drag-and-drop lands on this same zone, and an OR-pasted
                PEM below is treated as equivalent. */}
            <div>
              <div className="attestiv-label">
                <strong>2.</strong> {t('Select your PEM-encoded certificate', 'Select your PEM-encoded certificate')}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pem,.crt,.cer,application/x-pem-file,text/plain"
                onChange={onFileSelected}
                style={{ display: 'none' }}
                aria-hidden="true"
                tabIndex={-1}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '24px 16px',
                  borderRadius: 8,
                  border: dragActive
                    ? '2px dashed var(--color-accent, #2563eb)'
                    : selectedFileName
                      ? '2px solid var(--color-accent, #2563eb)'
                      : '2px dashed var(--color-border, #cbd5e1)',
                  background: dragActive
                    ? 'rgba(37, 99, 235, 0.08)'
                    : selectedFileName
                      ? 'rgba(37, 99, 235, 0.04)'
                      : 'var(--color-surface-muted, #f8fafc)',
                  cursor: 'pointer',
                  transition: 'border-color 120ms ease, background 120ms ease',
                  textAlign: 'center',
                }}
              >
                {selectedFileName ? (
                  <>
                    <i
                      className="ti ti-file-check"
                      aria-hidden="true"
                      style={{ fontSize: 32, color: 'var(--color-accent, #2563eb)' }}
                    />
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{selectedFileName}</div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                      {selectedFileSize !== null ? formatBytes(selectedFileSize) : ''}{' '}
                      · {t('PEM ready to upload', 'PEM ready to upload')}
                    </div>
                    {/* Absorbing wrapper so a click on the inner
                        buttons doesn't bubble up to the outer drop
                        zone (which would re-open the file dialog on
                        every "Clear" press). */}
                    <div
                      style={{ display: 'flex', gap: 8, marginTop: 4 }}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <GhostButton onClick={() => fileInputRef.current?.click()}>
                        <i className="ti ti-replace" aria-hidden="true" /> {t('Choose a different file', 'Choose a different file')}
                      </GhostButton>
                      <GhostButton onClick={() => clearSelectedFile()}>
                        <i className="ti ti-x" aria-hidden="true" /> {t('Clear', 'Clear')}
                      </GhostButton>
                    </div>
                  </>
                ) : (
                  <>
                    <i
                      className="ti ti-cloud-upload"
                      aria-hidden="true"
                      style={{ fontSize: 32, color: 'var(--color-text-tertiary, #64748b)' }}
                    />
                    <div style={{ fontWeight: 600, fontSize: 14 }}>
                      {t('Click to choose a file', 'Click to choose a file')}{' '}
                      <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                        {t('or drag it here', 'or drag it here')}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                      {t('Accepted: .pem, .crt, .cer (max 64 KB)', 'Accepted: .pem, .crt, .cer (max 64 KB)')}
                    </div>
                  </>
                )}
              </div>

              {/* Separator between the two equivalent input paths.
                  Without this, users were confused whether the file
                  picker and the textarea were redundant or both
                  required. Now it's clearly an OR. */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  margin: '16px 0',
                  color: 'var(--color-text-tertiary, #64748b)',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                }}
              >
                <div style={{ flex: 1, height: 1, background: 'var(--color-border, #e2e8f0)' }} />
                {t('or paste it below', 'or paste it below')}
                <div style={{ flex: 1, height: 1, background: 'var(--color-border, #e2e8f0)' }} />
              </div>

              <textarea
                rows={8}
                value={pemInput}
                onChange={(event) => {
                  setPemInput(event.target.value)
                  // If the user pastes after picking a file, the
                  // file label is stale — clear it so the UI tells
                  // the truth about what's actually queued.
                  if (selectedFileName) {
                    setSelectedFileName(null)
                    setSelectedFileSize(null)
                  }
                }}
                placeholder={'-----BEGIN CERTIFICATE-----\nMIID...\n-----END CERTIFICATE-----'}
                className="attestiv-input"
                style={{ fontFamily: 'monospace', fontSize: 12, width: '100%' }}
              />
            </div>

            {/* Step 3: Upload. The disabled-state hint makes it
                explicit what's missing — users were clicking the
                grey button and getting no feedback. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <PrimaryButton onClick={upload} disabled={busy || !labelInput.trim() || !pemInput.trim()}>
                {busy ? (
                  <>
                    <i className="ti ti-loader-2" aria-hidden="true" /> {t('Uploading…', 'Uploading…')}
                  </>
                ) : (
                  <>
                    <i className="ti ti-upload" aria-hidden="true" /> {t('Upload root CA', 'Upload root CA')}
                  </>
                )}
              </PrimaryButton>
              {!labelInput.trim() || !pemInput.trim() ? (
                <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  {!labelInput.trim()
                    ? t('Enter a label first.', 'Enter a label first.')
                    : t('Select a PEM file or paste one above.', 'Select a PEM file or paste one above.')}
                </span>
              ) : null}
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>{t('Uploaded root CAs', 'Uploaded root CAs')}</CardTitle>
          {bundles === null ? (
            <p>{t('Loading…', 'Loading…')}</p>
          ) : bundles.length === 0 ? (
            <EmptyState
              icon="ti-certificate"
              title={t('No root CAs uploaded yet.', 'No root CAs uploaded yet.')}
              description={t(
                'Connectors will fall back to the system trust store. Upload a PEM above to trust private CAs.',
                'Connectors will fall back to the system trust store. Upload a PEM above to trust private CAs.',
              )}
            />
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 12px' }}>{t('Label', 'Label')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('Subject', 'Subject')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('Expires', 'Expires')}</th>
                  <th style={{ padding: '8px 12px' }}>{t('Fingerprint (SHA-256)', 'Fingerprint (SHA-256)')}</th>
                  <th style={{ padding: '8px 12px' }} />
                </tr>
              </thead>
              <tbody>
                {bundles.map((bundle) => {
                  const expiry = new Date(bundle.not_after)
                  const daysLeft = Math.round((expiry.getTime() - now.getTime()) / 86400000)
                  let tone: 'red' | 'amber' | 'navy' = 'navy'
                  if (daysLeft <= 0) tone = 'red'
                  else if (daysLeft <= EXPIRY_WARNING_DAYS) tone = 'red'
                  else if (daysLeft <= EXPIRY_NOTICE_DAYS) tone = 'amber'
                  return (
                    <tr key={bundle.id} style={{ borderTop: '1px solid var(--color-border)' }}>
                      <td style={{ padding: '8px 12px', fontWeight: 600 }}>{bundle.label}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13 }}>{bundle.subject}</td>
                      <td style={{ padding: '8px 12px', fontSize: 13 }}>
                        <Badge tone={tone}>
                          {daysLeft <= 0
                            ? t('Expired', 'Expired')
                            : t('{n} days', '{n} days').replace('{n}', String(daysLeft))}
                        </Badge>
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                          {expiry.toISOString().slice(0, 10)}
                        </div>
                      </td>
                      <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 11 }}>
                        {bundle.fingerprint_sha256.slice(0, 16)}…{bundle.fingerprint_sha256.slice(-8)}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        <GhostButton onClick={() => void remove(bundle.id, bundle.label)} disabled={busy}>
                          <i className="ti ti-trash" aria-hidden="true" /> {t('Remove', 'Remove')}
                        </GhostButton>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Card>
        </>
        )}
      </div>
    </>
  )
}

// extractMessage reads body.detail first (the platform's writeError
// convention), falls back to body.error for legacy endpoints, and
// finally to the bare status line — mirrors the wizard's error
// parser so the trust-store UI surfaces upstream messages instead
// of generic statuses.
function extractMessage(body: any, response: Response): string {
  if (body && typeof body.detail === 'string' && body.detail) return body.detail
  if (body && typeof body.error === 'string' && body.error) return body.error
  return `${response.status} ${response.statusText}`
}
