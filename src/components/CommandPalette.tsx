'use client'

// CommandPalette — the ⌘K / Ctrl-K spotlight. A single keystroke jumps
// the operator to any page OR any inventoried asset, fuzzy-matched as
// they type. Asset search is server-side (the inventory list's new `q`
// param) so it scales past the page the operator happens to be on.
//
// Mounted once, globally, by AttestivLayout. Open state + the global
// hotkey live there; this component owns the overlay, the query, the
// debounced asset fetch, and keyboard navigation within the list.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

export type NavDestination = { label: string; to: string; icon: string; section: string }

type AssetHit = {
  asset_id: string
  name?: string | null
  asset_type?: string | null
  criticality?: string | null
}

type Result = {
  kind: 'page' | 'asset'
  label: string
  sub: string
  to: string
  icon: string
}

// A small asset_type → icon map so asset hits read at a glance. Falls
// back to a generic database glyph for anything unmapped.
const ASSET_ICONS: Record<string, string> = {
  vm: 'ti-device-desktop',
  virtual_machine: 'ti-device-desktop',
  host: 'ti-server-2',
  hypervisor_host: 'ti-server-2',
  server: 'ti-server',
  domain_controller: 'ti-shield-lock',
  endpoint: 'ti-device-laptop',
  cluster: 'ti-grid-pattern',
  storage_array: 'ti-database',
  storage_volume: 'ti-stack-2',
  firewall: 'ti-wall',
  network_device: 'ti-network',
  network_link: 'ti-route',
}

function assetIcon(assetType?: string | null): string {
  return ASSET_ICONS[String(assetType ?? '').toLowerCase()] ?? 'ti-database'
}

