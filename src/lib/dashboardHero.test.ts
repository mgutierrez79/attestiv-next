import { describe, it, expect } from 'vitest'
import {
  deriveControlsPassing,
  deriveOverallPosture,
  deriveTopFramework,
  scoreToPercent,
  type DashboardSummary,
} from './dashboardHero'

// W0-4 contract tests for the Dashboard hero. Three displayed metrics
// — Overall posture, Controls passing, Top framework — are now
// derivation-locked: same function the UI calls, same function the
// tests pin, no chance of "the dashboard says X but the data says Y".

describe('scoreToPercent — handles both 0-1 fraction and 0-100 percent shapes', () => {
  it('treats values <= 1 as a fraction', () => {
    expect(scoreToPercent({ score: 0.6448 })).toBe(64)
    expect(scoreToPercent({ score: 1 })).toBe(100)
    expect(scoreToPercent({ score: 0 })).toBe(0)
  })
  it('treats values > 1 as already-a-percent', () => {
    expect(scoreToPercent({ score: 64.48 })).toBe(64)
    expect(scoreToPercent({ score: 100 })).toBe(100)
  })
  it('falls back to controls_score when score is absent', () => {
    expect(scoreToPercent({ controls_score: 50 })).toBe(50)
  })
  it('clamps to 0..100', () => {
    expect(scoreToPercent({ score: 150 })).toBe(100) // already-percent shape, above 100 → clamped
    expect(scoreToPercent({ score: -0.1 })).toBe(0)  // negative fraction → clamped
  })
  it('returns 0 for missing/undefined input', () => {
    expect(scoreToPercent(undefined)).toBe(0)
    expect(scoreToPercent({})).toBe(0)
  })
})

describe('deriveOverallPosture — coverage-adjusted across evaluated frameworks', () => {
  it('returns "—" + zeros when no frameworks have scored', () => {
    expect(deriveOverallPosture(null)).toEqual({
      value: '—', percent: 0, count: 0, passing: 0, regulationTotal: 0, covered: 0, scoredAvg: 0,
    })
    expect(deriveOverallPosture({ framework_scores: {} })).toEqual({
      value: '—', percent: 0, count: 0, passing: 0, regulationTotal: 0, covered: 0, scoredAvg: 0,
    })
  })
  // The headline percent is now coverage-adjusted: passing /
  // regulation_total. Without this pin, the dashboard would silently
  // revert to the per-framework unweighted average — the misleading
  // headline the pilot operator caught: 55% headline on a posture an
  // auditor would honestly grade ~7%.
  it('headline = passing / sum(regulation_total) × 100 (auditor-honest)', () => {
    const summary: DashboardSummary = {
      framework_scores: {
        cis: { score: 53, controls_summary: { compliant: 4, total: 14, regulation_total: 153, covered: 24 } },
        dora: { score: 58, controls_summary: { compliant: 11, total: 25, regulation_total: 23, covered: 8 } },
      },
    }
    const hero = deriveOverallPosture(summary)
    // 15 passing of 176 auditable = 9%
    expect(hero.percent).toBe(9)
    expect(hero.value).toBe('9%')
    expect(hero.passing).toBe(15)
    expect(hero.regulationTotal).toBe(176)
    expect(hero.covered).toBe(32)
    // scoredAvg preserves the legacy unweighted average for the
    // demoted subtitle on the dashboard hero.
    expect(hero.scoredAvg).toBe(Math.round((53 + 58) / 2))
  })
  it('falls back to the unweighted scored average when regulation_total is missing', () => {
    const summary: DashboardSummary = {
      framework_scores: {
        dora: { score: 0.6 },
        nis2: { score: 80 },
        iso27001: { score: 0.4 },
      },
    }
    const hero = deriveOverallPosture(summary)
    // (60 + 80 + 40) / 3 = 60 — back-compat for older backend payloads.
    expect(hero.percent).toBe(60)
    expect(hero.value).toBe('60%')
    expect(hero.regulationTotal).toBe(0)
    expect(hero.scoredAvg).toBe(60)
  })
  it('mixed score shapes still aggregate correctly (no double-percent inflation in fallback)', () => {
    const summary: DashboardSummary = {
      framework_scores: {
        a: { score: 0.5 },
        b: { score: 50 },
      },
    }
    expect(deriveOverallPosture(summary).percent).toBe(50)
  })
})

describe('deriveControlsPassing — cross-framework controls rollup', () => {
  it('returns "—" when no controls have been totalled', () => {
    expect(deriveControlsPassing(null)).toEqual({ value: '—', sub: '', percent: 0, passing: 0, total: 0 })
    expect(deriveControlsPassing({ framework_scores: { a: { score: 0.5 } } })).toEqual({
      value: '—', sub: '', percent: 0, passing: 0, total: 0,
    })
  })
  it('sums compliant + total across frameworks and computes %', () => {
    const summary: DashboardSummary = {
      framework_scores: {
        dora: { controls_summary: { compliant: 80, total: 100 } },
        nis2: { controls_summary: { compliant: 60, total: 100 } },
      },
    }
    // 140 / 200 = 70%
    expect(deriveControlsPassing(summary)).toEqual({
      value: '70%', sub: '140 / 200', percent: 70, passing: 140, total: 200,
    })
  })
  it('zero-passing returns 0% (not "—" — the data exists)', () => {
    const summary: DashboardSummary = {
      framework_scores: { dora: { controls_summary: { compliant: 0, total: 50 } } },
    }
    expect(deriveControlsPassing(summary).value).toBe('0%')
    expect(deriveControlsPassing(summary).percent).toBe(0)
  })
})

describe('deriveTopFramework — highest-scoring framework callout', () => {
  it('returns "—" when no scores in', () => {
    expect(deriveTopFramework(null).value).toBe('—')
    expect(deriveTopFramework({ framework_scores: {} }).value).toBe('—')
  })
  it('picks the highest-scoring framework and humanises its label', () => {
    const summary: DashboardSummary = {
      framework_scores: {
        dora: { score: 0.6 },
        nis2: { score: 0.96 },
        iso27001: { score: 0.88 },
      },
    }
    const top = deriveTopFramework(summary)
    expect(top.id).toBe('nis2')
    expect(top.label).toBe('NIS2')
    expect(top.value).toBe('96%')
    expect(top.percent).toBe(96)
    expect(top.count).toBe(3)
  })
  it('uppercases the id when no humanised label exists', () => {
    const summary: DashboardSummary = {
      framework_scores: { custom_framework: { score: 0.5 } },
    }
    expect(deriveTopFramework(summary).label).toBe('CUSTOM_FRAMEWORK')
  })
})
