'use client';
// Frameworks / Controls.
//
// Flat library view across all frameworks. Each row is one control:
// framework, control id, name, current evidence coverage (0–100%),
// last evidence timestamp. Compliance managers use this when an
// auditor asks "show me everything mapped to A.9 access control" —
// the framework page gives them the per-framework rollup, this page
// is the cross-cutting filter.
//
// Backed by /v1/config/control-mappings, which returns the active
// control library from the configured frameworks. Falls back to a
// representative subset when the endpoint is empty so the page still
// communicates intent.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

import {
  Badge,
  Card,
  CardTitle,
  FrameworkBar,
  Pagination,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { isDemoMode } from '../lib/demoMode'

import { useI18n } from '../lib/i18n';

type Control = {
  framework: string
  control_id: string
  name: string
  area?: string
  coverage_pct?: number
  evidence_count?: number
  last_evidence_at?: string
}

const DEMO: Control[] = [
  { framework: 'SOC 2', control_id: 'CC6.1', name: 'Logical access — system access', area: 'Security', coverage_pct: 98, evidence_count: 142 },
  { framework: 'SOC 2', control_id: 'CC7.2', name: 'System monitoring', area: 'Security', coverage_pct: 92, evidence_count: 88 },
  { framework: 'SOC 2', control_id: 'CC8.1', name: 'Change management', area: 'Security', coverage_pct: 89, evidence_count: 60 },
  { framework: 'ISO 27001', control_id: 'A.9.1', name: 'Access control policy', area: 'A.9 Access control', coverage_pct: 95, evidence_count: 31 },
  { framework: 'ISO 27001', control_id: 'A.9.2', name: 'User access management', area: 'A.9 Access control', coverage_pct: 88, evidence_count: 44 },
  { framework: 'ISO 27001', control_id: 'A.12.4', name: 'Logging and monitoring', area: 'A.12 Operations security', coverage_pct: 91, evidence_count: 76 },
  { framework: 'PCI DSS 4.0', control_id: '1.2.5', name: 'Restrict inbound/outbound traffic', area: 'Network', coverage_pct: 84, evidence_count: 22 },
  { framework: 'PCI DSS 4.0', control_id: '8.3', name: 'Strong authentication', area: 'Access control', coverage_pct: 78, evidence_count: 36 },
  { framework: 'CIS Controls v8', control_id: '6.7', name: 'Centralize access control', area: 'Access control', coverage_pct: 90, evidence_count: 41 },
  { framework: 'CIS Controls v8', control_id: '8.1', name: 'Audit log management', area: 'Audit', coverage_pct: 94, evidence_count: 88 },
]

type TaskRow = { framework_id: string; control_id: string; status?: string; priority?: string }
type ExceptionRow = { framework_id: string; control_id: string; expires_at?: string; severity?: string }

// keyFor matches the (framework, control) tuple between the
// controls library (which uses humanised framework labels like "ISO
// 27001") and the GRC stores (which key by lowercased ids like
// "iso27001"). The library row carries the human label; we lower-
// case + strip spaces + drop version suffixes (e.g. "v8", "4.0") to
// match the canonical id used by /v1/remediation and /v1/exceptions.
function keyFor(framework: string, controlID: string): string {
  const fw = framework
    .toLowerCase()
    .replace(/\s+v?[\d.]+/g, '')
    .replace(/\s+/g, '')
  return `${fw}/${controlID}`
}

export function AttestivFrameworkControlsPage() {
  const {
    t
  } = useI18n();

  const [controls, setControls] = useState<Control[]>([])
  const [tasksByControl, setTasksByControl] = useState<Map<string, number>>(new Map())
  const [exceptionsByControl, setExceptionsByControl] = useState<Map<string, ExceptionRow[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [usingDemo, setUsingDemo] = useState(false)
  const [filter, setFilter] = useState('')
  const [framework, setFramework] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)

  useEffect(() => {
    let cancelled = false
    const allowDemo = isDemoMode()
    async function load() {
      try {
        const response = await apiFetch('/config/control-mappings')
        if (!response.ok) throw new Error(`${response.status}`)
        const body = await response.json().catch(() => ({}))
        // The backend now returns the flat library control list under
        // `controls`; `items` is the legacy per-connector mapping shape
        // that ControlMappingsPage writes. Prefer `controls`, fall back
        // to `items` for older builds.
        const items: any[] = Array.isArray(body?.controls)
          ? body.controls
          : Array.isArray(body?.items) ? body.items : Array.isArray(body) ? body : []
        const mapped: Control[] = items
          .map((item) => ({
            framework: String(item?.framework ?? ''),
            control_id: String(item?.control_id ?? item?.id ?? ''),
            name: String(item?.name ?? item?.title ?? ''),
            area: item?.area,
            coverage_pct: typeof item?.coverage_pct === 'number' ? item.coverage_pct : undefined,
            evidence_count: typeof item?.evidence_count === 'number' ? item.evidence_count : undefined,
            last_evidence_at: item?.last_evidence_at,
          }))
          .filter((control) => control.framework && control.control_id)
        if (!cancelled) {
          if (mapped.length > 0) {
            setControls(mapped)
            setUsingDemo(false)
          } else if (allowDemo) {
            setControls(DEMO)
            setUsingDemo(true)
          } else {
            setControls([])
            setUsingDemo(false)
          }
        }
      } catch {
        if (!cancelled) {
          if (allowDemo) {
            setControls(DEMO)
            setUsingDemo(true)
          } else {
            setControls([])
            setUsingDemo(false)
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    // Phase-2 chunk-7 annotations — open task count + active
    // exception flag per control. Two batched calls; failures
    // degrade silently (the table still renders the base coverage
    // columns).
    const loadAnnotations = async () => {
      try {
        const [tasksRes, exceptionsRes] = await Promise.all([
          apiFetch('/remediation?status=open&limit=1000'),
          apiFetch('/exceptions?status=active&limit=1000'),
        ])
        if (cancelled) return
        if (tasksRes.ok) {
          const body = await tasksRes.json().catch(() => ({}))
          const items: TaskRow[] = Array.isArray(body?.items) ? body.items : []
          const map = new Map<string, number>()
          for (const t of items) {
            const k = `${(t.framework_id || '').toLowerCase()}/${t.control_id || ''}`
            map.set(k, (map.get(k) ?? 0) + 1)
          }
          setTasksByControl(map)
        }
        if (exceptionsRes.ok) {
          const body = await exceptionsRes.json().catch(() => ({}))
          const items: ExceptionRow[] = Array.isArray(body?.items) ? body.items : []
          const map = new Map<string, ExceptionRow[]>()
          for (const e of items) {
            const k = `${(e.framework_id || '').toLowerCase()}/${e.control_id || ''}`
            const list = map.get(k) ?? []
            list.push(e)
            map.set(k, list)
          }
          setExceptionsByControl(map)
        }
      } catch {
        // swallow — annotations are nice-to-have, not load-bearing
      }
    }
    void loadAnnotations()
    return () => {
      cancelled = true
    }
  }, [])

  const frameworks = useMemo(() => {
    return Array.from(new Set(controls.map((control) => control.framework))).sort()
  }, [controls])

  const filtered = controls.filter((control) => {
    if (framework && control.framework !== framework) return false
    if (filter.trim()) {
      const needle = filter.trim().toLowerCase()
      return [control.framework, control.control_id, control.name, control.area]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    }
    return true
  })

  // Reset to the first page when the filter criteria (or page size)
  // change — but NOT on a plain data refresh.
  useEffect(() => {
    setPage(0)
  }, [filter, framework, pageSize])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pageCount - 1)
  const paged = useMemo(
    () => filtered.slice(currentPage * pageSize, currentPage * pageSize + pageSize),
    [filtered, currentPage, pageSize],
  )

  return (
    <>
      <Topbar
        title={t('Controls library', 'Controls library')}
        left={usingDemo ? <Badge tone="amber">{t(
          'Demo mappings — no control library configured',
          'Demo mappings — no control library configured'
        )}</Badge> : null}
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={framework}
              onChange={(event) => setFramework(event.target.value)}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-background-primary)',
                fontFamily: 'inherit',
                outline: 'none',
              }}
            >
              <option value="">{t('All frameworks', 'All frameworks')}</option>
              {frameworks.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder={t('Filter by id, name, area', 'Filter by id, name, area')}
              style={{
                padding: '6px 10px',
                fontSize: 12,
                border: '0.5px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-background-primary)',
                outline: 'none',
                minWidth: 220,
                fontFamily: 'inherit',
              }}
            />
          </div>
        }
      />
      <div className="attestiv-content">
        <Card>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{filtered.length} controls</span>}>
            {t('Cross-framework controls', 'Cross-framework controls')}
          </CardTitle>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Loading…', 'Loading…')}</div>
          ) : filtered.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No controls match.', 'No controls match.')}</div>
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
                  <th style={{ padding: '6px 10px' }}>{t('Control', 'Control')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Area', 'Area')}</th>
                  <th style={{ padding: '6px 10px', minWidth: 180 }}>{t('Coverage', 'Coverage')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Tasks', 'Tasks')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Exception', 'Exception')}</th>
                  <th style={{ padding: '6px 0 6px 10px', textAlign: 'right' }}>{t('Evidence', 'Evidence')}</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((control) => {
                  const k = keyFor(control.framework, control.control_id)
                  const taskCount = tasksByControl.get(k) ?? 0
                  const exceptions = exceptionsByControl.get(k) ?? []
                  const hasException = exceptions.length > 0
                  const nearestExpiry = hasException
                    ? exceptions
                        .map((e) => (e.expires_at ? new Date(e.expires_at).getTime() : Number.MAX_SAFE_INTEGER))
                        .reduce((a, b) => Math.min(a, b), Number.MAX_SAFE_INTEGER)
                    : null
                  const expiryDays = nearestExpiry && Number.isFinite(nearestExpiry)
                    ? Math.floor((nearestExpiry - Date.now()) / 86_400_000)
                    : null
                  return (
                    <tr key={`${control.framework}|${control.control_id}`} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={{ padding: '10px 10px 10px 0' }}>
                        <Badge tone="navy">{control.framework}</Badge>
                      </td>
                      <td style={{ padding: '10px' }}>
                        <Link
                          href={`/scoring/frameworks/${encodeURIComponent(keyFor(control.framework, control.control_id).split('/')[0])}/controls/${encodeURIComponent(control.control_id)}`}
                          style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
                          title="View evidence detail"
                        >
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 500, color: 'var(--color-brand-blue)' }}>{control.control_id}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{control.name}</div>
                        </Link>
                      </td>
                      <td style={{ padding: '10px', color: 'var(--color-text-secondary)' }}>{control.area ?? '—'}</td>
                      <td style={{ padding: '10px' }}>
                        {control.coverage_pct !== undefined ? (
                          <FrameworkBar name="" percent={control.coverage_pct} />
                        ) : (
                          '—'
                        )}
                      </td>
                      <td style={{ padding: '10px' }}>
                        {taskCount > 0 ? (
                          <Badge tone="amber" icon="ti-checklist">{taskCount}</Badge>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px' }}>
                        {hasException ? (
                          <Badge tone="navy" icon="ti-shield-half-filled">
                            {expiryDays !== null ? (expiryDays < 0 ? 'expired' : `${expiryDays}d`) : 'active'}
                          </Badge>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 0 10px 10px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                        {control.evidence_count ?? '—'}
                      </td>
                    </tr>
                  )
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
                label={t('Controls', 'Controls')}
              />
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
