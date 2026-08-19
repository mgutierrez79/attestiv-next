'use client';
// Scoring trend — 12-month sparkline + annotated events.
//
// Hand-rendered SVG (no chart library) because the dataset is tiny
// (≤12 points) and we want full control over the framework-coloured
// line + event markers + 95% threshold guideline. Adding Recharts
// for one widget would be a bigger dependency hit than the math.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import {
  Badge,
  Card,
  CardTitle,
  GhostButton,
  Pagination,
  Topbar,
} from '../components/AttestivUi'
import {
  formatPercent,
  getTrend,
  statusTone,
  type MonthlyScore,
  type TrendEvent,
} from '../lib/scoring'

import { useI18n } from '../lib/i18n';

const FRAMEWORK_COLORS: Record<string, string> = {
  dora: '#1D9E75',
  iso27001: '#185FA5',
  soc2: '#EF9F27',
  nis2: '#534AB7',
  gxp: '#639922',
  pci_dss: '#E24B4A',
}

export function AttestivScoringTrendPage() {
  const {
    t
  } = useI18n();
  const router = useRouter()

  const params = useParams<{ frameworkId?: string | string[] }>()
  const frameworkID = Array.isArray(params?.frameworkId)
    ? params.frameworkId[0]
    : (params?.frameworkId ?? '')
  const [months, setMonths] = useState<6 | 12 | 24>(12)
  const [data, setData] = useState<{ items: MonthlyScore[]; events: TrendEvent[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Events table: pagination + scroll, per the platform-wide list
  // primitive standard. Newest first so a fresh recompute appears
  // at the top of page 1 instead of buried at the end.
  const [eventsPage, setEventsPage] = useState(0)
  const [eventsPageSize, setEventsPageSize] = useState<number>(20)

  useEffect(() => {
    if (!frameworkID) return
    let cancelled = false
    setLoading(true)
    getTrend(frameworkID, months)
      .then((body) => {
        if (!cancelled) setData({ items: body.items, events: body.events })
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message ?? 'Trend load failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [frameworkID, months])

  return (
    <>
      <Topbar
        title={`${frameworkID || 'Framework'} trend`}
        right={
          <div style={{ display: 'flex', gap: 4, background: 'var(--color-background-secondary)', padding: 3, borderRadius: 'var(--border-radius-md)' }}>
            {[6, 12, 24].map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMonths(option as 6 | 12 | 24)}
                style={{
                  background: months === option ? 'var(--color-background-primary)' : 'transparent',
                  color: months === option ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: 'var(--border-radius-md)',
                  fontSize: 11,
                  fontWeight: months === option ? 500 : 400,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {option}m
              </button>
            ))}
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? (
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-status-red-deep)',
              background: 'var(--color-status-red-bg)',
              padding: '8px 12px',
              borderRadius: 'var(--border-radius-md)',
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        ) : null}

        <Card>
          <CardTitle right={data ? <Badge tone="navy">{data.items.length} months</Badge> : null}>
            {t('Score over time', 'Score over time')}
          </CardTitle>
          {loading ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Loading…', 'Loading…')}</div>
          ) : data && data.items.length > 0 ? (
            <TrendChart items={data.items} events={data.events} frameworkID={frameworkID} />
          ) : (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
              {t(
                'No history yet. Click Re-evaluate now on the calculator page to seed the first data point.',
                'No history yet. Click Re-evaluate now on the calculator page to seed the first data point.'
              )}
            </div>
          )}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={data ? <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{data.events.length} events</span> : null}>
            {t('Events', 'Events')}
          </CardTitle>
          {data && data.events.length > 0 ? (
            <EventsTable
              events={data.events}
              page={eventsPage}
              pageSize={eventsPageSize}
              onPage={setEventsPage}
              onPageSize={(s) => {
                setEventsPageSize(s)
                setEventsPage(0)
              }}
            />
          ) : (
            <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t(
              'No events recorded for this window.',
              'No events recorded for this window.'
            )}</div>
          )}
        </Card>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <GhostButton onClick={() => router.push('/frameworks')}>
            <i className="ti ti-arrow-left" aria-hidden="true" />
            {t('Back to scoring', 'Back to scoring')}
          </GhostButton>
        </div>
      </div>
    </>
  );
}

function TrendChart({
  items,
  events,
  frameworkID,
}: {
  items: MonthlyScore[]
  events: TrendEvent[]
  frameworkID: string
}) {
  const { t } = useI18n()

  const width = 720
  const height = 220
  const margin = { top: 12, right: 12, bottom: 36, left: 36 }
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom

  // Build the timeseries.
  //
  // Prefer score-bearing events (framework_scored / status_changed /
  // score_dropped). Score comes from either the backend-stamped Score
  // field (new path) or — for events stored before that field landed
  // — by parsing the trailing percentage out of the description. The
  // text patterns:
  //   "{fw} scored 47.3% (PASS)"            → 47.3
  //   "{fw} status changed: FAIL → WARN (42.3%)" → 42.3
  //   "{fw} score dropped 42.3% → 20.8%"   → 20.8
  // For all three patterns the "current" score is the LAST percentage
  // in the string, so a regex that returns the last match is enough
  // to cover every event type without case-splitting.
  type Point = { t: number; score: number }
  function scoreFromEvent(e: TrendEvent): number | undefined {
    if (typeof e.Score === 'number' && e.Score > 0) return e.Score
    const matches = e.Description.match(/(\d+(?:\.\d+)?)\s*%/g)
    if (!matches || matches.length === 0) return undefined
    const last = matches[matches.length - 1]
    const num = Number.parseFloat(last)
    if (!Number.isFinite(num)) return undefined
    return num / 100
  }
  const scoredEvents: Point[] = events
    .map((e) => ({ t: Date.parse(e.OccurredAt), score: scoreFromEvent(e) }))
    .filter((p): p is Point => Number.isFinite(p.t) && typeof p.score === 'number')
    .sort((a, b) => a.t - b.t)
  const monthlyPoints: Point[] = items.map((p) => ({
    t: Date.UTC(p.Year, p.Month - 1, 15),
    score: p.Score,
  }))
  const usingEvents = scoredEvents.length >= 2
  const points: Point[] = usingEvents ? scoredEvents : monthlyPoints

  // Y axis auto-fit. yMax caps at 1.0; yMin floors at 0.0 — never
  // crop scores away just to look better.
  const scores = points.map((p) => p.score)
  const rawMin = scores.length > 0 ? Math.min(...scores) : 0.7
  const rawMax = scores.length > 0 ? Math.max(...scores) : 1.0
  const span = Math.max(rawMax - rawMin, 0.05)
  const yMin = Math.max(0, Math.floor((rawMin - 0.05 - (span === 0.05 ? 0.05 : 0)) * 20) / 20)
  const yMax = Math.min(1, Math.ceil((rawMax + 0.05 + (span === 0.05 ? 0.05 : 0)) * 20) / 20)
  const tickCount = 5
  const ticks: number[] = []
  for (let i = 0; i < tickCount; i++) {
    ticks.push(yMin + ((yMax - yMin) * i) / (tickCount - 1))
  }
  function y(score: number) {
    if (score >= yMax) return margin.top
    if (score <= yMin) return margin.top + innerH
    const fraction = (score - yMin) / (yMax - yMin)
    return margin.top + innerH * (1 - fraction)
  }

  // X axis: real timestamps. Span is min/max of the visible points
  // (plus a small pad). When all points share one instant (degenerate
  // single-event case) we center the single dot.
  const tMin = points.length > 0 ? points[0].t : Date.now()
  const tMax = points.length > 0 ? points[points.length - 1].t : Date.now()
  const tSpan = Math.max(tMax - tMin, 1)
  function x(t: number) {
    if (points.length <= 1 || tMax === tMin) return margin.left + innerW / 2
    return margin.left + (innerW * (t - tMin)) / tSpan
  }

  const lineColor = FRAMEWORK_COLORS[frameworkID] ?? '#185FA5'

  const path = points
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${x(p.t).toFixed(1)} ${y(p.score).toFixed(1)}`)
    .join(' ')
  const passThresholdVisible = 0.95 >= yMin && 0.95 <= yMax
  const passLine = y(0.95)

  // X-axis date ticks — 5 evenly-spaced, formatted YYYY-MM-DD when
  // span > 60 days, else MM-DD HH:MM. Keeps labels readable across
  // both "12-month overview" and "single-day burst" views.
  const xTickCount = points.length > 1 ? 5 : 1
  const xTicks: number[] = []
  for (let i = 0; i < xTickCount; i++) {
    xTicks.push(tMin + (tSpan * i) / Math.max(xTickCount - 1, 1))
  }
  const labelMode: 'date' | 'datetime' = tSpan > 60 * 86400 * 1000 ? 'date' : 'datetime'
  function fmtTick(ms: number): string {
    const d = new Date(ms)
    if (labelMode === 'date') {
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    }
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {/* Y axis grid — dynamic ticks based on the auto-fit range. */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={margin.left}
              x2={margin.left + innerW}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--color-border-tertiary)"
            />
            <text
              x={margin.left - 6}
              y={y(tick) + 4}
              textAnchor="end"
              fontSize={10}
              fill="var(--color-text-tertiary)"
              fontFamily="var(--font-mono)"
            >
              {(tick * 100).toFixed(0)}%
            </text>
          </g>
        ))}

        {/* PASS-95% dashed guideline — drawn only when it's actually
            inside the visible Y range. Off-screen, it would hug
            the top axis and misrepresent "almost passing". */}
        {passThresholdVisible ? (
          <>
            <line
              x1={margin.left}
              x2={margin.left + innerW}
              y1={passLine}
              y2={passLine}
              stroke="var(--color-status-green-deep)"
              strokeDasharray="4 4"
              strokeOpacity={0.6}
            />
            <text x={margin.left + innerW - 4} y={passLine - 4} textAnchor="end" fontSize={9} fill="var(--color-status-green-deep)">
              {t('PASS 95%', 'PASS 95%')}
            </text>
          </>
        ) : null}

        {/* Event markers — vertical dotted lines at non-score
            events (e.g. config changes, evidence imports). Score-
            bearing events get their own dot from the points loop
            below, so they don't need a separate marker line. */}
        {events
          .filter((e) => typeof e.Score !== 'number')
          .map((event, index) => {
            const ts = Date.parse(event.OccurredAt)
            if (!Number.isFinite(ts) || ts < tMin || ts > tMax) return null
            return (
              <line
                key={`marker-${index}`}
                x1={x(ts)}
                x2={x(ts)}
                y1={margin.top}
                y2={margin.top + innerH}
                stroke={severityChartColor(event.Severity)}
                strokeDasharray="2 3"
                strokeOpacity={0.5}
              />
            )
          })}

        {/* Score line */}
        <path d={path} stroke={lineColor} strokeWidth={2} fill="none" />

        {/* Score points */}
        {points.map((p, index) => (
          <circle
            key={`pt-${index}`}
            cx={x(p.t)}
            cy={y(p.score)}
            r={points.length > 30 ? 2 : 3}
            fill={lineColor}
          />
        ))}

        {/* X-axis date ticks */}
        {xTicks.map((ts, index) => (
          <text
            key={`xt-${index}`}
            x={x(ts)}
            y={margin.top + innerH + 14}
            textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
            fontSize={10}
            fill="var(--color-text-tertiary)"
            fontFamily="var(--font-mono)"
          >
            {fmtTick(ts)}
          </text>
        ))}

        {/* Data-source hint so the operator knows what they're seeing */}
        <text
          x={margin.left + innerW}
          y={margin.top + innerH + 28}
          textAnchor="end"
          fontSize={9}
          fill="var(--color-text-tertiary)"
        >
          {usingEvents
            ? t('{n} events', '{n} events', { n: points.length })
            : t('{n} monthly aggregates', '{n} monthly aggregates', { n: points.length })}
        </text>
      </svg>
    </div>
  );
}

// EventsTable renders the trend events list with the platform-wide
// pagination + scroll pattern: newest first, page-size selector
// (10/20/50/100), bounded scroll height so the page never grows
// without bound.
function EventsTable({
  events,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  events: TrendEvent[]
  page: number
  pageSize: number
  onPage: (n: number) => void
  onPageSize: (n: number) => void
}) {
  const { t } = useI18n()
  // Sort newest first without mutating the prop. Date.parse returns
  // NaN on malformed input; treat NaN as oldest so it sinks to the
  // bottom rather than scrambling the order.
  const sorted = [...events].sort((a, b) => {
    const ta = Date.parse(a.OccurredAt)
    const tb = Date.parse(b.OccurredAt)
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0)
  })
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const paged = sorted.slice(current * pageSize, current * pageSize + pageSize)
  return (
    <>
      <div style={{ maxHeight: 480, overflowY: 'auto' }}>
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
              <th style={{ padding: '6px 10px 6px 0' }}>{t('Date', 'Date')}</th>
              <th style={{ padding: '6px 10px' }}>{t('Type', 'Type')}</th>
              <th style={{ padding: '6px 10px' }}>{t('Severity', 'Severity')}</th>
              <th style={{ padding: '6px 0 6px 10px' }}>{t('Description', 'Description')}</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((event, index) => (
              <tr key={`${event.OccurredAt}-${current}-${index}`} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                <td style={{ padding: '10px 10px 10px 0', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  {formatTimestamp(event.OccurredAt)}
                </td>
                <td style={{ padding: '10px' }}>
                  <Badge tone="gray">{event.Type}</Badge>
                </td>
                <td style={{ padding: '10px' }}>
                  <Badge tone={severityTone(event.Severity)}>{event.Severity}</Badge>
                </td>
                <td style={{ padding: '10px 0 10px 10px', color: 'var(--color-text-secondary)' }}>{event.Description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 8 }}>
        <Pagination
          page={current}
          pageSize={pageSize}
          total={sorted.length}
          onPageChange={onPage}
          onPageSizeChange={onPageSize}
          label={t('Events', 'Events')}
        />
      </div>
    </>
  )
}

function severityTone(severity: string): 'red' | 'amber' | 'gray' | 'blue' {
  switch (severity) {
    case 'critical':
      return 'red'
    case 'warning':
      return 'amber'
    case 'info':
      return 'blue'
    default:
      return 'gray'
  }
}

function severityChartColor(severity: string): string {
  switch (severity) {
    case 'critical':
      return 'var(--color-status-red-mid)'
    case 'warning':
      return 'var(--color-status-amber-mid)'
    default:
      return 'var(--color-status-blue-deep)'
  }
}

function formatTimestamp(value: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z')
}

// keep the unused statusTone reference satisfied — used in CardTitle
// fallback in callers that re-export from this module.
void statusTone
