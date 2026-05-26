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

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { apiFetch, apiJson } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { loadSettings, saveSettings } from '../lib/settings'
import { clearSessionMarker } from '../lib/session'
import { LanguageSwitcher } from './LanguageSwitcher'

// translateNavLabel: small helper that reuses the literal English label
// as the translation key. So `Overview` becomes `t('Overview',
// 'Overview')` — looks the key up in the dictionary if present, falls
// back to the English string otherwise. Keeps the data declaration
// readable (we can still see all the labels at a glance) without
// forcing a separate tKey for every nav entry.
function useNavTranslator() {
  const { t } = useI18n()
  return (label: string) => {
    const {
      t
    } = useI18n();

    return t(label, label);
  };
}

// Translation keys for the rail tooltips. Kept as a side table rather
// than added to each RailItem so the rail definition stays a plain
// data declaration; the renderer pulls the key when it resolves the
// localised label.
const RAIL_LABEL_TKEY: Record<SectionKey, string> = {
  dashboard: 'nav.dashboard',
  connectors: 'nav.connectors',
  evidence: 'nav.evidence',
  frameworks: 'nav.frameworks',
  apps: 'nav.apps',
  sites: 'nav.sites',
  inventory: 'nav.inventory',
  risks: 'nav.risks',
  policies: 'nav.policies',
  exceptions: 'nav.exceptions',
  remediation: 'nav.remediation',
  incidents: 'nav.incidents',
  thirdparties: 'nav.third_parties',
  dr: 'nav.dr',
  audit: 'nav.audit',
  settings: 'nav.settings',
}

type SectionKey =
  | 'dashboard'
  | 'connectors'
  | 'evidence'
  | 'frameworks'
  | 'apps'
  | 'sites'
  | 'inventory'
  | 'risks'
  | 'policies'
  | 'exceptions'
  | 'remediation'
  | 'incidents'
  | 'thirdparties'
  | 'dr'
  | 'audit'
  | 'settings'

type RailItem = {
  key: SectionKey
  label: string
  icon: string
  prefix: string
}

type NavItem = {
  to: string
  label: string
  icon: string
  badge?: 'issues' | 'dlq'
}

type Section = {
  key: SectionKey
  navLabel: string
  items: NavItem[]
}

// Top-rail order matches the mockup. "Settings" is pinned to the
// bottom via a flex spacer so admin-only entries don't crowd the
// daily-use rail.
const railTop: RailItem[] = [
  { key: 'dashboard',  label: 'Dashboard',  icon: 'ti-layout-dashboard', prefix: '/dashboard' },
  { key: 'connectors', label: 'Connectors', icon: 'ti-plug',             prefix: '/connectors' },
  { key: 'evidence',   label: 'Evidence',   icon: 'ti-lock',             prefix: '/evidence' },
  { key: 'frameworks', label: 'Frameworks', icon: 'ti-shield-check',     prefix: '/frameworks' },
  { key: 'apps',       label: 'Apps',       icon: 'ti-apps',             prefix: '/apps' },
  { key: 'sites',      label: 'Sites',      icon: 'ti-building',         prefix: '/sites' },
  { key: 'inventory',  label: 'Inventory',  icon: 'ti-database',         prefix: '/inventory' },
  { key: 'risks',      label: 'Risk',       icon: 'ti-alert-octagon',    prefix: '/risks' },
  { key: 'policies',   label: 'Policies',   icon: 'ti-file-text',        prefix: '/policies' },
  { key: 'exceptions', label: 'Exceptions', icon: 'ti-shield-off', prefix: '/exceptions' },
  { key: 'remediation', label: 'Remediation', icon: 'ti-checklist',       prefix: '/remediation' },
  { key: 'incidents',  label: 'Incidents',  icon: 'ti-radar-2',          prefix: '/incidents' },
  { key: 'thirdparties', label: 'Third parties', icon: 'ti-building',    prefix: '/third-parties' },
  { key: 'dr',         label: 'DR Testing', icon: 'ti-refresh-alert',    prefix: '/dr' },
  { key: 'audit',      label: 'Audit',      icon: 'ti-file-certificate', prefix: '/audit' },
]
const railBottom: RailItem[] = [
  { key: 'settings', label: 'Settings', icon: 'ti-settings', prefix: '/settings' },
]

