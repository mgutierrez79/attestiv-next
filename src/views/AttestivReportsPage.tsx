'use client';
// Audit / Reports list.
//
// Generated PDF / Markdown reports per framework. The Frameworks page
// is the trigger; this page is the archive — all prior runs that
// produced a signed report. The "Latest" entry is the canonical
// artifact an auditor downloads via /v1/public/reports/latest/pdf
// without needing to authenticate.

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  Pagination,
  PrimaryButton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { isDemoMode } from '../lib/demoMode'
import { loadSettings } from '../lib/settings'

import { useI18n } from '../lib/i18n';

type ReportRow = {
  id: string
  framework?: string
  run_id?: string
  generated_at: string
  format: 'pdf' | 'md'
  size_bytes?: number
  signed: boolean
}

const DEMO_REPORTS: ReportRow[] = [
  {
    id: 'soc2-2026-Q2',
    framework: 'SOC 2',
    run_id: 'run-2026-05-08T14-22-19Z',
    generated_at: '2026-05-08T14:22:51.000Z',
    format: 'pdf',
    size_bytes: 412_009,
    signed: true,
  },
  {
    id: 'iso27001-2026-Q2',
    framework: 'ISO 27001',
    run_id: 'run-2026-05-08T14-22-19Z',
    generated_at: '2026-05-08T14:23:11.000Z',
    format: 'pdf',
    size_bytes: 388_440,
    signed: true,
  },
  {
    id: 'executive-2026-04',
    framework: 'Executive brief',
    run_id: 'run-2026-04-30T22-00-00Z',
    generated_at: '2026-04-30T22:01:08.000Z',
    format: 'pdf',
    size_bytes: 188_240,
    signed: true,
  },
]

