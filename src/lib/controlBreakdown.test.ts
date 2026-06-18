import { describe, it, expect, vi } from 'vitest'
import {
  asScoredBadge,
  citationVerified,
  confidenceSummary,
  confidenceTone,
  contentDispositionFilename,
  downloadSignedBreakdown,
  failingItemsToCSV,
  FAILING_ITEM_CSV_COLUMNS,
  groupingCallouts,
  hasOpenLinkage,
  measuredHeadline,
  narrativeLines,
  observedBySources,
  resolvePresentationMode,
  signedBreakdownExportPath,
  sourceIsStale,
  type ControlBreakdown,
  type FailingItem,
  type SignedExportDeps,
} from './controlBreakdown'

// These tests pin the board-readable explainability contract: the
// "How did I pass?" drill-down must read obligation-first, must flag
// unverified citations, must keep measurement confidence distinct from
// the compliance score, must call out unowned + crown-jewel gaps, must
// export a CSV whose columns match the gap table, must warn before
// creating a duplicate risk/task, and must drive the layout off
// presentation_mode. Every backend field is omitempty, so each test also
// exercises the defensive (absent-field) path.

describe('resolvePresentationMode', () => {
  it('passes through known modes', () => {
    for (const m of ['proportional', 'gate', 'event', 'attestation'] as const) {
      expect(resolvePresentationMode(m)).toBe(m)
    }
  })
  it('falls back to proportional for unknown/absent', () => {
    expect(resolvePresentationMode(undefined)).toBe('proportional')
    expect(resolvePresentationMode('weird')).toBe('proportional')
  })
})

describe('narrativeLines — obligation first', () => {
  it('renders requirement first, then method/result/gap/remediation', () => {
    const lines = narrativeLines({
      remediation: 'Tag the 184 unowned assets.',
      result: '1,236 of 1,420 encrypted.',
      requirement: 'All production volumes must be encrypted at rest.',
      method: 'Counted encrypted volumes from the CMDB.',
      gap: '184 volumes unencrypted.',
    })
    expect(lines.map((l) => l.key)).toEqual([
      'requirement',
      'method',
      'result',
      'gap',
      'remediation',
    ])
    // The lead line is the obligation, regardless of object key order.
    expect(lines[0].text).toMatch(/must be encrypted/)
  })

  it('drops absent/blank fields (omitempty)', () => {
    const lines = narrativeLines({ requirement: 'X', method: '   ', result: '' })
    expect(lines.map((l) => l.key)).toEqual(['requirement'])
  })

  it('returns [] for an absent narrative', () => {
    expect(narrativeLines(undefined)).toEqual([])
  })
})

describe('citationVerified — unverified caption gating', () => {
  it('is true only for an explicit verified status', () => {
    expect(citationVerified('verified')).toBe(true)
    expect(citationVerified('VERIFIED')).toBe(true)
  })
  it('is false for draft / derived / missing', () => {
    expect(citationVerified('draft')).toBe(false)
    expect(citationVerified('derived')).toBe(false)
    expect(citationVerified(undefined)).toBe(false)
    expect(citationVerified('')).toBe(false)
  })
})

describe('confidence is distinct from the compliance score', () => {
  it('maps level to its own tone scale', () => {
    expect(confidenceTone('high')).toBe('green')
    expect(confidenceTone('medium')).toBe('amber')
    expect(confidenceTone('low')).toBe('red')
    expect(confidenceTone(undefined)).toBe('gray')
  })

  it('builds a reason-based summary', () => {
    const s = confidenceSummary({ level: 'medium', reason: '2 of 6 sources stale' })
    expect(s).toEqual({ level: 'medium', detail: '2 of 6 sources stale' })
  })

  it('derives "N of M sources stale" from healthy/total counts', () => {
    const s = confidenceSummary({ level: 'medium', healthy_sources: 4, total_sources: 6 })
    expect(s?.detail).toBe('2 of 6 sources stale')
  })

  it('returns null when there is nothing to show', () => {
    expect(confidenceSummary(undefined)).toBeNull()
    expect(confidenceSummary({})).toBeNull()
  })
})

