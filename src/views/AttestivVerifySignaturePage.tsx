'use client';
// Evidence / Verify signature.
//
// Standalone signature verifier. The auditor — or anyone with a
// signed manifest — pastes the manifest JSON, hits Verify, and gets a
// pass/fail along with the kid that signed it. Verification runs in
// the browser via Web Crypto; the only network call is to
// /v1/public/keys to fetch the platform's public keys, which any
// origin can reach without authentication.
//
// Why this is a dedicated page and not just a panel on /evidence:
// auditors often arrive with a manifest blob from email, a pen-test
// report, or a customer support ticket. They need a clean,
// standalone form, not a feature inside the operator console.

import { useState } from 'react'

import {
  Badge,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  SignatureBox,
  Topbar,
} from '../components/AttestivUi'
import { loadPublicKeys, verifyManifest, type ManifestPayload, type VerifyResult } from '../lib/verify'

import { useI18n } from '../lib/i18n';

export function AttestivVerifySignaturePage() {
  const {
    t
  } = useI18n();

  const [input, setInput] = useState('')
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publicKeyCount, setPublicKeyCount] = useState<number | null>(null)

  async function verify() {
    setError(null)
    setResult(null)
    setBusy(true)
    try {
      let parsed: ManifestPayload
      try {
        parsed = JSON.parse(input) as ManifestPayload
      } catch {
        throw new Error('Pasted content is not valid JSON.')
      }
      const keys = await loadPublicKeys()
      setPublicKeyCount(keys.length)
      const outcome = await verifyManifest(parsed)
      setResult(outcome)
    } catch (err: any) {
      setError(err?.message ?? 'Verification failed')
    } finally {
      setBusy(false)
    }
  }

  function loadSample() {
    setInput(JSON.stringify(SAMPLE_MANIFEST, null, 2))
    setResult(null)
    setError(null)
  }

  return (
    <>
      <Topbar
        title={t('Verify signature', 'Verify signature')}
        right={
          <GhostButton onClick={loadSample}>
            <i className="ti ti-file-text" aria-hidden="true" />
            {t('Load sample', 'Load sample')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px', gap: 12 }}>
          <Card>
            <CardTitle>{t('Manifest JSON', 'Manifest JSON')}</CardTitle>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t(
                'Paste a signed manifest here (the JSON the auditor received)…',
                'Paste a signed manifest here (the JSON the auditor received)…'
              )}
              rows={18}
              style={{
                width: '100%',
                padding: '10px 12px',
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-background-primary)',
                color: 'var(--color-text-primary)',
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
              <PrimaryButton onClick={verify} disabled={!input.trim() || busy}>
                {busy ? (
                  <>
                    <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                    {t('Verifying…', 'Verifying…')}
                  </>
                ) : (
                  <>
                    <i className="ti ti-shield-check" aria-hidden="true" />
                    {t('Verify signature', 'Verify signature')}
                  </>
                )}
              </PrimaryButton>
              <GhostButton
                onClick={() => {
                  setInput('')
                  setResult(null)
                  setError(null)
                }}
                disabled={busy}
              >
                {t('Clear', 'Clear')}
              </GhostButton>
            </div>
          </Card>

          <div>
            <Card>
              <CardTitle>{t('Result', 'Result')}</CardTitle>
              {error ? (
                <Banner tone="red" icon="ti-alert-triangle" title={t('Could not verify', 'Could not verify')} detail={error} />
              ) : result ? (
                <ResultPanel result={result} publicKeyCount={publicKeyCount} />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
                  {t('Paste a manifest and click Verify.', 'Paste a manifest and click Verify.')}
                </div>
              )}
            </Card>

            <Card style={{ marginTop: 10 }}>
              <CardTitle>{t('How this works', 'How this works')}</CardTitle>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                <p style={{ margin: '0 0 8px' }}>
                  {t(
                    'Verification runs in your browser via Web Crypto. The only network call fetches Attestiv\'s public keys from',
                    'Verification runs in your browser via Web Crypto. The only network call fetches Attestiv\'s public keys from'
                  )} <code>/v1/public/keys</code> {t('— no authentication required.', '— no authentication required.')}
                </p>
                <p style={{ margin: 0 }}>
                  {t(
                    'A pass means the manifest was signed by the holder of the private key bound to',
                    'A pass means the manifest was signed by the holder of the private key bound to'
                  )} <code>kid</code> {t(
                    'and has not been modified since signing.',
                    'and has not been modified since signing.'
                  )}
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function ResultPanel({ result, publicKeyCount }: { result: VerifyResult; publicKeyCount: number | null }) {
  const {
    t
  } = useI18n();

  const verified = result.status === 'valid'
  const tone: 'green' | 'red' | 'amber' =
    result.status === 'valid' ? 'green' : result.status === 'invalid' ? 'red' : 'amber'
  const icon =
    result.status === 'valid'
      ? 'ti-circle-check'
      : result.status === 'invalid'
        ? 'ti-circle-x'
        : 'ti-alert-circle'
  const title =
    result.status === 'valid'
      ? 'Signature verified'
      : result.status === 'invalid'
        ? 'Signature did not match'
        : 'Verification unavailable in this browser'
  const detail = result.status === 'valid' ? '' : result.reason
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Banner tone={tone} icon={icon} title={title} detail={detail} />
      {verified && result.kid ? (
        <div style={{ fontSize: 12 }}>
          <SignatureBox label="kid" value={result.kid} />
        </div>
      ) : null}
      <div style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ color: 'var(--color-text-tertiary)' }}>{t('Algorithm', 'Algorithm')}</span>
        <Badge tone="navy">ed25519</Badge>
      </div>
      {publicKeyCount !== null ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {publicKeyCount} {t('public key', 'public key')}{publicKeyCount === 1 ? '' : 's'} {t(
            'loaded from /v1/public/keys (active + retired).',
            'loaded from /v1/public/keys (active + retired).'
          )}
        </div>
      ) : null}
    </div>
  );
}

function Banner({
  tone,
  icon,
  title,
  detail,
}: {
  tone: 'green' | 'red' | 'amber'
  icon: string
  title: string
  detail: string
}) {
  const palette = {
    green: { bg: 'var(--color-status-green-bg)', fg: 'var(--color-status-green-deep)' },
    red: { bg: 'var(--color-status-red-bg)', fg: 'var(--color-status-red-deep)' },
    amber: { bg: 'var(--color-status-amber-bg)', fg: 'var(--color-status-amber-text)' },
  }[tone]
  return (
    <div
      style={{
        background: palette.bg,
        color: palette.fg,
        borderRadius: 'var(--border-radius-md)',
        padding: '12px 14px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 18, marginTop: 1 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: detail ? 4 : 0 }}>{title}</div>
        {detail ? <div style={{ fontSize: 12 }}>{detail}</div> : null}
      </div>
    </div>
  )
}

const SAMPLE_MANIFEST = {
  manifest_id: 'mf-2026-05-08T14-22-19Z',
  tenant: 'acme',
  evidence: [],
  frameworks: ['soc2'],
  signature: 'kid-7f3a91e45c2b1d:MEYCIQDqK1y3PqT8mVu...',
  algorithm: 'ed25519',
}
