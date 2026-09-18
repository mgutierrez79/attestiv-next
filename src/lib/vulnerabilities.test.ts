import { describe, expect, it } from 'vitest'

import {
  buildFleetQuery,
  deriveAssetVulnCard,
  deriveFleetView,
  fleetHrefForAsset,
  isWeakMatch,
  offsetFromPage,
  pageFromOffset,
  productLabel,
  severityChips,
  severityTone,
  WEAK_MATCH_CONFIDENCE,
  type AssetVulnResponse,
} from './vulnerabilities'

// These tests pin the safety property of the vulnerability surfaces:
// "no visibility" must never render as "no vulnerabilities". An asset
// with scanner_coverage=false, or served by an older backend where the
// endpoint 404s, shows "not scanned" — an explicit clean state exists
// only when a scanner actually covered the asset and found nothing.

const populated: AssetVulnResponse = {
  asset_id: 'vm-101',
  count: 12,
  summary: {
    critical: 2,
    high: 5,
    medium: 4,
    low: 1,
    kev: 1,
    sources: ['sentinelone'],
    scanner_coverage: true,
    newest_observed_at: '2026-08-20T00:00:00Z',
    oldest_open_days: 214,
  },
  items: [
    {
      cve_id: 'CVE-2025-1234',
      severity: 'critical',
      cvss: 9.8,
      title: 'RCE in example',
      product: 'openssl',
      version: '3.0.1',
      source: 'sentinelone',
      source_type: 'scanner',
      match_confidence: 'scanner_host_reported',
      state: 'open',
      days_open: 78,
      is_kev: true,
      kev_due_date: '2026-03-01',
      kev_ransomware: 'Known',
    },
  ],
  limit: 100,
  offset: 0,
  truncated: false,
}

describe('deriveAssetVulnCard', () => {
  it('is loading before the fetch settles', () => {
    expect(deriveAssetVulnCard({ kind: 'loading' })).toEqual({ state: 'loading' })
  })

  it('renders findings when the scanner covers the asset', () => {
    const card = deriveAssetVulnCard({ kind: 'loaded', body: populated })
    expect(card.state).toBe('populated')
    if (card.state !== 'populated') throw new Error('unreachable')
    expect(card.count).toBe(12)
    expect(card.items).toHaveLength(1)
    expect(card.summary.kev).toBe(1)
  })

  it('shows "not scanned" when scanner_coverage is false — even with zero items', () => {
    const card = deriveAssetVulnCard({
      kind: 'loaded',
      body: { asset_id: 'vm-9', count: 0, summary: { scanner_coverage: false }, items: [] },
    })
    expect(card.state).toBe('not_scanned')
  })

  it('shows "not scanned" when the endpoint 404s (older backend)', () => {
    expect(deriveAssetVulnCard({ kind: 'error', status: 404 })).toEqual({ state: 'not_scanned' })
  })

  it('never implies clean on any other fetch failure', () => {
    expect(deriveAssetVulnCard({ kind: 'error', status: 500 }).state).toBe('not_scanned')
    expect(deriveAssetVulnCard({ kind: 'error' }).state).toBe('not_scanned')
  })

  it('treats a missing scanner_coverage field as no coverage', () => {
    const card = deriveAssetVulnCard({
      kind: 'loaded',
      body: { asset_id: 'vm-9', count: 0, items: [] },
    })
    expect(card.state).toBe('not_scanned')
  })

  it('is explicitly clean only for covered assets with zero findings', () => {
    const card = deriveAssetVulnCard({
      kind: 'loaded',
      body: {
        asset_id: 'vm-9',
        count: 0,
        summary: { scanner_coverage: true, sources: ['sentinelone'] },
        items: [],
      },
    })
    expect(card.state).toBe('clean')
  })
})

describe('severityChips', () => {
  it('keeps critical→low order and appends KEV', () => {
    const chips = severityChips(populated.summary)
    expect(chips.map((c) => c.key)).toEqual(['critical', 'high', 'medium', 'low', 'kev'])
    expect(chips.map((c) => c.count)).toEqual([2, 5, 4, 1, 1])
  })

  it('keeps zero-count severities but drops a zero KEV chip', () => {
    const chips = severityChips({ critical: 0, high: 1, kev: 0, scanner_coverage: true })
    expect(chips.map((c) => c.key)).toEqual(['critical', 'high', 'medium', 'low'])
    expect(chips[0].count).toBe(0)
  })

  it('tolerates an absent summary', () => {
    expect(severityChips(undefined).map((c) => c.count)).toEqual([0, 0, 0, 0])
  })
})

describe('severityTone', () => {
  it('maps the four severities and defaults unknowns to gray', () => {
    expect(severityTone('critical')).toBe('red')
    expect(severityTone('CRITICAL')).toBe('red')
    expect(severityTone('high')).toBe('amber')
    expect(severityTone('medium')).toBe('blue')
    expect(severityTone('low')).toBe('gray')
    expect(severityTone('weird')).toBe('gray')
    expect(severityTone(undefined)).toBe('gray')
  })
})

