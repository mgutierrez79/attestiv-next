import { describe, it, expect } from 'vitest'
import { displayableMetaString } from './displayMeta'

describe('displayableMetaString', () => {
  it('passes through a normal word value, trimmed', () => {
    expect(displayableMetaString('on')).toBe('on')
    expect(displayableMetaString('normal')).toBe('normal')
    expect(displayableMetaString('  Powered On  ')).toBe('Powered On')
  })

  it('returns "" for null / undefined / empty', () => {
    expect(displayableMetaString(null)).toBe('')
    expect(displayableMetaString(undefined)).toBe('')
    expect(displayableMetaString('')).toBe('')
    expect(displayableMetaString('   ')).toBe('')
  })

  it('returns "" for an array value (e.g. health came back as an array)', () => {
    expect(displayableMetaString([1, 2, 3, 4, 5])).toBe('')
    expect(displayableMetaString([])).toBe('')
  })

  it('returns "" for a plain object value', () => {
    expect(displayableMetaString({ a: 1 })).toBe('')
  })

  it('returns "" for a stringified array / object', () => {
    expect(displayableMetaString('[1 2 3 4 5 ... 1020]')).toBe('')
    expect(displayableMetaString('{"x":1}')).toBe('')
    expect(displayableMetaString('  [a, b]  ')).toBe('')
  })

  it('keeps an all-digits string by default (numeric stats elsewhere)', () => {
    expect(displayableMetaString('17')).toBe('17')
  })

  it('drops an all-digits string when digitsAreJunk is set (power_state / health)', () => {
    expect(displayableMetaString('17', { digitsAreJunk: true })).toBe('')
    expect(displayableMetaString('0', { digitsAreJunk: true })).toBe('')
  })

  it('keeps a word value even when digitsAreJunk is set', () => {
    expect(displayableMetaString('on', { digitsAreJunk: true })).toBe('on')
    expect(displayableMetaString('normal', { digitsAreJunk: true })).toBe('normal')
  })

  it('does not treat alphanumeric values as bare digit codes', () => {
    expect(displayableMetaString('17C', { digitsAreJunk: true })).toBe('17C')
    expect(displayableMetaString('rev2', { digitsAreJunk: true })).toBe('rev2')
  })
})