// Each section's three sub-pages. Order is the order they appear in
// the sidebar. The first item is the section's default route (its
// /<section> path resolves here).
const sections: Record<SectionKey, Section> = {
  dashboard: {
    key: 'dashboard',
    navLabel: 'Summary',
    items: [
      { to: '/dashboard',         label: 'Overview', icon: 'ti-home' },
      { to: '/dashboard/posture', label: 'Posture',  icon: 'ti-chart-pie' },
      { to: '/dashboard/issues',  label: 'Issues',   icon: 'ti-alert-triangle', badge: 'issues' },
    ],
  },
  connectors: {
    key: 'connectors',
    navLabel: 'Sources',
    items: [
      { to: '/connectors',             label: 'Registry',    icon: 'ti-layout-grid' },
      { to: '/connectors/health',      label: 'Health',      icon: 'ti-activity' },
      { to: '/connectors/dead-letter', label: 'Dead-letter', icon: 'ti-inbox', badge: 'dlq' },
    ],
  },
  evidence: {
    key: 'evidence',
    navLabel: 'Evidence',
    items: [
      { to: '/evidence',            label: 'Live stream',       icon: 'ti-player-play' },
      { to: '/evidence/search',     label: 'Search',            icon: 'ti-search' },
      { to: '/evidence/cve-scans',  label: 'CVE scans',         icon: 'ti-bug' },
      { to: '/evidence/verify',     label: 'Verify signature',  icon: 'ti-check' },
    ],
  },
  frameworks: {
    key: 'frameworks',
    navLabel: 'Frameworks',
    items: [
      { to: '/frameworks',            label: 'All frameworks',    icon: 'ti-layout-list' },
      { to: '/frameworks/controls',   label: 'Controls',          icon: 'ti-list-check' },
      { to: '/frameworks/crosswalk',  label: 'Crosswalk',         icon: 'ti-arrows-cross' },
      { to: '/scoring/crosswalk',     label: 'Coverage by evidence', icon: 'ti-table-options' },
      { to: '/scoring/scope',         label: 'Per-scope score',   icon: 'ti-zoom-scan' },
    ],
  },
  apps: {
    key: 'apps',
    navLabel: 'Applications',
    items: [
      { to: '/apps',          label: 'Registry',  icon: 'ti-apps' },
      { to: '/apps?tier=tier_1', label: 'Tier 1',  icon: 'ti-flame' },
      { to: '/apps?gxp=true', label: 'GxP-validated', icon: 'ti-flask' },
    ],
  },
  sites: {
    key: 'sites',
    navLabel: 'Sites',
    items: [
      { to: '/sites',         label: 'Registry',         icon: 'ti-building' },
    ],
  },
  inventory: {
    key: 'inventory',
    navLabel: 'Inventory',
    items: [
      { to: '/inventory',                              label: 'All assets',      icon: 'ti-database' },
      { to: '/inventory?asset_type=vm',                label: 'Virtual machines', icon: 'ti-device-desktop' },
      { to: '/inventory?asset_type=host',              label: 'Hypervisor hosts', icon: 'ti-server-2' },
      { to: '/inventory?asset_type=cluster',           label: 'Clusters',         icon: 'ti-grid-pattern' },
      { to: '/inventory?asset_type=storage_array',     label: 'Storage arrays',   icon: 'ti-database' },
      { to: '/inventory?asset_type=storage_volume',    label: 'Storage volumes',  icon: 'ti-stack-2' },
      { to: '/inventory?asset_type=server',            label: 'Servers',          icon: 'ti-server' },
      { to: '/inventory?asset_type=firewall',          label: 'Firewalls',        icon: 'ti-wall' },
    ],
  },
  risks: {
    key: 'risks',
    navLabel: 'Risk',
    items: [
      { to: '/risks',          label: 'Register',  icon: 'ti-alert-octagon' },
      { to: '/risks/heatmap',  label: 'Heatmap',   icon: 'ti-grid-dots' },
      { to: '/risks?source=auto_scoring', label: 'Auto-created', icon: 'ti-rocket' },
      { to: '/risks?status=in_treatment', label: 'In treatment', icon: 'ti-tools' },
    ],
  },
  policies: {
    key: 'policies',
    navLabel: 'Policies',
    items: [
      { to: '/policies',                       label: 'All policies',  icon: 'ti-file-text' },
      { to: '/policies?overdueOnly=true',      label: 'Overdue review', icon: 'ti-clock-exclamation' },
      { to: '/policies?status=draft',          label: 'Draft',          icon: 'ti-pencil' },
    ],
  },
  exceptions: {
    key: 'exceptions',
    navLabel: 'Exceptions',
    items: [
      { to: '/exceptions',                  label: 'Register',       icon: 'ti-shield-off' },
      { to: '/exceptions?status=active',    label: 'Active',         icon: 'ti-clock' },
      { to: '/exceptions?status=expired',   label: 'Expired',        icon: 'ti-circle-x' },
    ],
  },
  remediation: {
    key: 'remediation',
    navLabel: 'Remediation',
    items: [
      { to: '/remediation',                  label: 'All tasks',  icon: 'ti-checklist' },
      { to: '/remediation?status=open',      label: 'Open',       icon: 'ti-circle-dot' },
      { to: '/remediation?priority=critical', label: 'Critical',  icon: 'ti-flame' },
    ],
  },
  incidents: {
    key: 'incidents',
    navLabel: 'Incidents',
    items: [
      { to: '/incidents',                            label: 'Register',          icon: 'ti-radar-2' },
      { to: '/incidents?nis2_significant=true',      label: 'NIS2 significant',  icon: 'ti-flame' },
      { to: '/incidents?status=detected',            label: 'Awaiting class.',   icon: 'ti-tag' },
    ],
  },
  thirdparties: {
    key: 'thirdparties',
    navLabel: 'Third parties',
    items: [
      { to: '/third-parties',                       label: 'Register',         icon: 'ti-building' },
      { to: '/third-parties?criticality=critical',  label: 'Critical',         icon: 'ti-flame' },
      { to: '/third-parties?due_only=true',         label: 'Due for review',   icon: 'ti-clock-exclamation' },
    ],
  },
  dr: {
    key: 'dr',
    navLabel: 'DR testing',
    items: [
      { to: '/dr',           label: 'Schedules',  icon: 'ti-calendar' },
      { to: '/dr/runs',      label: 'Test runs',  icon: 'ti-history' },
      { to: '/dr/approvals', label: 'Approvals',  icon: 'ti-user-check' },
    ],
  },
  audit: {
    key: 'audit',
    navLabel: 'Audit',
    items: [
      { to: '/audit',                  label: 'Audit trail',        icon: 'ti-timeline' },
      { to: '/audit/executive-summary', label: 'Executive summary',  icon: 'ti-presentation' },
      { to: '/audit/weekly-digest',     label: 'Weekly digest',      icon: 'ti-mail-fast' },
      { to: '/audit/reports',   label: 'Reports',     icon: 'ti-file-description' },
      { to: '/audit/manifests', label: 'Manifests',   icon: 'ti-file-certificate' },
      { to: '/audit/prepacket',      label: 'Pre-packet',  icon: 'ti-file-zip' },
      { to: '/audit/prepacket-diff', label: 'Posture diff', icon: 'ti-arrows-diff' },
      { to: '/audit/period-replay',  label: 'Period replay', icon: 'ti-history' },
    ],
  },
  settings: {
    key: 'settings',
    navLabel: 'Settings',
    items: [
      { to: '/settings',             label: 'Tenant',         icon: 'ti-building' },
      { to: '/settings/users',       label: 'Users & RBAC',   icon: 'ti-users' },
      { to: '/settings/keys',        label: 'API keys',       icon: 'ti-key' },
      { to: '/settings/frameworks',  label: 'Frameworks',     icon: 'ti-layout-list' },
      { to: '/settings/trust-store', label: 'Trust store',    icon: 'ti-certificate' },
      { to: '/settings/connectors',  label: 'Connector poll', icon: 'ti-refresh' },
      { to: '/settings/scoring',     label: 'Scoring poll',     icon: 'ti-gauge' },
      { to: '/settings/retention',     label: 'Retention policy', icon: 'ti-clock-hour-4' },
      { to: '/settings/dr-drill',      label: 'DR drill status',  icon: 'ti-shield-check' },
      { to: '/settings/authentication', label: 'Authentication',   icon: 'ti-key' },
      { to: '/settings/auth-posture',  label: 'Auth posture',     icon: 'ti-lock-square' },
      { to: '/settings/support',     label: 'Support bundle',   icon: 'ti-file-zip' },
    ],
  },
}