describe('weak-match indicator', () => {
  it('flags only the name-only unversioned join', () => {
    expect(isWeakMatch({ match_confidence: WEAK_MATCH_CONFIDENCE })).toBe(true)
    expect(isWeakMatch({ match_confidence: 'scanner_host_reported' })).toBe(false)
    expect(isWeakMatch({})).toBe(false)
  })
})

describe('productLabel', () => {
  it('joins product@version and degrades gracefully', () => {
    expect(productLabel({ product: 'openssl', version: '3.0.1' })).toBe('openssl@3.0.1')
    expect(productLabel({ product: 'openssl' })).toBe('openssl')
    expect(productLabel({ title: 'RCE in example' })).toBe('RCE in example')
    expect(productLabel({})).toBe('—')
  })
})

describe('buildFleetQuery — fleet filter logic', () => {
  it('returns an empty string with no filters', () => {
    expect(buildFleetQuery({})).toBe('')
  })

  it('encodes each filter and skips blanks', () => {
    expect(buildFleetQuery({ severity: 'critical' })).toBe('?severity=critical')
    expect(buildFleetQuery({ severity: '  ' })).toBe('')
    expect(buildFleetQuery({ source: 'sentinelone' })).toBe('?source=sentinelone')
    expect(buildFleetQuery({ q: 'CVE-2025-1234' })).toBe('?q=CVE-2025-1234')
  })

  it('sends the exact asset_id filter distinct from the free-text q', () => {
    expect(buildFleetQuery({ assetId: 'asset-1' })).toBe('?asset_id=asset-1')
    expect(buildFleetQuery({ assetId: '  ' })).toBe('')
    expect(buildFleetQuery({ assetId: 'vm/101' })).toBe('?asset_id=vm%2F101')
    expect(buildFleetQuery({ assetId: 'asset-1', q: 'openssl' })).toBe('?asset_id=asset-1&q=openssl')
  })

  it('sends kev only as kev=true — unchecked means no filter, not kev=false', () => {
    expect(buildFleetQuery({ kev: true })).toBe('?kev=true')
    expect(buildFleetQuery({ kev: false })).toBe('')
    expect(buildFleetQuery({ kev: undefined })).toBe('')
  })

  it('normalises severity casing and URL-encodes free text', () => {
    expect(buildFleetQuery({ severity: 'Critical' })).toBe('?severity=critical')
    expect(buildFleetQuery({ q: 'sql server' })).toBe('?q=sql+server')
  })

  it('combines filters in a stable order with paging', () => {
    expect(
      buildFleetQuery({
        assetId: 'asset-1',
        severity: 'high',
        kev: true,
        source: 'sentinelone',
        q: 'vm-1',
        limit: 50,
        offset: 100,
      }),
    ).toBe('?asset_id=asset-1&severity=high&kev=true&source=sentinelone&q=vm-1&limit=50&offset=100')
  })

  it('omits a zero offset and non-positive limits', () => {
    expect(buildFleetQuery({ limit: 50, offset: 0 })).toBe('?limit=50')
    expect(buildFleetQuery({ limit: 0 })).toBe('')
  })
})

describe('deriveFleetView', () => {
  it('marks a 404 as unsupported (older backend), other errors as errors', () => {
    expect(deriveFleetView({ kind: 'error', status: 404 })).toEqual({ state: 'unsupported' })
    const err = deriveFleetView({ kind: 'error', status: 500, message: 'boom' })
    expect(err).toEqual({ state: 'error', message: 'boom' })
  })

  it('honours count and truncated from the response', () => {
    const view = deriveFleetView({
      kind: 'loaded',
      body: { count: 240, items: [{ cve_id: 'CVE-1', asset_id: 'a' }], limit: 100, offset: 0, truncated: true },
    })
    expect(view).toEqual({
      state: 'loaded',
      items: [{ cve_id: 'CVE-1', asset_id: 'a' }],
      count: 240,
      truncated: true,
    })
  })

  it('defaults count to the delivered item count', () => {
    const view = deriveFleetView({ kind: 'loaded', body: { items: [{ cve_id: 'CVE-1' }] } })
    expect(view.state).toBe('loaded')
    if (view.state !== 'loaded') throw new Error('unreachable')
    expect(view.count).toBe(1)
    expect(view.truncated).toBe(false)
  })
})

describe('offset paging', () => {
  it('round-trips page and offset', () => {
    expect(pageFromOffset(0, 50)).toBe(0)
    expect(pageFromOffset(100, 50)).toBe(2)
    expect(offsetFromPage(2, 50)).toBe(100)
    expect(pageFromOffset(offsetFromPage(3, 25), 25)).toBe(3)
  })

  it('never divides by a zero limit', () => {
    expect(pageFromOffset(100, 0)).toBe(0)
    expect(offsetFromPage(2, 0)).toBe(0)
  })
})

describe('fleetHrefForAsset', () => {
  it('deep-links with the exact asset_id filter, encoded', () => {
    expect(fleetHrefForAsset('asset-1')).toBe('/evidence/vulnerabilities?asset_id=asset-1')
    expect(fleetHrefForAsset('vm/101')).toBe('/evidence/vulnerabilities?asset_id=vm%2F101')
  })
})
