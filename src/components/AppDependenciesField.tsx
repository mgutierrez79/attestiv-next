'use client';
// Repeatable dependency-row editor used by create + edit application
// forms. Each row picks a target app (from a loaded list), a free-text
// dependency_type, and a criticality. Health-check config is omitted —
// that's still YAML territory.

import { useEffect, useState } from 'react'

import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

export type Dependency = {
  application_id: string
  dependency_type: string
  criticality: 'critical' | 'high' | 'medium' | 'low'
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
}: {
  value: Dependency[]
  onChange: (next: Dependency[]) => void
  selfId?: string
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
      { application_id: apps[0]?.application_id ?? '', dependency_type: 'database', criticality: 'high' },
    ])
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
