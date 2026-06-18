'use client'
// Per-control "How did I pass?" explainability panels.
//
// Progressive disclosure, board-readable first: narrative lead → headline
// strip → source provenance → "already in flight" linkage → gap list. The
// raw requirement/sub-score/evidence breakdown stays below these (rendered
// by the host page) as the deepest disclosure layer.
//
// All logic lives in src/lib/controlBreakdown.ts; this file is
// presentational. Layout is driven off presentation_mode and every section
// gracefully omits itself when its fields are absent (omitempty contract).

import Link from 'next/link'
import { useCallback, useMemo, useState } from 'react'

import {
  Badge,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  SortableTable,
  StatusBadge,
  type TableColumn,
} from './AttestivUi'
import {
  asScoredBadge,
  citationVerified,
  confidenceSummary,
  confidenceTone,
  downloadSignedBreakdown,
  failingItemsToCSV,
  groupingCallouts,
  hasOpenLinkage,
  measuredHeadline,
  narrativeLines,
  observedBySources,
  resolvePresentationMode,
  sourceIsStale,
  type ControlBreakdown,
  type FailingItem,
} from '../lib/controlBreakdown'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type Translator = (key: string, def: string, vars?: Record<string, string | number>) => string

// NARRATIVE_LABELS maps each narrative line to its prose lead-in label.
const NARRATIVE_LABEL: Record<string, { key: string; def: string }> = {
  requirement: { key: 'control.breakdown.narrative.requirement', def: 'The control asks for' },
  method: { key: 'control.breakdown.narrative.method', def: 'How we measured it' },
  result: { key: 'control.breakdown.narrative.result', def: 'What we found' },
  gap: { key: 'control.breakdown.narrative.gap', def: 'The gap' },
  remediation: { key: 'control.breakdown.narrative.remediation', def: 'What to do' },
}

export function ControlBreakdownPanels({
  data,
  status,
  score,
  onCreateRemediation,
}: {
  data: ControlBreakdown
  // Compliance status/score come from the existing evidence response so the
  // headline strip stays consistent with the rest of the page.
  status: string
  score: number
  onCreateRemediation?: (payload: Record<string, unknown>) => Promise<void> | void
}) {
  const { t } = useI18n()
  const mode = resolvePresentationMode(data.presentation_mode)

  return (
    <>
      <NarrativeBlock data={data} t={t} />
      <HeadlineStrip data={data} status={status} score={score} mode={mode} t={t} />
      <ProvenanceStrip data={data} t={t} />
      <LinkagePanel data={data} t={t} />
      {mode === 'attestation' ? (
        <AttestationPanel data={data} t={t} />
      ) : mode === 'event' ? (
        <EventPanel data={data} t={t} />
      ) : (
        <GapList data={data} mode={mode} t={t} onCreateRemediation={onCreateRemediation} />
      )}
    </>
  )
}

// 1. Narrative block (lead) ------------------------------------------------

function NarrativeBlock({ data, t }: { data: ControlBreakdown; t: Translator }) {
  const lines = narrativeLines(data.narrative)
  const citation = data.narrative?.citation
  const verified = citationVerified(data.narrative?.citation_status)
  if (lines.length === 0 && !citation) return null
  return (
    <Card style={{ marginTop: 12 }}>
      <CardTitle
        right={
          citation ? (
            <Badge tone={verified ? 'green' : 'amber'} icon="ti-bookmark">
              {citation}
            </Badge>
          ) : null
        }
      >
        {t('control.breakdown.why_title', 'How did I pass?')}
      </CardTitle>
      {lines.map((line) => {
        const label = NARRATIVE_LABEL[line.key]
        const isLead = line.key === 'requirement'
        return (
          <p
            key={line.key}
            style={{
              fontSize: isLead ? 14 : 13,
              fontWeight: isLead ? 600 : 400,
              lineHeight: 1.55,
              margin: '0 0 8px',
              color: isLead ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            }}
          >
            <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
              {t(label.key, label.def)}:{' '}
            </span>
            {line.text}
          </p>
        )
      })}
      {citation && !verified ? (
        <p
          style={{
            fontSize: 11,
            color: 'var(--color-status-amber-text)',
            marginTop: 6,
            fontWeight: 500,
          }}
        >
          <i className="ti ti-alert-triangle" aria-hidden="true" style={{ marginRight: 4 }} />
          {t(
            'control.breakdown.citation_unverified',
            'Mapping not yet verified — do not rely on in audit.',
          )}
        </p>
      ) : null}
    </Card>
  )
}

