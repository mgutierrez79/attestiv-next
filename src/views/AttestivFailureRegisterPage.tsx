'use client'
// W1-3 Control-failure duration register.
//
// The risk register answers "what is broken?" — this page answers
// "how long has it been broken, and is this a repeat offender?". The
// auditor question DORA Art.5 / ISO 8.13 want answered: control X has
// been FAIL for 23 days, who owns it, what's the longest historical
// streak. Data is derived in the backend from the existing risk
// register (created_at of an open auto_scoring risk is the streak
// start; closed history rows are completed streaks), so this view
// doesn't introduce a new source of truth — it surfaces what was
// already encoded but previously invisible.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  HeroBand,
  PaginatedList,
  Skeleton,
  StatPill,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type Item = {
  risk_id: string
  framework_id: string
  framework_name?: string
  control_id: string
  control_name?: string
  control_area?: string
  current_status: string
  failing_since: string
  consecutive_days: number
  longest_streak_days: number
  previous_streaks: number
  owner?: string
  score: number
  title?: string
}

type Summary = {
  controls_failing: number
  failing_gt_30_days: number
  failing_gt_60_days: number
  failing_gt_90_days: number
  failing_gt_180_days: number
}

type Report = {
  items: Item[]
  count: number
  summary: Summary
}

const STATUS_TONE: Record<string, 'amber' | 'red' | 'navy' | 'gray'> = {
  FAIL: 'red',
  WARN: 'amber',
  REVIEW: 'navy',
}

// durationTone classifies the streak. >30d is the standard remediation
// SLA breach; >90d is the audit-finding territory. Tones map 1:1 onto
// the existing Badge palette so the page reads consistently with the
// rest of the console.
function durationTone(days: number): 'green' | 'amber' | 'red' {
  if (days > 90) return 'red'
  if (days > 30) return 'amber'
  return 'green'
}

function humanizeSince(iso: string, days: number): string {
  if (!iso) return `${days}d ago`
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return `${days}d ago`
    return `${d.toLocaleDateString()} (${days}d ago)`
  } catch {
    return `${days}d ago`
  }
}

export function AttestivFailureRegisterPage() {
  const { t } = useI18n()
  const router = useRouter()
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const r = await apiFetch('/risks/failure-register')
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        const body = (await r.json()) as Report
        if (!cancelled) {
          setReport({
            items: Array.isArray(body?.items) ? body.items : [],
            count: typeof body?.count === 'number' ? body.count : 0,
            summary: body?.summary ?? {
              controls_failing: 0,
              failing_gt_30_days: 0,
              failing_gt_60_days: 0,
              failing_gt_90_days: 0,
              failing_gt_180_days: 0,
            },
          })
        }
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load failure register')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const items = report?.items ?? []
  const summary = report?.summary

  // worstDays is the headline number — "the most aged failing control
  // on the floor is X days old". Empty register reads as "—" so we
  // don't print a misleading "0 days".
  const worstDays = useMemo(() => {
    if (items.length === 0) return null
    return items[0].consecutive_days
  }, [items])

  return (
    <>
      <Topbar
        title={t('Failure-duration register', 'Failure-duration register')}
        left={<Badge tone="navy">{items.length} {t('failing now', 'failing now')}</Badge>}
        right={
          <GhostButton onClick={() => router.push('/risks')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back to risks', 'Back to risks')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        {!loading ? (
          <HeroBand
            label={t('Worst-aged failure', 'Worst-aged failure')}
            value={worstDays !== null ? `${worstDays}d` : '—'}
            caption={
              items.length > 0
                ? `${items[0].framework_id?.toUpperCase()} ${items[0].control_id} — ${items[0].control_name || items[0].title || ''}`
                : t('No controls currently failing', 'No controls currently failing')
            }
            pills={
              <>
                <StatPill
                  label={t('Currently failing', 'Currently failing')}
                  value={String(summary?.controls_failing ?? 0)}
                />
                <StatPill
                  label={t('> 30 days', '> 30 days')}
                  value={String(summary?.failing_gt_30_days ?? 0)}
                  valueColor={(summary?.failing_gt_30_days ?? 0) > 0 ? 'var(--color-status-amber-deep)' : undefined}
                />
                <StatPill
                  label={t('> 60 days', '> 60 days')}
                  value={String(summary?.failing_gt_60_days ?? 0)}
                  valueColor={(summary?.failing_gt_60_days ?? 0) > 0 ? 'var(--color-status-amber-deep)' : undefined}
                />
                <StatPill
                  label={t('> 90 days', '> 90 days')}
                  value={String(summary?.failing_gt_90_days ?? 0)}
                  valueColor={(summary?.failing_gt_90_days ?? 0) > 0 ? 'var(--color-status-red-deep)' : undefined}
                />
              </>
            }
          />
        ) : null}

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{t('sorted by current duration', 'sorted by current duration')}</span>}>
            {t('Currently failing controls', 'Currently failing controls')}
          </CardTitle>
          {loading ? (
            <Skeleton lines={6} height={48} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="ti-checks"
              title={t('No failing controls', 'No failing controls')}
              description={t(
                'Every control with an auto-risk is either recovered or never opened a streak. The register will populate the next time a control drops to FAIL, WARN, or REVIEW.',
                'Every control with an auto-risk is either recovered or never opened a streak. The register will populate the next time a control drops to FAIL, WARN, or REVIEW.',
              )}
            />
          ) : (
            <PaginatedList
              items={items}
              itemKey={(item) => item.risk_id}
              renderItem={(item) => <Row item={item} onOpen={() => router.push(`/risks/${item.risk_id}`)} />}
            />
          )}
        </Card>
      </div>
    </>
  )
}

function Row({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const { t } = useI18n()
  const tone = STATUS_TONE[item.current_status] ?? 'gray'
  const dTone = durationTone(item.consecutive_days)
  const repeat = item.previous_streaks > 0
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen()
      }}
      style={{
        cursor: 'pointer',
        padding: '10px 12px',
        borderRadius: 'var(--border-radius-sm)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr) auto auto auto',
        gap: 12,
        alignItems: 'center',
        background: 'var(--color-background-secondary)',
        marginBottom: 6,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {item.control_name || item.title || item.control_id}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(item.framework_id || '').toUpperCase()} · {item.control_id}
          {item.control_area ? ` · ${item.control_area}` : ''}
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {t('Failing since', 'Failing since')} {humanizeSince(item.failing_since, item.consecutive_days)}
      </div>
      <Badge tone={tone}>{item.current_status || '—'}</Badge>
      <Badge tone={dTone}>
        {item.consecutive_days}d {t('current', 'current')}
      </Badge>
      <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
        {t('longest', 'longest')} {item.longest_streak_days}d
        {repeat ? ` · ${item.previous_streaks} ${t('prior', 'prior')}` : ''}
      </span>
    </div>
  )
}
