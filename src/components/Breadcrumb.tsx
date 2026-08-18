'use client'

// Breadcrumb — the console's "you are here" strip.
//
// The shell used to communicate location through two weak signals: a
// blue pill on one of seventeen near-identical rail glyphs, and a
// sidebar heading that named the section by a *different* word than the
// rail tooltip (click "Connectors", land on "Sources"). Once a page
// scrolled, both were off-screen and the answer to "which menu option
// am I in?" was nowhere on the page.
//
// This strip sits above each page's Topbar and spells the path out:
//   [icon] Inventory › All assets › vpw-rtm1-a01
// Ancestors are links, so it doubles as the way back up from a detail
// page — previously a browser-back-only journey.
//
// The trail comes from resolveNavLocation(), i.e. from the same nav
// model the rail and sidebar render, so the three can't drift.

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import type { TrailNode } from '../lib/nav'
import { useI18n } from '../lib/i18n'

// Detail routes end in an opaque id (/inventory/6f2c-…), and only the
// page itself knows the human name behind it. It publishes that name
// here and the strip swaps it into the last node. Pages that don't
// opt in simply show the id, which still beats showing nothing.
const BreadcrumbLeafContext = createContext<{
  leaf: string | null
  setLeaf: (label: string | null) => void
}>({ leaf: null, setLeaf: () => {} })

export function BreadcrumbLeafProvider({ children }: { children: ReactNode }) {
  const [leaf, setLeaf] = useState<string | null>(null)
  const value = useMemo(() => ({ leaf, setLeaf }), [leaf])
  return <BreadcrumbLeafContext.Provider value={value}>{children}</BreadcrumbLeafContext.Provider>
}

/**
 * useBreadcrumbLeaf names the current record in the breadcrumb, e.g.
 * `useBreadcrumbLeaf(asset?.name)` on an asset detail page. Pass
 * null/undefined while loading — the strip keeps showing the raw id
 * until a name arrives. Clears itself on unmount so the next page
 * doesn't inherit a stale name.
 */
export function useBreadcrumbLeaf(label: string | null | undefined): void {
  const { setLeaf } = useContext(BreadcrumbLeafContext)
  useEffect(() => {
    setLeaf(label ?? null)
    return () => setLeaf(null)
  }, [label, setLeaf])
}

export function Breadcrumb({ trail }: { trail: TrailNode[] }) {
  const { t } = useI18n()
  const { leaf } = useContext(BreadcrumbLeafContext)
  if (trail.length === 0) return null

  // Nav labels are their own translation keys (the t(label, label)
  // convention used throughout the nav); ids and record names are not.
  const text = (node: TrailNode) => (node.literal ? node.label : t(node.tKey ?? node.label, node.label))

  return (
    <nav className="attestiv-breadcrumb" aria-label={t('nav.breadcrumb', 'Breadcrumb')}>
      <ol className="attestiv-breadcrumb-list">
        {trail.map((node, index) => {
          const last = index === trail.length - 1
          const label = last && leaf ? leaf : text(node)
          return (
            <li key={`${node.href ?? 'current'}-${index}`} className="attestiv-breadcrumb-node">
              {index > 0 ? (
                <i className="ti ti-chevron-right attestiv-breadcrumb-sep" aria-hidden="true" />
              ) : null}
              {node.icon ? <i className={`ti ${node.icon} attestiv-breadcrumb-icon`} aria-hidden="true" /> : null}
              {node.href && !last ? (
                <Link href={node.href} className="attestiv-breadcrumb-link">
                  {label}
                </Link>
              ) : (
                <span className="attestiv-breadcrumb-current" aria-current={last ? 'page' : undefined}>
                  {label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
