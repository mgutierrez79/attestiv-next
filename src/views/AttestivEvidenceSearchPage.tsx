'use client';
// Evidence / Search.
//
// Lookup by evidence ID, run ID, framework, or free-text. The Live
// stream is the always-on view; this is the targeted lookup. Both
// hit /v1/evidence/log; this page just adds query params and a
// keyboard-friendly form.

import { type FormEvent, useState } from 'react'



import {
  Badge,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  SignatureBox,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n';

type EvidenceHit = {
  evidence_id: string
  kind: string
  title: string
  source?: string
  event?: string
  timestamp?: string
  signature?: string
  signature_status?: 'signed' | 'dlq' | 'retrying' | 'unknown'
  frameworks?: string[]
  run_id?: string
  finding_count?: number
  risk_score?: number
  run_hash?: string
  raw: any
}

const STATUS_TONE: Record<NonNullable<EvidenceHit['signature_status']>, 'green' | 'red' | 'amber' | 'gray'> = {
  signed: 'green',
  dlq: 'red',
  retrying: 'amber',
  unknown: 'gray',
}

// describeEvidence turns an evidence record's raw fields into a one-
// line human title. Today the pilot emits two shapes:
//   1. Run summaries (run_id + frameworks + finding_count + risk_score)
//   2. Connector evidence (asset_type, action, vm_name, etc.)
// Keep the matcher loose so unknown shapes still render a sensible
// title rather than a hex blob.
function describeEvidence(item: any): { kind: string; title: string } {
  if (!item || typeof item !== 'object') {
    return { kind: 'unknown', title: 'Evidence record' }
  }
  // Run summary
  if (item.run_id && (Array.isArray(item.frameworks) || typeof item.risk_score === 'number')) {
    const frameworks = Array.isArray(item.frameworks) && item.frameworks.length
      ? item.frameworks.join(', ').toUpperCase()
      : 'all frameworks'
    const findings = Number.isFinite(item.finding_count) ? Number(item.finding_count) : 0
    const controlFails = Number.isFinite(item.control_fail_count) ? Number(item.control_fail_count) : 0
    const risk = Number.isFinite(item.risk_score) ? Number(item.risk_score) : 0
    const findingsLabel = findings === 1 ? '1 finding' : `${findings} findings`
    const controlFailLabel = controlFails > 0
      ? ` · ${controlFails === 1 ? '1 failing control' : `${controlFails} failing controls`}`
      : ''
    return {
      kind: 'run_report',
      title: `Run report — ${frameworks} · ${findingsLabel}${controlFailLabel} · risk ${risk}`,
    }
  }
  // Connector / asset evidence
  const action = typeof item.action === 'string' ? item.action : ''
  const assetType = typeof item.asset_type === 'string' ? item.asset_type : ''
  const subject = typeof item.vm_name === 'string'
    ? item.vm_name
    : typeof item.asset_id === 'string'
      ? item.asset_id
      : ''
  if (action || assetType) {
    const verb = action || 'observed'
    const obj = assetType || 'asset'
    return {
      kind: assetType || action || 'event',
      title: subject ? `${verb} · ${obj} · ${subject}` : `${verb} · ${obj}`,
    }
  }
  // Fallback: use event/name/message if present, else evidence_id
  if (typeof item.event === 'string' && item.event) {
    return { kind: 'event', title: item.event }
  }
  if (typeof item.name === 'string' && item.name) {
    return { kind: 'event', title: item.name }
  }
  if (typeof item.message === 'string' && item.message) {
    return { kind: 'event', title: item.message }
  }
  return { kind: 'unknown', title: String(item.evidence_id ?? item.id ?? 'Evidence record') }
}

export function AttestivEvidenceSearchPage() {
  const {
    t
  } = useI18n();

  const [query, setQuery] = useState('')
  const [framework, setFramework] = useState('')
  const [results, setResults] = useState<EvidenceHit[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function search(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)
    setSearched(true)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set('q', query.trim())
      if (framework.trim()) params.set('framework', framework.trim())
      params.set('limit', '50')
      const response = await apiFetch(`/evidence/log?${params.toString()}`)
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const body = await response.json().catch(() => ({}))
      const items: any[] = Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : []
      const mapped: EvidenceHit[] = items.map((item) => {
        // The on-disk evidence log uses `report_signature` (Ed25519 hex
        // hash) and stashes the connector source under metadata.source.
        // Fall through to the legacy top-level fields if a future
        // emitter does add them so the row still renders right.
        const signature: string | undefined =
          (typeof item?.signature === 'string' && item.signature) ||
          (typeof item?.report_signature === 'string' && item.report_signature) ||
          undefined
        const source: string | undefined =
          (typeof item?.source === 'string' && item.source) ||
          (typeof item?.metadata?.source === 'string' && item.metadata.source) ||
          (typeof item?.metadata?.connectors === 'string' && item.metadata.connectors) ||
          undefined
        const described = describeEvidence(item)
        return {
          evidence_id: String(item?.evidence_id ?? item?.id ?? item?.run_id ?? ''),
          kind: described.kind,
          title: described.title,
          source,
          event: item?.event ?? item?.name,
          timestamp: item?.timestamp ?? item?.created_at,
          signature,
          signature_status: item?.signature_status ?? (signature ? 'signed' : 'unknown'),
          frameworks: Array.isArray(item?.frameworks) ? item.frameworks : undefined,
          run_id: item?.run_id,
          finding_count: typeof item?.finding_count === 'number' ? item.finding_count : undefined,
          risk_score: typeof item?.risk_score === 'number' ? item.risk_score : undefined,
          run_hash: typeof item?.run_hash === 'string' ? item.run_hash : undefined,
          raw: item,
        }
      })
      setResults(mapped)
    } catch (err: any) {
      setError(err?.message ?? 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <Topbar
        title={t('Search evidence', 'Search evidence')}
        right={
          <GhostButton onClick={() => undefined}>
            <i className="ti ti-list" aria-hidden="true" />
            {t('Live stream', 'Live stream')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        <Card>
          <CardTitle>{t('Search', 'Search')}</CardTitle>
          <form onSubmit={search}>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 200px auto', gap: 8, alignItems: 'end' }}>
              <div>
                <label style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
                  {t('Evidence ID, run, source, or text', 'Evidence ID, run, source, or text')}
                </label>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('e.g. ev-2026-05-08-...', 'e.g. ev-2026-05-08-...')}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 13,
                    border: '0.5px solid var(--color-border-secondary)',
                    borderRadius: 'var(--border-radius-md)',
                    background: 'var(--color-background-primary)',
                    outline: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 4 }}>
                  {t('Framework', 'Framework')}
                </label>
                <input
                  value={framework}
                  onChange={(event) => setFramework(event.target.value)}
                  placeholder={t('soc2 / iso27001 / ...', 'soc2 / iso27001 / ...')}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    fontSize: 13,
                    border: '0.5px solid var(--color-border-secondary)',
                    borderRadius: 'var(--border-radius-md)',
                    background: 'var(--color-background-primary)',
                    outline: 'none',
                    fontFamily: 'inherit',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <PrimaryButton type="submit" disabled={loading}>
                {loading ? (
                  <>
                    <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                    {t('Searching…', 'Searching…')}
                  </>
                ) : (
                  <>
                    <i className="ti ti-search" aria-hidden="true" />
                    {t('Search', 'Search')}
                  </>
                )}
              </PrimaryButton>
            </div>
          </form>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{results.length} matches</span>}>
            {t('Results', 'Results')}
          </CardTitle>
          {error ? (
            <div
              style={{
                fontSize: 12,
                color: 'var(--color-status-red-deep)',
                background: 'var(--color-status-red-bg)',
                padding: '8px 12px',
                borderRadius: 'var(--border-radius-md)',
                marginBottom: 8,
              }}
            >
              {error}
            </div>
          ) : null}
          {!searched ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t(
                'Enter a query to search the evidence log. Filters narrow by framework or run.',
                'Enter a query to search the evidence log. Filters narrow by framework or run.'
              )}
            </div>
          ) : results.length === 0 && !loading ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No evidence matches.', 'No evidence matches.')}</div>
          ) : (
            <div>
              {results.map((hit) => (
                <EvidenceHitRow key={hit.evidence_id} hit={hit} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function EvidenceHitRow({ hit }: { hit: EvidenceHit }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      style={{
        padding: '12px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>
          {hit.title}
        </span>
        {hit.signature_status ? <Badge tone={STATUS_TONE[hit.signature_status]}>{hit.signature_status}</Badge> : null}
        {hit.source ? <Badge tone="navy">{hit.source}</Badge> : null}
        {hit.frameworks?.map((framework) => (
          <Badge key={framework} tone="blue">
            {framework}
          </Badge>
        ))}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {hit.timestamp ? formatTimestamp(hit.timestamp) : '—'}
        </span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {hit.evidence_id ? (
          <span style={{ fontFamily: 'var(--font-mono)' }}>{hit.evidence_id}</span>
        ) : null}
        {hit.signature ? (
          <span title={hit.signature}>
            Ed25519 · {hit.signature.slice(0, 12)}…
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--color-text-link, var(--color-brand-blue))',
            cursor: 'pointer',
            padding: 0,
            fontSize: 11,
            fontFamily: 'inherit',
          }}
        >
          {expanded ? '− hide details' : '+ details'}
        </button>
      </div>
      {hit.event ? <div style={{ color: 'var(--color-text-secondary)' }}>{hit.event}</div> : null}
      {expanded ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {hit.signature ? <SignatureBox label="signature" value={hit.signature} /> : null}
          {hit.run_hash ? <SignatureBox label="run_hash" value={hit.run_hash} /> : null}
          <pre
            style={{
              background: 'var(--color-surface-secondary, #f7f7fa)',
              padding: '8px 10px',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'var(--font-mono)',
              overflowX: 'auto',
              maxHeight: 240,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              margin: 0,
            }}
          >
            {JSON.stringify(hit.raw, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

function formatTimestamp(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}
