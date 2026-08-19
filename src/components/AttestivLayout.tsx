'use client'

// AttestivLayout — the console shell.
//
// Three columns: 52px icon rail, 180px contextual sidebar, 1fr main
// content. The rail anchors the seven top-level sections; the
// sidebar shows the three sub-pages of the active section. This
// matches the mockup IA exactly and keeps the surface tight enough
// that the most important compliance objects (evidence, signatures,
// DLQ, audit trail) are always one click from any page.
//
// Auth gating: the page itself runs through the existing
// /v1/auth/me check via apiJson, so an authenticated user sees their
// roles. Tenant pill in the footer reflects the resolved tenant.
//
// Issue badge: polls the DLQ count every 30s. Same source the
// previous Layout used; the new chrome is purely a visual lift.
//
// Wayfinding: the nav model itself lives in lib/nav.ts, and
// resolveNavLocation() there decides which rail glyph and which sidebar
// entry light up. The shell renders three coordinated answers to "where
// am I?" — the lit rail glyph, the named section in the sidebar header,
// and the Breadcrumb strip above the page's own Topbar.

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { apiFetch, apiJson } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { loadSettings, saveSettings } from '../lib/settings'
import { clearSessionMarker } from '../lib/session'
import {
  RAIL_GROUPS,
  RAIL_LABEL_TKEY,
  canSeeSection,
  navDestinations,
  railBottom,
  railTop,
  resolveNavLocation,
  sections,
  type NavItem,
  type RailItem,
  type SectionKey,
} from '../lib/nav'
import { LanguageSwitcher } from './LanguageSwitcher'
import { GuidedTourProvider } from './GuidedTour'
import { BackgroundTasksProvider } from './BackgroundTasks'
import { FreshnessBanner } from './FreshnessBanner'
import { Breadcrumb, BreadcrumbLeafProvider } from './Breadcrumb'
import { CommandPalette } from './CommandPalette'

// translateNavLabel: small helper that reuses the literal English label
// as the translation key. So `Overview` becomes `t('Overview',
// 'Overview')` — looks the key up in the dictionary if present, falls
// back to the English string otherwise. Keeps the data declaration
// readable (we can still see all the labels at a glance) without
// forcing a separate tKey for every nav entry.
function useNavTranslator() {
  const { t } = useI18n()
  return (label: string) => {
    return t(label, label);
  };
}


const ROLES_CACHE_KEY = 'compliantly.ui.roles'

// Cache the resolved roles so a returning user gets the correct
// reduced nav on the next load without waiting for /auth/me — avoids
// a flash of admin-only sections for non-admins.
function loadCachedRoles(): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(ROLES_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((role): role is string => typeof role === 'string') : null
  } catch {
    return null
  }
}

function cacheRoles(roles: string[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(ROLES_CACHE_KEY, JSON.stringify(roles))
  } catch {
    // best-effort cache; nav still resolves from /auth/me
  }
}

function clearCachedRoles(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(ROLES_CACHE_KEY)
  } catch {
    // ignore
  }
}

// SearchParamsBridge exists to keep useSearchParams() out of the shell
// itself. Reading it directly in AttestivLayout forces a Suspense
// boundary around the whole console (Next aborts the prerender
// otherwise) — and a router.push() into a boundary that wraps the live
// tree starts a transition that never commits, so every rail and
// sidebar click silently did nothing. Isolating the read in a
// null-rendering child keeps the boundary around something that cannot
// block anything, and the shell learns the query through state.
function SearchParamsBridge({ onChange }: { onChange: (search: string) => void }) {
  const params = useSearchParams()
  const search = params?.toString() ?? ''
  useEffect(() => {
    onChange(search)
  }, [search, onChange])
  return null
}

function useRailLabel() {
  const { t } = useI18n()
  return (key: SectionKey, fallback: string) => {
    const translated = t(RAIL_LABEL_TKEY[key])
    // The translator returns the key itself when nothing matches;
    // fall back to the seed English label so a missing entry doesn't
    // surface `nav.dashboard` as a tooltip.
    return translated === RAIL_LABEL_TKEY[key] ? fallback : translated
  };
}