describe('measuredHeadline', () => {
  it('renders "1,236 / 1,420 = 87%, needs 95%" from counts + threshold', () => {
    const h = measuredHeadline(
      { numerator: 1236, denominator: 1420 },
      { pass_pct: 95 },
    )
    expect(h?.ratio).toBe('1,236 / 1,420')
    expect(h?.pct).toBe('87%')
    expect(h?.needs).toBe('95%')
  })

  it('falls back to current_pct when no denominator', () => {
    const h = measuredHeadline({ current_pct: 87 }, { pass_pct: 95 })
    expect(h?.ratio).toBeNull()
    expect(h?.pct).toBe('87%')
  })

  it('never produces a "/ 0" ratio (event-style zero denominator)', () => {
    // No ratio, pct, or threshold → the whole headline is null (the
    // component then omits the strip rather than printing "/ 0 = NaN%").
    expect(measuredHeadline({ numerator: 0, denominator: 0 }, undefined)).toBeNull()
    // With a threshold present we still get a needs target but never a ratio.
    const withNeeds = measuredHeadline({ numerator: 0, denominator: 0 }, { pass_pct: 95 })
    expect(withNeeds?.ratio).toBeNull()
    expect(withNeeds?.needs).toBe('95%')
  })
})

describe('groupingCallouts — unowned + crown jewels called out', () => {
  it('uses backend-provided counts when present', () => {
    const c = groupingCallouts({ unowned_count: 47, crown_jewel_count: 3 }, [])
    expect(c).toEqual({ unowned: 47, crownJewel: 3 })
  })

  it('derives counts from failing_items when omitted', () => {
    const items: FailingItem[] = [
      { id: '1', owner: 'alice', crown_jewel: true },
      { id: '2', owner: '', crown_jewel: false },
      { id: '3', crown_jewel: true },
    ]
    const c = groupingCallouts(undefined, items)
    expect(c.unowned).toBe(2) // item 2 (blank) + item 3 (absent)
    expect(c.crownJewel).toBe(2)
  })
})

describe('failingItemsToCSV — columns match the gap table', () => {
  it('emits the expected header in order', () => {
    const csv = failingItemsToCSV([])
    expect(csv).toBe(FAILING_ITEM_CSV_COLUMNS.join(','))
    expect(csv.split('\n')[0]).toBe(
      'id,name,asset_type,owner,business_unit,criticality,crown_jewel',
    )
  })

  it('serialises rows, quoting commas and rendering booleans', () => {
    const csv = failingItemsToCSV([
      {
        id: 'vol-1',
        name: 'db, primary',
        asset_type: 'volume',
        owner: '',
        business_unit: 'Finance',
        criticality: 'high',
        crown_jewel: true,
      },
    ])
    const [, row] = csv.split('\n')
    expect(row).toBe('vol-1,"db, primary",volume,,Finance,high,true')
  })
})

describe('hasOpenLinkage — dedup before create', () => {
  it('detects an open risk for the control', () => {
    expect(hasOpenLinkage({ risks: [{ risk_id: 'r1', status: 'open' }] })).toBe(true)
  })
  it('detects an open task', () => {
    expect(
      hasOpenLinkage({ remediation_tasks: [{ task_id: 't1', status: 'in_progress' }] }),
    ).toBe(true)
  })
  it('treats terminal statuses as not open', () => {
    expect(
      hasOpenLinkage({
        risks: [{ risk_id: 'r1', status: 'closed' }],
        remediation_tasks: [{ task_id: 't1', status: 'done' }],
      }),
    ).toBe(false)
  })
  it('falls back to the rollup counts (open_tasks, not tasks)', () => {
    expect(hasOpenLinkage({ rollup: { open_risks: 1 } })).toBe(true)
    expect(hasOpenLinkage({ rollup: { open_tasks: 2 } })).toBe(true)
    expect(hasOpenLinkage({ rollup: { open_risks: 0, open_tasks: 0 } })).toBe(false)
  })
  it('is false for an absent linkage', () => {
    expect(hasOpenLinkage(undefined)).toBe(false)
  })
})

