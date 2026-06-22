import { describe, it, expect } from 'vitest'
import {
  addComponent,
  dedupeComponents,
  formatComponentList,
  parseComponentList,
  removeComponent,
} from './appComponents'

// These helpers back the Components multi-select picker on the create +
// edit application forms. The critical invariant is that the round-trip
// (legacy comma string → array → submit string) is byte-for-byte
// identical to the old free-text field's `split(',').map(trim).filter`
// behaviour, so the backend contract is unchanged.

describe('parseComponentList', () => {
  it('splits, trims, and drops empties', () => {
    expect(parseComponentList('VRWMSQLA01, VRWMSQLA02')).toEqual(['VRWMSQLA01', 'VRWMSQLA02'])
  })
  it('drops empty segments from stray commas and whitespace', () => {
    expect(parseComponentList(' a ,, b , ')).toEqual(['a', 'b'])
  })
  it('de-duplicates while keeping first-seen order', () => {
    expect(parseComponentList('a, b, a, c, b')).toEqual(['a', 'b', 'c'])
  })
  it('returns [] for empty / whitespace input', () => {
    expect(parseComponentList('')).toEqual([])
    expect(parseComponentList('   ')).toEqual([])
  })
})

describe('formatComponentList', () => {
  it('joins back with ", " — the exact legacy separator', () => {
    expect(formatComponentList(['VRWMSQLA01', 'VRWMSQLA02'])).toBe('VRWMSQLA01, VRWMSQLA02')
  })
  it('trims, drops empties, and dedupes before joining', () => {
    expect(formatComponentList([' a ', '', 'b', 'a'])).toBe('a, b')
  })
  it('produces an empty string for an empty array', () => {
    expect(formatComponentList([])).toBe('')
  })
})

describe('round-trip equivalence with the old free-text field', () => {
  // Replicate the old submit pipeline: raw string → components names.
  function legacyComponentNames(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  // New pipeline: parse to array (load), then formatComponentList →
  // split/trim/filter (submit). Result names must match the legacy ones
  // for any input WITHOUT duplicates (dedupe is an intended improvement).
  function newComponentNames(raw: string): string[] {
    return formatComponentList(parseComponentList(raw))
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }
  it('matches the legacy output for a typical list', () => {
    const raw = 'VRWMSQLA01, VRWMSQLA02, app-web-01'
    expect(newComponentNames(raw)).toEqual(legacyComponentNames(raw))
  })
  it('matches for messy whitespace / trailing commas', () => {
    const raw = '  VRWMSQLA01 ,VRWMSQLA02,  '
    expect(newComponentNames(raw)).toEqual(legacyComponentNames(raw))
  })
})

describe('dedupeComponents', () => {
  it('trims, drops empties, removes dups, preserves order', () => {
    expect(dedupeComponents([' a ', 'b', 'a', '', '  ', 'c'])).toEqual(['a', 'b', 'c'])
  })
})

describe('addComponent', () => {
  it('appends a trimmed name', () => {
    expect(addComponent(['a'], '  b ')).toEqual(['a', 'b'])
  })
  it('ignores empty / whitespace additions (same ref)', () => {
    const v = ['a']
    expect(addComponent(v, '   ')).toBe(v)
    expect(addComponent(v, '')).toBe(v)
  })
  it('rejects duplicates (same ref)', () => {
    const v = ['a', 'b']
    expect(addComponent(v, 'a')).toBe(v)
    expect(addComponent(v, ' a ')).toBe(v)
  })
})

describe('removeComponent', () => {
  it('drops the item at the given index', () => {
    expect(removeComponent(['a', 'b', 'c'], 1)).toEqual(['a', 'c'])
  })
  it('is a no-op for an out-of-range index', () => {
    expect(removeComponent(['a', 'b'], 5)).toEqual(['a', 'b'])
  })
})