export function AttestivLayout({ children }: { children: ReactNode }) {
  const {
    t
  } = useI18n();

  const router = useRouter()
  const pathname = usePathname() || '/'
  // The query string is half of "where am I": /inventory?asset_type=vm
  // and /inventory are different sidebar entries, and pathname alone
  // cannot tell them apart. It arrives via SearchParamsBridge below —
  // see the note there for why it isn't read directly.
  const [search, setSearch] = useState('')
  const handleSearchChange = useCallback((next: string) => setSearch(next), [])
  const location = useMemo(() => resolveNavLocation(pathname, search), [pathname, search])
  const activeSection = location.sectionKey
  const section = location.section

  const [tenantId, setTenantId] = useState('')
  const [subject, setSubject] = useState('')
  const [issuesCount, setIssuesCount] = useState(0)
  const [roles, setRoles] = useState<string[] | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Shortcut hint defaults to ⌘K (matches SSR) and corrects to Ctrl K on
  // non-Mac after mount, avoiding a hydration mismatch.
  const [shortcutHint, setShortcutHint] = useState('⌘K')
  const destinations = useMemo(() => navDestinations(roles), [roles])

  // Pull current tenant + subject from /auth/me so the footer pill
  // reflects the bound principal, not whatever the user typed in
  // settings. Re-runs on pathname change so the post-login redirect
  // (login → /dashboard) refetches once the session cookie is set —
  // previously the [] dep meant the first call ran while still
  // unauthenticated and the user pill stayed empty until a manual
  // refresh.
  useEffect(() => {
    setTenantId(loadSettings().tenantId)
    setRoles(loadCachedRoles())
    let cancelled = false
    apiJson<{ subject?: string; roles?: string[]; tenant_id?: string | null }>('/auth/me')
      .then((response) => {
        if (cancelled) return
        if (response.tenant_id) setTenantId(response.tenant_id)
        if (response.subject) setSubject(response.subject)
        if (Array.isArray(response.roles)) {
          setRoles(response.roles)
          cacheRoles(response.roles)
        }
      })
      .catch(() => {
        // Layout is rendered before auth resolution; silent failure
        // is fine. The login redirect happens via middleware.
      })
    return () => {
      cancelled = true
    }
  }, [pathname])

  // Global ⌘K / Ctrl-K opens the command palette from anywhere in the
  // console. Toggles so a second press closes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const platform = typeof navigator !== 'undefined' ? navigator.platform : ''
    if (!/Mac|iPhone|iPad/.test(platform)) setShortcutHint('Ctrl K')
  }, [])

  // Every console route inherited the root layout's static "Attestiv"
  // title, so browser tabs, history entries and bookmarks were all
  // indistinguishable. Mirror the breadcrumb into document.title —
  // "Inventory · Virtual machines · Attestiv".
  //
  // Mirror the breadcrumb into the tab title, so browser tabs, history
  // entries and bookmarks are told apart — every console route used to
  // inherit the root layout's static "Attestiv".
  //
  // Best-effort by design. On a soft navigation (the normal case in this
  // console) this always wins. On a cold load Next may apply the root
  // layout's static metadata title after this effect, and some routes
  // then keep showing plain "Attestiv" — the same title they showed
  // before, so nothing regresses. Making it unconditional would mean a
  // per-route generateMetadata across ~70 routes, which still could not
  // express the filter deep-links (?asset_type=vm) that half these
  // titles come from.
  useEffect(() => {
    const crumbs = location.trail.map((node) =>
      node.literal ? node.label : t(node.tKey ?? node.label, node.label),
    )
    document.title = [...crumbs, 'Attestiv'].join(' · ')
  }, [location, t])

  // DLQ count for the Issues / Dead-letter badges. Same source as
  // the previous Layout — Phase 3 has the count tenant-scoped at the
  // store layer, so this number reflects only the current tenant.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const response = await apiJson<{ count?: number }>(
          '/ingest/queue?queue=dead_letter&status=dead_letter&limit=1',
        )
        if (!cancelled) setIssuesCount(response.count || 0)
      } catch {
        // No-op: a transient failure shouldn't break the chrome.
      }
    }
    void refresh()
    const handle = window.setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  // Sign out: revoke the server session (clears the httpOnly cookie +
  // audit-logs the logout), drop the locally-stored credential, clear
  // the middleware session marker, and bounce to /login. Best-effort
  // on the server call — in dev-mode or with an API key the endpoint
  // may 403/401, but we still must clear local state so the next load
  // is unauthenticated.
  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' })
    } catch {
      // ignore — clear local state regardless
    }
    clearSessionMarker()
    clearCachedRoles()
    saveSettings({ ...loadSettings(), apiKey: '', localToken: '' })
    router.push('/login')
  }

  const railLabel = useRailLabel()
  const navT = useNavTranslator()
  const renderRailButton = (item: RailItem) => {
    const active = item.key === activeSection
    const label = railLabel(item.key, item.label)
    return (
      <button
        key={item.key}
        type="button"
        title={label}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
        data-tour-id={`nav-${item.key}`}
        onClick={() => router.push(sections[item.key].items[0].to)}
        className={`attestiv-rail-btn${active ? ' active' : ''}`}
      >
        <i className={`ti ${item.icon}`} aria-hidden="true" />
      </button>
    )
  }

  const renderNavItem = (item: NavItem) => {
    // Exactly one entry is current, chosen by resolveNavLocation, so a
    // filter deep-link no longer leaves the section root lit and a
    // detail route no longer leaves the whole sidebar dark.
    const active = item === location.item
    const showBadge = item.badge && issuesCount > 0
    return (
      <button
        key={item.to}
        type="button"
        onClick={() => router.push(item.to)}
        aria-current={active ? 'page' : undefined}
        className={`attestiv-nav-item${active ? ' active' : ''}`}
      >
        <i className={`ti ${item.icon}`} aria-hidden="true" />
        <span style={{ flex: 1 }}>{navT(item.label)}</span>
        {showBadge ? (
          <span
            className="attestiv-nav-badge"
            style={{ background: 'var(--color-status-red-bg)', color: 'var(--color-status-red-deep)' }}
          >
            {issuesCount}
          </span>
        ) : null}
      </button>
    )
  }

  return (
    <BackgroundTasksProvider>
    <GuidedTourProvider>
    <BreadcrumbLeafProvider>
    <Suspense fallback={null}>
      <SearchParamsBridge onChange={handleSearchChange} />
    </Suspense>
    <div className="attestiv-shell">
      <div className="attestiv-rail">
        <div className="attestiv-rail-logo">
          <AttestivLogo />
        </div>
        {RAIL_GROUPS.map((group) => {
          const items = group.keys
            .map((k) => railTop.find((r) => r.key === k))
            .filter((r): r is RailItem => !!r && canSeeSection(r.key, roles))
          if (items.length === 0) return null
          const groupLabel = t(group.labelKey, group.label)
          return (
            <div key={group.label} style={{ display: 'contents' }}>
              <div className="attestiv-rail-group">
                <span className="attestiv-rail-group-text">{groupLabel}</span>
              </div>
              {items.map(renderRailButton)}
            </div>
          )
        })}
        <div className="attestiv-rail-spacer" />
        {railBottom.filter((item) => canSeeSection(item.key, roles)).map(renderRailButton)}
      </div>
      <aside className="attestiv-sidebar">
        {/* The header names the section you are in, not the product —
          * the rail's logo already carries the brand, and "which of the
          * seventeen glyphs is lit?" is the question a user actually
          * has here. It shows the RAIL label (Connectors), because the
          * sidebar group below shows the section's own heading
          * (Sources); showing only the latter meant you clicked
          * "Connectors" and landed somewhere called "Sources". */}
        <div className="attestiv-sidebar-header">
          <div className="attestiv-sidebar-brand">{t('Attestiv', 'Attestiv')}</div>
          <div className="attestiv-sidebar-title">
            <i className={`ti ${location.rail.icon}`} aria-hidden="true" />
            <span>{railLabel(activeSection, location.rail.label)}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label={t('Search pages and assets', 'Search pages and assets')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            width: 'calc(100% - 16px)',
            margin: '8px',
            padding: '7px 9px',
            border: '0.5px solid var(--color-border-secondary)',
            borderRadius: 'var(--border-radius-md)',
            background: 'var(--color-background-secondary)',
            color: 'var(--color-text-tertiary)',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
          }}
        >
          <i className="ti ti-search" aria-hidden="true" style={{ fontSize: 14 }} />
          <span style={{ flex: 1, textAlign: 'left' }}>{t('Search…', 'Search…')}</span>
          <kbd
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              border: '0.5px solid var(--color-border-secondary)',
              borderRadius: 4,
              padding: '1px 5px',
            }}
          >
            {shortcutHint}
          </kbd>
        </button>
        <div className="attestiv-nav-group">
          <div className="attestiv-nav-label">{navT(section.navLabel)}</div>
          {section.items.map(renderNavItem)}
        </div>
        <div className="attestiv-sidebar-footer">
          <LanguageSwitcher />
          <div className="attestiv-tenant-pill">
            <div className="attestiv-tenant-dot" />
            <div>
              <div style={{ fontSize: 11, fontWeight: 500 }}>{tenantId || navT('No tenant')}</div>
              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>
                {subject || navT('unauthenticated')}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="attestiv-nav-item"
            style={{ width: '100%', marginTop: 8, color: 'var(--color-text-secondary)' }}
          >
            <i className="ti ti-logout" aria-hidden="true" />
            <span style={{ flex: 1, textAlign: 'left' }}>{t('nav.logout', 'Sign out')}</span>
          </button>
        </div>
      </aside>
      <main className="attestiv-main">
        <FreshnessBanner />
        <Breadcrumb trail={location.trail} />
        {children}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} destinations={destinations} />
    </div>
    </BreadcrumbLeafProvider>
    </GuidedTourProvider>
    </BackgroundTasksProvider>
  );
}

// Inline brand mark from the mockup. Shield + check, three-tone
// blue. Inlining beats a separate SVG file because the colors are
// design tokens — keeping the source here means the logo moves with
// the palette automatically.
export function AttestivLogo() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 1L3 4.5V10C3 14.5 6 18 10 19.5C14 18 17 14.5 17 10V4.5L10 1Z"
        fill="var(--color-brand-blue-pale)"
        stroke="var(--color-brand-blue-soft)"
        strokeWidth="0.5"
      />
      <path
        d="M10 3.5L5 6.5V10C5 13.5 7.5 16.5 10 17.5C12.5 16.5 15 13.5 15 10V6.5L10 3.5Z"
        fill="var(--color-brand-blue-mid)"
      />
      <path
        d="M7 10L9.5 12.5L14 8"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
