'use client';
// Evidence ▸ CVE scans — operator uploads a vulnerability scan
// and seven framework scores move on the next eval cycle. This
// is the page that demonstrates the "born multi-framework" thesis:
// one piece of evidence, every framework that references it
// updates simultaneously.
//
// Three actions:
//   - Paste a CSV (Tenable/Qualys export format) and POST as text/csv
//   - Paste a JSON body and POST as application/json
//   - View previous scans + delete

import { useEffect, useState } from 'react'
import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n'

type CVEFinding = {
  cve_id: string
  cvss_score: number
  affected_system: string
  days_since_detection: number
  severity?: string
  fixed_at?: string
}

type CVEScan = {
  id: string
  scan_date: string
  scanner: string
  system_count: number
  critical_count: number
  high_count: number
  findings: CVEFinding[]
  uploaded_at: string
  uploaded_by?: string
}

type KEVStatus = {
  enabled: boolean
  kev_size: number
  last_refreshed_at?: string
  age_hours?: number
}

const SAMPLE_CSV = `cve_id,cvss_score,affected_system,days_since_detection,severity,fixed_at
CVE-2025-1234,9.8,vm-101,12,critical,
CVE-2025-5678,7.5,vm-101,3,high,2026-05-15T00:00:00Z
CVE-2025-9999,9.1,vm-205,1,critical,`

const SAMPLE_JSON = JSON.stringify(
  {
    scan_date: new Date().toISOString(),
    scanner: 'tenable',
    findings: [
      { cve_id: 'CVE-2025-1234', cvss_score: 9.8, affected_system: 'vm-101', days_since_detection: 12, severity: 'critical' },
      { cve_id: 'CVE-2025-5678', cvss_score: 7.5, affected_system: 'vm-101', days_since_detection: 3, severity: 'high' },
    ],
  },
  null,
  2,
)

