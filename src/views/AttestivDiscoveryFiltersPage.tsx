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
  connectorScopeKnown,
  firstRuleProblem,
  ruleMatchesNothing,
  rulesEqual,
  rulesPayload,
  rulesToSave,
  toDrafts,
  type DiscoveryField,
  type DiscoveryFilterRule,
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
const fieldLabel = { display: 'block', fontSize: 11, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 4 }

// editorRows always leaves a row to type into: with no filters saved the
// page opens on an empty one instead of a bare "Add filter" button.
function editorRows(rules: DiscoveryFilterRule[]): DraftRule[] {
  return rules.length > 0 ? toDrafts(rules) : [blankRule()]
}

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
    setDrafts(editorRows(body.rules))
  }, [])

  // previewSaved shows what each SAVED rule matches — in the inventory and
  // among what the connectors report — so a rule that can never match is
  // flagged as soon as the page opens, without pressing Test.
  const previewSaved = useCallback(async () => {
    try {
      setPreview(
        await readBody<DiscoveryPreviewResponse>(
          await apiFetch('/settings/discovery-filters/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
          }),
        ),
      )
    } catch {
      setPreview(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const body = await readBody<DiscoveryFiltersResponse>(await apiFetch('/settings/discovery-filters'))
      adopt(body)
      if (body.rules.length > 0) await previewSaved()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load discovery filters')
    }
  }, [adopt, previewSaved])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // saveable is what a save or a test sends: the rows minus a new one left
  // empty. Preview counts come back per saveable rule; saveIndex maps a row
  // to its position there.
  const saveable = useMemo(() => rulesToSave(drafts), [drafts])
  const saveIndex = useMemo(() => new Map(saveable.map((rule, i) => [rule.key, i])), [saveable])
  const dirty = useMemo(() => (loaded ? !rulesEqual(saveable, loaded.rules) : false), [saveable, loaded])
  // ruleNumber turns a position in saveable (what preview counts refer to)
  // into the "Filter n" the page shows.
  const ruleNumber = (at: number) => drafts.findIndex((rule) => rule.key === saveable[at]?.key) + 1 || at + 1
  const maxRules = loaded?.limits.max_rules ?? 200
  const maxPattern = loaded?.limits.max_pattern_length ?? 256
  const savedEnabled = loaded?.rules.filter((r) => r.enabled).length ?? 0
  const knownSources = loaded?.known_sources ?? []

  function update(key: string, patch: Partial<DraftRule>) {
    setDrafts((current) => current.map((rule) => (rule.key === key ? { ...rule, ...patch } : rule)))
    setPreview(null)
  }

  function remove(key: string) {
    setDrafts((current) => {
      const rest = current.filter((rule) => rule.key !== key)
      return rest.length > 0 ? rest : [blankRule()]
    })
    setPreview(null)
  }

  function add() {
    setDrafts((current) => [...current, blankRule()])
    setPreview(null)
  }

  // localProblem stops a request the server would refuse anyway, with a
  // message that names the row.
  function localProblem(): string | null {
    const problem = firstRuleProblem(saveable, maxPattern)
    if (!problem) return null
    const n = ruleNumber(problem.index)
    return problem.problem === 'empty'
      ? t('Filter {n}: enter the text to exclude.', 'Filter {n}: enter the text to exclude.', { n })
      : t('Filter {n}: the pattern is longer than {max} characters.', 'Filter {n}: the pattern is longer than {max} characters.', {
          n,
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
      // A filter means "not in my inventory": saving also removes what the
      // rules match from the inventory now, instead of leaving the rows
      // imported before the filter in place. Check what that is first and
      // say it before anything is saved.
      const planned =
        saveable.length > 0
          ? await readBody<DiscoveryPreviewResponse>(
              await apiFetch('/settings/discovery-filters/preview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(rulesPayload(saveable)),
              }),
            )
          : null
      const matched = planned?.matched ?? 0
      if (matched > 0) {
        const question = t(
          'Saving removes the {n} discovered assets these filters match from the inventory and keeps them out of every future discovery. Hand-entered assets are never removed. Continue?',
          'Saving removes the {n} discovered assets these filters match from the inventory and keeps them out of every future discovery. Hand-entered assets are never removed. Continue?',
          { n: matched },
        )
        if (!window.confirm(question)) {
          setPreview(planned)
          return
        }
      }
      const body = await readBody<DiscoveryFiltersResponse>(
        await apiFetch('/settings/discovery-filters', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(rulesPayload(saveable)),
        }),
      )
      adopt(body)
      // Keep the counts the rules had when saved: after the removal the
      // inventory count is 0 for every rule that worked.
      setPreview(planned)
      if (matched === 0) {
        setInfo(
          t(
            'Saved. No asset in the inventory matches these filters now; they apply to every future discovery.',
            'Saved. No asset in the inventory matches these filters now; they apply to every future discovery.',
          ),
        )
        return
      }
      const result = await readBody<{ deleted: number; failed: number }>(
        await apiFetch('/settings/discovery-filters/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected_matches: matched }),
        }),
      )
      if (result.failed > 0) {
        setError(
          t('Removed {deleted} assets; {failed} could not be removed. Try again.', 'Removed {deleted} assets; {failed} could not be removed. Try again.', {
            deleted: result.deleted,
            failed: result.failed,
          }),
        )
      } else {
        setInfo(
          t(
            'Saved. {n} assets removed from the inventory; the filters keep them out of every future discovery.',
            'Saved. {n} assets removed from the inventory; the filters keep them out of every future discovery.',
            { n: result.deleted },
          ),
        )
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save discovery filters')
    } finally {
      setBusy(false)
    }
  }

  function discard() {
    if (loaded) setDrafts(editorRows(loaded.rules))
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
            body: JSON.stringify(rulesPayload(saveable)),
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

          {loaded && loaded.rules.length === 0 ? (
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: '4px 0 10px' }}>
              <strong>{t('No discovery filters yet', 'No discovery filters yet')}.</strong>{' '}
              {t(
                'Every asset the connectors discover is imported. Add a filter to leave out the ones you do not assess.',
                'Every asset the connectors discover is imported. Add a filter to leave out the ones you do not assess.',
              )}
            </div>
          ) : null}

          <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
            {drafts.map((rule, index) => {
              const n = index + 1
              const at = saveIndex.get(rule.key)
              const hits = rule.id && lastRun ? lastRun.rule_hits[rule.id] ?? 0 : null
              const previewHits = preview && at !== undefined ? preview.rule_hits[at] ?? null : null
              const connectorHits = preview?.connector_rule_hits && at !== undefined ? preview.connector_rule_hits[at] ?? 0 : 0
              const scopeKnown = connectorScopeKnown(rule.source, knownSources)
              // A disabled rule matches nothing by choice; the server takes
              // it as is, so warn only once it is switched on.
              const warning = !rule.enabled
                ? ''
                : !scopeKnown
                ? t(
                    'Not a connector — this filter can never match. Pick one from the list or leave it on All connectors.',
                    'Not a connector — this filter can never match. Pick one from the list or leave it on All connectors.',
                  )
                : at !== undefined && ruleMatchesNothing(rule, at, preview)
                  ? t(
                      'This filter matches nothing: no asset in the inventory or reported by a connector contains this text. Enter only the text to look for — for example picking — not a sentence.',
                      'This filter matches nothing: no asset in the inventory or reported by a connector contains this text. Enter only the text to look for — for example picking — not a sentence.',
                    )
                  : ''
              const textId = `discovery-filter-text-${rule.key}`
              return (
                <div
                  key={rule.key}
                  style={{
                    border: '1px solid var(--color-border-secondary)',
                    borderRadius: 'var(--border-radius-lg)',
                    padding: 12,
                    background: rule.enabled ? 'var(--color-background-primary)' : 'var(--color-background-secondary)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
                    <strong style={{ fontSize: 12.5 }}>{t('Filter {n}', 'Filter {n}', { n })}</strong>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: busy ? 'default' : 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={busy}
                        aria-label={t('Filter {n} enabled', 'Filter {n} enabled', { n })}
                        onChange={(e) => update(rule.key, { enabled: e.target.checked })}
                      />
                      {t('Enabled', 'Enabled')}
                    </label>
                    <div style={{ flex: 1 }} />
                    {previewHits !== null && rule.enabled ? (
                      <span style={{ fontSize: 11, color: 'var(--color-status-blue-deep)' }}>
                        {t('{n} in inventory · {m} from connectors', '{n} in inventory · {m} from connectors', {
                          n: previewHits,
                          m: connectorHits,
                        })}
                      </span>
                    ) : null}
                    {hits !== null ? (
                      <span
                        style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}
                        title={t('Assets this filter kept out during the last discovery', 'Assets this filter kept out during the last discovery')}
                      >
                        {t('Last run', 'Last run')}: {hits}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => remove(rule.key)}
                      disabled={busy}
                      aria-label={t('Remove filter {n}', 'Remove filter {n}', { n })}
                      title={t('Remove filter {n}', 'Remove filter {n}', { n })}
                      style={{
                        background: 'none',
                        border: '1px solid var(--color-border-secondary)',
                        borderRadius: 'var(--border-radius-md)',
                        padding: '4px 8px',
                        cursor: busy ? 'default' : 'pointer',
                        color: 'var(--color-text-secondary)',
                      }}
                    >
                      <i className="ti ti-trash" aria-hidden="true" />
                    </button>
                  </div>

                  <label htmlFor={textId} style={{ ...fieldLabel, fontSize: 12, color: 'var(--color-text-primary)' }}>
                    {t('Text to exclude', 'Text to exclude')}
                  </label>
                  <TextInput
                    id={textId}
                    value={rule.pattern}
                    disabled={busy}
                    maxLength={maxPattern}
                    placeholder={rule.match === 'glob' ? '*.lab.local' : rule.match === 'regex' ? '^tmpl-\\d+$' : 'picking'}
                    onChange={(e) => update(rule.key, { pattern: e.target.value })}
                    style={{ width: '100%', fontSize: 14, padding: '8px 10px', fontFamily: 'var(--font-mono)' }}
                  />
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                    {t(
                      'Type only the text to look for — for example picking, not a sentence. Every discovered asset that contains it is kept out of the inventory. Write why in Reason.',
                      'Type only the text to look for — for example picking, not a sentence. Every discovered asset that contains it is kept out of the inventory. Write why in Reason.',
                    )}
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 12 }}>
                    <label>
                      <span style={fieldLabel}>{t('How to match', 'How to match')}</span>
                      <Select
                        value={rule.match}
                        disabled={busy}
                        onChange={(e) => update(rule.key, { match: e.target.value as DiscoveryMatchMode })}
                        style={{ width: '100%' }}
                      >
                        {MATCH_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {matchLabels[mode]}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label>
                      <span style={fieldLabel}>{t('Look in', 'Look in')}</span>
                      <Select
                        value={rule.field}
                        disabled={busy}
                        onChange={(e) => update(rule.key, { field: e.target.value as DiscoveryField })}
                        style={{ width: '100%' }}
                      >
                        {FIELDS.map((field) => (
                          <option key={field} value={field}>
                            {fieldLabels[field]}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label>
                      <span style={fieldLabel}>{t('Connector', 'Connector')}</span>
                      <Select
                        value={rule.source ?? ''}
                        disabled={busy}
                        onChange={(e) => update(rule.key, { source: e.target.value })}
                        style={{ width: '100%' }}
                      >
                        <option value="">{t('All connectors', 'All connectors')}</option>
                        {knownSources.map((source) => (
                          <option key={source} value={source}>
                            {source}
                          </option>
                        ))}
                        {!scopeKnown ? (
                          <option value={rule.source}>
                            {rule.source} — {t('not a connector', 'not a connector')}
                          </option>
                        ) : null}
                      </Select>
                    </label>
                    <label>
                      <span style={fieldLabel}>{t('Reason (optional)', 'Reason (optional)')}</span>
                      <TextInput
                        value={rule.note ?? ''}
                        disabled={busy}
                        maxLength={loaded?.limits.max_note_length ?? 500}
                        placeholder={t('why this is excluded', 'why this is excluded')}
                        onChange={(e) => update(rule.key, { note: e.target.value })}
                        style={{ width: '100%' }}
                      />
                    </label>
                  </div>

                  {warning ? (
                    <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--color-status-amber-text)' }}>
                      <i className="ti ti-alert-triangle" aria-hidden="true" /> {warning}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

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
          </div>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14, flexWrap: 'wrap' }}>
            <GhostButton onClick={add} disabled={busy || !loaded || drafts.length >= maxRules}>
              <i className="ti ti-plus" aria-hidden="true" /> {t('Add filter', 'Add filter')}
            </GhostButton>
            <GhostButton onClick={runPreview} disabled={busy || saveable.length === 0}>
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
                        <td style={{ ...cell, fontFamily: 'var(--font-mono)' }}>{item.rules.map((i) => `#${ruleNumber(i)}`).join(', ')}</td>
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
              'Saving already removes what the filters match. Use this if assets the saved filters match are still listed, for example after filters were saved through the API. Only discovered assets are removed, and the removal is recorded in the audit trail.',
              'Saving already removes what the filters match. Use this if assets the saved filters match are still listed, for example after filters were saved through the API. Only discovered assets are removed, and the removal is recorded in the audit trail.',
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
