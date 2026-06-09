'use client'
// Software Bill of Materials — upload, list, and inspect.
//
// Backed by /v1/sbom (GAP-002). Operators paste or drop a CycloneDX
// JSON file; the platform parses it server-side, cross-references
// against the CISA KEV catalog, and surfaces the result here. The
// list shows one row per uploaded BOM with KEV match counts and a
// click-through to the detail card.

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PrimaryButton,
  Skeleton,
  TextInput,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type BOMSummary = {
  id: string
  application_id?: string
  format: 'cyclonedx' | 'spdx' | 'unknown'
  spec_version?: string
  source_tool?: string
  component_count: number
  vulnerability_count: number
  uploaded_by: string
  uploaded_at: string
}

type Component = {
  bom_ref?: string
  name: string
  version?: string
  type?: string
  purl?: string
  cpe?: string
  license?: string
  supplier?: string
}

type Vulnerability = {
  id: string
  cwe?: string[]
  severity?: string
  cvss_score?: number
  description?: string
  affected_components?: string[]
  source?: string
  kev_matched?: boolean
  kev_due_date?: string
}

type BOMDetail = BOMSummary & {
  components?: Component[]
  vulnerabilities?: Vulnerability[]
}

export function AttestivSBOMPage() {
  const { t } = useI18n()
  const [items, setItems] = useState<BOMSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [applicationID, setApplicationID] = useState('')
  const [uploadText, setUploadText] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [selected, setSelected] = useState<BOMDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const resp = await apiFetch('/sbom')
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      const data = (await resp.json()) as { items: BOMSummary[] }
      setItems(data.items || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load SBOMs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function upload() {
    setUploading(true)
    setError(null)
    try {
      let body: string | null = uploadText.trim() || null
      if (!body && uploadFile) {
        body = await uploadFile.text()
      }
      if (!body) {
        throw new Error('Paste a CycloneDX JSON document or attach a file')
      }
      const qs = applicationID.trim()
        ? `?application_id=${encodeURIComponent(applicationID.trim())}`
        : ''
      const resp = await apiFetch(`/sbom${qs}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
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
      setUploadText('')
      setUploadFile(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function openDetail(id: string) {
    setSelected(null)
    setDetailLoading(true)
    try {
      const resp = await apiFetch(`/sbom/${encodeURIComponent(id)}`)
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      const data = (await resp.json()) as BOMDetail
      setSelected(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load detail')
    } finally {
      setDetailLoading(false)
    }
  }

  async function crossReference(id: string) {
    setError(null)
    try {
      const resp = await apiFetch(`/sbom/${encodeURIComponent(id)}/cross-reference`, {
        method: 'POST',
      })
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      await openDetail(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cross-reference failed')
    }
  }

  async function remove(id: string) {
    if (!window.confirm(t('Delete this SBOM? This cannot be undone.', 'Delete this SBOM? This cannot be undone.'))) return
    try {
      const resp = await apiFetch(`/sbom/${encodeURIComponent(id)}`, { method: 'DELETE' })
      if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
      if (selected?.id === id) setSelected(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const totalComponents = useMemo(
    () => items.reduce((sum, b) => sum + (b.component_count || 0), 0),
    [items],
  )
  const totalVulns = useMemo(
    () => items.reduce((sum, b) => sum + (b.vulnerability_count || 0), 0),
    [items],
  )

  return (
    <>
      <Topbar
        title={t('Software supply chain (SBOM)', 'Software supply chain (SBOM)')}
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11 }}>
            <Badge tone="navy">
              {t('{n} BOMs', '{n} BOMs', { n: items.length })}
            </Badge>
            <Badge tone="navy">
              {t('{n} components', '{n} components', { n: totalComponents })}
            </Badge>
            <Badge tone={totalVulns > 0 ? 'amber' : 'green'}>
              {t('{n} vulnerabilities', '{n} vulnerabilities', { n: totalVulns })}
            </Badge>
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Card>
          <CardTitle>{t('Upload', 'Upload')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
            {t(
              'Paste a CycloneDX 1.x JSON document or attach a file. Once uploaded the platform cross-references every CVE against the CISA Known Exploited Vulnerabilities catalog and stamps kev_matched on each match.',
              'Paste a CycloneDX 1.x JSON document or attach a file. Once uploaded the platform cross-references every CVE against the CISA Known Exploited Vulnerabilities catalog and stamps kev_matched on each match.',
            )}
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                {t('Application ID (optional)', 'Application ID (optional)')}
              </div>
              <TextInput
                value={applicationID}
                onChange={(e) => setApplicationID(e.target.value)}
                placeholder="auxia-portal"
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>
                {t('Attach .json', 'Attach .json')}
              </div>
              <input
                type="file"
                accept="application/json,.json"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                style={{ fontSize: 12 }}
              />
            </div>
          </div>
          <textarea
            value={uploadText}
            onChange={(e) => setUploadText(e.target.value)}
            placeholder={t('Paste CycloneDX JSON here…', 'Paste CycloneDX JSON here…')}
            rows={6}
            style={{
              width: '100%',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              padding: 8,
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-md)',
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <PrimaryButton onClick={() => void upload()} disabled={uploading}>
              <i className={uploading ? 'ti ti-loader' : 'ti ti-upload'} aria-hidden="true" />{' '}
              {uploading ? t('Uploading…', 'Uploading…') : t('Upload BOM', 'Upload BOM')}
            </PrimaryButton>
          </div>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<GhostButton onClick={() => void refresh()}>
            <i className="ti ti-refresh" aria-hidden="true" /> {t('Refresh', 'Refresh')}
          </GhostButton>}>
            {t('Uploaded BOMs', 'Uploaded BOMs')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={4} height={28} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="ti-package-off"
              title={t('No BOMs uploaded yet', 'No BOMs uploaded yet')}
              description={t(
                'Upload a CycloneDX document above to start building the supply-chain inventory.',
                'Upload a CycloneDX document above to start building the supply-chain inventory.',
              )}
            />
          ) : (
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={headerRowStyle}>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('ID', 'ID')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Application', 'Application')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Format', 'Format')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('Components', 'Components')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('Vulns', 'Vulns')}</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left' }}>{t('Uploaded', 'Uploaded')}</th>
                  <th style={{ padding: '6px 10px' }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((bom) => (
                  <tr key={bom.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                    <td style={{ padding: '6px 10px' }}>
                      <button
                        type="button"
                        onClick={() => void openDetail(bom.id)}
                        style={linkButtonStyle}
                        title={bom.id}
                      >
                        <code style={{ fontSize: 11 }}>{bom.id.slice(0, 16)}…</code>
                      </button>
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      {bom.application_id ? <code style={{ fontSize: 11 }}>{bom.application_id}</code> : '—'}
                    </td>
                    <td style={{ padding: '6px 10px' }}>
                      <Badge tone="gray">
                        {bom.format}
                        {bom.spec_version ? ` ${bom.spec_version}` : ''}
                      </Badge>
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{bom.component_count}</td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                      {bom.vulnerability_count > 0 ? (
                        <Badge tone={bom.vulnerability_count > 0 ? 'amber' : 'gray'}>
                          {bom.vulnerability_count}
                        </Badge>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td style={{ padding: '6px 10px', color: 'var(--color-text-tertiary)' }}>
                      {bom.uploaded_at.slice(0, 10)}
                    </td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                      <GhostButton onClick={() => void crossReference(bom.id)}>
                        <i className="ti ti-shield-search" aria-hidden="true" />
                      </GhostButton>{' '}
                      <GhostButton onClick={() => void remove(bom.id)}>
                        <i className="ti ti-trash" aria-hidden="true" />
                      </GhostButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {detailLoading ? (
          <Card style={{ marginTop: 12 }}>
            <Skeleton lines={3} height={22} />
          </Card>
        ) : selected ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle
              right={
                <GhostButton onClick={() => setSelected(null)}>
                  <i className="ti ti-x" aria-hidden="true" /> {t('Close', 'Close')}
                </GhostButton>
              }
            >
              {t('Detail', 'Detail')} · <code style={{ fontSize: 11 }}>{selected.id}</code>
            </CardTitle>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <Field label={t('Application', 'Application')} value={selected.application_id || '—'} />
              <Field label={t('Format', 'Format')} value={`${selected.format} ${selected.spec_version || ''}`.trim()} />
              <Field label={t('Source tool', 'Source tool')} value={selected.source_tool || '—'} />
              <Field label={t('Uploaded by', 'Uploaded by')} value={selected.uploaded_by || '—'} />
            </div>

            <div style={{ marginTop: 14 }}>
              <h4 style={sectionHeader}>
                {t('Components', 'Components')} <Badge tone="navy">{selected.components?.length ?? 0}</Badge>
              </h4>
              {selected.components && selected.components.length > 0 ? (
                <div style={{ maxHeight: 240, overflowY: 'auto', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)' }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={headerRowStyle}>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>{t('Name', 'Name')}</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>{t('Version', 'Version')}</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>{t('Type', 'Type')}</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>{t('License', 'License')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.components.map((c, i) => (
                        <tr key={i} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                          <td style={{ padding: '4px 8px' }}>{c.name}</td>
                          <td style={{ padding: '4px 8px', color: 'var(--color-text-tertiary)' }}>{c.version || '—'}</td>
                          <td style={{ padding: '4px 8px', color: 'var(--color-text-tertiary)' }}>{c.type || '—'}</td>
                          <td style={{ padding: '4px 8px', color: 'var(--color-text-tertiary)' }}>{c.license || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('No components projected (SPDX or empty).', 'No components projected (SPDX or empty).')}</p>
              )}
            </div>

            <div style={{ marginTop: 14 }}>
              <h4 style={sectionHeader}>
                {t('Vulnerabilities', 'Vulnerabilities')} <Badge tone={(selected.vulnerabilities?.length ?? 0) > 0 ? 'amber' : 'gray'}>
                  {selected.vulnerabilities?.length ?? 0}
                </Badge>
              </h4>
              {selected.vulnerabilities && selected.vulnerabilities.length > 0 ? (
                <div style={{ maxHeight: 240, overflowY: 'auto', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)' }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={headerRowStyle}>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>CVE</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>{t('Severity', 'Severity')}</th>
                        <th style={{ padding: '4px 8px', textAlign: 'right' }}>CVSS</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>KEV</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>{t('Description', 'Description')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.vulnerabilities.map((v) => (
                        <tr key={v.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                          <td style={{ padding: '4px 8px' }}>
                            <code style={{ fontSize: 10 }}>{v.id}</code>
                          </td>
                          <td style={{ padding: '4px 8px' }}>
                            <Badge tone={severityTone(v.severity)}>{v.severity || '—'}</Badge>
                          </td>
                          <td style={{ padding: '4px 8px', textAlign: 'right' }}>{v.cvss_score?.toFixed(1) ?? '—'}</td>
                          <td style={{ padding: '4px 8px' }}>
                            {v.kev_matched ? (
                              <Badge tone="red" icon="ti-flame">{t('KEV', 'KEV')}</Badge>
                            ) : (
                              <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>—</span>
                            )}
                          </td>
                          <td style={{ padding: '4px 8px', color: 'var(--color-text-tertiary)' }}>
                            {(v.description || '').slice(0, 80)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {t('No embedded vulnerabilities. Run cross-reference to check against CISA KEV.', 'No embedded vulnerabilities. Run cross-reference to check against CISA KEV.')}
                </p>
              )}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 12, marginTop: 2 }}>{value}</div>
    </div>
  )
}

function severityTone(severity?: string): 'red' | 'amber' | 'navy' | 'gray' {
  switch ((severity || '').toLowerCase()) {
    case 'critical':
      return 'red'
    case 'high':
      return 'amber'
    case 'medium':
    case 'low':
      return 'navy'
    default:
      return 'gray'
  }
}

const headerRowStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-tertiary)',
  background: 'var(--color-background-secondary)',
}

const linkButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  color: 'var(--color-brand-blue)',
  fontFamily: 'inherit',
}

const sectionHeader: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--color-text-secondary)',
  marginBottom: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}