export function AttestivCVEUploadPage() {
  const { t } = useI18n()

  const [scans, setScans] = useState<CVEScan[]>([])
  const [kev, setKev] = useState<KEVStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [format, setFormat] = useState<'csv' | 'json'>('csv')
  const [body, setBody] = useState(SAMPLE_CSV)
  const [submitting, setSubmitting] = useState(false)
  const [refreshingKEV, setRefreshingKEV] = useState(false)

  async function refresh() {
    try {
      const [r, kevR] = await Promise.all([
        apiFetch('/evidence/cve-scan'),
        apiFetch('/system/cveenrich/status'),
      ])
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      const payload = (await r.json()) as { items: CVEScan[] }
      setScans(payload.items || [])
      if (kevR.ok) {
        setKev((await kevR.json()) as KEVStatus)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scans')
    } finally {
      setLoading(false)
    }
  }

  async function refreshKEV() {
    setRefreshingKEV(true)
    setError(null)
    setSuccess(null)
    try {
      const r = await apiFetch('/system/cveenrich/refresh', { method: 'POST' })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      const body = (await r.json()) as { entries_loaded: number }
      setSuccess(t('KEV refreshed: {{n}} entries.', 'KEV refreshed: {{n}} entries.').replace('{{n}}', String(body.entries_loaded)))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'KEV refresh failed')
    } finally {
      setRefreshingKEV(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  function setFormatAndSample(next: 'csv' | 'json') {
    setFormat(next)
    setBody(next === 'csv' ? SAMPLE_CSV : SAMPLE_JSON)
  }

  async function upload() {
    setSubmitting(true)
    setError(null)
    setSuccess(null)
    try {
      const r = await apiFetch('/evidence/cve-scan', {
        method: 'POST',
        headers: { 'Content-Type': format === 'csv' ? 'text/csv' : 'application/json' },
        body,
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      const saved = (await r.json()) as CVEScan
      setSuccess(
        t(
          'Uploaded {{id}} — {{critical}} critical, {{high}} high. Scoring will pick this up on the next eval cycle.',
          'Uploaded {{id}} — {{critical}} critical, {{high}} high. Scoring will pick this up on the next eval cycle.',
        )
          .replace('{{id}}', saved.id)
          .replace('{{critical}}', String(saved.critical_count))
          .replace('{{high}}', String(saved.high_count)),
      )
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function deleteScan(id: string) {
    if (!confirm(t('Delete this scan? Scoring will drop it on the next eval.', 'Delete this scan? Scoring will drop it on the next eval.'))) return
    try {
      const r = await apiFetch('/evidence/cve-scan/' + encodeURIComponent(id), { method: 'DELETE' })
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
      setSuccess(t('Deleted', 'Deleted'))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <>
      <Topbar
        title={t('CVE scans', 'CVE scans')}
        left={<Badge tone="navy">{scans.length} {t('scans', 'scans')}</Badge>}
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {success ? <Banner tone="success">{success}</Banner> : null}

        <Banner tone="info" title={t('Why upload CVE scans', 'Why upload CVE scans')}>
          {t(
            'vulnerability_scan + critical_cve_detected are referenced by seven framework YAMLs (CIS, DORA, ISO27001, NIS2, NIST, PCI-DSS, SOC2). Until you upload here, every one of those frameworks ignores the vulnerability dimension. One upload moves all seven scores at once.',
            'vulnerability_scan + critical_cve_detected are referenced by seven framework YAMLs (CIS, DORA, ISO27001, NIS2, NIST, PCI-DSS, SOC2). Until you upload here, every one of those frameworks ignores the vulnerability dimension. One upload moves all seven scores at once.',
          )}
        </Banner>

        {kev?.enabled ? (
          <Card style={{ marginTop: 10 }}>
            <CardTitle right={
              <GhostButton onClick={refreshKEV} disabled={refreshingKEV}>
                <i className="ti ti-refresh" aria-hidden="true" />
                {refreshingKEV ? t('Refreshing…', 'Refreshing…') : t('Refresh KEV', 'Refresh KEV')}
              </GhostButton>
            }>
              {t('CISA KEV enrichment', 'CISA KEV enrichment')}
            </CardTitle>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              {t(
                'CVEs uploaded here are cross-checked against the CISA Known Exploited Vulnerabilities catalog. A CVE in this catalog is being actively exploited in the wild RIGHT NOW — the strongest priority signal possible. Records gain an is_kev=true field plus a kev tag so framework controls can gate on it.',
                'CVEs uploaded here are cross-checked against the CISA Known Exploited Vulnerabilities catalog. A CVE in this catalog is being actively exploited in the wild RIGHT NOW — the strongest priority signal possible. Records gain an is_kev=true field plus a kev tag so framework controls can gate on it.',
              )}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12, flexWrap: 'wrap' }}>
              <span>
                <strong>{kev.kev_size.toLocaleString()}</strong> {t('catalog entries', 'catalog entries')}
              </span>
              {kev.last_refreshed_at ? (
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                  {t('Last refresh', 'Last refresh')}: {kev.last_refreshed_at.slice(0, 19).replace('T', ' ')} UTC
                  {kev.age_hours != null ? ` (${Math.round(kev.age_hours)}h ago)` : ''}
                </span>
              ) : (
                <Badge tone="amber">{t('not refreshed yet', 'not refreshed yet')}</Badge>
              )}
            </div>
          </Card>
        ) : null}

        <Card style={{ marginTop: 10 }}>
          <CardTitle right={
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                onClick={() => setFormatAndSample('csv')}
                style={pillStyle(format === 'csv')}
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => setFormatAndSample('json')}
                style={pillStyle(format === 'json')}
              >
                JSON
              </button>
            </div>
          }>
            {t('Upload a scan', 'Upload a scan')}
          </CardTitle>
          <p style={cardLeadStyle}>
            {format === 'csv'
              ? t('Paste a CSV with columns: cve_id, cvss_score, affected_system, days_since_detection, severity, fixed_at.', 'Paste a CSV with columns: cve_id, cvss_score, affected_system, days_since_detection, severity, fixed_at.')
              : t('Paste a JSON object with scan_date, scanner, and findings[].', 'Paste a JSON object with scan_date, scanner, and findings[].')}
          </p>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 160,
              fontSize: 12,
              fontFamily: 'monospace',
              padding: 10,
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-background-primary)',
              color: 'var(--color-text-primary)',
              resize: 'vertical',
            }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <GhostButton onClick={() => setBody(format === 'csv' ? SAMPLE_CSV : SAMPLE_JSON)}>
              {t('Reset to sample', 'Reset to sample')}
            </GhostButton>
            <PrimaryButton onClick={upload} disabled={submitting || !body.trim()}>
              <i className="ti ti-upload" aria-hidden="true" />
              {submitting ? t('Uploading…', 'Uploading…') : t('Upload', 'Upload')}
            </PrimaryButton>
          </div>
        </Card>

        <Card style={{ marginTop: 10 }}>
          <CardTitle>{t('Recent scans', 'Recent scans')}</CardTitle>
          {loading ? (
            <Skeleton lines={3} height={36} />
          ) : scans.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t('No CVE scans uploaded yet.', 'No CVE scans uploaded yet.')}
            </div>
          ) : (
            <div>
              {scans.slice().reverse().map((scan) => {
                // Count of findings that look like they'd hit KEV
                // enrichment (critical or CVSS>=9). Operator-visible
                // proxy for "of N critical findings, how many are
                // actively-exploited?" — the hydrator's actual gate.
                const criticalsWithKEVPotential = scan.findings.filter(
                  (f) => (f.severity || '').toLowerCase() === 'critical' || (f.cvss_score ?? 0) >= 9,
                ).length
                return (
                  <div key={scan.id} style={rowStyle}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>
                        {scan.scanner} · <span style={{ color: 'var(--color-text-tertiary)' }}>{scan.scan_date.slice(0, 10)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                        <code>{scan.id}</code>
                      </div>
                    </div>
                    <Badge tone="red">{scan.critical_count} critical</Badge>
                    <Badge tone="amber">{scan.high_count} high</Badge>
                    <Badge tone="navy">{scan.findings.length} findings</Badge>
                    {criticalsWithKEVPotential > 0 && kev?.enabled ? (
                      <Badge tone="red"><i className="ti ti-flame" aria-hidden="true" /> {criticalsWithKEVPotential} KEV-eligible</Badge>
                    ) : null}
                    <GhostButton onClick={() => deleteScan(scan.id)}>
                      <i className="ti ti-trash" aria-hidden="true" />
                    </GhostButton>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    padding: '4px 10px',
    fontSize: 11,
    border: '0.5px solid var(--color-border-secondary)',
    borderRadius: 'var(--border-radius-md)',
    background: active ? 'var(--color-brand-blue)' : 'var(--color-background-primary)',
    color: active ? '#fff' : 'var(--color-text-secondary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 500,
  }
}

const cardLeadStyle: React.CSSProperties = {
  fontSize: 12.5,
  lineHeight: 1.5,
  color: 'var(--color-text-secondary)',
  marginTop: 4,
  marginBottom: 8,
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 0',
  borderBottom: '0.5px solid var(--color-border-tertiary)',
}