export function CommandPalette({
  open,
  onClose,
  destinations,
}: {
  open: boolean
  onClose: () => void
  destinations: NavDestination[]
}) {
  const { t } = useI18n()
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [assetHits, setAssetHits] = useState<AssetHit[]>([])
  const [active, setActive] = useState(0)

  // Reset + focus on open; clear on close so the next open starts fresh.
  useEffect(() => {
    if (open) {
      setQuery('')
      setAssetHits([])
      setActive(0)
      // Defer focus to after the overlay paints.
      const h = window.setTimeout(() => inputRef.current?.focus(), 10)
      return () => window.clearTimeout(h)
    }
  }, [open])

  // Lock body scroll while the palette is open.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  // Debounced server-side asset search. Only fires for 2+ chars; the
  // inventory list `q` param matches name / asset_id / asset_type.
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) {
      setAssetHits([])
      return
    }
    let cancelled = false
    const handle = window.setTimeout(async () => {
      try {
        const r = await apiFetch(`/inventory/assets?q=${encodeURIComponent(q)}&limit=7`)
        if (!r.ok) return
        const body = await r.json()
        if (cancelled) return
        setAssetHits(Array.isArray(body?.items) ? body.items : [])
      } catch {
        // Network hiccup — pages still searchable, just no asset hits.
      }
    }, 180)
    return () => {
      cancelled = true
      window.clearTimeout(handle)
    }
  }, [query, open])

  const pageResults = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase()
    const matched = q
      ? destinations.filter(
          (d) =>
            t(d.label, d.label).toLowerCase().includes(q) ||
            d.label.toLowerCase().includes(q) ||
            d.section.toLowerCase().includes(q),
        )
      : destinations
    return matched.slice(0, q ? 6 : 8).map((d) => ({
      kind: 'page' as const,
      label: t(d.label, d.label),
      sub: t(d.section, d.section),
      to: d.to,
      icon: d.icon,
    }))
  }, [destinations, query, t])

  const assetResults = useMemo<Result[]>(
    () =>
      assetHits.map((a) => ({
        kind: 'asset' as const,
        label: (a.name && a.name.trim()) || a.asset_id,
        sub: [a.asset_type, a.criticality].filter(Boolean).join(' · ') || a.asset_id,
        to: `/inventory/${encodeURIComponent(a.asset_id)}`,
        icon: assetIcon(a.asset_type),
      })),
    [assetHits],
  )

  const results = useMemo(() => [...pageResults, ...assetResults], [pageResults, assetResults])

  // Keep the active index in range as results change.
  useEffect(() => {
    setActive((a) => (a >= results.length ? 0 : a))
  }, [results.length])

  if (!open) return null

  const go = (r: Result | undefined) => {
    if (!r) return
    router.push(r.to)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      go(results[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  const renderGroup = (title: string, group: Result[], startIndex: number) => {
    if (group.length === 0) return null
    return (
      <div style={{ padding: '6px 0' }}>
        <div
          style={{
            fontSize: 10,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--color-text-tertiary)',
            padding: '4px 14px',
          }}
        >
          {title}
        </div>
        {group.map((r, i) => {
          const idx = startIndex + i
          const isActive = idx === active
          return (
            <button
              key={`${r.kind}-${r.to}-${i}`}
              type="button"
              onMouseEnter={() => setActive(idx)}
              onClick={() => go(r)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                padding: '9px 14px',
                border: 'none',
                background: isActive ? 'var(--color-status-blue-bg)' : 'transparent',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <i
                className={`ti ${r.icon}`}
                aria-hidden="true"
                style={{ fontSize: 17, color: isActive ? 'var(--color-status-blue-deep)' : 'var(--color-text-tertiary)', flexShrink: 0 }}
              />
              <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: 'var(--color-text-primary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.label}
                </span>
                <span
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-tertiary)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {r.sub}
                </span>
              </span>
              {isActive ? (
                <i className="ti ti-corner-down-left" aria-hidden="true" style={{ fontSize: 13, color: 'var(--color-text-tertiary)' }} />
              ) : null}
            </button>
          )
        })}
      </div>
    )
  }

  const pageStart = 0
  const assetStart = pageResults.length

  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        background: 'rgba(8, 20, 40, 0.32)',
        backdropFilter: 'blur(1.5px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        animation: 'attestiv-fade-in 0.12s ease',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Command palette', 'Command palette')}
        onClick={(e) => e.stopPropagation()}
        style={{
          marginTop: '12vh',
          width: 'min(580px, calc(100vw - 32px))',
          background: 'var(--color-background-primary)',
          borderRadius: 'var(--border-radius-lg)',
          border: '0.5px solid var(--color-border-secondary)',
          boxShadow: '0 24px 60px -12px rgba(4, 44, 83, 0.28), 0 0 0 0.5px var(--color-border-tertiary)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '70vh',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
          <i className="ti ti-search" aria-hidden="true" style={{ fontSize: 18, color: 'var(--color-text-tertiary)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={t('Search pages and assets…', 'Search pages and assets…')}
            aria-label={t('Search pages and assets', 'Search pages and assets')}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: 15,
              color: 'var(--color-text-primary)',
              fontFamily: 'inherit',
            }}
          />
          <kbd
            style={{
              fontSize: 10,
              color: 'var(--color-text-tertiary)',
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 4,
              padding: '2px 6px',
              fontFamily: 'var(--font-mono)',
            }}
          >
            esc
          </kbd>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {results.length === 0 ? (
            <div style={{ padding: '28px 14px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 13 }}>
              {query.trim()
                ? t('No matches for "{q}"', 'No matches for "{q}"', { q: query.trim() })
                : t('Type to search…', 'Type to search…')}
            </div>
          ) : (
            <>
              {renderGroup(t('Pages', 'Pages'), pageResults, pageStart)}
              {renderGroup(t('Assets', 'Assets'), assetResults, assetStart)}
            </>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            gap: 14,
            padding: '8px 14px',
            borderTop: '0.5px solid var(--color-border-tertiary)',
            fontSize: 10,
            color: 'var(--color-text-tertiary)',
            background: 'var(--color-background-secondary)',
          }}
        >
          <span><kbd style={kbdStyle}>↑</kbd><kbd style={kbdStyle}>↓</kbd> {t('navigate', 'navigate')}</span>
          <span><kbd style={kbdStyle}>↵</kbd> {t('open', 'open')}</span>
          <span><kbd style={kbdStyle}>esc</kbd> {t('close', 'close')}</span>
        </div>
      </div>
    </div>
  )
}

const kbdStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 3,
  padding: '0 4px',
  marginRight: 2,
}
