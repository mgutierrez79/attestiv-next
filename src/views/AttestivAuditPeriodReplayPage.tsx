'use client'
// W2-1 Period-state replay.
//
// Auditor question: "what did my compliance posture look like on
// 2026-04-15?" — the answer is in the scoring_records table (every
// framework_result is retained with its occurred_at), but until this
// page existed there was no way to actually ask it.
//
// The page is a date-time picker + a button that hits
// /v1/scoring/at-time?at=<RFC3339>, then renders the framework cards
// using the same shapes as the live Frameworks page so the auditor
// reads identical visuals — "live" vs "as of" is the only difference.
//
// Honest absence: frameworks that hadn't been evaluated by the chosen
// date come back as status=no_data, NOT as 0%, so an auditor doesn't
// misread an unevaluated framework as a 0% failure.

import { useMemo, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  HeroBand,
  PrimaryButton,
  Skeleton,
  StatPill,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type FrameworkItem = {
  framework_id: string
  framework_name?: string
  score?: number
  status?: string
  total_controls?: number
  passing_controls?: number
  warn_controls?: number
  review_controls?: number
  fail_controls?: number
  evaluated_at?: string
  coverage?: {
    regulation_total?: number
    covered?: number
    status?: string
  }
}

type Response = {
  items: FrameworkItem[]
  count: number
  as_of: string
  is_replay: boolean
}

// defaultAsOfInput returns "YYYY-MM-DDTHH:MM" — the format the HTML
// datetime-local input accepts — defaulted to the start of the last
// month (a sensible "what was the posture at the start of the audit
// period" pre-fill).
function defaultAsOfInput(): string {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - 1)
  d.setHours(0, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toRFC3339(localInput: string): string {
  // datetime-local emits "2026-04-15T12:00" (no tz). We interpret as
  // local time and convert to UTC RFC3339 — the backend stores in UTC,
  // so this round-trips correctly.
  const d = new Date(localInput)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString()
}

function scorePct(item: FrameworkItem): number {
  const raw = typeof item.score === 'number' ? item.score : 0
  const pct = raw <= 1 ? raw * 100 : raw
  return Math.max(0, Math.min(100, Math.round(pct)))
}

function statusTone(status?: string): 'green' | 'amber' | 'red' | 'gray' {
  switch ((status || '').toLowerCase()) {
    case 'pass':
      return 'green'
    case 'warn':
    case 'review':
      return 'amber'
    case 'fail':
      return 'red'
    default:
      return 'gray'
  }
}

export function AttestivAuditPeriodReplayPage() {
  const { t } = useI18n()
  const [asOfInput, setAsOfInput] = useState<string>(defaultAsOfInput)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [response, setResponse] = useState<Response | null>(null)

  async function replay() {
    setError(null)
    setBusy(true)
    setResponse(null)
    try {
      const at = toRFC3339(asOfInput)
      if (!at) throw new Error(t('Enter a valid date and time', 'Enter a valid date and time'))
      const r = await apiFetch(`/scoring/at-time?at=${encodeURIComponent(at)}`)
      if (!r.ok) {
        const body = await r.text().catch(() => '')
        throw new Error(body || `${r.status} ${r.statusText}`)
      }
      const body = (await r.json()) as Response
      setResponse({
        items: Array.isArray(body?.items) ? body.items : [],
        count: typeof body?.count === 'number' ? body.count : 0,
        as_of: body?.as_of ?? at,
        is_replay: Boolean(body?.is_replay),
      })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Replay failed')
    } finally {
      setBusy(false)
    }
  }

  const items = response?.items ?? []
  const evaluatedItems = items.filter((i) => (i.status || '').toLowerCase() !== 'no_data')

  const hero = useMemo(() => {
    if (evaluatedItems.length === 0) return { avg: 0, count: 0 }
    const sum = evaluatedItems.reduce((acc, i) => acc + scorePct(i), 0)
    return { avg: Math.round(sum / evaluatedItems.length), count: evaluatedItems.length }
  }, [evaluatedItems])

  const noDataCount = items.length - evaluatedItems.length

  return (
    <>
      <Topbar
        title={t('Period-state replay', 'Period-state replay')}
        left={response ? <Badge tone="navy">{t('as of', 'as of')} {new Date(response.as_of).toLocaleString()}</Badge> : null}
        right={
          <GhostButton onClick={() => { if (typeof window !== 'undefined') window.location.href = '/audit' }}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Back to audit', 'Back to audit')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Card>
          <CardTitle>{t('Pick an audit-period timestamp', 'Pick an audit-period timestamp')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
            {t(
              'Reconstructs the framework scores the engine recorded at the chosen moment. Frameworks not yet evaluated by that date appear as "no data" — never as 0%.',
              'Reconstructs the framework scores the engine recorded at the chosen moment. Frameworks not yet evaluated by that date appear as "no data" — never as 0%.',
            )}
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="datetime-local"
              value={asOfInput}
              onChange={(e) => setAsOfInput(e.target.value)}
              disabled={busy}
              style={{
                padding: '8px 10px',
                borderRadius: 'var(--border-radius-sm)',
                border: '1px solid var(--color-border-secondary)',
                background: 'var(--color-background-secondary)',
                color: 'var(--color-text-primary)',
                fontSize: 13,
              }}
            />
            <PrimaryButton onClick={replay} disabled={busy}>
              {busy ? (
                <>
                  <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                  {t('Replaying…', 'Replaying…')}
                </>
              ) : (
                <>
                  <i className="ti ti-history" aria-hidden="true" /> {t('Replay state', 'Replay state')}
                </>
              )}
            </PrimaryButton>
          </div>
        </Card>

        {response ? (
          <HeroBand
            label={t('Posture as of', 'Posture as of')}
            value={hero.count > 0 ? `${hero.avg}%` : '—'}
            percent={hero.avg}
            caption={
              hero.count > 0
                ? `${t('average across', 'average across')} ${hero.count} ${t('evaluated frameworks at that moment', 'evaluated frameworks at that moment')}`
                : t('No frameworks had been evaluated yet', 'No frameworks had been evaluated yet')
            }
            pills={
              <>
                <StatPill
                  label={t('Frameworks', 'Frameworks')}
                  value={String(items.length)}
                  sub={`${hero.count} ${t('evaluated', 'evaluated')}`}
                />
                <StatPill
                  label={t('No data at this date', 'No data at this date')}
                  value={String(noDataCount)}
                  valueColor={noDataCount > 0 ? 'var(--color-text-tertiary)' : undefined}
                />
                <StatPill label={t('Snapshot UTC', 'Snapshot UTC')} value={new Date(response.as_of).toISOString().slice(0, 16) + 'Z'} />
              </>
            }
          />
        ) : null}

        {response ? (
          <Card style={{ marginTop: 12 }}>
            <CardTitle right={<span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{response.count} {t('frameworks', 'frameworks')}</span>}>
              {t('Frameworks at this moment', 'Frameworks at this moment')}
            </CardTitle>
            {busy ? (
              <Skeleton lines={6} height={56} />
            ) : items.length === 0 ? (
              <EmptyState
                icon="ti-history-off"
                title={t('Nothing scored yet', 'Nothing scored yet')}
                description={t('The platform had not evaluated any framework by the chosen date.', 'The platform had not evaluated any framework by the chosen date.')}
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                {items.map((item) => (
                  <FrameworkCard key={item.framework_id} item={item} />
                ))}
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </>
  )
}

function FrameworkCard({ item }: { item: FrameworkItem }) {
  const { t } = useI18n()
  const noData = (item.status || '').toLowerCase() === 'no_data'
  const pct = scorePct(item)
  const tone = noData ? 'gray' : statusTone(item.status)
  return (
    <Card>
      <CardTitle right={<Badge tone={tone}>{noData ? t('no data', 'no data') : `${pct}%`}</Badge>}>
        {item.framework_name || item.framework_id.toUpperCase()}
      </CardTitle>
      {noData ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>
          {t('Not evaluated by this date.', 'Not evaluated by this date.')}
        </p>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div>
            <strong>{item.passing_controls ?? 0}</strong> {t('passing', 'passing')} ·{' '}
            <strong>{item.review_controls ?? 0}</strong> {t('review', 'review')} ·{' '}
            <strong>{item.warn_controls ?? 0}</strong> {t('warn', 'warn')} ·{' '}
            <strong>{item.fail_controls ?? 0}</strong> {t('fail', 'fail')} {t('of', 'of')}{' '}
            <strong>{item.total_controls ?? 0}</strong>
          </div>
          {item.evaluated_at ? (
            <div style={{ color: 'var(--color-text-tertiary)' }}>
              {t('Evaluated at', 'Evaluated at')} {new Date(item.evaluated_at).toLocaleString()}
            </div>
          ) : null}
        </div>
      )}
    </Card>
  )
}
