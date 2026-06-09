'use client'
// W1-2 Connector-coverage attestation.
//
// What this page answers, for an auditor: "if connector X goes down,
// which controls become no_data?" — and the inverse — "which controls
// have no connector backing at all and so cannot be measured?". The
// backend builds the map by walking the connector catalog's declared
// Outputs and resolving them against the control library via the same
// crosswalk function the engine uses. The map is signed (Ed25519) so
// an auditor can verify it came from this platform.

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  HeroBand,
  PrimaryButton,
  Skeleton,
  StatPill,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type CrosswalkHit = {
  framework_id: string
  framework_name: string
  control_id: string
  control_name: string
  control_area?: string
  weight: number
  matched_tag: string
}

type EvidenceMapping = {
  evidence_type: string
  controls: CrosswalkHit[]
}

type ConnectorEntry = {
  name: string
  label: string
  category?: string
  enabled: boolean
  outputs: string[]
  evidence_mappings: EvidenceMapping[]
  controls_supported: number
}

type Gap = {
  framework_id: string
  framework_name: string
  control_id: string
  control_name: string
  control_area?: string
  weight: number
  required_tags?: string[]
}

type Attestation = {
  bundle_type: string
  tenant_id?: string
  generated_at: string
  connectors: ConnectorEntry[]
  controls_without_connector_coverage: Gap[]
  summary: {
    connectors_total: number
    connectors_enabled: number
    controls_total: number
    controls_with_coverage: number
    controls_without: number
  }
  signature?: { algorithm: string; key_id?: string; value: string }
}

export function AttestivConnectorCoveragePage() {
  const { t } = useI18n()
  const [data, setData] = useState<Attestation | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const r = await apiFetch('/connectors/coverage')
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        const body = (await r.json()) as Attestation
        if (!cancelled) setData(body)
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load coverage')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  function downloadAttestation() {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `connector-coverage-${new Date(data.generated_at).toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const enabledConnectors = useMemo(() => (data?.connectors ?? []).filter((c) => c.enabled), [data])
  const disabledConnectors = useMemo(() => (data?.connectors ?? []).filter((c) => !c.enabled), [data])
  const coveragePct = useMemo(() => {
    if (!data || data.summary.controls_total === 0) return 0
    return Math.round((data.summary.controls_with_coverage / data.summary.controls_total) * 100)
  }, [data])

  return (
    <>
      <Topbar
        title={t('Connector coverage attestation', 'Connector coverage attestation')}
        left={data?.signature ? <Badge tone="green">{t('signed', 'signed')}</Badge> : null}
        right={
          <PrimaryButton onClick={downloadAttestation} disabled={!data}>
            <i className="ti ti-download" aria-hidden="true" /> {t('Download signed JSON', 'Download signed JSON')}
          </PrimaryButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        {!loading && data ? (
          <HeroBand
            label={t('Controls with connector backing', 'Controls with connector backing')}
            value={`${coveragePct}%`}
            percent={coveragePct}
            caption={
              data.summary.controls_total > 0
                ? `${data.summary.controls_with_coverage} ${t('of', 'of')} ${data.summary.controls_total} ${t('controls — others can\'t be measured', 'controls — others can\'t be measured')}`
                : t('No controls loaded', 'No controls loaded')
            }
            pills={
              <>
                <StatPill label={t('Connectors enabled', 'Connectors enabled')} value={`${data.summary.connectors_enabled}/${data.summary.connectors_total}`} />
                <StatPill
                  label={t('Without coverage', 'Without coverage')}
                  value={String(data.summary.controls_without)}
                  valueColor={data.summary.controls_without > 0 ? 'var(--color-status-red-deep)' : 'var(--color-status-green-deep)'}
                />
                <StatPill
                  label={t('Generated', 'Generated')}
                  value={new Date(data.generated_at).toLocaleTimeString()}
                />
              </>
            }
          />
        ) : null}

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={enabledConnectors.length > 0 ? <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('expand to see controls', 'expand to see controls')}</span> : null}>
            {t('Enabled connectors → controls', 'Enabled connectors → controls')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={5} height={48} />
          ) : enabledConnectors.length === 0 ? (
            <EmptyState
              icon="ti-plug-off"
              title={t('No connectors enabled', 'No connectors enabled')}
              description={t(
                'Until at least one connector is enabled, every control will lack a connector backing.',
                'Until at least one connector is enabled, every control will lack a connector backing.',
              )}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {enabledConnectors.map((c) => (
                <ConnectorRow key={c.name} connector={c} expanded={expanded === c.name} onToggle={() => setExpanded(expanded === c.name ? null : c.name)} />
              ))}
            </div>
          )}
        </Card>

        {data && data.controls_without_connector_coverage.length > 0 ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle right={<Badge tone="red">{data.controls_without_connector_coverage.length}</Badge>}>
              {t('Controls without any connector backing', 'Controls without any connector backing')}
            </CardTitle>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
              {t(
                'These controls have no enabled connector producing the evidence types their requirements need. They will remain no_data until a covering connector is enabled or the control is exempted.',
                'These controls have no enabled connector producing the evidence types their requirements need. They will remain no_data until a covering connector is enabled or the control is exempted.',
              )}
            </p>
            <GapsTable gaps={data.controls_without_connector_coverage} />
          </Card>
        ) : null}

        {disabledConnectors.length > 0 ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle right={<Badge tone="gray">{disabledConnectors.length}</Badge>}>
              {t('Available but not enabled', 'Available but not enabled')}
            </CardTitle>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: '0 0 8px' }}>
              {t(
                'These connectors are in the catalog but not currently feeding evidence to this tenant. Enabling them would expand coverage to the controls listed below.',
                'These connectors are in the catalog but not currently feeding evidence to this tenant. Enabling them would expand coverage to the controls listed below.',
              )}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {disabledConnectors.map((c) => (
                <ConnectorRow key={c.name} connector={c} expanded={expanded === c.name} onToggle={() => setExpanded(expanded === c.name ? null : c.name)} />
              ))}
            </div>
          </Card>
        ) : null}

        {data?.signature ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle>{t('Attestation signature', 'Attestation signature')}</CardTitle>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 4, fontFamily: 'var(--font-mono, monospace)' }}>
              <div><strong>{t('algorithm', 'algorithm')}:</strong> {data.signature.algorithm}</div>
              {data.signature.key_id ? <div><strong>key_id:</strong> {data.signature.key_id}</div> : null}
              <div style={{ wordBreak: 'break-all' }}><strong>{t('signature', 'signature')}:</strong> {data.signature.value}</div>
            </div>
            <div style={{ marginTop: 8 }}>
              <GhostButton
                onClick={() => {
                  if (data.signature?.value) navigator.clipboard.writeText(data.signature.value).catch(() => undefined)
                }}
              >
                <i className="ti ti-copy" aria-hidden="true" /> {t('Copy signature', 'Copy signature')}
              </GhostButton>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  )
}

