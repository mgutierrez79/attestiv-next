'use client';
// Audit ▸ Pre-packet ▸ Diff — Q1-vs-Q2 posture comparison.
//
// Operator uploads a prior signed pre-packet zip; the server
// generates the current packet in-memory from live tenant state,
// then ships back a structured delta showing what improved, what
// regressed, and (the killer detail) which framework YAMLs were
// edited between captures (yaml_hash_changed=true).
//
// The auditor's value: a single click answers "did the customer's
// posture actually improve, or did they just edit the rules?".

import { useState } from 'react'
import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n'

type FrameworkDelta = {
  framework_id: string
  base_score?: number
  current_score?: number
  base_status?: string
  current_status?: string
  base_yaml_sha256?: string
  current_yaml_sha256?: string
  score_delta_pp?: number
  status_changed?: boolean
  yaml_hash_changed?: boolean
  framework_added?: boolean
  framework_removed?: boolean
}

type GapRow = {
  framework_id: string
  control_id: string
  control_name: string
  status: string
  score: string
  finding_code: string
  finding_description: string
}

type DiffResult = {
  framework_score_delta: FrameworkDelta[]
  new_gaps: GapRow[]
  closed_gaps: GapRow[]
  summary: {
    frameworks_compared: number
    new_gap_count: number
    closed_gap_count: number
    yaml_changes: number
    status_changes: number
  }
  base_manifest_summary?: { generated_at?: string; tenant_id?: string }
  current_manifest_summary?: { generated_at?: string; tenant_id?: string }
}