// 2. Headline strip --------------------------------------------------------

function HeadlineStrip({
  data,
  status,
  score,
  mode,
  t,
}: {
  data: ControlBreakdown
  status: string
  score: number
  mode: string
  t: Translator
}) {
  const headline = measuredHeadline(data.measured, data.threshold)
  const conf = confidenceSummary(data.confidence)
  const showRatio = mode !== 'event' // never show "/ 0" math for event controls
  return (
    <Card style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <StatusBadge status={status} />
        <span style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {(score * 100).toFixed(0)}%
        </span>
        {showRatio && headline ? (
          <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {headline.ratio ? `${headline.ratio} = ` : ''}
            {headline.pct ?? '—'}
            {headline.needs
              ? `, ${t('control.breakdown.needs', 'needs {n}', { n: headline.needs })}`
              : ''}
          </span>
        ) : null}
        {conf ? (
          <span style={{ marginLeft: 'auto' }}>
            <Badge tone={confidenceTone(data.confidence?.level)} icon="ti-gauge">
              {t('control.breakdown.confidence', 'Confidence')}: {conf.level}
              {conf.detail ? ` · ${conf.detail}` : ''}
            </Badge>
          </span>
        ) : null}
      </div>
      <AsScoredBadge data={data} t={t} />
    </Card>
  )
}