function ConnectorRow({ connector, expanded, onToggle }: { connector: ConnectorEntry; expanded: boolean; onToggle: () => void }) {
  const { t } = useI18n()
  const hasMappings = connector.evidence_mappings && connector.evidence_mappings.length > 0
  return (
    <div
      style={{
        background: 'var(--color-background-secondary)',
        borderRadius: 'var(--border-radius-sm)',
        padding: '10px 12px',
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.5fr) auto auto auto',
          gap: 12,
          alignItems: 'center',
          cursor: 'pointer',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {connector.label || connector.name}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            {connector.name}
            {connector.category ? ` · ${connector.category}` : ''}
          </div>
        </div>
        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
          {connector.outputs.length} {t('evidence types', 'evidence types')}
        </span>
        <Badge tone={connector.enabled ? 'green' : 'gray'}>
          {connector.controls_supported} {t('controls', 'controls')}
        </Badge>
        <i className={`ti ${expanded ? 'ti-chevron-up' : 'ti-chevron-down'}`} aria-hidden="true" style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }} />
      </div>
      {expanded ? (
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--color-border-secondary)' }}>
          {hasMappings ? (
            connector.evidence_mappings.map((mapping) => (
              <div key={mapping.evidence_type} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                  <code style={{ fontSize: 11 }}>{mapping.evidence_type}</code> → {mapping.controls.length} {t('controls', 'controls')}
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--color-text-secondary)', fontSize: 11.5 }}>
                  {mapping.controls.map((hit) => (
                    <li key={`${hit.framework_id}|${hit.control_id}`} style={{ marginBottom: 2 }}>
                      <strong>{hit.framework_id.toUpperCase()}</strong>{' '}
                      <code style={{ fontSize: 11 }}>{hit.control_id}</code>{' '}
                      {hit.control_name}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          ) : (
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>
              {t('No control mappings — this connector\'s evidence types are not referenced by any loaded framework.', 'No control mappings — this connector\'s evidence types are not referenced by any loaded framework.')}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

function GapsTable({ gaps }: { gaps: Gap[] }) {
  const { t } = useI18n()
  // Group by framework for readability — a tenant typically has a few
  // dozen gaps spread across frameworks; the grouped view makes it
  // much easier to scan than one long flat list.
  const byFramework = useMemo(() => {
    const map: Record<string, { name: string; gaps: Gap[] }> = {}
    for (const g of gaps) {
      const key = g.framework_id
      if (!map[key]) map[key] = { name: g.framework_name || g.framework_id.toUpperCase(), gaps: [] }
      map[key].gaps.push(g)
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
  }, [gaps])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {byFramework.map(([fid, group]) => (
        <div key={fid}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
            {group.name} <span style={{ color: 'var(--color-text-tertiary)' }}>· {group.gaps.length} {t('gaps', 'gaps')}</span>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--color-text-secondary)', fontSize: 11.5 }}>
            {group.gaps.map((g) => (
              <li key={g.control_id} style={{ marginBottom: 2 }}>
                <code style={{ fontSize: 11 }}>{g.control_id}</code> {g.control_name}
                {g.required_tags && g.required_tags.length > 0 ? (
                  <span style={{ color: 'var(--color-text-tertiary)' }}> {t('— needs', '— needs')}: {g.required_tags.join(', ')}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