export function AttestivAuditPrepacketDiffPage() {
  const { t } = useI18n()
  const [file, setFile] = useState<File | null>(null)
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runDiff() {
    if (!file) return
    setRunning(true)
    setError(null)
    setDiff(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const r = await apiFetch('/audit/prepacket-diff', { method: 'POST', body: form })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(text || `${r.status} ${r.statusText}`)
      }
      setDiff((await r.json()) as DiffResult)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Diff failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <>
      <Topbar
        title={t('Pre-packet diff', 'Pre-packet diff')}
        left={
          diff ? (
            <Badge tone="navy">
              {diff.summary.frameworks_compared} {t('frameworks compared', 'frameworks compared')}
            </Badge>
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Banner tone="info" title={t('What this answers', 'What this answers')}>
          {t(
            'Upload a previously-generated signed pre-packet (the BASE). The server generates the CURRENT packet in-memory from live tenant state, then ships back a structured delta: what improved, what regressed, which framework YAMLs were edited between captures. The yaml_hash_changed flag is the auditor\'s killer detail — it distinguishes a real posture change from a control-rules edit.',
            'Upload a previously-generated signed pre-packet (the BASE). The server generates the CURRENT packet in-memory from live tenant state, then ships back a structured delta: what improved, what regressed, which framework YAMLs were edited between captures. The yaml_hash_changed flag is the auditor\'s killer detail — it distinguishes a real posture change from a control-rules edit.',
          )}
        </Banner>

        <Card style={{ marginTop: 10 }}>
          <CardTitle right={<Badge tone="navy">{t('Ed25519 verified base', 'Ed25519 verified base')}</Badge>}>
            {t('Step 1 — upload the base packet', 'Step 1 — upload the base packet')}
          </CardTitle>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              style={{ fontSize: 12 }}
            />
            <PrimaryButton onClick={runDiff} disabled={!file || running}>
              <i className="ti ti-arrows-diff" aria-hidden="true" />
              {running ? t('Computing diff…', 'Computing diff…') : t('Compute diff', 'Compute diff')}
            </PrimaryButton>
            {diff ? (
              <GhostButton onClick={() => { setDiff(null); setFile(null) }}>
                {t('Reset', 'Reset')}
              </GhostButton>
            ) : null}
          </div>
        </Card>

        {diff ? (
          <>
            <Card style={{ marginTop: 12 }}>
              <CardTitle>{t('Summary', 'Summary')}</CardTitle>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 4 }}>
                <Stat label={t('Frameworks compared', 'Frameworks compared')} value={diff.summary.frameworks_compared} />
                <Stat label={t('Status changes', 'Status changes')} value={diff.summary.status_changes} tone={diff.summary.status_changes > 0 ? 'amber' : undefined} />
                <Stat label={t('YAML edited', 'YAML edited')} value={diff.summary.yaml_changes} tone={diff.summary.yaml_changes > 0 ? 'red' : undefined} />
                <Stat label={t('New gaps', 'New gaps')} value={diff.summary.new_gap_count} tone={diff.summary.new_gap_count > 0 ? 'red' : undefined} />
                <Stat label={t('Closed gaps', 'Closed gaps')} value={diff.summary.closed_gap_count} tone={diff.summary.closed_gap_count > 0 ? 'green' : undefined} />
              </div>
              <div style={{ display: 'flex', gap: 24, fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 10, flexWrap: 'wrap' }}>
                {diff.base_manifest_summary?.generated_at ? <span>{t('Base captured', 'Base captured')}: {diff.base_manifest_summary.generated_at.slice(0, 19).replace('T', ' ')}</span> : null}
                {diff.current_manifest_summary?.generated_at ? <span>{t('Current', 'Current')}: {diff.current_manifest_summary.generated_at.slice(0, 19).replace('T', ' ')}</span> : null}
              </div>
            </Card>

            <Card style={{ marginTop: 12 }}>
              <CardTitle>{t('Per-framework delta', 'Per-framework delta')}</CardTitle>
              <table style={tableStyle}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 11 }}>
                    <th style={th}>{t('Framework', 'Framework')}</th>
                    <th style={th}>{t('Base score', 'Base score')}</th>
                    <th style={th}>{t('Current score', 'Current score')}</th>
                    <th style={th}>{t('Δpp', 'Δpp')}</th>
                    <th style={th}>{t('Status', 'Status')}</th>
                    <th style={th}>{t('YAML', 'YAML')}</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.framework_score_delta.map((d) => (
                    <tr key={d.framework_id} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={td}><code>{d.framework_id}</code></td>
                      <td style={td}>{d.base_score != null ? (d.base_score * 100).toFixed(1) + '%' : '—'}</td>
                      <td style={td}>{d.current_score != null ? (d.current_score * 100).toFixed(1) + '%' : '—'}</td>
                      <td style={{ ...td, color: deltaTone(d.score_delta_pp) }}>
                        {d.score_delta_pp != null ? (d.score_delta_pp > 0 ? '+' : '') + d.score_delta_pp.toFixed(1) : '—'}
                      </td>
                      <td style={td}>
                        {d.framework_added ? (
                          <Badge tone="green">added</Badge>
                        ) : d.framework_removed ? (
                          <Badge tone="red">removed</Badge>
                        ) : d.status_changed ? (
                          <span><Badge tone="gray">{d.base_status}</Badge> → <Badge tone={statusTone(d.current_status)}>{d.current_status}</Badge></span>
                        ) : (
                          <Badge tone="gray">{d.current_status || '—'}</Badge>
                        )}
                      </td>
                      <td style={td}>
                        {d.yaml_hash_changed ? (
                          <Badge tone="red"><i className="ti ti-alert-triangle" aria-hidden="true" /> edited</Badge>
                        ) : (
                          <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>
                            {(d.current_yaml_sha256 ?? d.base_yaml_sha256 ?? '').slice(0, 8) || '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
              <Card>
                <CardTitle right={<Badge tone="red">{diff.new_gaps.length}</Badge>}>
                  {t('New gaps (regressions)', 'New gaps (regressions)')}
                </CardTitle>
                {diff.new_gaps.length === 0 ? (
                  <div style={empty}>{t('No new gaps.', 'No new gaps.')}</div>
                ) : (
                  <GapList rows={diff.new_gaps} />
                )}
              </Card>
              <Card>
                <CardTitle right={<Badge tone="green">{diff.closed_gaps.length}</Badge>}>
                  {t('Closed gaps (improvements)', 'Closed gaps (improvements)')}
                </CardTitle>
                {diff.closed_gaps.length === 0 ? (
                  <div style={empty}>{t('No closed gaps.', 'No closed gaps.')}</div>
                ) : (
                  <GapList rows={diff.closed_gaps} />
                )}
              </Card>
            </div>
          </>
        ) : null}
      </div>
    </>
  )
}

function GapList({ rows }: { rows: GapRow[] }) {
  return (
    <div>
      {rows.map((g, i) => (
        <div key={`${g.framework_id}-${g.control_id}-${i}`} style={{ padding: '6px 0', borderTop: i ? '0.5px solid var(--color-border-tertiary)' : 'none', fontSize: 12 }}>
          <div><Badge tone="navy">{g.framework_id}</Badge> <code style={{ fontSize: 11 }}>{g.control_id}</code></div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{g.control_name}</div>
          {g.finding_code ? <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{g.finding_code}</div> : null}
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'amber' | 'red' | 'green' }) {
  const color = tone === 'red' ? 'var(--color-status-red-mid)' : tone === 'amber' ? 'var(--color-status-amber-mid)' : tone === 'green' ? 'var(--color-status-green-mid)' : 'var(--color-text-primary)'
  return (
    <Card>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1, color }}>{value}</div>
    </Card>
  )
}

function deltaTone(d?: number): string {
  if (d == null) return 'var(--color-text-primary)'
  if (d > 0.5) return 'var(--color-status-green-mid)'
  if (d < -0.5) return 'var(--color-status-red-mid)'
  return 'var(--color-text-secondary)'
}

function statusTone(s?: string): 'green' | 'amber' | 'red' | 'gray' {
  switch ((s ?? '').toLowerCase()) {
    case 'pass': return 'green'
    case 'review':
    case 'warn': return 'amber'
    case 'fail': return 'red'
    default: return 'gray'
  }
}

const tableStyle: React.CSSProperties = { width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 6 }
const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.4 }
const td: React.CSSProperties = { padding: '8px', fontSize: 12, verticalAlign: 'top' }
const empty: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-tertiary)', padding: '6px 0' }
