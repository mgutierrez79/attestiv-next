'use client';
// Coverage Register page (Workstream A3).
//
// Auditor-facing view of the framework's regulation coverage. The
// headline is honest: "N of TOTAL covered", where TOTAL is the
// regulation's actual auditable-unit count (93 for ISO 27001:2022,
// 153 for CIS v8, etc.). Per-entry breakdown shows whether each unit
// is:
//
//   evidenced     — connector telemetry produced a score
//   attested      — covered by a signed in-date policy doc
//   not-evidenced — neither path resolves; auditor treats as not covered
//   out-of-scope  — operator-declared exclusion with a stored reason
//
// The four counts sum exactly to TOTAL. Operators can filter by
// status to focus on the gaps.
//
// Backed by GET /v1/scoring/coverage-register[?framework=...]. When a
// framework has no register declared yet (E1 not done for that
// framework), the page surfaces the gap explicitly rather than
// hiding it behind a zero — "register missing" is a real gap, not a
// silent pass.

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n';

type EffectiveStatus = 'evidenced' | 'attested' | 'not-evidenced' | 'out-of-scope'
type CoverageMode = 'automatable' | 'attestable' | 'out-of-scope'

type RegisterEntry = {
  ref: string
  name: string
  category?: string
  coverage_mode: CoverageMode
  control_id?: string
  effective_status: EffectiveStatus
  reason?: string
  score?: number
  score_status?: string
  evaluated_at?: string
}

type Rollup = {
  total: number
  evidenced: number
  attested: number
  not_evidenced: number
  out_of_scope: number
}

type FrameworkRegister = {
  framework_id: string
  framework_name: string
  yaml_hash?: string
  regulation_total?: number
  coverage_status?: string
  statement?: string
  entries: RegisterEntry[]
  rollup: Rollup
  register_missing?: boolean
  register_missing_reason?: string
  invariant_violation?: string
}

type ListResponse = {
  frameworks: FrameworkRegister[]
  count: number
}

const STATUS_FILTERS: Array<{ key: 'all' | EffectiveStatus; label: string; tone: 'navy' | 'green' | 'amber' | 'red' | 'gray' }> = [
  { key: 'all', label: 'All', tone: 'navy' },
  { key: 'evidenced', label: 'Evidenced', tone: 'green' },
  { key: 'attested', label: 'Attested', tone: 'navy' },
  { key: 'not-evidenced', label: 'Uncovered', tone: 'amber' },
  { key: 'out-of-scope', label: 'Out of scope', tone: 'gray' },
]

