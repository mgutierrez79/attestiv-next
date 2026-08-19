import { describe, expect, it } from 'vitest'

import { resolveNavLocation, sectionFromPath } from './nav'

// These tests pin the three wayfinding failures that motivated
// resolveNavLocation. Each one shipped as a silently-wrong highlight,
// so they are worth guarding rather than trusting to review.

describe('sectionFromPath', () => {
  it('resolves rail prefixes', () => {
    expect(sectionFromPath('/connectors/health')).toBe('connectors')
    expect(sectionFromPath('/settings/keys')).toBe('settings')
  })

  it('routes the sections folded into Inventory', () => {
    for (const path of ['/apps', '/apps/a-1', '/sites/s-1', '/third-parties', '/network/topology']) {
      expect(sectionFromPath(path)).toBe('inventory')
    }
  })

  // Regression: /scoring/* is only reachable from the Frameworks
  // sidebar, but it matched no rail prefix and fell through to the
  // dashboard default — so opening "Coverage by evidence" threw the
  // rail back to Dashboard.
  it('keeps /scoring under Frameworks', () => {
    expect(sectionFromPath('/scoring/crosswalk')).toBe('frameworks')
    expect(sectionFromPath('/scoring/frameworks/soc2/controls/CC1.1')).toBe('frameworks')
  })

  it('falls back to dashboard for unknown routes', () => {
    expect(sectionFromPath('/nope')).toBe('dashboard')
  })
})

describe('resolveNavLocation', () => {
  it('marks the section root current on an unfiltered URL', () => {
    const at = resolveNavLocation('/inventory')
    expect(at.item?.label).toBe('All assets')
    expect(at.trail.map((n) => n.label)).toEqual(['Inventory', 'All assets'])
  })

  // Regression: usePathname() drops the query, so every filter
  // deep-link left "All assets" lit instead of the entry the user
  // clicked.
  it('picks the entry whose filter is active', () => {
    expect(resolveNavLocation('/inventory', 'asset_type=vm').item?.label).toBe('Virtual machines')
    expect(resolveNavLocation('/inventory', '?asset_type=firewall').item?.label).toBe('Firewalls')
    expect(resolveNavLocation('/risks', 'status=in_treatment').item?.label).toBe('In treatment')
    expect(resolveNavLocation('/policies', 'overdueOnly=true').item?.label).toBe('Overdue review')
  })

  it('keeps the filter entry current when the URL carries extra params', () => {
    expect(resolveNavLocation('/inventory', 'asset_type=vm&q=web').item?.label).toBe('Virtual machines')
  })

  it('falls back to the section root for a filter no entry claims', () => {
    expect(resolveNavLocation('/inventory', 'q=web').item?.label).toBe('All assets')
  })

  it('does not match a filter entry from a bare section URL', () => {
    expect(resolveNavLocation('/inventory').item?.label).not.toBe('Virtual machines')
  })

  // Regression: the old check excluded the section root from prefix
  // matching, so a detail route lit nothing at all in the sidebar.
  it('keeps the parent entry current on a detail route, and names the record', () => {
    const at = resolveNavLocation('/inventory/dc1-esx-04')
    expect(at.item?.label).toBe('All assets')
    expect(at.trail.map((n) => n.label)).toEqual(['Inventory', 'All assets', 'dc1-esx-04'])
    expect(at.trail[2].literal).toBe(true)
  })

  it('prefers the most specific ancestor', () => {
    // /dr/plans must beat /dr on /dr/plans/{id}.
    expect(resolveNavLocation('/dr/plans/plan-7').item?.label).toBe('DR Plans')
    // An exact child beats the section root that also prefixes it.
    expect(resolveNavLocation('/inventory/network').item?.label).toBe('Network')
  })

  it('builds a trail for routes with no sidebar entry', () => {
    expect(resolveNavLocation('/apps/new').trail.map((n) => n.label)).toEqual([
      'Inventory',
      'Applications',
      'New application',
    ])
    // /scoring is a routing group, not a page — it must not appear.
    expect(resolveNavLocation('/scoring/calculator').trail.map((n) => n.label)).toEqual([
      'Frameworks',
      'Scoring calculator',
    ])
    // Unlisted static segments are de-slugged rather than shown raw.
    expect(resolveNavLocation('/apps/a-1/edit').trail.map((n) => n.label)).toEqual([
      'Inventory',
      'Applications',
      'a-1',
      'Edit',
    ])
  })

  it('links ancestors and never the current page', () => {
    const at = resolveNavLocation('/connectors/dead-letter')
    expect(at.trail[0].href).toBe('/connectors')
    expect(at.trail[at.trail.length - 1].href).toBeUndefined()
  })

  it('never links a breadcrumb ancestor that has no page behind it', () => {
    // /scoring/frameworks, /scoring/frameworks/{fid} and .../controls are
    // structural parents of the control-detail route — no page.tsx exists
    // for any of them, so a link would 404 (found in the 2026-08 UX audit).
    const at = resolveNavLocation('/scoring/frameworks/iso27001/controls/ISO27001-A5.9')
    expect(at.trail.map((n) => n.label)).toEqual([
      'Frameworks',
      'Framework score',
      'iso27001',
      'Controls',
      'ISO27001-A5.9',
    ])
    expect(at.trail[0].href).toBe('/frameworks')
    expect(at.trail[1].href).toBeUndefined()
    expect(at.trail[2].href).toBeUndefined()
    expect(at.trail[3].href).toBeUndefined()
    const trend = resolveNavLocation('/scoring/trend/soc2')
    expect(trend.trail.map((n) => n.label)).toEqual(['Frameworks', 'Score trend', 'soc2'])
    expect(trend.trail[1].href).toBeUndefined()
  })

  it('ignores a trailing slash', () => {
    expect(resolveNavLocation('/connectors/health/').item?.label).toBe('Health')
  })

  it('gives the Management section a rail item even though it is hidden', () => {
    const at = resolveNavLocation('/management/board-pack')
    expect(at.sectionKey).toBe('management')
    expect(at.rail.icon).toBeTruthy()
    expect(at.trail.map((n) => n.label)).toEqual(['Management', 'Board pack'])
  })
})
