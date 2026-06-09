'use client';
// Architecture documentation page — Audit ▸ Documentation (DAT).
//
// Generates the DAT (Dossier d'Architecture Technique) on demand.
// French enterprise-style long-form deliverable that auditors expect
// alongside the per-framework reports: operator-supplied business
// context (policies/documentation/dat.yaml) composed with the live
// platform state (inventory, applications, sites, connectors,
// framework scope) into a signed PDF.

import { useState } from 'react'
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

export function AttestivDocumentationPage() {
  const { t } = useI18n()

  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSize, setLastSize] = useState<number | null>(null)

  async function downloadDAT() {
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch('/documentation/dat')
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `${response.status} ${response.statusText}`)
      }
      const blob = await response.blob()
      setLastSize(blob.size)
      const objectUrl = URL.createObjectURL(blob)
      const cd = response.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `dat-${new Date().toISOString().slice(0, 10)}.pdf`
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate DAT')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Topbar
        title={t('Architecture documentation', 'Architecture documentation')}
        left={<Badge tone="navy">DAT</Badge>}
        right={
          <GhostButton onClick={() => router.push('/audit')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Audit', 'Audit')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {lastSize != null ? (
          <Banner tone="success">
            {t('Downloaded', 'Downloaded')} {formatBytes(lastSize)}.
          </Banner>
        ) : null}

        <Banner tone="info" title={t('What the DAT is', 'What the DAT is')}>
          {t(
            'The Dossier d\'Architecture Technique is the French enterprise-style architecture document auditors expect alongside the per-framework reports. It pairs your operator-supplied business context (project, owners, scope, SLA, security posture) with the live platform state (inventory counts, applications, sites, connectors, framework scope) into a single signed PDF.',
            'The Dossier d\'Architecture Technique is the French enterprise-style architecture document auditors expect alongside the per-framework reports. It pairs your operator-supplied business context (project, owners, scope, SLA, security posture) with the live platform state (inventory counts, applications, sites, connectors, framework scope) into a single signed PDF.',
          )}
        </Banner>

        <Card>
          <CardTitle right={<Badge tone="navy">signed PDF</Badge>}>
            {t('Generate & download', 'Generate & download')}
          </CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
            {t(
              'A fresh DAT is rendered every time so concurrent requests never race. The operator context is read from',
              'A fresh DAT is rendered every time so concurrent requests never race. The operator context is read from',
            )}{' '}
            <code>policies/documentation/dat.yaml</code>{' '}
            {t(
              '— missing context becomes prompts in the rendered PDF rather than a refusal to render.',
              '— missing context becomes prompts in the rendered PDF rather than a refusal to render.',
            )}
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <PrimaryButton onClick={downloadDAT} disabled={busy}>
              <i className="ti ti-file-text" aria-hidden="true" />
              {busy ? 'Generating…' : 'Download DAT (PDF)'}
            </PrimaryButton>
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('What\'s inside', 'What\'s inside')}</CardTitle>
          <ul style={listStyle}>
            <li>{t('Cover page + table of contents.', 'Cover page + table of contents.')}</li>
            <li>{t('§ 1 Contexte & objectifs — project, business owners, drivers.', '§ 1 Contexte & objectifs — project, business owners, drivers.')}</li>
            <li>{t('§ 2 Périmètre — in-scope / out-of-scope statements.', '§ 2 Périmètre — in-scope / out-of-scope statements.')}</li>
            <li>{t('§ 3 Vue applicative — every registered application with criticality, GxP status, component/dependency counts.', '§ 3 Vue applicative — every registered application with criticality, GxP status, component/dependency counts.')}</li>
            <li>{t('§ 4 Vue infrastructure — site map (primary/DR/cloud), asset breakdown by type, total CI count.', '§ 4 Vue infrastructure — site map (primary/DR/cloud), asset breakdown by type, total CI count.')}</li>
            <li>{t('§ 5 Connecteurs — every catalog connector with category, outputs, and enabled state.', '§ 5 Connecteurs — every catalog connector with category, outputs, and enabled state.')}</li>
            <li>{t('§ 6 SLA & objectifs — RTO/RPO targets, availability, evidence freshness.', '§ 6 SLA & objectifs — RTO/RPO targets, availability, evidence freshness.')}</li>
            <li>{t('§ 7 Sécurité — signing algorithm, encryption at rest, key management, audit log posture.', '§ 7 Sécurité — signing algorithm, encryption at rest, key management, audit log posture.')}</li>
            <li>{t('§ 8 Conformité — every framework in scope and its control count.', '§ 8 Conformité — every framework in scope and its control count.')}</li>
            <li>{t('§ 9 Glossaire — operator-defined glossary of project-specific terms.', '§ 9 Glossaire — operator-defined glossary of project-specific terms.')}</li>
            <li>{t('§ 10 Références — applicable standards, regulations, internal procedures.', '§ 10 Références — applicable standards, regulations, internal procedures.')}</li>
          </ul>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Operator context (YAML)', 'Operator context (YAML)')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
            {t(
              'The platform reads',
              'The platform reads',
            )}{' '}
            <code>policies/documentation/dat.yaml</code>{' '}
            {t(
              'for the business-facing fields (project name, owners, validators, distribution list, version history, scope statements, SLA targets, security paragraphs, glossary, references). Edit it in the repository and redeploy to update the next generated PDF — there is no GUI editor for this content because it belongs in version control alongside the rest of your compliance configuration.',
              'for the business-facing fields (project name, owners, validators, distribution list, version history, scope statements, SLA targets, security paragraphs, glossary, references). Edit it in the repository and redeploy to update the next generated PDF — there is no GUI editor for this content because it belongs in version control alongside the rest of your compliance configuration.',
            )}
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {t(
              'Everything else (inventory counts, application/site/connector lists, framework scope, signing key id, generation timestamp) is auto-discovered from the running platform every time you click',
              'Everything else (inventory counts, application/site/connector lists, framework scope, signing key id, generation timestamp) is auto-discovered from the running platform every time you click',
            )}{' '}
            <strong>{t('Download DAT', 'Download DAT')}</strong>.
          </p>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Public endpoint', 'Public endpoint')}</CardTitle>
          <ul style={listStyle}>
            <li>
              <code>GET /v1/documentation/dat</code>{' '}
              {t(
                '— authenticated (reader, reporter, admin); returns the rendered PDF inline and records a',
                '— authenticated (reader, reporter, admin); returns the rendered PDF inline and records a',
              )}{' '}
              <code>docgen_dat_generated</code>{' '}
              {t('entry in the audit trail.', 'entry in the audit trail.')}
            </li>
          </ul>
        </Card>
      </div>
    </>
  )
}

const listStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-secondary)',
  lineHeight: 1.8,
  paddingLeft: 18,
  marginTop: 0,
  marginBottom: 0,
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