// Role-based nav visibility. The backend RBAC (internal/security/
// auth.go) is the enforcer; this only decides what to SHOW so a role
// isn't sent down dead-ends that 403. Mapping mirrors the backend:
//   - admin     superset, sees every section
//   - reporter  full read+write surface, minus admin config (Settings)
//   - reader    same surface as reporter for visibility (read-only)
//   - auditor   read-only AND restricted to auditorAllowedPrefixes,
//               so it only sees sections backed by those paths
type Role = 'admin' | 'reporter' | 'reader' | 'auditor'

// Non-admin roles allowed to see each section. admin is implicit
// (always allowed). An empty list means admin-only.
const SECTION_ROLES: Record<SectionKey, Role[]> = {
  dashboard:    ['reporter', 'reader', 'auditor'],
  connectors:   ['reporter', 'reader', 'auditor'],
  evidence:     ['reporter', 'reader', 'auditor'],
  frameworks:   ['reporter', 'reader', 'auditor'],
  apps:         ['reporter', 'reader'],
  sites:        ['reporter', 'reader'],
  inventory:    ['reporter', 'reader', 'auditor'],
  risks:        ['reporter', 'reader'],
  policies:     ['reporter', 'reader'],
  exceptions:   ['reporter', 'reader', 'auditor'],
  remediation:  ['reporter', 'reader'],
  incidents:    ['reporter', 'reader'],
  thirdparties: ['reporter', 'reader'],
  dr:           ['reporter', 'reader', 'auditor'],
  audit:        ['reporter', 'reader', 'auditor'],
  settings:     [],
}

