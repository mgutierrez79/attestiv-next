'use client';
// Trust Center — public, no-auth surface where a prospect or
// auditor checks "is this platform real?" without an account:
//   - lists the frameworks this tenant publishes,
//   - links to the latest signed report,
//   - lets the visitor verify a run manifest's Ed25519 signature.
//
// Visual shape mirrors the /gxp and /dora landing pages so the
// public surface is one coherent thing. Uses CSS variables from
// the Attestiv theme — the previous version used hard-coded
// Tailwind hex colors that no longer match the console.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { defaultSettings, loadSettings } from '../lib/settings'
import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
} from '../components/AttestivUi'
import { AttestivLogo } from '../components/AttestivLayout'

import { useI18n } from '../lib/i18n'

type TrustCenterFramework = {
  key: string
  name: string
  version: string
}

type TrustCenterReport = {
  run_id?: string | null
  timestamp?: string | null
  pdf_url?: string | null
  md_url?: string | null
}

type ManifestSignatureStatus = {
  enabled: boolean
  present: boolean
  valid?: boolean | null
}

type ManifestVerificationResponse = {
  run_id: string
  status: ManifestSignatureStatus
}

type TrustCenterResponse = {
  frameworks: TrustCenterFramework[]
  latest_report?: TrustCenterReport | null
}

