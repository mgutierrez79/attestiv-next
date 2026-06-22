'use client';
// Multi-select picker for an application's component VMs. Replaces the
// old free-text comma-separated input on the create + edit application
// forms. The user picks real discovered assets from inventory (by
// display name), but can also type a name that isn't discovered yet —
// the backend matches components to inventory by VM display name, so a
// raw string is always acceptable.
//
// The value contract is a plain string[] of VM display names. The parent
// pages still join/split to the exact comma-separated payload the
// backend expects, so the wire contract is unchanged.

import { useEffect, useMemo, useRef, useState } from 'react'

import { apiFetch } from '../lib/api'
import { addComponent, removeComponent } from '../lib/appComponents'
import { useI18n } from '../lib/i18n'

// Re-export the pure helpers so the create/edit pages can import them
// alongside the component (they live in src/lib for dependency-free
// unit testing).
export { addComponent, dedupeComponents, formatComponentList, parseComponentList, removeComponent } from '../lib/appComponents'

// ── Component ───────────────────────────────────────────────────────

type AssetOption = { name: string; assetType: string }

export function AppComponentsField({
  value,
  onChange,
}: {
  value: string[]
  onChange: (next: string[]) => void
}) {
  const { t } = useI18n()
  const [assets, setAssets] = useState<AssetOption[]>([])
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  // Inventory fetch on mount. A failure here is non-fatal: we simply
  // fall back to plain free-text add (the suggestion list stays empty).
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const response = await apiFetch('/inventory/assets?limit=2000')
        if (!response.ok) return
        const body = await response.json().catch(() => ({}))
        if (cancelled) return
        const items: AssetOption[] = Array.isArray(body?.items)
          ? body.items
              .map((a: any) => ({
                name: String(a?.name ?? a?.asset_id ?? '').trim(),
                assetType: String(a?.asset_type ?? '').trim(),
              }))
              .filter((a: AssetOption) => a.name)
          : []
        // De-duplicate by display name, keep first asset_type seen.
        const seen = new Set<string>()
        const deduped: AssetOption[] = []
        for (const a of items) {
          if (seen.has(a.name)) continue
          seen.add(a.name)
          deduped.push(a)
        }
        setAssets(deduped)
      } catch {
        // Inventory unreachable — degrade to free-text add silently.
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // Suggestions: assets not already selected, filtered by the draft,
  // capped so the dropdown stays small.
  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase()
    const chosen = new Set(value)
    return assets
      .filter((a) => !chosen.has(a.name))
      .filter((a) => (q ? a.name.toLowerCase().includes(q) : true))
      .slice(0, 8)
  }, [assets, draft, value])

  function commit(name: string) {
    const next = addComponent(value, name)
    if (next !== value) onChange(next)
    setDraft('')
    inputRef.current?.focus()
  }

  function remove(index: number) {
    onChange(removeComponent(value, index))
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      commit(draft)
    }
  }

  const datalistId = 'app-components-inventory'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {value.map((name, i) => (
            <span key={`${name}-${i}`} style={chipStyle}>
              <span>{name}</span>
              <button
                type="button"
                onClick={() => remove(i)}
                title={t('Remove component', 'Remove component')}
                aria-label={t('Remove component', 'Remove component')}
                style={chipRemoveStyle}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          ref={inputRef}
          list={datalistId}
          type="text"
          value={draft}
          onChange={(e) => {
            const v = e.target.value
            // Selecting a datalist option fires onChange with the full
            // value and (in most browsers) no keydown — auto-commit when
            // the typed value exactly matches a known asset name.
            if (assets.some((a) => a.name === v)) {
              commit(v)
              return
            }
            setDraft(v)
          }}
          onKeyDown={onKeyDown}
          style={inputStyle}
          placeholder={t('Search inventory or type a VM name…', 'Search inventory or type a VM name…')}
          aria-label={t('Add component', 'Add component')}
        />
        <button type="button" onClick={() => commit(draft)} disabled={!draft.trim()} style={addButtonStyle}>
          + {t('Add', 'Add')}
        </button>
        <datalist id={datalistId}>
          {suggestions.map((a) => (
            <option key={a.name} value={a.name}>
              {a.assetType ? a.assetType : undefined}
            </option>
          ))}
        </datalist>
      </div>

      {value.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {t('No components selected yet.', 'No components selected yet.')}
        </div>
      )}
    </div>
  )
}

const chipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px 4px 10px',
  borderRadius: 4,
  border: '0.5px solid var(--color-border-tertiary)',
  background: 'var(--color-surface-secondary, var(--color-surface-primary))',
  fontSize: 12,
  fontFamily: 'inherit',
  color: 'var(--color-text-primary)',
}

const chipRemoveStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
  color: 'var(--color-text-danger, #b53b3b)',
  fontFamily: 'inherit',
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 10px',
  borderRadius: 4,
  border: '0.5px solid var(--color-border-tertiary)',
  background: 'var(--color-surface-primary)',
  fontSize: 13,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
}

const addButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 4,
  padding: '8px 12px',
  fontSize: 11,
  cursor: 'pointer',
  color: 'var(--color-text-secondary)',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}
