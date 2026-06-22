'use client';
// Dashboard / Posture history.
//
// 30/60/90-day compliance score trend per framework. The dashboard
// shows current posture; this page shows the slope. Compliance
// managers care about whether they're trending up or down between
// audits — a flat 92% might be fine but a 92% that started at 96% a
// month ago is an issue.
//
// Backed by /v1/scores/history. The chart is hand-rendered SVG: a
// single sparkline per framework with the latest value on the right.
// Heavier charting (Recharts/Visx) is overkill for a four-line
// dashboard widget that doesn't need axes or tooltips.

import { useEffect, useId, useState } from 'react'

import {
  Badge,
  Card,
  CardTitle,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { isDemoMode } from '../lib/demoMode'
import {
  areaPath,
  downsample,
  formatScore,
  smoothPath,
  toPoints,
  yDomain,
} from '../lib/postureSparkline'

import { useI18n } from '../lib/i18n';

type ScorePoint = {
  date: string
  value: number
}

type FrameworkSeries = {
  framework: string
  current: number
  history: ScorePoint[]
}

const DEMO_SERIES: FrameworkSeries[] = [
  {
    framework: 'SOC 2',
    current: 96,
    history: [88, 89, 90, 91, 91, 92, 92, 93, 94, 94, 95, 96].map((value, index) => ({
      date: dateNDaysAgo(11 - index),
      value,
    })),
  },
  {
    framework: 'ISO 27001',
    current: 91,
    history: [82, 83, 85, 87, 88, 89, 89, 90, 90, 91, 91, 91].map((value, index) => ({
      date: dateNDaysAgo(11 - index),
      value,
    })),
  },
  {
    framework: 'PCI DSS 4.0',
    current: 84,
    history: [70, 72, 74, 76, 78, 79, 80, 81, 82, 83, 84, 84].map((value, index) => ({
      date: dateNDaysAgo(11 - index),
      value,
    })),
  },
  {
    framework: 'CIS Controls v8',
    current: 89,
    history: [86, 87, 88, 88, 87, 88, 88, 89, 89, 89, 89, 89].map((value, index) => ({
      date: dateNDaysAgo(11 - index),
      value,
    })),
  },
]

export function AttestivPostureHistoryPage() {
  const {
    t
  } = useI18n();

  const [series, setSeries] = useState<FrameworkSeries[]>([])
  const [usingDemo, setUsingDemo] = useState(false)
  const [window, setWindow] = useState<30 | 60 | 90>(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const allowDemo = isDemoMode()
    async function load() {
      try {
        const response = await apiFetch(`/scoring/history?days=${window}`)
        if (!response.ok) throw new Error(`${response.status}`)
        const body = await response.json().catch(() => ({}))
        const items: any[] = Array.isArray(body?.items) ? body.items : []
        const grouped = groupByFramework(items)
        if (!cancelled) {
          if (grouped.length > 0) {
            setSeries(grouped)
            setUsingDemo(false)
          } else if (allowDemo) {
            setSeries(DEMO_SERIES)
            setUsingDemo(true)
          } else {
            setSeries([])
            setUsingDemo(false)
          }
        }
      } catch {
        if (!cancelled) {
          if (allowDemo) {
            setSeries(DEMO_SERIES)
            setUsingDemo(true)
          } else {
            setSeries([])
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
  }, [window])

  return (
    <>
      <Topbar
        title={t('Compliance posture', 'Compliance posture')}
        left={usingDemo ? <Badge tone="amber">{t(
          'Demo trend — no historical scores yet',
          'Demo trend — no historical scores yet'
        )}</Badge> : null}
        right={<WindowToggle value={window} onChange={setWindow} />}
      />
      <div className="attestiv-content">
        {loading ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('Loading…', 'Loading…')}</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: 12,
            }}
          >
            {series.map((entry) => (
              <FrameworkSparklineCard key={entry.framework} series={entry} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function FrameworkSparklineCard({ series }: { series: FrameworkSeries }) {
  const {
    t
  } = useI18n();

  const tone: 'green' | 'amber' | 'red' = series.current >= 95 ? 'green' : series.current >= 85 ? 'amber' : 'red'
  const trend = trendDelta(series.history)
  const trendColor = trend > 0 ? 'var(--color-status-green-deep)' : trend < 0 ? 'var(--color-status-red-deep)' : 'var(--color-text-tertiary)'
  return (
    <Card>
      <CardTitle right={<Badge tone={tone}>{formatScore(series.current)}%</Badge>}>
        {series.framework}
      </CardTitle>
      <Sparkline points={series.history} tone={tone} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
        <span>{series.history.length} {t('data points', 'data points')}</span>
        <span style={{ color: trendColor, fontWeight: 500 }}>
          {trend > 0 ? '↑' : trend < 0 ? '↓' : '–'} {Math.abs(trend).toFixed(1)} pts
        </span>
      </div>
    </Card>
  );
}

function Sparkline({ points, tone }: { points: ScorePoint[]; tone: 'green' | 'amber' | 'red' }) {
  const {
    t
  } = useI18n();
  const gradientId = useId()

  if (points.length === 0) {
    return <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('No data.', 'No data.')}</div>;
  }
  const width = 320
  const height = 60
  // Bucket ~1000 raw samples down to a readable ~120-point trend. downsample()
  // takes each bucket's median, so lone transient dips are smoothed away while
  // sustained drops survive (see lib/postureSparkline.ts).
  const values = downsample(points.map((point) => point.value), 120)
  const domain = yDomain(values)
  const coords = toPoints(values, width, height, domain)
  const linePath = smoothPath(coords)
  const fillPath = areaPath(linePath, width, height)
  const last = coords[coords.length - 1]

  const stroke =
    tone === 'green'
      ? 'var(--color-status-green-mid)'
      : tone === 'amber'
        ? 'var(--color-status-amber-mid)'
        : 'var(--color-status-red-mid)'
  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
          <stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        stroke={stroke}
        strokeWidth={2}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last.x} cy={last.y} r={3} fill={stroke} stroke="var(--color-background-primary)" strokeWidth={1.5} />
    </svg>
  )
}

function WindowToggle({
  value,
  onChange,
}: {
  value: 30 | 60 | 90
  onChange: (v: 30 | 60 | 90) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        background: 'var(--color-background-secondary)',
        padding: 3,
        borderRadius: 'var(--border-radius-md)',
      }}
    >
      {[30, 60, 90].map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option as 30 | 60 | 90)}
          style={{
            background: value === option ? 'var(--color-background-primary)' : 'transparent',
            color: value === option ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
            border: 'none',
            padding: '4px 10px',
            borderRadius: 'var(--border-radius-md)',
            fontSize: 11,
            fontWeight: value === option ? 500 : 400,
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {option}d
        </button>
      ))}
    </div>
  )
}

function groupByFramework(items: any[]): FrameworkSeries[] {
  const map = new Map<string, ScorePoint[]>()
  for (const item of items) {
    const framework = String(item?.framework ?? '')
    if (!framework) continue
    const value = Number(item?.score ?? item?.value ?? 0)
    if (!Number.isFinite(value)) continue
    const date = String(item?.timestamp ?? item?.date ?? '')
    if (!date) continue
    if (!map.has(framework)) map.set(framework, [])
    map.get(framework)!.push({ date, value })
  }
  return Array.from(map.entries()).map(([framework, history]) => {
    const sorted = history.sort((a, b) => a.date.localeCompare(b.date))
    return {
      framework,
      current: sorted.length > 0 ? sorted[sorted.length - 1].value : 0,
      history: sorted,
    }
  })
}

function trendDelta(points: ScorePoint[]): number {
  if (points.length < 2) return 0
  return points[points.length - 1].value - points[0].value
}

function dateNDaysAgo(n: number): string {
  const date = new Date()
  date.setDate(date.getDate() - n)
  return date.toISOString().slice(0, 10)
}
