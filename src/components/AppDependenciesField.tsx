'use client';
// Repeatable dependency-row editor used by create + edit application
// forms. Each row picks a target app (from a loaded list), a free-text
// dependency_type, and a criticality. Health-check config is omitted —
// that's still YAML territory.

import { useEffect, useState } from 'react'

import { GhostButton } from './AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'
import {
  emptyFlow,
  FLOW_DIRECTIONS,
  FLOW_PROTOCOLS,
  suggestionToFlow,
  type DependencyFlow,
  type FlowSuggestion,
  type FlowSuggestionsResponse,
} from '../lib/appFlows'

export type Dependency = {
  application_id: string
  dependency_type: string
  criticality: 'critical' | 'high' | 'medium' | 'low'
  // Optional per-dependency network flow matrix. Edited in-place below
  // each dependency row and threaded into the POST/PUT body by the
  // create / edit pages.
  flows?: DependencyFlow[]
}

type AppOption = { application_id: string; display_name?: string }

const CRITICALITY_OPTIONS: Dependency['criticality'][] = ['critical', 'high', 'medium', 'low']

const DEPENDENCY_TYPE_HINTS = [
  'ldap_auth',
  'database',
  'dns',
  'ntp',
  'storage',
  'message_bus',
  'shared_filesystem',
] as const

