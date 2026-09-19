import { describe, expect, it } from 'vitest'

import { blankRule, firstRuleProblem, rulesEqual, rulesPayload, toDrafts, type DiscoveryFilterRule } from './discoveryFilters'

const stored: DiscoveryFilterRule[] = [
  {
    id: 'df_1',
    pattern: '*.lab.local',
    match: 'glob',
    field: 'name',
    enabled: true,
    note: 'lab estate',
    created_by: 'alice',
    created_at: '2026-09-01T10:00:00Z',
  },
]

describe('discovery filter drafts', () => {
  it('keys saved rules by id and unsaved rules uniquely', () => {
    const drafts = toDrafts(stored)
    expect(drafts[0].key).toBe('df_1')
    expect(drafts[0].source).toBe('')
    const a = blankRule()
    const b = blankRule()
    expect(a.key).not.toBe(b.key)
    expect(a).toMatchObject({ pattern: '', match: 'contains', field: 'any', enabled: true })
  })

  it('sends only what the operator controls, trimmed', () => {
    const drafts = toDrafts(stored)
    drafts[0].pattern = '  *.lab.local '
    drafts[0].source = ' VCenter '
    const body = rulesPayload(drafts)
    expect(body.rules[0]).toEqual({
      id: 'df_1',
      pattern: '*.lab.local',
      match: 'glob',
      field: 'name',
      source: 'vcenter',
      enabled: true,
      note: 'lab estate',
    })
    // Server-owned stamps and the client-only key never go back.
    expect(body.rules[0]).not.toHaveProperty('created_by')
    expect(body.rules[0]).not.toHaveProperty('key')
    // A rule not saved yet carries no id, so the server assigns one.
    expect(rulesPayload([blankRule()]).rules[0].id).toBeUndefined()
  })

  it('detects unsaved changes but ignores whitespace and stamps', () => {
    const drafts = toDrafts(stored)
    expect(rulesEqual(drafts, stored)).toBe(true)
    drafts[0].pattern = '*.lab.local  '
    expect(rulesEqual(drafts, stored)).toBe(true)
    drafts[0].enabled = false
    expect(rulesEqual(drafts, stored)).toBe(false)
    expect(rulesEqual([...toDrafts(stored), blankRule()], stored)).toBe(false)
  })

  it('flags empty and over-long patterns before a round trip', () => {
    expect(firstRuleProblem(stored, 256)).toBeNull()
    expect(firstRuleProblem([...stored, blankRule()], 256)).toEqual({ index: 1, problem: 'empty' })
    expect(firstRuleProblem([{ ...stored[0], pattern: 'x'.repeat(10) }], 5)).toEqual({ index: 0, problem: 'too_long' })
  })
})