// roles === null means "not resolved yet" (pre-/auth/me): render the
// full nav optimistically so there's no empty-rail flash and no
// regression. Once roles arrive we filter. Direct-URL access to a
// hidden section still works — the page's own 403 handling is the
// backstop — we just don't advertise it in the rail.
function canSeeSection(key: SectionKey, roles: string[] | null): boolean {
  if (roles === null) return true
  const set = new Set(roles.map((role) => role.toLowerCase().trim()))
  if (set.has('admin')) return true
  return SECTION_ROLES[key].some((role) => set.has(role))
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

function sectionFromPath(pathname: string): SectionKey {
  for (const item of [...railTop, ...railBottom]) {
    if (pathname === item.prefix || pathname.startsWith(`${item.prefix}/`)) {
      return item.key
    }
  }
  // Default: dashboard. Any unknown route lands here visually until
  // it 404s; better than rendering an empty rail.
  return 'dashboard'
}

function useRailLabel() {
  const { t } = useI18n()
  return (key: SectionKey, fallback: string) => {
    const {
      t
    } = useI18n();

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
  const activeSection = useMemo(() => sectionFromPath(pathname), [pathname])
  const section = sections[activeSection]

  const [tenantId, setTenantId] = useState('')
  const [subject, setSubject] = useState('')
  const [issuesCount, setIssuesCount] = useState(0)
  const [roles, setRoles] = useState<string[] | null>(null)

  // Pull current tenant + subject from /auth/me so the footer pill
  // reflects the bound principal, not whatever the user typed in
  // settings. Falls back to localStorage if /auth/me hasn't returned
  // yet (cold load).
  useEffect(() => {
    setTenantId(loadSettings().tenantId)
    // Seed from the cached roles first (instant correct nav for a
    // returning user), then reconcile with the authoritative /auth/me.
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
  }, [])

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
        onClick={() => router.push(sections[item.key].items[0].to)}
        className={`attestiv-rail-btn${active ? ' active' : ''}`}
      >
        <i className={`ti ${item.icon}`} aria-hidden="true" />
      </button>
    )
  }

  const renderNavItem = (item: NavItem) => {
    const active = pathname === item.to ||
      (item.to !== `/${section.key}` && pathname.startsWith(`${item.to}/`)) ||
      // Default nav item is active when pathname matches the section
      // root exactly (e.g. /dashboard → "Overview").
      (item.to === sections[section.key].items[0].to && pathname === sections[section.key].items[0].to)
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
    <div className="attestiv-shell">
      <div className="attestiv-rail">
        <div className="attestiv-rail-logo">
          <AttestivLogo />
        </div>
        {railTop.filter((item) => canSeeSection(item.key, roles)).map(renderRailButton)}
        <div className="attestiv-rail-spacer" />
        {railBottom.filter((item) => canSeeSection(item.key, roles)).map(renderRailButton)}
      </div>
      <aside className="attestiv-sidebar">
        <div className="attestiv-sidebar-header">
          <div className="attestiv-sidebar-title">{t('Attestiv', 'Attestiv')}</div>
          <div className="attestiv-sidebar-sub">{navT(section.navLabel)}</div>
        </div>
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
      <main className="attestiv-main">{children}</main>
    </div>
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