// AsScoredConsistencyBadge — the additive "as scored / consistency" strip.
// Renders a green chip when the live data still matches what the control was
// scored against, an amber chip when the inventory drifted since scoring,
// a muted "not yet scored" note for an explicit no_snapshot, and nothing at
// all when the block is absent. The scored_at timestamp is interpolated as
// {when}.
function AsScoredBadge({ data, t }: { data: ControlBreakdown; t: Translator }) {
  const badge = asScoredBadge(
    data.as_scored,
    data.reconciliation?.consistency_with_scored,
  )
  if (!badge) {
    // no_snapshot is an explicit (not absent) state — surface it muted so an
    // auditor knows the control hasn't been scored yet, rather than silently
    // omitting. Anything truly absent renders nothing.
    const raw = (
      data.as_scored?.consistency ??
      data.reconciliation?.consistency_with_scored ??
      ''
    )
      .toString()
      .trim()
      .toLowerCase()
    if (raw === 'no_snapshot') {
      return (
        <div style={{ marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
            <i className="ti ti-clock-pause" aria-hidden="true" style={{ marginRight: 4 }} />
            {t('control.breakdown.as_scored_none', 'Not yet scored')}
          </span>
        </div>
      )
    }
    return null
  }
  const rawWhen = data.as_scored?.scored_at
  const when = rawWhen ? new Date(rawWhen).toLocaleString() : ''
  // Per-tone icon + honest default copy. Gray is the muted "can't be
  // automatically reconciled" state — neither a green check (we're NOT
  // claiming consistency) nor an amber warning (it isn't an alarm).
  const icon =
    badge.tone === 'amber'
      ? 'ti-alert-triangle'
      : badge.tone === 'gray'
        ? 'ti-circle-dashed'
        : 'ti-circle-check'
  const fallback =
    badge.tone === 'amber'
      ? 'Inventory changed since this control was scored ({when}) — showing live recompute'
      : badge.tone === 'gray'
        ? "As scored {when} — current data can't be automatically reconciled"
        : 'As scored {when} · consistent with current data'
  return (
    <div style={{ marginTop: 8 }}>
      <Badge tone={badge.tone} icon={icon}>
        {t(badge.messageKey, fallback, { when })}
      </Badge>
    </div>
  )
}

// 3. Source provenance strip ----------------------------------------------

function ProvenanceStrip({ data, t }: { data: ControlBreakdown; t: Translator }) {
  const prov = data.provenance
  const fresh = data.freshness
  const sources = prov?.sources ?? []
  const silent = prov?.silent_sources ?? []
  const unmergeable = prov?.unmergeable
  if (!prov && !fresh) return null
  return (
    <Card style={{ marginTop: 12 }}>
      <CardTitle
        right={
          fresh?.as_of ? (
            <span style={{ fontSize: 11, color: fresh.degraded ? 'var(--color-status-amber-text)' : 'var(--color-text-tertiary)' }}>
              {fresh.degraded ? (
                <i className="ti ti-alert-triangle" aria-hidden="true" style={{ marginRight: 4 }} />
              ) : null}
              {t('control.breakdown.as_of', 'As of')} {new Date(fresh.as_of).toLocaleString()}
            </span>
          ) : null
        }
      >
        {t('control.breakdown.provenance_title', 'Where the evidence came from')}
      </CardTitle>

      {sources.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {sources.map((s, i) => {
            const stale = sourceIsStale(s)
            return (
              <div
                key={`${s.connector}-${i}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, flexWrap: 'wrap' }}
              >
                <Badge tone={stale ? 'amber' : 'green'} dot>
                  {stale ? t('control.breakdown.stale', 'stale') : t('control.breakdown.healthy', 'healthy')}
                </Badge>
                <strong style={{ fontSize: 12 }}>{s.connector || '—'}</strong>
                {typeof s.pre_dedup_count === 'number' ? (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('control.breakdown.pre_dedup', '{n} records (pre-dedup)', { n: s.pre_dedup_count })}
                  </span>
                ) : null}
                {s.last_success ? (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    {t('control.breakdown.last_success', 'last success {when}', {
                      when: new Date(s.last_success).toLocaleString(),
                    })}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : null}

      {silent.length > 0 ? (
        <div
          style={{
            marginTop: 8,
            padding: '8px 10px',
            borderRadius: 'var(--border-radius-md)',
            background: 'var(--color-status-red-bg)',
            color: 'var(--color-status-red-deep)',
            fontSize: 12,
          }}
        >
          <i className="ti ti-bell-off" aria-hidden="true" style={{ marginRight: 6 }} />
          {t('control.breakdown.silent_sources', 'Silent sources (expected but returned nothing)')}:{' '}
          <strong>{silent.join(', ')}</strong>
        </div>
      ) : null}

      {prov?.dedup_rule ? (
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8 }}>
          <span style={{ color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
            {t('control.breakdown.dedup_rule', 'De-duplication rule')}:{' '}
          </span>
          {prov.dedup_rule}
          {prov.dedup_rule_version ? (
            <span style={{ color: 'var(--color-text-tertiary)' }}> ({prov.dedup_rule_version})</span>
          ) : null}
        </p>
      ) : null}

      {unmergeable && typeof unmergeable.count === 'number' && unmergeable.count > 0 ? (
        <p style={{ fontSize: 12, color: 'var(--color-status-amber-text)', marginTop: 6 }}>
          <i className="ti ti-help-circle" aria-hidden="true" style={{ marginRight: 4 }} />
          {t(
            'control.breakdown.unmergeable',
            '{n} assets could not be de-duplicated',
            { n: unmergeable.count },
          )}
          {unmergeable.reason ? ` — ${unmergeable.reason}` : ''}
        </p>
      ) : null}
    </Card>
  )
}

// 4. "Already in flight" linkage panel ------------------------------------

function LinkagePanel({ data, t }: { data: ControlBreakdown; t: Translator }) {
  const linkage = data.linkage
  if (!linkage || (!linkage.risks?.length && !linkage.remediation_tasks?.length && !linkage.rollup)) {
    return null
  }
  const r = linkage.rollup
  return (
    <Card style={{ marginTop: 12 }}>
      <CardTitle>{t('control.breakdown.linkage_title', 'Already in flight')}</CardTitle>
      {r ? (
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: '0 0 10px' }}>
          {t('control.breakdown.rollup', '{gaps} gaps · {risks} open risk(s) · {tasks} task(s) ({overdue} overdue) · {exceptions} accepted exception(s)', {
            gaps: r.gaps ?? 0,
            risks: r.open_risks ?? 0,
            tasks: r.open_tasks ?? 0,
            overdue: r.overdue_tasks ?? 0,
            exceptions: r.accepted_exceptions ?? 0,
          })}
        </p>
      ) : null}

      {linkage.risks && linkage.risks.length > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <div style={labelStyle}>{t('control.breakdown.linked_risks', 'Risks')}</div>
          {linkage.risks.map((risk) => (
            <div key={risk.risk_id} style={linkRowStyle}>
              <Link
                href={`/risks/${encodeURIComponent(risk.risk_id ?? '')}`}
                style={{ color: 'var(--color-brand-blue)', textDecoration: 'none', flex: 1, minWidth: 0 }}
              >
                {risk.title || risk.risk_id}
              </Link>
              {risk.auto_created ? <Badge tone="navy" icon="ti-rocket">{t('control.breakdown.auto', 'auto')}</Badge> : null}
              {risk.severity ? <Badge tone={severityTone(risk.severity)}>{risk.severity}</Badge> : null}
              <Badge tone="gray">{risk.status || '—'}</Badge>
              {risk.owner ? <span style={metaStyle}>{risk.owner}</span> : null}
            </div>
          ))}
        </div>
      ) : null}

      {linkage.remediation_tasks && linkage.remediation_tasks.length > 0 ? (
        <div>
          <div style={labelStyle}>{t('control.breakdown.linked_tasks', 'Remediation tasks')}</div>
          {linkage.remediation_tasks.map((task) => (
            <div key={task.task_id} style={linkRowStyle}>
              <Link
                href={`/remediation/${encodeURIComponent(task.task_id ?? '')}`}
                style={{ color: 'var(--color-brand-blue)', textDecoration: 'none', flex: 1, minWidth: 0 }}
              >
                {task.title || task.task_id}
              </Link>
              {task.auto_created ? <Badge tone="navy" icon="ti-rocket">{t('control.breakdown.auto', 'auto')}</Badge> : null}
              <Badge tone="gray">{task.status || '—'}</Badge>
              {task.owner ? <span style={metaStyle}>{task.owner}</span> : null}
              {task.due_date ? (
                <span style={{ ...metaStyle, color: task.past_due ? 'var(--color-status-red-mid)' : 'var(--color-text-tertiary)' }}>
                  {task.past_due ? t('control.breakdown.overdue', 'overdue') + ' · ' : ''}
                  {task.due_date}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  )
}

// 5. Gap list (proportional / gate) ---------------------------------------

function GapList({
  data,
  mode,
  t,
  onCreateRemediation,
}: {
  data: ControlBreakdown
  mode: string
  t: Translator
  onCreateRemediation?: (payload: Record<string, unknown>) => Promise<void> | void
}) {
  const items = useMemo(() => data.failing_items ?? [], [data.failing_items])
  const callouts = groupingCallouts(data.grouping, items)
  const [showCreate, setShowCreate] = useState(false)

  const exportCSV = useCallback(() => {
    const csv = failingItemsToCSV(items)
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gap-${data.control_id ?? 'control'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [items, data.control_id])

  const columns: TableColumn<FailingItem & Record<string, unknown>>[] = useMemo(
    () => [
      { key: 'name', label: t('control.breakdown.col.name', 'Name'), sortable: true },
      { key: 'asset_type', label: t('control.breakdown.col.asset_type', 'Type'), sortable: true },
      { key: 'owner', label: t('control.breakdown.col.owner', 'Owner'), sortable: true },
      { key: 'business_unit', label: t('control.breakdown.col.business_unit', 'Business unit'), sortable: true },
      { key: 'criticality', label: t('control.breakdown.col.criticality', 'Criticality'), sortable: true },
      { key: 'crown_jewel', label: t('control.breakdown.col.crown_jewel', 'Crown jewel'), align: 'center' },
      { key: 'observed_by', label: t('control.breakdown.col.observed_by', 'Observed by') },
    ],
    [t],
  )

  const title =
    mode === 'gate'
      ? t('control.breakdown.gate_title', 'Requires ALL — {n} exception(s)', { n: items.length })
      : t('control.breakdown.gap_title', 'Failing assets ({n})', { n: items.length })

  return (
    <Card style={{ marginTop: 12 }}>
      <CardTitle
        right={
          <div style={{ display: 'flex', gap: 6 }}>
            <GhostButton onClick={exportCSV} disabled={items.length === 0}>
              <i className="ti ti-download" aria-hidden="true" style={{ fontSize: 12 }} />{' '}
              {t('control.breakdown.export_csv', 'Export CSV')}
            </GhostButton>
            {onCreateRemediation ? (
              <PrimaryButton onClick={() => setShowCreate(true)}>
                <i className="ti ti-plus" aria-hidden="true" />{' '}
                {t('control.breakdown.create_task', 'Create task / risk')}
              </PrimaryButton>
            ) : null}
          </div>
        }
      >
        {title}
      </CardTitle>

      {/* Audit-grade signed export — separate from the convenience CSV
          above. Downloads the offline-verifiable evidence bundle, and
          surfaces the "evaluate first" (409) / error states inline. */}
      <ExportSignedBreakdown
        frameworkId={data.framework_id}
        controlId={data.control_id}
        t={t}
      />

      {/* Grouping summary chips — unowned + crown jewels called out first. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <Badge tone={callouts.unowned > 0 ? 'red' : 'gray'} icon="ti-user-off">
          {t('control.breakdown.unowned', '{n} unowned', { n: callouts.unowned })}
        </Badge>
        <Badge tone={callouts.crownJewel > 0 ? 'red' : 'gray'} icon="ti-diamond">
          {t('control.breakdown.crown_jewels', '{n} crown jewels', { n: callouts.crownJewel })}
        </Badge>
        {(data.grouping?.by_criticality ?? []).map((g) => (
          <Badge key={`crit-${g.key}`} tone="gray">
            {g.key}: {g.count}
          </Badge>
        ))}
      </div>

      <SortableTable
        columns={columns}
        rows={items as (FailingItem & Record<string, unknown>)[]}
        rowKey={(row, i) => String(row.id ?? row.name ?? i)}
        renderCell={(row, col) => {
          if (col.key === 'owner') {
            const owner = (row.owner ?? '').trim()
            return owner ? (
              owner
            ) : (
              <span style={{ color: 'var(--color-status-red-mid)', fontWeight: 600 }}>
                {t('control.breakdown.col.unowned', '(unowned)')}
              </span>
            )
          }
          if (col.key === 'crown_jewel') {
            return row.crown_jewel ? (
              <i
                className="ti ti-diamond"
                aria-label={t('control.breakdown.col.crown_jewel', 'Crown jewel')}
                style={{ color: 'var(--color-status-red-mid)' }}
              />
            ) : (
              <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
            )
          }
          if (col.key === 'observed_by') {
            const sources = observedBySources(row.observed_by)
            return sources.length > 0 ? (
              sources.join(', ')
            ) : (
              <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>
            )
          }
          const v = row[col.key]
          return v == null || v === '' ? <span style={{ color: 'var(--color-text-tertiary)' }}>—</span> : String(v)
        }}
        empty={
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
            {t('control.breakdown.no_failing', 'No failing assets — every measured asset passes.')}
          </div>
        }
        label={t('control.breakdown.gap_label', 'Failing assets')}
      />

      {showCreate ? (
        <CreateRemediationModal
          data={data}
          t={t}
          onClose={() => setShowCreate(false)}
          onCreate={onCreateRemediation!}
        />
      ) : null}
    </Card>
  )
}

// Create remediation task/risk — reuses the Remediation modal shape and
// pre-fills framework_id + control_id. BEFORE creating, it checks the
// linkage block: if an open risk/task already exists for this control it
// warns the user to link to it instead of blindly creating a duplicate.
function CreateRemediationModal({
  data,
  t,
  onClose,
  onCreate,
}: {
  data: ControlBreakdown
  t: Translator
  onClose: () => void
  onCreate: (payload: Record<string, unknown>) => Promise<void> | void
}) {
  const alreadyOpen = hasOpenLinkage(data.linkage)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      await onCreate({
        title,
        framework_id: data.framework_id,
        control_id: data.control_id,
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(3, 35, 74, 0.38)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('control.breakdown.create_task', 'Create task / risk')}
        style={{
          background: 'var(--color-background-primary)',
          borderRadius: 'var(--border-radius-lg)',
          padding: 20,
          width: 'min(520px, 92vw)',
        }}
      >
        <h3 style={{ marginTop: 0, fontSize: 15, fontWeight: 500 }}>
          {t('control.breakdown.create_task', 'Create task / risk')}
        </h3>
        <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          <code>{data.framework_id}/{data.control_id}</code>
        </p>

        {alreadyOpen && !acknowledged ? (
          <div
            data-testid="linkage-warning"
            style={{
              background: 'var(--color-status-amber-bg)',
              color: 'var(--color-status-amber-text)',
              borderRadius: 'var(--border-radius-md)',
              padding: '10px 12px',
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            <i className="ti ti-alert-triangle" aria-hidden="true" style={{ marginRight: 6 }} />
            {t(
              'control.breakdown.already_exists',
              'An open risk/task already exists for this control — link to it instead?',
            )}
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              <GhostButton onClick={() => setAcknowledged(true)}>
                {t('control.breakdown.create_anyway', 'Create anyway')}
              </GhostButton>
            </div>
          </div>
        ) : (
          <>
            <label style={{ display: 'block', marginBottom: 12 }}>
              <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 3 }}>
                {t('control.breakdown.task_title', 'Title')}
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                style={{
                  width: '100%',
                  fontSize: 12,
                  padding: '6px 8px',
                  border: '0.5px solid var(--color-border-secondary)',
                  borderRadius: 'var(--border-radius-md)',
                  background: 'var(--color-background-primary)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </label>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
              <GhostButton onClick={onClose} disabled={busy}>
                {t('common.cancel', 'Cancel')}
              </GhostButton>
              <PrimaryButton onClick={submit} disabled={busy || !title.trim()}>
                {busy ? t('control.breakdown.saving', 'Saving…') : t('control.breakdown.create', 'Create')}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ExportSignedBreakdown — downloads the audit-grade signed export
// (application/zip) for this control via the server-side proxy. The proxy
// (apiFetch) prepends /v1, so we pass the path from /scoring onward.
//
// Behaviour, per contract:
//  - 200 → read the blob, derive the filename from Content-Disposition
//          (falling back to breakdown-{fid}-{cid}.zip), trigger a download,
//          revoke the object URL.
//  - 409 → no scored snapshot yet: show a non-blocking inline message,
//          do NOT download.
//  - any other non-OK / network error → inline error, never throw/crash.
function ExportSignedBreakdown({
  frameworkId,
  controlId,
  t,
}: {
  frameworkId?: string
  controlId?: string
  t: Translator
}) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'amber' | 'red'; text: string } | null>(null)

  const onExport = useCallback(async () => {
    if (!frameworkId || !controlId) return
    setBusy(true)
    setNotice(null)
    const outcome = await downloadSignedBreakdown(frameworkId, controlId, {
      apiFetch,
      createObjectURL: (blob) => URL.createObjectURL(blob),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
      triggerDownload: (url, filename) => {
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
      },
    })
    if (outcome.status === 'needs_evaluation') {
      setNotice({
        tone: 'amber',
        text: t(
          'control.breakdown.export_signed_409',
          'Evaluate this framework first to export a signed breakdown',
        ),
      })
    } else if (outcome.status === 'error') {
      setNotice({
        tone: 'red',
        text: t(
          'control.breakdown.export_signed_error',
          'Could not export the signed breakdown — please try again.',
        ),
      })
    }
    setBusy(false)
  }, [frameworkId, controlId, t])

  if (!frameworkId || !controlId) return null

  return (
    <div style={{ marginTop: 4, marginBottom: 10 }}>
      <span
        title={t(
          'control.breakdown.export_signed_tooltip',
          'Signed, offline-verifiable evidence bundle',
        )}
        style={{ display: 'inline-block' }}
      >
        <GhostButton onClick={onExport} disabled={busy}>
          <i className="ti ti-file-certificate" aria-hidden="true" style={{ fontSize: 12 }} />{' '}
          {busy
            ? t('control.breakdown.saving', 'Saving…')
            : t('control.breakdown.export_signed', 'Export signed breakdown')}
        </GhostButton>
      </span>
      {notice ? (
        <p
          data-testid="export-signed-notice"
          style={{
            fontSize: 12,
            marginTop: 6,
            color:
              notice.tone === 'amber'
                ? 'var(--color-status-amber-text)'
                : 'var(--color-status-red-deep)',
          }}
        >
          <i
            className={notice.tone === 'amber' ? 'ti ti-info-circle' : 'ti ti-alert-triangle'}
            aria-hidden="true"
            style={{ marginRight: 4 }}
          />
          {notice.text}
        </p>
      ) : null}
    </div>
  )
}

// Event-mode panel — never a percentage with denominator 0. Shows the
// observed event list (failing_items reused as the event records) or an
// N/A note when there are none.
function EventPanel({ data, t }: { data: ControlBreakdown; t: Translator }) {
  const items = data.failing_items ?? []
  return (
    <Card style={{ marginTop: 12 }}>
      <CardTitle>{t('control.breakdown.event_title', 'Events on record')}</CardTitle>
      {items.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {t('control.breakdown.event_none', 'No qualifying event on record (N/A — not a proportion).')}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {items.map((item, i) => {
            const sources = observedBySources(item.observed_by)
            return (
              <li
                key={item.id ?? i}
                style={{ padding: '6px 0', borderTop: '0.5px solid var(--color-border-tertiary)', fontSize: 13 }}
              >
                <strong>{item.name || item.id}</strong>
                {item.asset_type ? <span style={metaStyle}> · {item.asset_type}</span> : null}
                {sources.length > 0 ? (
                  <span style={metaStyle}>
                    {' · '}
                    {t('control.breakdown.observed_by', 'observed by {sources}', { sources: sources.join(', ') })}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

// Attestation-mode panel — the backend sends NO signed-doc block here
// (narrative + threshold + linkage only). Rather than fabricate one, point
// the auditor to the coverage register / attestation path where the signed
// document and its provenance actually live.
function AttestationPanel({ t }: { data: ControlBreakdown; t: Translator }) {
  return (
    <Card style={{ marginTop: 12 }}>
      <CardTitle>{t('control.breakdown.attestation_title', 'Signed attestation')}</CardTitle>
      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.55 }}>
        <i className="ti ti-info-circle" aria-hidden="true" style={{ marginRight: 6 }} />
        {t(
          'control.breakdown.attestation_caption',
          'This control is satisfied by a signed attestation. See the coverage register for the attesting document and its signature provenance.',
        )}
      </p>
    </Card>
  )
}

// severityTone maps a risk severity label to a badge tone. Defaults to gray
// for unknown/absent so an unrecognised severity never reads as critical.
function severityTone(severity?: string): 'red' | 'amber' | 'gray' {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
    case 'high':
      return 'red'
    case 'medium':
    case 'moderate':
      return 'amber'
    default:
      return 'gray'
  }
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-tertiary)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  marginBottom: 4,
}
const linkRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 0',
  borderTop: '0.5px solid var(--color-border-tertiary)',
  fontSize: 12,
  flexWrap: 'wrap',
}
const metaStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-text-tertiary)',
}