function joinUrl(base: string, path: string) {
  const normalizedBase = base.replace(/\/+$/, '')
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

export function TrustCenterPage() {
  const { t } = useI18n()

  const [data, setData] = useState<TrustCenterResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [verifyRunId, setVerifyRunId] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<ManifestSignatureStatus | null>(null)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultSettings().apiBaseUrl)

  const loadData = async (apiBaseUrlOverride?: string) => {
    setLoading(true)
    setError(null)
    try {
      const nextApiBaseUrl = apiBaseUrlOverride ?? loadSettings().apiBaseUrl
      setApiBaseUrl(nextApiBaseUrl)
      const url = joinUrl(nextApiBaseUrl, '/v1/public/trust-center')
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }
      const payload = (await response.json()) as TrustCenterResponse
      setData(payload)
      if (payload.latest_report?.run_id) {
        setVerifyRunId(payload.latest_report.run_id)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData(loadSettings().apiBaseUrl)
  }, [])

  const pdfUrl = data?.latest_report?.pdf_url ? joinUrl(apiBaseUrl, data.latest_report.pdf_url) : null
  const mdUrl = data?.latest_report?.md_url ? joinUrl(apiBaseUrl, data.latest_report.md_url) : null

  const verifyManifest = async () => {
    setVerifyError(null)
    setVerifying(true)
    try {
      const runQuery = verifyRunId ? `?run_id=${encodeURIComponent(verifyRunId)}` : ''
      const url = joinUrl(apiBaseUrl, `/v1/public/manifest/verify${runQuery}`)
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }
      const payload = (await response.json()) as ManifestVerificationResponse
      setVerifyStatus(payload.status)
      if (payload.run_id && payload.run_id !== verifyRunId) {
        setVerifyRunId(payload.run_id)
      }
    } catch (err) {
      setVerifyError((err as Error).message)
      setVerifyStatus(null)
    } finally {
      setVerifying(false)
    }
  }

  const verificationLabel = () => {
    if (!verifyStatus) return t('Not checked', 'Not checked')
    if (!verifyStatus.enabled) return t('Verification not configured', 'Verification not configured')
    if (!verifyStatus.present) return t('Signature missing', 'Signature missing')
    if (verifyStatus.valid) return t('Signature valid', 'Signature valid')
    return t('Signature invalid', 'Signature invalid')
  }

  const verificationTone = (): 'success' | 'warning' | 'error' | 'info' => {
    if (!verifyStatus) return 'info'
    if (!verifyStatus.enabled || !verifyStatus.present) return 'warning'
    if (verifyStatus.valid) return 'success'
    return 'error'
  }

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <Link href="/" style={brandLinkStyle}>
          <span style={brandLogoBoxStyle}>
            <AttestivLogo />
          </span>
          <span style={brandLabelStyle}>Attestiv</span>
        </Link>
        <nav style={navStyle}>
          <Link href="/gxp" style={navLinkStyle}>{t('GxP', 'GxP')}</Link>
          <Link href="/dora" style={navLinkStyle}>{t('DORA', 'DORA')}</Link>
          <Link href="/login" style={ctaLinkStyle}>{t('Open console →', 'Open console →')}</Link>
        </nav>
      </header>

      <section style={heroStyle}>
        <div style={heroBadgeStyle}>{t('Public — no account required', 'Public — no account required')}</div>
        <h1 style={h1Style}>{t('Trust center', 'Trust center')}</h1>
        <p style={leadStyle}>
          {t(
            'Frameworks this tenant publishes, the latest signed compliance report, and an offline-friendly way to verify the manifest signature against the platform\'s public Ed25519 key.',
            'Frameworks this tenant publishes, the latest signed compliance report, and an offline-friendly way to verify the manifest signature against the platform\'s public Ed25519 key.'
          )}
        </p>
        <div style={ctaRowStyle}>
          <PrimaryButton onClick={() => void loadData()} disabled={loading}>
            <i className="ti ti-refresh" aria-hidden="true" />
            {loading ? t('Refreshing…', 'Refreshing…') : t('Refresh', 'Refresh')}
          </PrimaryButton>
        </div>
      </section>

      <div style={mainStyle}>
        {error ? <Banner tone="error" title={t('Trust center error', 'Trust center error')}>{error}</Banner> : null}

        <Card style={{ marginTop: 8 }}>
          <CardTitle right={<Badge tone="navy">{data?.frameworks?.length ?? 0}</Badge>}>
            {t('Compliance frameworks supported', 'Compliance frameworks supported')}
          </CardTitle>
          <p style={cardLeadStyle}>
            {t(
              'Overview of the frameworks Attestiv currently supports for this tenant.',
              'Overview of the frameworks Attestiv currently supports for this tenant.'
            )}
          </p>
          <div style={gridStyle}>
            {(data?.frameworks || []).map((framework) => (
              <div key={framework.key} style={frameworkCardStyle}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: 'var(--color-brand-blue)' }}>
                  {framework.key}
                </div>
                <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>
                  {framework.name || framework.key.toUpperCase()}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
                  {framework.version ? `${t('Version', 'Version')} ${framework.version}` : t('Version pending', 'Version pending')}
                </div>
              </div>
            ))}
            {!loading && (data?.frameworks?.length ?? 0) === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                {t('No frameworks published yet.', 'No frameworks published yet.')}
              </div>
            ) : null}
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<Badge tone="navy">{t('signed', 'signed')}</Badge>}>
            {t('Latest report', 'Latest report')}
          </CardTitle>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
            {data?.latest_report?.run_id
              ? `${t('Run', 'Run')}: ${data.latest_report.run_id} · ${data.latest_report.timestamp || 'n/a'}`
              : t('No report published yet.', 'No report published yet.')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            {pdfUrl ? (
              <a href={pdfUrl} style={downloadLinkStyle}>
                <i className="ti ti-file-type-pdf" aria-hidden="true" />
                {t('Download PDF', 'Download PDF')}
              </a>
            ) : null}
            {mdUrl ? (
              <a href={mdUrl} style={downloadLinkStyle}>
                <i className="ti ti-file-text" aria-hidden="true" />
                {t('Download Markdown', 'Download Markdown')}
              </a>
            ) : null}
            {!pdfUrl && !mdUrl ? (
              <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                {t('No report available.', 'No report available.')}
              </span>
            ) : null}
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Verify report signature', 'Verify report signature')}</CardTitle>
          <p style={cardLeadStyle}>
            {t(
              'Confirm the run manifest signature for the published report against Attestiv\'s public Ed25519 key.',
              'Confirm the run manifest signature for the published report against Attestiv\'s public Ed25519 key.'
            )}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
            <input
              value={verifyRunId}
              onChange={(event) => setVerifyRunId(event.target.value)}
              placeholder="run-YYYYMMDD-HHMMSS"
              style={inputStyle}
            />
            <PrimaryButton onClick={verifyManifest} disabled={verifying}>
              <i className="ti ti-shield-check" aria-hidden="true" />
              {verifying ? t('Verifying…', 'Verifying…') : t('Verify', 'Verify')}
            </PrimaryButton>
            <GhostButton onClick={() => { setVerifyStatus(null); setVerifyError(null); setVerifyRunId('') }}>
              {t('Clear', 'Clear')}
            </GhostButton>
          </div>
          {verifyError ? (
            <Banner tone="error" title={t('Verification error', 'Verification error')}>{verifyError}</Banner>
          ) : null}
          <div style={{ marginTop: 12 }}>
            <Banner tone={verificationTone()}>
              <strong>{t('Status', 'Status')}:</strong> {verificationLabel()}
            </Banner>
          </div>
        </Card>
      </div>

      <footer style={footerStyle}>
        <span>© Attestiv</span>
        <span style={{ flex: 1 }} />
        <Link href="/gxp" style={footerLinkStyle}>{t('GxP', 'GxP')}</Link>
        <Link href="/dora" style={footerLinkStyle}>{t('DORA', 'DORA')}</Link>
        <Link href="/login" style={footerLinkStyle}>{t('Console login', 'Console login')}</Link>
      </footer>
    </div>
  )
}

