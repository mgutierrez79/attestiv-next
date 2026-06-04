'use client'
// Citation review page.
//
// Every regulatory citation the platform ships is best-effort until a
// human reviewer (juriste / compliance authority) confirms it. This page
// is that reviewer's queue: it lists every control's citation, its
// effective status (verified / rejected / draft / derived), and — for an
// admin — lets them record a verified or rejected decision. The headline
// "audit-ready" percentage is the fraction an auditor could rely on.
//
// Why it matters: the scoring math is honest, but the regulatory mapping
// behind each control is unverified until reviewed. A CISO should not
// present a draft-cited control as proven-mapped to a regulation. This
// page closes that gap with an attributable review trail.

import { useEffect, useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  GhostButton,
  Pagination,
  PrimaryButton,
  Skeleton,
  StatPill,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type CitationRow = {
  framework_id: string
  framework_name: string
  control_id: string
  control_name: string
  citation: string
  citation_status: string
  citation_verified: boolean
  citation_review?: { reviewed_by?: string; reviewed_at?: string; note?: string }
}

type ReviewResponse = {
  items: CitationRow[]
  count: number
  counts: Record<string, number>
  audit_ready_pct: number
}

function statusTone(status: string): 'green' | 'amber' | 'red' | 'gray' {
  switch (status) {
    case 'verified':
      return 'green'
    case 'rejected':
      return 'red'
    case 'draft':
    case 'derived':
      return 'amber'
    default:
      return 'gray'
  }
}

export function AttestivCitationsPage() {
  const { t } = useI18n()
  const [data, setData] = useState<ReviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [busy, setBusy] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const r = await apiFetch('/scoring/citations/review')
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        const body = (await r.json()) as ReviewResponse
        if (!cancelled) setData(body)
      } catch (err: any) {
        if (!cancelled) setError(err?.message ?? 'Failed to load citations')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const rows = useMemo(() => {
    const all = data?.items ?? []
    if (filter === 'all') return all
    if (filter === 'unverified') return all.filter((r) => r.citation_status !== 'verified')
    return all.filter((r) => (r.citation_status || 'unset') === filter)
  }, [data, filter])

  useEffect(() => setPage(0), [filter])

  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize)

  async function review(row: CitationRow, status: 'verified' | 'rejected') {
    const key = `${row.framework_id}/${row.control_id}`
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const r = await apiFetch('/scoring/citations/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framework_id: row.framework_id, control_id: row.control_id, status }),
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      setNotice(t('Citation updated', 'Citation updated') + `: ${row.control_id} → ${status}`)
      setReloadKey((k) => k + 1)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to record review')
    } finally {
      setBusy(null)
    }
  }

  const counts = data?.counts ?? {}
  const auditReady = data ? Math.round(data.audit_ready_pct * 100) : 0

  return (
    <>
      <Topbar title={t('Citation review', 'Citation review')} />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}

        <Card>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatPill
              label={t('Audit-ready', 'Audit-ready')}
              value={data ? `${auditReady}%` : '—'}
              sub={t('citations verified', 'citations verified')}
              valueColor={auditReady >= 95 ? 'var(--color-status-green-deep)' : undefined}
            />
            <StatPill label={t('Verified', 'Verified')} value={String(counts['verified'] ?? 0)} />
            <StatPill label={t('Draft', 'Draft')} value={String(counts['draft'] ?? 0)} />
            <StatPill label={t('Derived', 'Derived')} value={String(counts['derived'] ?? 0)} />
            <StatPill label={t('Rejected', 'Rejected')} value={String(counts['rejected'] ?? 0)} />
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {t(
              'Citations are best-effort until a reviewer verifies the regulatory mapping. Only verified citations should be relied on in an audit. Recording a decision here is admin-only and written to the immutable audit log.',
              'Citations are best-effort until a reviewer verifies the regulatory mapping. Only verified citations should be relied on in an audit. Recording a decision here is admin-only and written to the immutable audit log.',
            )}
          </p>
        </Card>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
          {['all', 'unverified', 'verified', 'draft', 'derived', 'rejected'].map((f) => (
            <GhostButton key={f} onClick={() => setFilter(f)}>
              <span style={{ fontWeight: filter === f ? 700 : 400 }}>{t(f, f)}</span>
            </GhostButton>
          ))}
        </div>

        <Card>
          {loading ? (
            <Skeleton lines={8} height={16} />
          ) : pageRows.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', padding: '12px 0' }}>
              {t('No citations match this filter.', 'No citations match this filter.')}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {pageRows.map((row) => {
                const key = `${row.framework_id}/${row.control_id}`
                return (
                  <div
                    key={key}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto',
                      gap: 12,
                      alignItems: 'center',
                      padding: '10px 0',
                      borderBottom: '0.5px solid var(--color-border-tertiary)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <Badge tone={statusTone(row.citation_status)}>
                          {row.citation_status || t('unset', 'unset')}
                        </Badge>
                        <code style={{ fontSize: 11 }}>{row.control_id}</code>
                        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{row.control_name}</span>
                        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>· {row.framework_name}</span>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                        {row.citation || t('(no citation)', '(no citation)')}
                      </div>
                      {row.citation_review?.reviewed_by ? (
                        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                          {t('Reviewed by', 'Reviewed by')} {row.citation_review.reviewed_by}
                        </div>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {row.citation_status !== 'verified' ? (
                        <PrimaryButton onClick={() => review(row, 'verified')} disabled={busy === key}>
                          {t('Verify', 'Verify')}
                        </PrimaryButton>
                      ) : null}
                      {row.citation_status !== 'rejected' ? (
                        <GhostButton onClick={() => review(row, 'rejected')} disabled={busy === key}>
                          {t('Reject', 'Reject')}
                        </GhostButton>
                      ) : null}
                    </div>
                  </div>
                )
              })}
              <Pagination
                page={page}
                pageSize={pageSize}
                total={rows.length}
                onPageChange={setPage}
                onPageSizeChange={(s) => {
                  setPageSize(s)
                  setPage(0)
                }}
              />
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