export function AppDependenciesField({
  value,
  onChange,
  selfId,
  appId,
}: {
  value: Dependency[]
  onChange: (next: Dependency[]) => void
  selfId?: string
  // The saved application id. Present only on the edit page (the create
  // page hasn't persisted the app yet). When present, each dependency gets
  // a "Suggest flows" button backed by GET /apps/{appId}/flow-suggestions.
  appId?: string
}) {
  const { t } = useI18n()
  const [apps, setApps] = useState<AppOption[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await apiFetch('/apps')
        if (!response.ok) throw new Error(`${response.status}`)
        const body = await response.json().catch(() => ({}))
        const items: AppOption[] = Array.isArray(body?.items)
          ? body.items
              .map((a: any) => ({
                application_id: String(a?.application_id ?? ''),
                display_name: a?.display_name,
              }))
              .filter((a: AppOption) => a.application_id && a.application_id !== selfId)
          : []
        if (!cancelled) setApps(items)
      } catch (err: unknown) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'load failed')
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [selfId])

  function update(index: number, patch: Partial<Dependency>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }
  function add() {
    onChange([
      ...value,
      { application_id: apps[0]?.application_id ?? '', dependency_type: 'database', criticality: 'high', flows: [] },
    ])
  }

  // Flow-row mutators, scoped to one dependency. They mirror the
  // dependency add/remove/update pattern above, operating on the
  // dependency's own `flows` array so the parent state shape stays a flat
  // list of dependencies that each carry their flows.
  function addFlow(depIndex: number) {
    update(depIndex, { flows: [...(value[depIndex].flows ?? []), emptyFlow()] })
  }
  function removeFlow(depIndex: number, flowIndex: number) {
    update(depIndex, { flows: (value[depIndex].flows ?? []).filter((_, i) => i !== flowIndex) })
  }
  function updateFlow(depIndex: number, flowIndex: number, patch: Partial<DependencyFlow>) {
    update(depIndex, {
      flows: (value[depIndex].flows ?? []).map((f, i) => (i === flowIndex ? { ...f, ...patch } : f)),
    })
  }

  // Suggest-flows state, keyed by dependency index: which row is currently
  // fetching, and the resolved address hint to show under its button. Only
  // wired up when `appId` is present (edit page).
  const [suggestingIndex, setSuggestingIndex] = useState<number | null>(null)
  const [suggestHints, setSuggestHints] = useState<Record<number, string>>({})

  // suggestFlows fetches GET /apps/{appId}/flow-suggestions and appends, to
  // the given dependency, the suggestions whose dependency_application_id
  // matches that dependency's target app. Best-effort: failures are shown as
  // a brief hint and otherwise ignored.
  async function suggestFlows(depIndex: number) {
    if (!appId) return
    const dep = value[depIndex]
    setSuggestingIndex(depIndex)
    try {
      const response = await apiFetch(`/apps/${encodeURIComponent(appId)}/flow-suggestions`)
      if (!response.ok) throw new Error(`${response.status}`)
      const body = (await response.json().catch(() => ({}))) as FlowSuggestionsResponse
      const matches: FlowSuggestion[] = (body.suggestions ?? []).filter(
        (s) => s.dependency_application_id === dep.application_id,
      )
      if (matches.length === 0) {
        setSuggestHints((prev) => ({
          ...prev,
          [depIndex]: t('No flow suggestions for this dependency.', 'No flow suggestions for this dependency.'),
        }))
        return
      }
      update(depIndex, { flows: [...(value[depIndex].flows ?? []), ...matches.map(suggestionToFlow)] })
      // Surface the resolved source/destination addresses as a hint.
      const addrs = Array.from(
        new Set(matches.flatMap((s) => [...(s.source_addresses ?? []), ...(s.destination_addresses ?? [])])),
      )
      setSuggestHints((prev) => ({
        ...prev,
        [depIndex]: addrs.length > 0
          ? t('Resolves to {addrs}', 'Resolves to {addrs}', { addrs: addrs.join(', ') })
          : t('Added {n} suggested flow(s).', 'Added {n} suggested flow(s).', { n: matches.length }),
      }))
    } catch {
      setSuggestHints((prev) => ({
        ...prev,
        [depIndex]: t('Could not load flow suggestions.', 'Could not load flow suggestions.'),
      }))
    } finally {
      setSuggestingIndex(null)
    }
  }

  if (loadError) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-danger, #b53b3b)' }}>
        {t('Could not load applications:', 'Could not load applications:')} {loadError}
      </div>
    )
  }
  if (apps.length === 0 && value.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
        {t(
          'No other applications registered. Create one first, then add a dependency.',
          'No other applications registered. Create one first, then add a dependency.',
        )}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {t('No dependencies declared.', 'No dependencies declared.')}
        </div>
      ) : (
        value.map((row, i) => (
          <div
            key={i}
            style={{
              border: '0.5px solid var(--color-border-tertiary)',
              borderRadius: 6,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1.5fr 1fr auto',
                gap: 6,
                alignItems: 'center',
              }}
            >
              <select
                value={row.application_id}
                onChange={(e) => update(i, { application_id: e.target.value })}
                style={rowInputStyle}
              >
                <option value="">{t('— select application —', '— select application —')}</option>
                {apps.map((a) => (
                  <option key={a.application_id} value={a.application_id}>
                    {a.display_name ? `${a.display_name} (${a.application_id})` : a.application_id}
                  </option>
                ))}
              </select>
              <input
                list="dep-type-hints"
                type="text"
                value={row.dependency_type}
                onChange={(e) => update(i, { dependency_type: e.target.value })}
                placeholder="database"
                style={rowInputStyle}
              />
              <select
                value={row.criticality}
                onChange={(e) =>
                  update(i, { criticality: e.target.value as Dependency['criticality'] })
                }
                style={rowInputStyle}
              >
                {CRITICALITY_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => remove(i)}
                title={t('Remove this dependency', 'Remove this dependency')}
                style={removeButtonStyle}
              >
                ×
              </button>
            </div>
            <FlowEditor
              flows={row.flows ?? []}
              onAdd={() => addFlow(i)}
              onRemove={(flowIndex) => removeFlow(i, flowIndex)}
              onUpdate={(flowIndex, patch) => updateFlow(i, flowIndex, patch)}
              onSuggest={appId ? () => suggestFlows(i) : undefined}
              suggesting={suggestingIndex === i}
              suggestHint={suggestHints[i]}
              t={t}
            />
          </div>
        ))
      )}
      <datalist id="dep-type-hints">
        {DEPENDENCY_TYPE_HINTS.map((h) => (
          <option key={h} value={h} />
        ))}
      </datalist>
      <button type="button" onClick={add} style={addButtonStyle}>
        + {t('Add dependency', 'Add dependency')}
      </button>
    </div>
  )
}

