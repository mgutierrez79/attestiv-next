'use client'
// Settings ▸ Discovery filters.
//
// Operator-entered text rules that keep unwanted assets (lab VMs,
// templates, test appliances, decommissioned hosts) out of the inventory.
// The rules are persisted server-side and applied on every discovery —
// the connector poll's auto-import and the inventory Update button — so an
// excluded asset never comes back. Assets imported before a rule existed
// are removed with the explicit clean-up below, never silently.
//
// API shapes live in src/lib/discoveryFilters.ts.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  EmptyState,
  GhostButton,
  PrimaryButton,
  Select,
  TextInput,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import {
  FIELDS,
  MATCH_MODES,
  blankRule,
  firstRuleProblem,
  rulesEqual,
  rulesPayload,
  toDrafts,
  type DiscoveryField,
  type DiscoveryFiltersResponse,
  type DiscoveryMatchMode,
  type DiscoveryPreviewResponse,
  type DraftRule,
} from '../lib/discoveryFilters'
import { useI18n } from '../lib/i18n'

async function readBody<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
  }
  return body as T
}

const cell = { padding: '6px 8px', verticalAlign: 'top' as const }
const head = { padding: '6px 8px', fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)' }

export function AttestivDiscoveryFiltersPage() {
  const { t } = useI18n()
  const router = useRouter()
  const [loaded, setLoaded] = useState<DiscoveryFiltersResponse | null>(null)
  const [drafts, setDrafts] = useState<DraftRule[]>([])
  const [preview, setPreview] = useState<DiscoveryPreviewResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const matchLabels: Record<DiscoveryMatchMode, string> = {
    contains: t('Contains', 'Contains'),
    exact: t('Exact', 'Exact'),
    glob: t('Wildcard', 'Wildcard'),
    regex: t('Regular expression', 'Regular expression'),
  }
  const fieldLabels: Record<DiscoveryField, string> = {
    any: t('Any field', 'Any field'),
    name: t('Name / hostname', 'Name / hostname'),
    asset_id: t('Asset ID', 'Asset ID'),
    asset_type: t('Asset type', 'Asset type'),
    source: t('Connector source', 'Connector source'),
    ip: t('IP address', 'IP address'),
    tag: t('Tag', 'Tag'),
  }

  const adopt = useCallback((body: DiscoveryFiltersResponse) => {
    setLoaded(body)
    setDrafts(toDrafts(body.rules))
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      adopt(await readBody<DiscoveryFiltersResponse>(await apiFetch('/settings/discovery-filters')))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load discovery filters')
    }
  }, [adopt])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const dirty = useMemo(() => (loaded ? !rulesEqual(drafts, loaded.rules) : false), [drafts, loaded])
  const maxRules = loaded?.limits.max_rules ?? 200
  const maxPattern = loaded?.limits.max_pattern_length ?? 256
  const savedEnabled = loaded?.rules.filter((r) => r.enabled).length ?? 0

  function update(key: string, patch: Partial<DraftRule>) {
    setDrafts((current) => current.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)))
    setPreview(null)
  }

  function remove(key: string) {
    setDrafts((current) => current.filter((rule) => rule.key !== key))
    setPreview(null)
  }

  function add() {
    setDrafts((current) => [...current, blankRule()])
    setPreview(null)
  }

  // localProblem stops a request the server would refuse anyway, with a
  // message that names the row.
  function localProblem(): string | null {
    const problem = firstRuleProblem(drafts, maxPattern)
    if (!problem) return null
    return problem.problem === 'empty'
      ? t('Filter {n}: enter a pattern.', 'Filter {n}: enter a pattern.', { n: problem.index + 1 })
      : t('Filter {n}: the pattern is longer than {max} characters.', 'Filter {n}: the pattern is longer than {max} characters.', {
          n: problem.index + 1,
          max: maxPattern,
        })
  }

  async function save() {
    const problem = localProblem()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const body = await readBody<DiscoveryFiltersResponse>(
        await apiFetch('/settings/discovery-filters', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rulesPayload(drafts)),
        }),
      )
      adopt(body)
      setInfo(t('Saved. The next discovery skips matching assets.', 'Saved. The next discovery skips matching assets.'))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save discovery filters')
    } finally {
      setBusy(false)
    }
  }

  function discard() {
    if (loaded) setDrafts(toDrafts(loaded.rules))
    setPreview(null)
    setError(null)
    setInfo(null)
  }

  async function runPreview() {
    const problem = localProblem()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      setPreview(
        await readBody<DiscoveryPreviewResponse>(
          await apiFetch('/settings/discovery-filters/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(rulesPayload(drafts)),
          }),
        ),
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to preview discovery filters')
    } finally {
      setBusy(false)
    }
  }

  // cleanUp removes the discovered assets the SAVED filters match. It
  // previews the saved rules first so the confirmation names the real
  // count, and sends that count back: if the inventory moved in between,
  // the server deletes nothing and asks for another look.
  async function cleanUp() {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const saved = await readBody<DiscoveryPreviewResponse>(
        await apiFetch('/settings/discovery-filters/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        }),
      )
      setPreview(saved)
      if (saved.matched === 0) {
        setInfo(t('No inventory assets match the saved filters. Nothing to remove.', 'No inventory assets match the saved filters. Nothing to remove.'))
        return
      }
      const question = t(
        'Remove {n} discovered assets that match the saved filters from the inventory? Hand-entered assets are never removed. This cannot be undone, and the filters keep these assets from being imported again.',
        'Remove {n} discovered assets that match the saved filters from the inventory? Hand-entered assets are never removed. This cannot be undone, and the filters keep these assets from being imported again.',
        { n: saved.matched },
      )
      if (!window.confirm(question)) return
      const result = await readBody<{ deleted: number; failed: number }>(
        await apiFetch('/settings/discovery-filters/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_matches: saved.matched }),
        }),
      )
      setPreview(null)
      if (result.failed > 0) {
        setError(
          t('Removed {deleted} assets; {failed} could not be removed. Try again.', 'Removed {deleted} assets; {failed} could not be removed. Try again.', {
            deleted: result.deleted,
            failed: result.failed,
          }),
        )
      } else {
        setInfo(t('Removed {n} assets from the inventory.', 'Removed {n} assets from the inventory.', { n: result.deleted }))
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove matching assets')
    } finally {
      setBusy(false)
    }
  }

  const lastRun = loaded?.last_run ?? null

  return (
    <>
      <Topbar
        title={t('Discovery filters', 'Discovery filters')}
        left={<Badge tone="navy">{t('admin only', 'admin only')}</Badge>}
        right={
          <GhostButton onClick={() => router.push('/settings')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Settings', 'Settings')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {info ? <Banner tone="success">{info}</Banner> : null}

        <Card>
          <CardTitle>{t('Exclusion filters', 'Exclusion filters')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
            {t(
              'Connectors report everything they can see, including lab machines, templates and test devices. An asset that matches any enabled filter is left out every time assets are discovered, so it never enters the inventory. Filters are saved on the server and apply to every connector poll and every inventory update. Matching ignores upper and lower case. Hand-entered assets are never filtered.',
              'Connectors report everything they can see, including lab machines, templates and test devices. An asset that matches any enabled filter is left out every time assets are discovered, so it never enters the inventory. Filters are saved on the server and apply to every connector poll and every inventory update. Matching ignores upper and lower case. Hand-entered assets are never filtered.',
            )}
          </p>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
            {t(
              'Excluded assets are also left out of compliance scoring, together with the vulnerabilities, software, backup jobs and other connector records reported for them. Scores change at the next scoring run.',
              'Excluded assets are also left out of compliance scoring, together with the vulnerabilities, software, backup jobs and other connector records reported for them. Scores change at the next scoring run.',
            )}
          </p>

          {loaded && drafts.length === 0 ? (
            <EmptyState
              icon="ti-filter"
              title={t('No discovery filters yet', 'No discovery filters yet')}
              description={t(
                'Every asset the connectors discover is imported. Add a filter to leave out the ones you do not assess.',
                'Every asset the connectors discover is imported. Add a filter to leave out the ones you do not assess.',
              )}
            />
          ) : null}

          {drafts.length > 0 ? (
            <div style={{ overflowX: 'auto', marginTop: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left' }}>
                    <th style={head}>#</th>
                    <th style={head}>{t('On', 'On')}</th>
                    <th style={head}>{t('Pattern', 'Pattern')}</th>
                    <th style={head}>{t('Match', 'Match')}</th>
                    <th style={head}>{t('Field', 'Field')}</th>
                    <th style={head}>{t('Connector', 'Connector')}</th>
                    <th style={head}>{t('Note', 'Note')}</th>
                    <th style={head} title={t('Assets this filter kept out during the last discovery', 'Assets this filter kept out during the last discovery')}>
                      {t('Last run', 'Last run')}
                    </th>
                    <th style={head} />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((rule, index) => {
                    const hits = rule.id && lastRun ? lastRun.rule_hits[rule.id] ?? 0 : null
                    const previewHits = preview ? preview.rule_hits[index] : null
                    return (
                      <tr key={rule.key} style={{ borderTop: '1px solid var(--color-border-tertiary)', opacity: rule.enabled ? 1 : 0.6 }}>
                        <td style={{ ...cell, paddingTop: 12, color: 'var(--color-text-tertiary)' }}>{index + 1}</td>
                        <td style={{ ...cell, paddingTop: 10 }}>
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            disabled={busy}
                            aria-label={t('Filter {n} enabled', 'Filter {n} enabled', { n: index + 1 })}
                            onChange={(e) => update(rule.key, { enabled: e.target.checked })}
                          />
                        </td>
                        <td style={{ ...cell, minWidth: 200 }}>
                          <TextInput
                            value={rule.pattern}
                            disabled={busy}
                            maxLength={maxPattern}
                            placeholder={rule.match === 'glob' ? '*.lab.local' : rule.match === 'regex' ? '^tmpl-\\d+$' : 'lab'}
                            aria-label={t('Filter {n} pattern', 'Filter {n} pattern', { n: index + 1 })}
                            onChange={(e) => update(rule.key, { pattern: e.target.value })}
                            style={{ width: '100%', fontFamily: 'var(--font-mono)' }}
                          />
                        </td>
                        <td style={cell}>
                          <Select
                            value={rule.match}
                            disabled={busy}
                            aria-label={t('Filter {n} match', 'Filter {n} match', { n: index + 1 })}
                            onChange={(e) => update(rule.key, { match: e.target.value as DiscoveryMatchMode })}
                            style={{ minWidth: 170 }}
                          >
                            {MATCH_MODES.map((mode) => (
                              <option key={mode} value={mode}>
                                {matchLabels[mode]}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td style={cell}>
                          <Select
                            value={rule.field}
                            disabled={busy}
                            aria-label={t('Filter {n} field', 'Filter {n} field', { n: index + 1 })}
                            onChange={(e) => update(rule.key, { field: e.target.value as DiscoveryField })}
                            style={{ minWidth: 170 }}
                          >
                            {FIELDS.map((field) => (
                              <option key={field} value={field}>
                                {fieldLabels[field]}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td style={{ ...cell, minWidth: 140 }}>
                          <TextInput
                            value={rule.source ?? ''}
                            disabled={busy}
                            list="discovery-filter-sources"
                            placeholder={t('all connectors', 'all connectors')}
                            aria-label={t('Filter {n} connector', 'Filter {n} connector', { n: index + 1 })}
                            onChange={(e) => update(rule.key, { source: e.target.value })}
                            style={{ width: '100%' }}
                          />
                        </td>
                        <td style={{ ...cell, minWidth: 160 }}>
                          <TextInput
                            value={rule.note ?? ''}
                            disabled={busy}
                            maxLength={loaded?.limits.max_note_length ?? 500}
                            placeholder={t('why this is excluded', 'why this is excluded')}
                            aria-label={t('Filter {n} note', 'Filter {n} note', { n: index + 1 })}
                            onChange={(e) => update(rule.key, { note: e.target.value })}
                            style={{ width: '100%' }}
                          />
                        </td>
                        <td style={{ ...cell, paddingTop: 12, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                          {hits === null ? '—' : hits}
                          {previewHits !== null && rule.enabled ? (
                            <div style={{ fontSize: 10.5, color: 'var(--color-status-blue-deep)', fontFamily: 'inherit' }}>
                              {t('preview: {n}', 'preview: {n}', { n: previewHits })}
                            </div>
                          ) : null}
                        </td>
                        <td style={{ ...cell, paddingTop: 8 }}>
                          <button
                            type="button"
                            onClick={() => remove(rule.key)}
                            disabled={busy}
                            aria-label={t('Remove filter {n}', 'Remove filter {n}', { n: index + 1 })}
                            title={t('Remove filter {n}', 'Remove filter {n}', { n: index + 1 })}
                            style={{
                              background: 'none',
                              border: '1px solid var(--color-border-secondary)',
                              borderRadius: 'var(--border-radius-md)',
                              padding: '5px 8px',
                              cursor: busy ? 'default' : 'pointer',
                              color: 'var(--color-text-secondary)',
                            }}
                          >
                            <i className="ti ti-trash" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <datalist id="discovery-filter-sources">
                {(loaded?.known_sources ?? []).map((source) => (
                  <option key={source} value={source} />
                ))}
              </datalist>
            </div>
          ) : null}

          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 10, lineHeight: 1.6 }}>
            <div>
              <strong>{matchLabels.contains}</strong>: {t('the text appears anywhere in the value (lab matches build-lab-01).', 'the text appears anywhere in the value (lab matches build-lab-01).')}
            </div>
            <div>
              <strong>{matchLabels.exact}</strong>: {t('the whole value equals the text.', 'the whole value equals the text.')}
            </div>
            <div>
              <strong>{matchLabels.glob}</strong>: {t('* stands for any characters and ? for one character (*.lab.local).', '* stands for any characters and ? for one character (*.lab.local).')}
            </div>
            <div>
              <strong>{matchLabels.regex}</strong>: {t('RE2 syntax, as used by Go.', 'RE2 syntax, as used by Go.')}
            </div>
            <div>
              <strong>{t('Connector', 'Connector')}</strong>: {t('leave empty for every connector, or name one (vcenter) or one instance (vcenter:dca).', 'leave empty for every connector, or name one (vcenter) or one instance (vcenter:dca).')}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <GhostButton onClick={add} disabled={busy || !loaded || drafts.length >= maxRules}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Add filter', 'Add filter')}
            </GhostButton>
            <GhostButton onClick={runPreview} disabled={busy || drafts.length === 0}>
              <i className="ti ti-eye" aria-hidden="true" /> {t('Test against inventory', 'Test against inventory')}
            </GhostButton>
            <div style={{ flex: 1 }} />
            {dirty ? <Badge tone="amber">{t('Unsaved changes', 'Unsaved changes')}</Badge> : null}
            <GhostButton onClick={discard} disabled={busy || !dirty}>
              <i className="ti ti-arrow-back-up" aria-hidden="true" /> {t('Discard', 'Discard')}
            </GhostButton>
            <PrimaryButton onClick={save} disabled={busy || !dirty}>
              <i className="ti ti-device-floppy" aria-hidden="true" /> {t('Save', 'Save')}
            </PrimaryButton>
          </div>
        </Card>

        {preview ? (
          <Card>
            <CardTitle>{t('Preview', 'Preview')}</CardTitle>
            <p style={{ fontSize: 12, marginTop: 0 }}>
              {t(
                '{matched} of {evaluated} discovered assets in the inventory match the enabled filters.',
                '{matched} of {evaluated} discovered assets in the inventory match the enabled filters.',
                { matched: preview.matched, evaluated: preview.evaluated },
              )}
            </p>
            {preview.items.length > 0 ? (
              <div style={{ overflowX: 'auto', maxHeight: 360, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ textAlign: 'left' }}>
                      <th style={head}>{t('Name', 'Name')}</th>
                      <th style={head}>{t('Asset type', 'Asset type')}</th>
                      <th style={head}>{t('Source', 'Source')}</th>
                      <th style={head}>{t('Matched by', 'Matched by')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item) => (
                      <tr key={item.asset_id} style={{ borderTop: '1px solid var(--color-border-tertiary)' }}>
                        <td style={cell}>
                          <div style={{ fontWeight: 500 }}>{item.name || item.asset_id}</div>
                          {item.name ? (
                            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)' }}>{item.asset_id}</div>
                          ) : null}
                        </td>
                        <td style={cell}>{item.asset_type || '—'}</td>
                        <td style={{ ...cell, fontFamily: 'var(--font-mono)' }}>{item.sources.join(', ') || '—'}</td>
                        <td style={{ ...cell, fontFamily: 'var(--font-mono)' }}>{item.rules.map((i) => `#${i + 1}`).join(', ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {preview.truncated ? (
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
                {t('Showing the first {n} matches.', 'Showing the first {n} matches.', { n: preview.items.length })}
              </div>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <CardTitle>{t('Clean up the existing inventory', 'Clean up the existing inventory')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
            {t(
              'A saved filter stops new imports. Assets imported before the filter existed stay in the inventory until you remove them here. Only discovered assets that match the saved, enabled filters are removed, and the removal is recorded in the audit trail.',
              'A saved filter stops new imports. Assets imported before the filter existed stay in the inventory until you remove them here. Only discovered assets that match the saved, enabled filters are removed, and the removal is recorded in the audit trail.',
            )}
          </p>
          {dirty ? (
            <div style={{ fontSize: 12, color: 'var(--color-status-amber-text)', marginBottom: 8 }}>
              {t('Save or discard your changes first.', 'Save or discard your changes first.')}
            </div>
          ) : null}
          <GhostButton onClick={cleanUp} disabled={busy || dirty || savedEnabled === 0}>
            <i className="ti ti-trash" aria-hidden="true" /> {t('Remove matching assets…', 'Remove matching assets…')}
          </GhostButton>
        </Card>

        <Card>
          <CardTitle>{t('Last discovery', 'Last discovery')}</CardTitle>
          {lastRun ? (
            <>
              <KV label={t('Ran at', 'Ran at')} value={new Date(lastRun.at).toLocaleString()} />
              <KV label={t('Assets discovered', 'Assets discovered')} value={String(lastRun.evaluated)} />
              <KV label={t('Excluded by filters', 'Excluded by filters')} value={String(lastRun.excluded)} />
            </>
          ) : (
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', margin: 0 }}>
              {t(
                'No discovery has run through the filters since the API service started. Counts appear after the next connector poll or inventory update.',
                'No discovery has run through the filters since the API service started. Counts appear after the next connector poll or inventory update.',
              )}
            </p>
          )}
        </Card>
      </div>
    </>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}