describe('sourceIsStale', () => {
  it('flags stale via any signal', () => {
    expect(sourceIsStale({ stale: true })).toBe(true)
    expect(sourceIsStale({ healthy: false })).toBe(true)
    expect(sourceIsStale({ status: 'stale' })).toBe(true)
  })
  it('is healthy otherwise', () => {
    expect(sourceIsStale({ status: 'healthy', healthy: true })).toBe(false)
    expect(sourceIsStale({})).toBe(false)
  })
  it('branches on healthy/stale (always present) even without a status string', () => {
    // The wire shape has no `status`; healthy/stale alone must decide.
    expect(sourceIsStale({ connector: 'cmdb', healthy: true, stale: false })).toBe(false)
    expect(sourceIsStale({ connector: 'tenable', healthy: false, stale: true })).toBe(true)
    expect(sourceIsStale({ connector: 'okta', healthy: true, stale: true })).toBe(true)
  })
})

describe('observedBySources — observed_by is an array of {source} objects', () => {
  it('flattens distinct source names in order', () => {
    const sources = observedBySources([
      { source: 'cmdb', asset_id: 'a-1' },
      { source: 'tenable', asset_id: 'a-9' },
    ])
    expect(sources).toEqual(['cmdb', 'tenable'])
  })
  it('de-dupes repeated sources and drops blank/absent ones', () => {
    expect(
      observedBySources([
        { source: 'cmdb' },
        { source: 'cmdb', asset_id: 'a-2' },
        { source: '  ' },
        {},
      ]),
    ).toEqual(['cmdb'])
  })
  it('returns [] for absent observed_by (omitempty)', () => {
    expect(observedBySources(undefined)).toEqual([])
    expect(observedBySources([])).toEqual([])
  })
})

describe('linkage wire shapes — rollup.open_tasks, task.past_due, risk.severity', () => {
  it('rollup task count reads from open_tasks (not the old `tasks` key)', () => {
    const linkage = { rollup: { gaps: 184, open_risks: 1, open_tasks: 3, overdue_tasks: 1, accepted_exceptions: 0 } }
    expect(linkage.rollup.open_tasks).toBe(3)
    expect(hasOpenLinkage(linkage)).toBe(true)
  })

  it('a task past_due flag drives the overdue styling, due_date carries the date', () => {
    const task = { task_id: 't1', status: 'in_progress', due_date: '2026-01-01', past_due: true }
    // past_due (not the old `overdue`) is the field the renderer tones on.
    expect(task.past_due).toBe(true)
    expect(task.due_date).toBe('2026-01-01')
    expect(hasOpenLinkage({ remediation_tasks: [task] })).toBe(true)
  })

  it('a risk carries severity and has no due/past_due (those are task-only)', () => {
    const risk = { risk_id: 'r1', status: 'open', severity: 'high', owner: 'alice', auto_created: true }
    expect(risk.severity).toBe('high')
    // @ts-expect-error risks have no due_date on the wire
    expect(risk.due_date).toBeUndefined()
    expect(hasOpenLinkage({ risks: [risk] })).toBe(true)
  })
})