// FlowEditor renders the per-dependency network flow matrix in edit mode:
// a header label + an add/remove/edit grid of flow rows. Columns mirror the
// read-only matrix on the detail page (source, destination, protocol, ports,
// direction, description). Empty by default; the operator opts in per
// dependency by clicking "Add flow".
function FlowEditor({
  flows,
  onAdd,
  onRemove,
  onUpdate,
  onSuggest,
  suggesting,
  suggestHint,
  t,
}: {
  flows: DependencyFlow[]
  onAdd: () => void
  onRemove: (flowIndex: number) => void
  onUpdate: (flowIndex: number, patch: Partial<DependencyFlow>) => void
  // Suggest-flows action — only present (button rendered) when the parent
  // has a saved appId (edit page).
  onSuggest?: () => void
  suggesting?: boolean
  suggestHint?: string
  t: (key: string, fallback?: string, vars?: Record<string, string | number>) => string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingLeft: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {t('Network flows', 'Network flows')}
      </span>
      {flows.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {t('No flows declared for this dependency.', 'No flows declared for this dependency.')}
        </div>
      ) : (
        flows.map((flow, j) => (
          <div
            key={j}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1.4fr 0.9fr 1fr 1.2fr 1.6fr auto',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <input
              type="text"
              value={flow.source ?? ''}
              onChange={(e) => onUpdate(j, { source: e.target.value })}
              placeholder={t('Source', 'Source')}
              aria-label={t('Source', 'Source')}
              style={flowInputStyle}
            />
            <input
              type="text"
              value={flow.destination ?? ''}
              onChange={(e) => onUpdate(j, { destination: e.target.value })}
              placeholder={t('Destination', 'Destination')}
              aria-label={t('Destination', 'Destination')}
              style={flowInputStyle}
            />
            <select
              value={flow.protocol ?? 'tcp'}
              onChange={(e) => onUpdate(j, { protocol: e.target.value as DependencyFlow['protocol'] })}
              aria-label={t('Protocol', 'Protocol')}
              style={flowInputStyle}
            >
              {FLOW_PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={flow.ports ?? ''}
              onChange={(e) => onUpdate(j, { ports: e.target.value })}
              placeholder="443,8443"
              aria-label={t('Ports', 'Ports')}
              style={flowInputStyle}
            />
            <select
              value={flow.direction ?? ''}
              onChange={(e) =>
                onUpdate(j, { direction: (e.target.value || undefined) as DependencyFlow['direction'] })
              }
              aria-label={t('Direction', 'Direction')}
              style={flowInputStyle}
            >
              <option value="">{t('— direction —', '— direction —')}</option>
              {FLOW_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={flow.description ?? ''}
              onChange={(e) => onUpdate(j, { description: e.target.value })}
              placeholder={t('Description', 'Description')}
              aria-label={t('Description', 'Description')}
              style={flowInputStyle}
            />
            <button
              type="button"
              onClick={() => onRemove(j)}
              title={t('Remove this flow', 'Remove this flow')}
              style={removeButtonStyle}
            >
              ×
            </button>
          </div>
        ))
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onAdd} style={addButtonStyle}>
          + {t('Add flow', 'Add flow')}
        </button>
        {onSuggest ? (
          <GhostButton type="button" onClick={onSuggest} disabled={suggesting}>
            <i className="ti ti-bulb" aria-hidden="true" />{' '}
            {suggesting ? t('Suggesting…', 'Suggesting…') : t('Suggest flows', 'Suggest flows')}
          </GhostButton>
        ) : null}
        {suggestHint ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{suggestHint}</span>
        ) : null}
      </div>
    </div>
  )
}

const flowInputStyle: React.CSSProperties = {
  padding: '5px 7px',
  borderRadius: 4,
  border: '0.5px solid var(--color-border-tertiary)',
  background: 'var(--color-surface-primary)',
  fontSize: 11,
  fontFamily: 'inherit',
  minWidth: 0,
}

const rowInputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 4,
  border: '0.5px solid var(--color-border-tertiary)',
  background: 'var(--color-surface-primary)',
  fontSize: 12,
  fontFamily: 'inherit',
}

const removeButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 4,
  width: 26,
  height: 26,
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  color: 'var(--color-text-danger, #b53b3b)',
  fontFamily: 'inherit',
}

const addButtonStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'transparent',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 11,
  cursor: 'pointer',
  color: 'var(--color-text-secondary)',
  fontFamily: 'inherit',
}
