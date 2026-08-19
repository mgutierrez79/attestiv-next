'use client';
// Audit / Manifests browser.
//
// Lists every signed compliance manifest the tenant has produced.
// Each manifest is a digest of (run, evidence list, framework
// scores) signed with the platform's Ed25519 key. Auditors come here
// to download a manifest + matching public key, then verify offline.
//
// Backed by /v1/runs — every run has a manifest_path and signature
// in the run summary. We map runs into a manifest-centric view so
// the auditor doesn't have to know about the run/manifest split.

import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PrimaryButton,
  SignatureBox,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { isDemoMode } from '../lib/demoMode'
import { formatTimestamp } from '../lib/time'

import { useI18n } from '../lib/i18n';

type ManifestRow = {
  run_id: string
  timestamp: string
  risk_score?: number
  overall_risk?: string
  manifest_path?: string
  signature?: string
  evidence_count?: number
  finding_count?: number
  frameworks?: string[]
}

// ManifestDoc is the shape of GET /v1/runs/{run_id}/manifest — the
// signed manifest itself plus the server's own verification verdict.
// Everything an auditor needs to carry to an offline verifier lives
// here: the Ed25519 signature, the key id, and the integrity anchors
// (hashes of the evidence log, inputs, outputs, analytics) the
// signature covers.
type ManifestDoc = {
  run_id: string
  manifest: {
    run_id?: string
    timestamp?: string
    kid?: string
    signature?: string
    language?: string
    run_contract_version?: string
    integrity?: Record<string, unknown>
    integrity_anchors?: Record<string, string>
    artifact_hashes?: Record<string, string>
    inputs?: { hash?: string; sources?: unknown[] }
    [key: string]: unknown
  }
  signature_status?: { enabled?: boolean; present?: boolean; valid?: boolean; expected?: string | null }
}