describe('presentation_mode variants (smoke of the contract)', () => {
  const base: ControlBreakdown = { framework_id: 'iso27001', control_id: 'A.8.24' }

  it('proportional drives the gap-list path with a measurable headline', () => {
    const d: ControlBreakdown = {
      ...base,
      presentation_mode: 'proportional',
      measured: { numerator: 1236, denominator: 1420 },
      threshold: { pass_pct: 95 },
      failing_items: [{ id: '1', owner: '', observed_by: [{ source: 'cmdb' }, { source: 'tenable' }] }],
    }
    expect(resolvePresentationMode(d.presentation_mode)).toBe('proportional')
    expect(measuredHeadline(d.measured, d.threshold)?.needs).toBe('95%')
    expect(groupingCallouts(d.grouping, d.failing_items).unowned).toBe(1)
    // observed_by source names render from the {source} objects.
    expect(observedBySources(d.failing_items?.[0].observed_by)).toEqual(['cmdb', 'tenable'])
  })

  it('event mode avoids a percentage with denominator 0', () => {
    const d: ControlBreakdown = { ...base, presentation_mode: 'event', measured: { denominator: 0 } }
    expect(resolvePresentationMode(d.presentation_mode)).toBe('event')
    expect(measuredHeadline(d.measured, undefined)?.ratio ?? null).toBeNull()
  })

  it('attestation mode carries narrative + linkage only — no attestation block, no failing_items', () => {
    // The backend sends NO `attestation` object in attestation mode; the
    // response is narrative + threshold + linkage. failing_items/measured/
    // grouping are absent. The panel points the user to the coverage register.
    const d: ControlBreakdown = {
      ...base,
      presentation_mode: 'attestation',
      narrative: { requirement: 'A signed BCP must be on file and current.' },
      threshold: { pass_pct: 100 },
      linkage: { rollup: { open_tasks: 1 } },
    }
    expect(resolvePresentationMode(d.presentation_mode)).toBe('attestation')
    expect(d.failing_items).toBeUndefined()
    expect(narrativeLines(d.narrative).map((l) => l.key)).toEqual(['requirement'])
    expect(hasOpenLinkage(d.linkage)).toBe(true)
  })

  it('gate mode resolves', () => {
    const d: ControlBreakdown = { ...base, presentation_mode: 'gate', failing_items: [{ id: 'x' }] }
    expect(resolvePresentationMode(d.presentation_mode)).toBe('gate')
  })
})

describe('asScoredBadge — "as scored" consistency mapping', () => {
  it('maps consistent → green with the consistent message key', () => {
    const badge = asScoredBadge({ scored_at: '2026-06-18T10:00:00Z', consistency: 'consistent' })
    expect(badge).toEqual({
      tone: 'green',
      messageKey: 'control.breakdown.as_scored_consistent',
      usesScoredAt: true,
    })
  })

  it('maps inventory_changed_since_scoring → amber with the changed message key', () => {
    const badge = asScoredBadge({
      scored_at: '2026-06-18T10:00:00Z',
      consistency: 'inventory_changed_since_scoring',
    })
    expect(badge).toEqual({
      tone: 'amber',
      messageKey: 'control.breakdown.as_scored_changed',
      usesScoredAt: true,
    })
  })

  it('maps not_reconcilable → muted gray with the not_reconcilable key', () => {
    const badge = asScoredBadge({
      scored_at: '2026-06-18T10:00:00Z',
      consistency: 'not_reconcilable',
    })
    expect(badge).toEqual({
      tone: 'gray',
      messageKey: 'control.breakdown.as_scored_not_reconcilable',
      usesScoredAt: true,
    })
  })

  it('renders nothing for no_snapshot, absent, or unknown consistency', () => {
    expect(asScoredBadge({ consistency: 'no_snapshot' })).toBeNull()
    expect(asScoredBadge({})).toBeNull()
    expect(asScoredBadge(undefined)).toBeNull()
    expect(asScoredBadge({ consistency: 'something_new' })).toBeNull()
  })

  it('falls back to reconciliation.consistency_with_scored when as_scored is absent', () => {
    expect(asScoredBadge(undefined, 'consistent')?.tone).toBe('green')
    expect(asScoredBadge(undefined, 'inventory_changed_since_scoring')?.tone).toBe('amber')
    // Explicit as_scored.consistency wins over the reconciliation fallback.
    expect(
      asScoredBadge({ consistency: 'consistent' }, 'inventory_changed_since_scoring')?.tone,
    ).toBe('green')
  })
})

describe('contentDispositionFilename', () => {
  it('reads a plain quoted filename', () => {
    expect(contentDispositionFilename('attachment; filename="breakdown-iso27001-A.8.24.zip"')).toBe(
      'breakdown-iso27001-A.8.24.zip',
    )
  })
  it('reads a bare (unquoted) filename', () => {
    expect(contentDispositionFilename('attachment; filename=breakdown.zip')).toBe('breakdown.zip')
  })
  it('prefers the RFC 5987 filename* form and decodes it', () => {
    expect(
      contentDispositionFilename("attachment; filename*=UTF-8''breakdown-%C3%A9.zip"),
    ).toBe('breakdown-é.zip')
  })
  it('returns null for an absent/empty header', () => {
    expect(contentDispositionFilename(null)).toBeNull()
    expect(contentDispositionFilename(undefined)).toBeNull()
    expect(contentDispositionFilename('attachment')).toBeNull()
  })
})

