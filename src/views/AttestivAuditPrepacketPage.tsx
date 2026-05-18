'use client';
// Auditor pre-validation packet page — Audit ▸ Pre-packet.
//
// One-click download of a signed zip an operator hands an external
// auditor BEFORE the engagement starts. The auditor verifies it
// offline against the platform's public key, reads what passes vs
// what's in remediation, and arrives knowing which control rows to
// dig into. The packet itself is generated server-side by
// /v1/audit/prepacket; this page is the operator-facing wrapper.

import { useEffect, useState } from 'react'
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
import { apiFetch, apiJson } from '../lib/api'

import { useI18n } from '../lib/i18n';

type FrameworkSummary = { key: string; name?: string }
type FrameworksResponse = { frameworks: FrameworkSummary[] }

export function AttestivAuditPrepacketPage() {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastSize, setLastSize] = useState<number | null>(null)
  const [frameworks, setFrameworks] = useState<FrameworkSummary[]>([])
  const [framework, setFramework] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    apiJson<FrameworksResponse>('/config/frameworks').then((resp) => {
      if (!cancelled) setFrameworks(resp.frameworks || [])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  async function downloadPacket() {
    setBusy(true)
    setError(null)
    try {
      const query = framework ? `?framework=${encodeURIComponent(framework)}` : ''
      const response = await apiFetch(`/audit/prepacket${query}`)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `${response.status} ${response.statusText}`)
      }
      const blob = await response.blob()
      setLastSize(blob.size)
      const objectUrl = URL.createObjectURL(blob)
      const cd = response.headers.get('Content-Disposition') || ''
      const match = cd.match(/filename="?([^"]+)"?/)
      const filename = match?.[1] || `audit-prepacket-${new Date().toISOString().slice(0, 10)}.zip`
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate auditor packet')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Topbar
        title={t('Audit pre-packet', 'Audit pre-packet')}
        left={<Badge tone="navy">{t('signed', 'signed')}</Badge>}
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
            {t('Downloaded', 'Downloaded')} {formatBytes(lastSize)}. {t(
              'Share by email or your usual secure transfer; the auditor verifies it offline.',
              'Share by email or your usual secure transfer; the auditor verifies it offline.'
            )}
          </Banner>
        ) : null}

        <Banner tone="info" title={t('What an auditor pre-packet is for', 'What an auditor pre-packet is for')}>
          {t(
            'Give an external auditor a signed, point-in-time snapshot of the tenant\'s compliance posture BEFORE the engagement begins. The auditor verifies the packet offline, reads which controls pass vs which are in remediation, and arrives knowing where to focus the walkthrough. No live access to the platform required.',
            'Give an external auditor a signed, point-in-time snapshot of the tenant\'s compliance posture BEFORE the engagement begins. The auditor verifies the packet offline, reads which controls pass vs which are in remediation, and arrives knowing where to focus the walkthrough. No live access to the platform required.'
          )}
        </Banner>

        <Card>
          <CardTitle right={<Badge tone="navy">Ed25519</Badge>}>{t('Generate & download', 'Generate & download')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
            {t(
              'Select an optional framework filter to narrow the packet to a single audit scope (e.g. DORA only). Leave blank to include every framework the tenant is subscribed to.',
              'Select an optional framework filter to narrow the packet to a single audit scope (e.g. DORA only). Leave blank to include every framework the tenant is subscribed to.'
            )}
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <label style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t('Framework', 'Framework')}
            </label>
            <select
              value={framework}
              onChange={(e) => setFramework(e.target.value)}
              style={{
                fontSize: 12,
                padding: '6px 10px',
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-background-primary)',
                color: 'var(--color-text-primary)',
                fontFamily: 'inherit',
                minWidth: 180,
              }}
            >
              <option value="">{t('All frameworks', 'All frameworks')}</option>
              {frameworks.map((fw) => (
                <option key={fw.key} value={fw.key}>{fw.name || fw.key}</option>
              ))}
            </select>
            <div style={{ flex: 1 }} />
            <PrimaryButton onClick={downloadPacket} disabled={busy}>
              <i className="ti ti-file-zip" aria-hidden="true" />
              {busy ? t('Generating…', 'Generating…') : t('Download packet', 'Download packet')}
            </PrimaryButton>
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('What\'s inside', 'What\'s inside')}</CardTitle>
          <ul style={listStyle}>
            <li><code>manifest.json</code> — {t('signed inventory of every file + SHA256.', 'signed inventory of every file + SHA256.')}</li>
            <li><code>signature.txt</code> — {t('Ed25519 signature over', 'Ed25519 signature over')} <code>manifest.json</code>.</li>
            <li><code>public_keys.json</code> — {t('active + previous platform keys so the auditor can verify offline.', 'active + previous platform keys so the auditor can verify offline.')}</li>
            <li><code>framework_summary.json</code> — {t('per-framework score, status, and control counts.', 'per-framework score, status, and control counts.')}</li>
            <li><code>controls.csv</code> — {t('flat control-by-control table — one row per control with status, score, evidence count.', 'flat control-by-control table — one row per control with status, score, evidence count.')}</li>
            <li><code>gaps.csv</code> — {t('only non-passing controls, with the finding code + remediation hint.', 'only non-passing controls, with the finding code + remediation hint.')}</li>
            <li><code>remediation_open.json</code> — {t('open and in-progress remediation tasks tied to those gaps.', 'open and in-progress remediation tasks tied to those gaps.')}</li>
            <li><code>README.md</code> — {t('verification instructions + "what to ask for next" playbook for the auditor.', 'verification instructions + "what to ask for next" playbook for the auditor.')}</li>
          </ul>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('What\'s deliberately NOT included', 'What\'s deliberately NOT included')}</CardTitle>
          <ul style={listStyle}>
            <li>{t('Raw evidence content — logs, configurations, screenshots. The auditor uses control IDs from gaps.csv as the index into a live walkthrough.', 'Raw evidence content — logs, configurations, screenshots. The auditor uses control IDs from gaps.csv as the index into a live walkthrough.')}</li>
            <li>{t('Connector credentials, endpoint URLs, secrets.', 'Connector credentials, endpoint URLs, secrets.')}</li>
            <li>{t('Actor identities or PII from the audit log.', 'Actor identities or PII from the audit log.')}</li>
            <li>{t('Other tenants\' data. The packet is scoped to the X-Tenant-ID header on the request.', 'Other tenants\' data. The packet is scoped to the X-Tenant-ID header on the request.')}</li>
          </ul>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('How the auditor verifies', 'How the auditor verifies')}</CardTitle>
          <ol style={{ ...listStyle, paddingLeft: 20 }}>
            <li>{t('Extract the zip.', 'Extract the zip.')}</li>
            <li>{t('Compute SHA256 of each file (except manifest.json and signature.txt) and confirm it matches the entry in manifest.json.', 'Compute SHA256 of each file (except manifest.json and signature.txt) and confirm it matches the entry in manifest.json.')}</li>
            <li>{t('Take the active=true public key from public_keys.json and verify signature.txt\'s signature value against the bytes of manifest.json.', 'Take the active=true public key from public_keys.json and verify signature.txt\'s signature value against the bytes of manifest.json.')}</li>
            <li>{t('If both check out, the packet is intact and produced by the platform at the manifest\'s generated_at timestamp.', 'If both check out, the packet is intact and produced by the platform at the manifest\'s generated_at timestamp.')}</li>
          </ol>
        </Card>
      </div>
    </>
  );
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
