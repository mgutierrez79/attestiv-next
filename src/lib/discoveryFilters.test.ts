import { describe, expect, it } from 'vitest'

import {
  blankRule,
  connectorScopeKnown,
  firstRuleProblem,
  ruleMatchesNothing,
  rulesEqual,
  rulesPayload,
  rulesToSave,
  toDrafts,
  type DiscoveryFilterRule,
  type DiscoveryPreviewResponse,
} from './discoveryFilters'

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

  it('ignores a new row left empty but keeps a saved rule whose text was cleared', () => {
    const drafts = [...toDrafts(stored), blankRule()]
    expect(rulesToSave(drafts)).toHaveLength(1)
    expect(rulesEqual(rulesToSave(drafts), stored)).toBe(true)
    drafts[1].pattern = '  '
    expect(rulesToSave(drafts)).toHaveLength(1)
    drafts[1].pattern = 'picking'
    expect(rulesToSave(drafts)).toHaveLength(2)
    drafts[0].pattern = ''
    // Still sent, so the save reports the empty text instead of deleting.
    expect(rulesToSave(drafts).map((r) => r.id)).toEqual(['df_1', undefined])
  })
})

// The pilot's first rules (2026-09-19) typed a sentence as the pattern and
// the keyword as the connector; both matched nothing, silently.
describe('rules that cannot match', () => {
  const known = ['dynatrace', 'vcenter', 'vcenter:vmware-vcenter-dcb']

  it('flags a connector scope that names no connector', () => {
    expect(connectorScopeKnown('', known)).toBe(true)
    expect(connectorScopeKnown('vcenter', known)).toBe(true)
    expect(connectorScopeKnown('VCenter:VMware-vCenter-DCB', known)).toBe(true)
    expect(connectorScopeKnown('picking', known)).toBe(false)
    expect(connectorScopeKnown('vmware', known)).toBe(false)
  })

  it('flags an enabled rule that matches nothing in the inventory nor at the connectors', () => {
    const rules: DiscoveryFilterRule[] = [
      { pattern: 'suprimer les nomes de machines picking', match: 'contains', field: 'any', enabled: true },
      { pattern: 'picking', match: 'contains', field: 'name', enabled: true },
      { pattern: 'snapshot', match: 'contains', field: 'name', enabled: false },
    ]
    const preview: DiscoveryPreviewResponse = {
      evaluated: 2111,
      matched: 0,
      // PICKING VMs already removed from the inventory…
      rule_hits: [0, 0, 0],
      // …but vCenter still reports them.
      connector_rule_hits: [0, 22, 0],
      items: [],
      truncated: false,
    }
    expect(ruleMatchesNothing(rules[0], 0, preview)).toBe(true)
    expect(ruleMatchesNothing(rules[1], 1, preview)).toBe(false)
    expect(ruleMatchesNothing(rules[2], 2, preview)).toBe(false) // disabled
    expect(ruleMatchesNothing(rules[0], 0, null)).toBe(false) // nothing known yet
  })
})