function downloadJSON(filename: string, payload: unknown) {
  if (typeof window === 'undefined') return
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const DEMO: ManifestRow[] = [
  {
    run_id: 'run-2026-05-08T14-22-19Z',
    timestamp: '2026-05-08T14:22:19.103Z',
    risk_score: 92,
    overall_risk: 'low',
    evidence_count: 1247,
    frameworks: ['SOC 2', 'ISO 27001'],
    signature: 'kid-7f3a91e45c2b1d:MEYCIQDqK1y3PqT8mVu6XkW...',
    manifest_path: '/manifests/2026-05-08T14-22-19Z.json',
  },
  {
    run_id: 'run-2026-05-07T14-22-12Z',
    timestamp: '2026-05-07T14:22:12.000Z',
    risk_score: 91,
    overall_risk: 'low',
    evidence_count: 1238,
    frameworks: ['SOC 2', 'ISO 27001'],
    signature: 'kid-7f3a91e45c2b1d:MEUCIQDqXKlLD3wjfA8R...',
    manifest_path: '/manifests/2026-05-07T14-22-12Z.json',
  },
  {
    run_id: 'run-2026-05-06T14-22-04Z',
    timestamp: '2026-05-06T14:22:04.000Z',
    risk_score: 88,
    overall_risk: 'medium',
    evidence_count: 1219,
    frameworks: ['SOC 2', 'ISO 27001', 'PCI DSS'],
    signature: 'kid-7f3a91e45c2b1d:MEUCIBpO0o5q2tkPbR9...',
    manifest_path: '/manifests/2026-05-06T14-22-04Z.json',
  },
]

export function AttestivManifestsPage() {
  const {
    t
  } = useI18n();

  const [rows, setRows] = useState<ManifestRow[]>([])
  const [loading, setLoading] = useState(true)
  const [usingDemo, setUsingDemo] = useState(false)
  const [selected, setSelected] = useState<ManifestRow | null>(null)

  useEffect(() => {
    let cancelled = false
    const allowDemo = isDemoMode()
    async function load() {
      try {
        const response = await apiFetch('/runs?limit=50')
        if (!response.ok) throw new Error(`${response.status}`)
        const body = await response.json().catch(() => ({}))
        const items: any[] = Array.isArray(body?.items) ? body.items : []
        const mapped: ManifestRow[] = items.map((item) => ({
          run_id: String(item?.run_id ?? ''),
          timestamp: String(item?.timestamp ?? ''),
          risk_score: typeof item?.risk_score === 'number' ? item.risk_score : undefined,
          overall_risk: typeof item?.overall_risk === 'string' ? item.overall_risk : undefined,
          manifest_path: item?.path ?? undefined,
          signature: item?.summary?.signature ?? undefined,
          evidence_count: item?.summary?.evidence_count ?? undefined,
          finding_count: typeof item?.summary?.finding_count === 'number' ? item.summary.finding_count : undefined,
          frameworks: Array.isArray(item?.summary?.frameworks) ? item.summary.frameworks : undefined,
        }))
        if (!cancelled) {
          if (mapped.length > 0) {
            setRows(mapped)
            setSelected(mapped[0])
            setUsingDemo(false)
          } else if (allowDemo) {
            setRows(DEMO)
            setSelected(DEMO[0])
            setUsingDemo(true)
          } else {
            setRows([])
            setSelected(null)
            setUsingDemo(false)
          }
        }
      } catch {
        if (!cancelled) {
          if (allowDemo) {
            setRows(DEMO)
            setSelected(DEMO[0])
            setUsingDemo(true)
          } else {
            setRows([])
            setSelected(null)
            setUsingDemo(false)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Topbar
        title={t('Signed manifests', 'Signed manifests')}
        left={usingDemo ? <Badge tone="amber">{t('Demo data — no signed runs yet', 'Demo data — no signed runs yet')}</Badge> : null}
        right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('{n} manifests', '{n} manifests', { n: rows.length })}</span>}
      />
      <div className="attestiv-content">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 12 }}>
          <Card>
            <CardTitle>{t('Recent runs', 'Recent runs')}</CardTitle>
            {loading ? (
              <Skeleton lines={4} height={30} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon="ti-file-certificate"
                title="No signed runs yet"
                description="A manifest is written and Ed25519-signed every time a report run completes (the report scheduler, or Frameworks › Generate report). Until then there is nothing to verify here."
              />
            ) : (
              <div>
                {rows.map((row) => (
                  <button
                    key={row.run_id}
                    type="button"
                    onClick={() => setSelected(row)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 2fr) 100px 80px',
                      gap: 12,
                      padding: '10px 6px',
                      borderBottom: '0.5px solid var(--color-border-tertiary)',
                      background: selected?.run_id === row.run_id ? 'var(--color-status-blue-bg)' : 'transparent',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      fontSize: 12,
                      color: 'var(--color-text-primary)',
                      alignItems: 'center',
                    }}
                  >
                    <div style={{ overflow: 'hidden' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {row.run_id || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        {formatTimestamp(row.timestamp)}
                      </div>
                    </div>
                    <Badge tone={riskTone(row.overall_risk)}>{row.overall_risk ?? 'unknown'}</Badge>
                    <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textAlign: 'right' }}>
                      {typeof row.finding_count === 'number'
                        ? t('{n} findings', '{n} findings', { n: row.finding_count })
                        : typeof row.evidence_count === 'number'
                          ? t('{n} evidence', '{n} evidence', { n: row.evidence_count })
                          : '—'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Card>

          <div>
            <Card>
              <CardTitle>{t('Manifest detail', 'Manifest detail')}</CardTitle>
              {selected ? (
                <ManifestDetail row={selected} demo={usingDemo} />
              ) : (
                <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Select a manifest.', 'Select a manifest.')}</div>
              )}
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function ManifestDetail({ row, demo }: { row: ManifestRow; demo: boolean }) {
  const {
    t
  } = useI18n();
  const [doc, setDoc] = useState<ManifestDoc | null>(null)
  const [docError, setDocError] = useState<string | null>(null)
  const [docLoading, setDocLoading] = useState(false)

  // Pull the real signed manifest for the selected run. /v1/runs only
  // carries the run summary; the signature, kid and integrity anchors
  // live in the manifest document — which is exactly what the auditor
  // needs to see and carry away.
  useEffect(() => {
    if (demo || !row.run_id) {
      setDoc(null)
      return
    }
    let cancelled = false
    setDocLoading(true)
    setDocError(null)
    apiFetch(`/runs/${encodeURIComponent(row.run_id)}/manifest`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? t('Manifest file not found on this node (run {id}).', 'Manifest file not found on this node (run {id}).', { id: row.run_id })
              : t('Manifest request failed ({status}).', 'Manifest request failed ({status}).', { status: response.status }),
          )
        }
        return (await response.json()) as ManifestDoc
      })
      .then((body) => {
        if (!cancelled) setDoc(body)
      })
      .catch((err: unknown) => {
        if (!cancelled) setDocError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setDocLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [row.run_id, demo, t])

  const manifest = doc?.manifest
  const integrity = (manifest?.integrity ?? {}) as Record<string, unknown>
  const kid = String(manifest?.kid ?? integrity.kid ?? '') || undefined
  const signature = String(manifest?.signature ?? integrity.signature ?? row.signature ?? '') || undefined
  const algorithm = signature ? (kid ? 'Ed25519' : 'HMAC-SHA256 (legacy)') : undefined
  const status = doc?.signature_status
  const anchors: Array<[string, string]> = Object.entries(manifest?.integrity_anchors ?? {})
    .filter(([, v]) => typeof v === 'string' && v)
    .map(([k, v]) => [k, String(v)])
  const artifacts: Array<[string, string]> = Object.entries(manifest?.artifact_hashes ?? {}).map(([k, v]) => [k, String(v)])
  const sectionLabel: CSSProperties = {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--color-text-tertiary)',
    fontWeight: 600,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
      <KV label={t('Run', 'Run')} value={row.run_id} mono />
      <KV label={t('Signed at', 'Signed at')} value={formatTimestamp(manifest?.timestamp ?? row.timestamp)} mono />
      {row.risk_score !== undefined ? <KV label={t('Risk score', 'Risk score')} value={String(row.risk_score)} /> : null}
      {typeof row.finding_count === 'number' ? <KV label={t('Findings', 'Findings')} value={String(row.finding_count)} /> : null}
      {row.evidence_count !== undefined ? <KV label={t('Evidence count', 'Evidence count')} value={String(row.evidence_count)} /> : null}
      {row.frameworks ? <KV label={t('Frameworks', 'Frameworks')} value={row.frameworks.join(', ')} /> : null}
      {manifest?.run_contract_version ? <KV label={t('Run contract', 'Run contract')} value={`v${manifest.run_contract_version}`} mono /> : null}

      {docLoading ? <Skeleton lines={3} height={28} /> : null}
      {docError ? <Banner tone="warning">{docError}</Banner> : null}

      {signature || kid ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={sectionLabel}>{t('Signature', 'Signature')}</span>
            {status ? (
              status.valid ? (
                <Badge tone="green" icon="ti-shield-check">{t('verified on server', 'verified on server')}</Badge>
              ) : status.present ? (
                <Badge tone="red" icon="ti-shield-x">{t('signature does not verify', 'signature does not verify')}</Badge>
              ) : (
                <Badge tone="amber" icon="ti-shield-off">{t('unsigned', 'unsigned')}</Badge>
              )
            ) : null}
            {algorithm ? <Badge tone="gray">{algorithm}</Badge> : null}
          </div>
          {kid ? <SignatureBox label={t('Key id', 'Key id')} value={kid} /> : null}
          {signature ? <SignatureBox label={t('Signature', 'Signature')} value={signature} /> : null}
        </div>
      ) : !docLoading && !demo ? (
        <Banner tone="warning" title={t('No signature on this manifest', 'No signature on this manifest')}>
          {t(
            'The run completed but its manifest carries no Ed25519 signature. Check the signing key configuration under Settings › API keys before relying on this run.',
            'The run completed but its manifest carries no Ed25519 signature. Check the signing key configuration under Settings › API keys before relying on this run.',
          )}
        </Banner>
      ) : null}

      {anchors.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <span style={sectionLabel}>
            {t('Integrity anchors (SHA-256, covered by the signature)', 'Integrity anchors (SHA-256, covered by the signature)')}
          </span>
          {anchors.map(([name, hash]) => (
            <SignatureBox key={name} label={name} value={hash} />
          ))}
        </div>
      ) : null}

      {artifacts.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          <span style={sectionLabel}>{t('Artifact hashes', 'Artifact hashes')}</span>
          {artifacts.map(([name, hash]) => (
            <SignatureBox key={name} label={name} value={hash} />
          ))}
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <PrimaryButton
          disabled={demo || !doc}
          onClick={() => {
            if (doc) downloadJSON(`${row.run_id}.manifest.json`, doc.manifest)
          }}
        >
          <i className="ti ti-file-download" aria-hidden="true" />
          {t('Download manifest', 'Download manifest')}
        </PrimaryButton>
        <GhostButton
          disabled={demo}
          onClick={() => {
            // /v1/public/keys returns the full ring (active + retired) keyed
            // by kid — exactly what an offline verifier wants, since a packet
            // signed before a rotation must still verify after it.
            void apiFetch('/public/keys')
              .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
              .then((keys) => downloadJSON('attestiv-public-keys.json', keys))
              .catch(() => setDocError(t('Public key download failed.', 'Public key download failed.')))
          }}
        >
          <i className="ti ti-key" aria-hidden="true" />
          {t('Public key', 'Public key')}
        </GhostButton>
      </div>
      <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', margin: '4px 0 0', lineHeight: 1.5 }}>
        {t(
          'Verify offline: download both files, then run attestiv-verify against the manifest with the public key — no network and no Attestiv service involved. /v1/public/keys is also served unauthenticated for auditors without console access.',
          'Verify offline: download both files, then run attestiv-verify against the manifest with the public key — no network and no Attestiv service involved. /v1/public/keys is also served unauthenticated for auditors without console access.',
        )}
      </p>
      {row.manifest_path ? <KV label={t('Server path', 'Server path')} value={row.manifest_path} mono /> : null}
    </div>
  );
}

function KV({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span
        style={{
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          fontWeight: 500,
          textAlign: 'right',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  )
}

function riskTone(risk?: string): 'green' | 'amber' | 'red' | 'gray' {
  switch ((risk ?? '').toLowerCase()) {
    case 'low':
      return 'green'
    case 'medium':
      return 'amber'
    case 'high':
    case 'critical':
      return 'red'
    default:
      return 'gray'
  }
}