export function AttestivCoverageRegisterPage() {
  const { t } = useI18n()
  const [frameworks, setFrameworks] = useState<FrameworkRegister[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedFW, setSelectedFW] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | EffectiveStatus>('all')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const r = await apiFetch('/scoring/coverage-register')
        if (!r.ok) {
          setError(`${r.status} ${r.statusText}`)
          if (!cancelled) setLoading(false)
          return
        }
        const body: ListResponse = await r.json()
        if (!cancelled) {
          setFrameworks(body.frameworks ?? [])
          if (body.frameworks?.length && !selectedFW) {
            setSelectedFW(body.frameworks[0].framework_id)
          }
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'request failed')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const active = useMemo(
    () => frameworks.find((f) => f.framework_id === selectedFW) ?? frameworks[0],
    [frameworks, selectedFW],
  )

  return (
    <>
      <Topbar
        title={t('Controls', 'Controls')}
        left={active ? <Badge tone="navy">{active.framework_name}</Badge> : null}
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {loading ? (
          <Banner tone="info">{t('Loading coverage register…', 'Loading coverage register…')}</Banner>
        ) : null}

        {/* Framework switcher — one chip per loaded framework. */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {frameworks.map((fw) => (
            <button
              key={fw.framework_id}
              type="button"
              onClick={() => setSelectedFW(fw.framework_id)}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: fw.framework_id === active?.framework_id ? 600 : 400,
                border: `1px solid ${fw.framework_id === active?.framework_id ? 'var(--color-status-blue-deep)' : 'var(--color-border-tertiary)'}`,
                background: fw.framework_id === active?.framework_id ? 'var(--color-status-blue-bg)' : 'var(--color-background-primary)',
                color: 'var(--color-text-primary)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {fw.framework_name}
            </button>
          ))}
        </div>

        {active ? (
          <ActiveFrameworkRegister
            fw={active}
            statusFilter={statusFilter}
            onFilter={setStatusFilter}
            t={t}
          />
        ) : !loading ? (
          <Banner tone="info">{t('No frameworks loaded', 'No frameworks loaded')}</Banner>
        ) : null}
      </div>
    </>
  )
}

function ActiveFrameworkRegister({
  fw,
  statusFilter,
  onFilter,
  t,
}: {
  fw: FrameworkRegister
  statusFilter: 'all' | EffectiveStatus
  onFilter: (s: 'all' | EffectiveStatus) => void
  t: (key: string, defaultText?: string) => string
}) {
  const router = useRouter()
  const filteredEntries = useMemo(() => {
    if (statusFilter === 'all') return fw.entries
    return fw.entries.filter((e) => e.effective_status === statusFilter)
  }, [fw.entries, statusFilter])

  const total = fw.rollup?.total ?? 0
  const evidenced = fw.rollup?.evidenced ?? 0
  const attested = fw.rollup?.attested ?? 0
  const notEvidenced = fw.rollup?.not_evidenced ?? 0
  const outOfScope = fw.rollup?.out_of_scope ?? 0
  const covered = evidenced + attested
  const coveragePct = total > 0 ? Math.round((covered / total) * 100) : 0

  if (fw.register_missing) {
    return (
      <Banner tone="warning" title={t('Register not declared', 'Register not declared')}>
        {fw.register_missing_reason ||
          t('No coverage register declared for this framework', 'No coverage register declared for this framework')}
      </Banner>
    )
  }

  return (
    <>
      {/* Headline: N of TOTAL covered, honest breakdown. */}
      <Card>
        <CardTitle right={<Badge tone="navy">{`${coveragePct}%`}</Badge>}>
          {t('Coverage headline', 'Coverage headline')}
        </CardTitle>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 8 }}>
          <Headline label="Total auditable units" value={total} tone="navy" />
          <Headline label="Evidenced (connector)" value={evidenced} tone="green" />
          <Headline label="Attested (signed doc)" value={attested} tone="navy" />
          <Headline label="Uncovered" value={notEvidenced} tone="amber" />
          <Headline label="Out of scope" value={outOfScope} tone="gray" />
        </div>
        {fw.invariant_violation ? (
          <Banner tone="error">
            {t('Invariant violation', 'Invariant violation')}: {fw.invariant_violation}
          </Banner>
        ) : null}
        {fw.statement ? (
          <details style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            <summary style={{ cursor: 'pointer' }}>{t('What this means', 'What this means')}</summary>
            <p style={{ marginTop: 6 }}>{fw.statement}</p>
            {fw.yaml_hash ? (
              <p style={{ marginTop: 4, fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                {t('Framework YAML SHA256', 'Framework YAML SHA256')}: <code>{fw.yaml_hash.slice(0, 16)}…</code>
              </p>
            ) : null}
          </details>
        ) : null}
      </Card>

      {/* Filter chips */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
        {STATUS_FILTERS.map((f) => {
          const count =
            f.key === 'all'
              ? total
              : f.key === 'evidenced'
                ? evidenced
                : f.key === 'attested'
                  ? attested
                  : f.key === 'not-evidenced'
                    ? notEvidenced
                    : outOfScope
          const active = statusFilter === f.key
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => onFilter(f.key)}
              style={{
                padding: '6px 10px',
                fontSize: 11,
                fontWeight: active ? 600 : 400,
                border: `1px solid ${active ? 'var(--color-status-blue-deep)' : 'var(--color-border-tertiary)'}`,
                background: active ? 'var(--color-status-blue-bg)' : 'var(--color-background-primary)',
                color: 'var(--color-text-primary)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              {f.label} <Badge tone={f.tone}>{count}</Badge>
            </button>
          )
        })}
      </div>

      {/* Entry table */}
      <Card>
        <CardTitle right={<Badge tone="navy">{filteredEntries.length}</Badge>}>
          {t('Register entries', 'Register entries')}
        </CardTitle>
        <div style={{ maxHeight: '60vh', overflowY: 'auto', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 'var(--border-radius-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              {['Ref', 'Name', 'Category', 'Mode', 'Status', 'Score'].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '6px 4px',
                    fontWeight: 500,
                    color: 'var(--color-text-tertiary)',
                    position: 'sticky',
                    top: 0,
                    background: 'var(--color-background-primary)',
                    borderBottom: '0.5px solid var(--color-border-tertiary)',
                    zIndex: 1,
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredEntries.map((e) => {
              // Evidenced/attested units backed by a scored control drill
              // into the full scored-control detail — this is what merges
              // "scored controls" into the register: the register is the
              // list, the scored control is the detail.
              const drillable = Boolean(e.control_id)
              return (
              <tr
                key={e.ref}
                onClick={drillable ? () => router.push(`/scoring/frameworks/${encodeURIComponent(fw.framework_id)}/controls/${encodeURIComponent(e.control_id as string)}`) : undefined}
                title={drillable ? t('View scored control detail', 'View scored control detail') : undefined}
                style={{ borderBottom: '0.5px solid var(--color-border-quaternary)', cursor: drillable ? 'pointer' : 'default' }}
              >
                <td style={{ padding: '6px 4px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{e.ref}{drillable ? ' ▸' : ''}</td>
                <td style={{ padding: '6px 4px' }}>{e.name}</td>
                <td style={{ padding: '6px 4px', fontSize: 11, color: 'var(--color-text-tertiary)' }}>{e.category || '—'}</td>
                <td style={{ padding: '6px 4px', fontSize: 11 }}>{e.coverage_mode}</td>
                <td style={{ padding: '6px 4px' }}>
                  <StatusBadge status={e.effective_status} />
                </td>
                <td style={{ padding: '6px 4px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                  {typeof e.score === 'number' ? `${Math.round(e.score * 100)}%` : '—'}
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        </div>
        {/* Inline reasons for out-of-scope rows */}
        {filteredEntries.some((e) => e.effective_status === 'out-of-scope' && e.reason) ? (
          <details style={{ marginTop: 10 }}>
            <summary style={{ fontSize: 11, cursor: 'pointer', color: 'var(--color-text-tertiary)' }}>
              {t('Out-of-scope reasons', 'Out-of-scope reasons')}
            </summary>
            <ul style={{ marginTop: 6, paddingLeft: 18, fontSize: 11 }}>
              {filteredEntries
                .filter((e) => e.effective_status === 'out-of-scope' && e.reason)
                .map((e) => (
                  <li key={e.ref}>
                    <code>{e.ref}</code>: {e.reason}
                  </li>
                ))}
            </ul>
          </details>
        ) : null}
      </Card>
    </>
  )
}

function Headline({ label, value, tone }: { label: string; value: number; tone: 'navy' | 'green' | 'amber' | 'red' | 'gray' }) {
  return (
    <div>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-text-tertiary)' }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color: 'var(--color-text-primary)', marginTop: 2 }}>
        {value}
      </div>
      <Badge tone={tone}>{label.split(' ')[0]}</Badge>
    </div>
  )
}

function StatusBadge({ status }: { status: EffectiveStatus }) {
  switch (status) {
    case 'evidenced':
      return <Badge tone="green">evidenced</Badge>
    case 'attested':
      return <Badge tone="navy">attested</Badge>
    case 'out-of-scope':
      return <Badge tone="gray">out of scope</Badge>
    case 'not-evidenced':
    default:
      return <Badge tone="amber">not evidenced</Badge>
  }
}