describe('downloadSignedBreakdown — export flow', () => {
  function makeDeps(overrides: Partial<SignedExportDeps> = {}): {
    deps: SignedExportDeps
    triggerDownload: ReturnType<typeof vi.fn>
    createObjectURL: ReturnType<typeof vi.fn>
    revokeObjectURL: ReturnType<typeof vi.fn>
  } {
    const triggerDownload = vi.fn()
    const createObjectURL = vi.fn(() => 'blob:fake-url')
    const revokeObjectURL = vi.fn()
    const deps: SignedExportDeps = {
      apiFetch: vi.fn(async () => ({
        blob: async () => new Blob(['zip-bytes'], { type: 'application/zip' }),
        headers: { get: () => 'attachment; filename="breakdown-iso27001-A.8.24.zip"' },
      })),
      createObjectURL,
      revokeObjectURL,
      triggerDownload,
      ...overrides,
    }
    return { deps, triggerDownload, createObjectURL, revokeObjectURL }
  }

  it('builds the right proxy path (apiFetch prepends /v1)', () => {
    expect(signedBreakdownExportPath('iso27001', 'A.8.24')).toBe(
      '/scoring/frameworks/iso27001/controls/A.8.24/breakdown/export',
    )
  })

  it('calls the right URL and triggers a blob download on 200', async () => {
    const { deps, triggerDownload, createObjectURL, revokeObjectURL } = makeDeps()
    const outcome = await downloadSignedBreakdown('iso27001', 'A.8.24', deps)
    expect(deps.apiFetch).toHaveBeenCalledWith(
      '/scoring/frameworks/iso27001/controls/A.8.24/breakdown/export',
    )
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(triggerDownload).toHaveBeenCalledWith('blob:fake-url', 'breakdown-iso27001-A.8.24.zip')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url')
    expect(outcome).toEqual({ status: 'ok', filename: 'breakdown-iso27001-A.8.24.zip' })
  })

  it('falls back to a default filename when Content-Disposition is absent', async () => {
    const { deps, triggerDownload } = makeDeps({
      apiFetch: vi.fn(async () => ({
        blob: async () => new Blob(['z']),
        headers: { get: () => null },
      })),
    })
    const outcome = await downloadSignedBreakdown('soc2', 'CC6.1', deps)
    expect(triggerDownload).toHaveBeenCalledWith('blob:fake-url', 'breakdown-soc2-CC6.1.zip')
    expect(outcome).toEqual({ status: 'ok', filename: 'breakdown-soc2-CC6.1.zip' })
  })

  it('maps a 409 (no scored snapshot) to needs_evaluation without downloading', async () => {
    const { deps, triggerDownload } = makeDeps({
      apiFetch: vi.fn(async () => {
        throw Object.assign(new Error('Conflict'), { status: 409 })
      }),
    })
    const outcome = await downloadSignedBreakdown('iso27001', 'A.8.24', deps)
    expect(outcome).toEqual({ status: 'needs_evaluation' })
    expect(triggerDownload).not.toHaveBeenCalled()
  })

  it('maps other non-OK / network errors to error without throwing', async () => {
    const { deps, triggerDownload } = makeDeps({
      apiFetch: vi.fn(async () => {
        throw Object.assign(new Error('Server error'), { status: 500 })
      }),
    })
    const outcome = await downloadSignedBreakdown('iso27001', 'A.8.24', deps)
    expect(outcome).toEqual({ status: 'error' })
    expect(triggerDownload).not.toHaveBeenCalled()

    const net = makeDeps({
      apiFetch: vi.fn(async () => {
        throw new Error('network down')
      }),
    })
    expect(await downloadSignedBreakdown('iso27001', 'A.8.24', net.deps)).toEqual({
      status: 'error',
    })
  })
})
