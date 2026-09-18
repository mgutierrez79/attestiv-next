'use client';
// Evidence ▸ Vulnerabilities — fleet-wide vulnerability list.
//
// Reads the ADDITIVE aggregation endpoint GET /v1/vulnerabilities
// (older backends 404 → an explicit "requires a newer backend" state,
// never an empty table). Rows are rendered in delivered order — the
// backend sorts KEV-first, then CVSS descending — so the most
// actionable findings are always on page one; no client re-sort.
//
// Filters map 1:1 onto the endpoint's query params (severity, source,
// kev, q) and are seeded from the URL so the asset detail page can
// deep-link here with ?q=<hostname>.

import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  Pagination,
  Select,
  Skeleton,
  TextInput,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch, ApiError } from '../lib/api'
import { useI18n } from '../lib/i18n'
import {
  buildFleetQuery,
  deriveFleetView,
  isWeakMatch,
  offsetFromPage,
  pageFromOffset,
  productLabel,
  severityTone,
  type FleetOutcome,
  type FleetVulnItem,
} from '../lib/vulnerabilities'

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const

export function AttestivVulnerabilitiesPage() {
  const { t } = useI18n()
  const searchParams = useSearchParams()

  // Filters — seeded once from the URL (deep links from the asset
  // card), then owned locally. Changing any filter resets paging.
  // asset_id is the exact-match deep link from the asset detail card;
  // clearing its chip widens back to the whole fleet.
  const [assetId, setAssetId] = useState(() => searchParams?.get('asset_id') ?? '')
  const [severity, setSeverity] = useState(() =>
    (searchParams?.get('severity') ?? '').toLowerCase(),
  )
  const [source, setSource] = useState(() => searchParams?.get('source') ?? '')
  const [kevOnly, setKevOnly] = useState(
    () => (searchParams?.get('kev') ?? '').toLowerCase() === 'true',
  )
  const [q, setQ] = useState(() => searchParams?.get('q') ?? '')
  // The text box is applied on submit, not per keystroke, so typing
  // doesn't fire a request per character.
  const [qInput, setQInput] = useState(() => searchParams?.get('q') ?? '')
  const [limit, setLimit] = useState(50)
  const [offset, setOffset] = useState(0)

  const [outcome, setOutcome] = useState<FleetOutcome>({ kind: 'loading' })
  // Every source ever seen in a response — keeps the source filter
  // populated even while a severity filter narrows the current page.
  const [knownSources, setKnownSources] = useState<string[]>([])

  const query = buildFleetQuery({ assetId, severity, source, kev: kevOnly, q, limit, offset })

  useEffect(() => {
    let cancelled = false
    setOutcome({ kind: 'loading' })
    apiFetch(`/vulnerabilities${query}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (cancelled) return
        if (!body || typeof body !== 'object') {
          setOutcome({ kind: 'error', message: t('Failed to load', 'Failed to load') })
          return
        }
        setOutcome({ kind: 'loaded', body })
        const seen = new Set<string>()
        for (const item of Array.isArray(body.items) ? (body.items as FleetVulnItem[]) : []) {
          if (item.source) seen.add(item.source)
        }
        if (seen.size > 0) {
          setKnownSources((prev) => Array.from(new Set([...prev, ...seen])).sort())
        }
      })
      .catch((err) => {
        if (cancelled) return
        setOutcome({
          kind: 'error',
          status: err instanceof ApiError ? err.status : undefined,
          message: err instanceof Error ? err.message : String(err),
        })
      })
    return () => {
      cancelled = true
    }
    // t is stable per language; query encodes every filter + paging input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  const view = useMemo(() => deriveFleetView(outcome), [outcome])

  const hasFilters = Boolean(assetId || severity || source || kevOnly || q)
  const sourceOptions = useMemo(() => {
    const set = new Set(knownSources)
    if (source) set.add(source)
    return Array.from(set).sort()
  }, [knownSources, source])

  function applyFilter(update: () => void) {
    update()
    setOffset(0)
  }

  return (
    <>
      <Topbar
        title={t('Vulnerabilities', 'Vulnerabilities')}
        left={
          view.state === 'loaded' ? (
            <Badge tone="navy">
              {t('{n} vulnerabilities', '{n} vulnerabilities', { n: view.count })}
            </Badge>
          ) : null
        }
      />
      <div className="attestiv-content">
        {view.state === 'error' ? <Banner tone="error">{view.message}</Banner> : null}

        <Card style={{ marginTop: 10 }}>
          <CardTitle>{t('Vulnerabilities', 'Vulnerabilities')}</CardTitle>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {assetId ? (
              // Active exact-asset filter (deep link from the asset
              // detail card). Clearing it widens back to the whole
              // fleet — the button is the chip.
              <GhostButton onClick={() => applyFilter(() => setAssetId(''))}>
                <i className="ti ti-database" aria-hidden="true" />
                {t('Asset', 'Asset')}: <code style={{ fontSize: 11 }}>{assetId}</code>
                <i className="ti ti-x" aria-hidden="true" />
              </GhostButton>
            ) : null}
            <Select
              value={severity}
              onChange={(e) => applyFilter(() => setSeverity(e.target.value))}
              aria-label={t('Severity', 'Severity')}
              style={{ width: 'auto', fontSize: 12 }}
            >
              <option value="">{t('All severities', 'All severities')}</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <Select
              value={source}
              onChange={(e) => applyFilter(() => setSource(e.target.value))}
              aria-label={t('Source', 'Source')}
              style={{ width: 'auto', fontSize: 12 }}
            >
              <option value="">{t('All sources', 'All sources')}</option>
              {sourceOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={kevOnly}
                onChange={(e) => applyFilter(() => setKevOnly(e.target.checked))}
              />
              {t('KEV only', 'KEV only')}
            </label>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                applyFilter(() => setQ(qInput.trim()))
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 220 }}
            >
              <TextInput
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder={t('Search CVE, product, or host…', 'Search CVE, product, or host…')}
                aria-label={t('Search', 'Search')}
                style={{ flex: 1, fontSize: 12 }}
              />
              <GhostButton type="submit">
                <i className="ti ti-search" aria-hidden="true" /> {t('Search', 'Search')}
              </GhostButton>
            </form>
          </div>

          {view.state === 'loaded' && view.truncated ? (
            <div style={{ marginTop: 10 }}>
              <Banner tone="warning">
                {t(
                  'Result set truncated — narrow the filters to see the rest.',
                  'Result set truncated — narrow the filters to see the rest.',
                )}
              </Banner>
            </div>
          ) : null}

          {view.state === 'loading' ? (
            <div style={{ marginTop: 12 }}>
              <Skeleton lines={5} height={32} />
            </div>
          ) : view.state === 'unsupported' ? (
            <EmptyState
              icon="ti-server-off"
              title={t(
                'Fleet vulnerability view requires a newer backend.',
                'Fleet vulnerability view requires a newer backend.',
              )}
              description={t(
                'This backend does not expose /v1/vulnerabilities yet. Upgrade the backend to list vulnerabilities across the fleet.',
                'This backend does not expose /v1/vulnerabilities yet. Upgrade the backend to list vulnerabilities across the fleet.',
              )}
            />
          ) : view.state === 'error' ? null : view.items.length === 0 ? (
            <EmptyState
              icon="ti-radar-off"
              title={t('No vulnerability records', 'No vulnerability records')}
              description={
                hasFilters
                  ? t('No results for the current filters.', 'No results for the current filters.')
                  : t(
                      'No connected source has reported vulnerabilities matched to inventory assets. This may mean no scanner is connected — not that the fleet is clean.',
                      'No connected source has reported vulnerabilities matched to inventory assets. This may mean no scanner is connected — not that the fleet is clean.',
                    )
              }
            />
          ) : (
            <>
              <div style={{ overflowX: 'auto', marginTop: 12 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      <th style={{ padding: '6px 10px 6px 0' }}>CVE</th>
                      <th style={{ padding: '6px 10px' }}>{t('Severity', 'Severity')}</th>
                      <th style={{ padding: '6px 10px', textAlign: 'right' }}>{t('CVSS', 'CVSS')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Asset', 'Asset')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Product', 'Product')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('Source', 'Source')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('KEV', 'KEV')}</th>
                      <th style={{ padding: '6px 10px' }}>{t('State', 'State')}</th>
                      <th style={{ padding: '6px 0 6px 10px', textAlign: 'right' }}>{t('Days open', 'Days open')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.items.map((item, i) => (
                      <tr
                        key={`${item.cve_id}-${item.asset_id ?? ''}-${item.product ?? ''}-${i}`}
                        style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}
                      >
                        <td style={{ padding: '8px 10px 8px 0' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <code style={{ fontSize: 11 }}>{item.cve_id}</code>
                            {isWeakMatch(item) ? (
                              <Badge
                                tone="gray"
                                icon="ti-zoom-question"
                                title={t(
                                  'Host attribution by name-only software match',
                                  'Host attribution by name-only software match',
                                )}
                              >
                                {t('Weak match', 'Weak match')}
                              </Badge>
                            ) : null}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <Badge tone={severityTone(item.severity)}>{item.severity ?? '—'}</Badge>
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {item.cvss != null ? item.cvss.toFixed(1) : '—'}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {item.asset_id ? (
                            <a href={`/inventory/${encodeURIComponent(item.asset_id)}`} style={{ fontWeight: 500 }}>
                              {item.hostname || item.asset_id}
                            </a>
                          ) : (
                            item.hostname || '—'
                          )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>{productLabel(item)}</td>
                        <td style={{ padding: '8px 10px' }}>{item.source ?? '—'}</td>
                        <td style={{ padding: '8px 10px' }}>
                          {item.is_kev ? (
                            <Badge tone="red" icon="ti-flame" title={item.kev_ransomware}>
                              {t('KEV', 'KEV')}
                              {item.kev_due_date
                                ? ` · ${t('due {date}', 'due {date}', { date: item.kev_due_date })}`
                                : ''}
                            </Badge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td style={{ padding: '8px 10px' }}>{item.state ?? '—'}</td>
                        <td style={{ padding: '8px 0 8px 10px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {item.days_open ?? '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 10 }}>
                <Pagination
                  page={pageFromOffset(offset, limit)}
                  pageSize={limit}
                  total={view.count}
                  onPageChange={(page) => setOffset(offsetFromPage(page, limit))}
                  onPageSizeChange={(size) => {
                    setLimit(size)
                    setOffset(0)
                  }}
                  pageSizes={[25, 50, 100]}
                  label={t('Vulnerabilities', 'Vulnerabilities')}
                />
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  )
}