export function AttestivReportsPage() {
  const {
    t
  } = useI18n();

  const [reports, setReports] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [usingDemo, setUsingDemo] = useState(false)
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [busyRow, setBusyRow] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  // downloadReport fetches the per-run PDF (or md) and triggers a
  // client-side download. apiFetch carries the session cookie so the
  // backend's auth gate is honoured. /v1/runs/{id}/report/pdf auto-
  // generates the file if it doesn't exist yet, which means the
  // first download of a fresh run takes ~half a second longer than
  // subsequent ones — still inside the button-click budget.
  async function downloadReport(runID: string, format: 'pdf' | 'md') {
    if (!runID) return
    setBusyRow(runID)
    setError(null)
    setInfo(null)
    try {
      const suffix = format === 'pdf' ? 'report/pdf' : 'report'
      const response = await apiFetch(`/runs/${encodeURIComponent(runID)}/${suffix}`)
      if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(text || `${response.status} ${response.statusText}`)
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `${runID}.${format}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to download')
    } finally {
      setBusyRow(null)
    }
  }

  // copyAuditorLink puts the no-auth public URL on the clipboard so
  // the user can paste it into an email to an external auditor. The
  // /v1/public/reports/latest/pdf endpoint always serves the most
  // recent run, so older rows can't link to a stable URL — those
  // rows still get the button but it copies the latest URL with a
  // warning, which we surface in the info banner.
  async function copyAuditorLink(runID: string, isLatest: boolean) {
    const settings = loadSettings()
    const base = settings.apiBaseUrl?.replace(/\/+$/, '') || ''
    const url = `${base}/v1/public/reports/latest/pdf`
    try {
      await navigator.clipboard.writeText(url)
      if (isLatest) {
        setInfo('Auditor link copied. This URL serves the most recent signed PDF without auth.')
      } else {
        setInfo(
          `Auditor link copied — but it always serves the LATEST run, not ${runID}. Pin a specific run by including its id in a follow-up email.`,
        )
      }
    } catch {
      setError(`Could not copy. Manual URL: ${url}`)
    }
  }

  useEffect(() => {
    let cancelled = false
    const allowDemo = isDemoMode()
    async function load() {
      try {
        const response = await apiFetch('/runs?limit=50')
        if (!response.ok) throw new Error(`${response.status}`)
        const body = await response.json().catch(() => ({}))
        const items: any[] = Array.isArray(body?.items) ? body.items : []
        const mapped: ReportRow[] = items.map((item) => ({
          id: String(item?.run_id ?? ''),
          framework: Array.isArray(item?.summary?.frameworks) && item.summary.frameworks.length === 1
            ? item.summary.frameworks[0]
            : 'All frameworks',
          run_id: item?.run_id,
          generated_at: String(item?.timestamp ?? ''),
          format: 'pdf' as const,
          size_bytes: typeof item?.summary?.size_bytes === 'number' ? item.summary.size_bytes : undefined,
          signed: !!item?.summary?.signature,
        }))
        if (!cancelled) {
          if (mapped.length > 0) {
            setReports(mapped)
            setUsingDemo(false)
          } else if (allowDemo) {
            setReports(DEMO_REPORTS)
            setUsingDemo(true)
          } else {
            setReports([])
            setUsingDemo(false)
          }
        }
      } catch {
        if (!cancelled) {
          if (allowDemo) {
            setReports(DEMO_REPORTS)
            setUsingDemo(true)
          } else {
            setReports([])
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

  const filtered = filter.trim()
    ? reports.filter((report) =>
        [report.id, report.framework, report.run_id]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(filter.trim().toLowerCase())),
      )
    : reports

  // Reset to the first page when the filter (or page size) changes —
  // but NOT on a plain data refresh.
  useEffect(() => {
    setPage(0)
  }, [filter, pageSize])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const paged = useMemo(
    () => filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filtered, currentPage, pageSize],
  )

  return (
    <>
      <Topbar
        title={t('Reports', 'Reports')}
        left={usingDemo ? <Badge tone="amber">{t('Demo data — no signed reports yet', 'Demo data — no signed reports yet')}</Badge> : null}
        right={
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t('Filter by framework or run id', 'Filter by framework or run id')}
            style={{
              padding: '6px 10px',
              fontSize: 12,
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-md)',
              background: 'var(--color-background-primary)',
              outline: 'none',
              minWidth: 240,
              fontFamily: 'inherit',
            }}
          />
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {info ? <Banner tone="info">{info}</Banner> : null}
        <Card>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{filtered.length} reports</span>}>
            {t('Generated reports', 'Generated reports')}
          </CardTitle>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Loading…', 'Loading…')}</div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No reports match.', 'No reports match.')}</div>
          ) : (
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
            <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    fontSize: 10,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                    color: 'var(--color-text-tertiary)',
                    textAlign: 'left',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--color-background-primary)',
                    zIndex: 1,
                  }}
                >
                  <th style={{ padding: '6px 10px 6px 0' }}>{t('Framework', 'Framework')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Run', 'Run')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Generated', 'Generated')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Size', 'Size')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Signed', 'Signed')}</th>
                  <th style={{ padding: '6px 0 6px 10px', textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {paged.map(report => {
                  const {
                    t
                  } = useI18n();

                  return (
                    <tr key={report.id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={{ padding: '10px 10px 10px 0', fontWeight: 500 }}>{report.framework ?? '—'}</td>
                      <td style={{ padding: '10px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                        {report.run_id ?? '—'}
                      </td>
                      <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                        {formatTimestamp(report.generated_at)}
                      </td>
                      <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>
                        {report.size_bytes ? formatBytes(report.size_bytes) : '—'}
                      </td>
                      <td style={{ padding: '10px' }}>
                        {report.signed ? <Badge tone="green">signed</Badge> : <Badge tone="gray">unsigned</Badge>}
                      </td>
                      <td style={{ padding: '10px 0 10px 10px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <GhostButton onClick={() => copyAuditorLink(report.run_id ?? report.id, filtered[0] === report)}>
                            <i className="ti ti-link" aria-hidden="true" />
                            {t('Auditor link', 'Auditor link')}
                          </GhostButton>
                          <PrimaryButton
                            onClick={() => downloadReport(report.run_id ?? report.id, report.format)}
                            disabled={busyRow === (report.run_id ?? report.id)}
                          >
                            <i className="ti ti-file-download" aria-hidden="true" />
                            {busyRow === (report.run_id ?? report.id) ? 'Downloading…' : 'Download'}
                          </PrimaryButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
          {filtered.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <Pagination
                page={currentPage}
                pageSize={pageSize}
                total={filtered.length}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s)
                  setPage(0)
                }}
                label={t('Reports', 'Reports')}
              />
            </div>
          ) : null}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Public auditor endpoints', 'Public auditor endpoints')}</CardTitle>
          <ul
            style={{
              margin: 0,
              paddingLeft: 18,
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              lineHeight: 1.7,
            }}
          >
            <li><code>{t('GET /v1/public/reports/latest/pdf', 'GET /v1/public/reports/latest/pdf')}</code> {t(
                '— most recent signed PDF, no auth required.',
                '— most recent signed PDF, no auth required.'
              )}</li>
            <li><code>{t('GET /v1/public/reports/latest/md', 'GET /v1/public/reports/latest/md')}</code> {t('— markdown source for the same.', '— markdown source for the same.')}</li>
            <li><code>{t('GET /v1/public/keys', 'GET /v1/public/keys')}</code> {t(
                '— Ed25519 public keys (active + retired) for offline verification.',
                '— Ed25519 public keys (active + retired) for offline verification.'
              )}</li>
            <li><code>{t('GET /v1/public/manifest/verify', 'GET /v1/public/manifest/verify')}</code> {t('— pass', '— pass')} <code>{t('?run=...', '?run=...')}</code> {t('to verify the manifest.', 'to verify the manifest.')}</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function formatTimestamp(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
