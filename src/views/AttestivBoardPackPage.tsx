'use client'
// Board pack — 6-page management PDF.
//
// The page itself is a download trigger + reporting window selector.
// Heavy lifting (composing the 6 sections) happens in the backend
// at GET /v1/management/board-pack[?days=N], which streams the PDF
// straight to the browser. The audit-independence boundary is
// enforced server-side via the X-Audit-Boundary: management header
// and the auditor-role exclusion on /management/* — see
// docs/audit-management-boundary.md.

import { useState } from 'react'

import {
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  Select,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

const WINDOW_OPTIONS: { value: number; label: string }[] = [
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days (quarterly)' },
  { value: 180, label: '180 days (half-year)' },
  { value: 365, label: '365 days (annual)' },
]

export function AttestivBoardPackPage() {
  const { t } = useI18n()
  const [windowDays, setWindowDays] = useState(90)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function downloadPDF() {
    setBusy(true)
    setError(null)
    try {
      const resp = await apiFetch(`/management/board-pack?days=${windowDays}`)
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
      const blob = await resp.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `board-pack-${windowDays}d.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      if (err instanceof Error) setError(err.message)
      else setError('Failed to generate board pack')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Topbar title={t('Board pack', 'Board pack')} />
      <div className="attestiv-content">
        <Card>
          <CardTitle>{t('Quarterly posture report for the board', 'Quarterly posture report for the board')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 0 }}>
            {t(
              'A 6-page management PDF: posture trend, regulatory exposure (ROI engine), top open risks, top open incidents, and the remediation pulse. Hand it to the audit committee or board pack distribution.',
              'A 6-page management PDF: posture trend, regulatory exposure (ROI engine), top open risks, top open incidents, and the remediation pulse. Hand it to the audit committee or board pack distribution.',
            )}
          </p>
          <Banner tone="info">
            {t(
              'Audit-independence boundary: this report is MANAGEMENT-tier. Do not file it as part of an auditor working paper (PCAOB AS 2701, ISAE 3000). For auditor-tier evidence use the signed pre-packet under Audit → Pre-packet.',
              'Audit-independence boundary: this report is MANAGEMENT-tier. Do not file it as part of an auditor working paper (PCAOB AS 2701, ISAE 3000). For auditor-tier evidence use the signed pre-packet under Audit → Pre-packet.',
            )}
          </Banner>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle>{t('Generate', 'Generate')}</CardTitle>
          <div
            style={{
              display: 'flex',
              gap: 12,
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              marginBottom: 10,
            }}
          >
            <label style={{ fontSize: 12 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>
                {t('Reporting window', 'Reporting window')}
              </div>
              <Select
                value={windowDays}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                style={{ minWidth: 220 }}
              >
                {WINDOW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </label>
            <PrimaryButton onClick={() => void downloadPDF()} disabled={busy}>
              <i
                className={busy ? 'ti ti-loader' : 'ti ti-download'}
                aria-hidden="true"
              />{' '}
              {busy
                ? t('Generating…', 'Generating…')
                : t('Download PDF', 'Download PDF')}
            </PrimaryButton>
            <GhostButton onClick={() => window.location.assign('/management/roi')}>
              <i className="ti ti-coin" aria-hidden="true" />{' '}
              {t('Open Financial posture', 'Open Financial posture')}
            </GhostButton>
          </div>
          {error ? <Banner tone="error">{error}</Banner> : null}
        </Card>
      </div>
    </>
  )
}