const pageStyle: React.CSSProperties = {
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  minHeight: '100vh',
  fontFamily: 'inherit',
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  padding: '14px 32px',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
}

const brandLinkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  textDecoration: 'none',
  color: 'var(--color-text-primary)',
}

const brandLabelStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: 0.2,
}

const brandLogoBoxStyle: React.CSSProperties = {
  display: 'inline-flex',
  width: 28,
  height: 28,
  alignItems: 'center',
  justifyContent: 'center',
}

const navStyle: React.CSSProperties = {
  marginLeft: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  fontSize: 13,
}

const navLinkStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  textDecoration: 'none',
}

const ctaLinkStyle: React.CSSProperties = {
  ...navLinkStyle,
  color: 'var(--color-brand-blue)',
  fontWeight: 600,
}

const heroStyle: React.CSSProperties = {
  maxWidth: 880,
  margin: '0 auto',
  padding: '60px 32px 30px',
}

const heroBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
  color: 'var(--color-brand-blue)',
  padding: '4px 10px',
  border: '0.5px solid var(--color-brand-blue)',
  borderRadius: 999,
  marginBottom: 18,
}

const h1Style: React.CSSProperties = {
  fontSize: 34,
  lineHeight: 1.15,
  fontWeight: 700,
  margin: 0,
  letterSpacing: -0.5,
}

const leadStyle: React.CSSProperties = {
  fontSize: 15,
  lineHeight: 1.55,
  color: 'var(--color-text-secondary)',
  marginTop: 14,
  marginBottom: 22,
  maxWidth: 700,
}

const ctaRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
}

const mainStyle: React.CSSProperties = {
  maxWidth: 880,
  margin: '0 auto',
  padding: '12px 32px 60px',
}

const cardLeadStyle: React.CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.6,
  color: 'var(--color-text-secondary)',
  marginTop: 4,
  marginBottom: 12,
}

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
  marginTop: 4,
}

const frameworkCardStyle: React.CSSProperties = {
  padding: 14,
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--border-radius-md)',
  background: 'var(--color-background-secondary)',
}

const downloadLinkStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 14px',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--border-radius-md)',
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  textDecoration: 'none',
  fontSize: 12.5,
}

const inputStyle: React.CSSProperties = {
  fontSize: 12.5,
  padding: '8px 12px',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--border-radius-md)',
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  fontFamily: 'inherit',
  minWidth: 280,
  flex: 1,
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 18,
  padding: '20px 32px',
  borderTop: '0.5px solid var(--color-border-tertiary)',
  fontSize: 12,
  color: 'var(--color-text-tertiary)',
}

const footerLinkStyle: React.CSSProperties = {
  color: 'var(--color-text-secondary)',
  textDecoration: 'none',
}
