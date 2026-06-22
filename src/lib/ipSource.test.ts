import { describe, it, expect } from 'vitest'
import { ipSourceTag } from './ipSource'

describe('ipSourceTag', () => {
  it('badges ad_dns with the Active Directory record tooltip', () => {
    const tag = ipSourceTag('ad_dns')
    expect(tag).not.toBeNull()
    expect(tag!.label).toBe('DNS')
    expect(tag!.tooltip).toBe(
      'Resolved from an Active Directory DNS record — not directly reported by a connector.',
    )
  })

  it('badges dns_lookup with the live-lookup tooltip', () => {
    const tag = ipSourceTag('dns_lookup')
    expect(tag).not.toBeNull()
    expect(tag!.label).toBe('DNS')
    expect(tag!.tooltip).toBe(
      'Resolved from a live DNS lookup — not directly reported by a connector.',
    )
  })

  it('badges a bare "dns" value with the generic tooltip', () => {
    const tag = ipSourceTag('dns')
    expect(tag).not.toBeNull()
    expect(tag!.tooltip).toBe('Resolved from DNS — not directly reported by a connector.')
  })

  it('does NOT badge connector-sourced IPs', () => {
    expect(ipSourceTag('connector')).toBeNull()
  })

  it('does NOT badge IPs with no recorded source (undefined / null / empty)', () => {
    // An IP absent from ip_sources resolves to undefined here — no badge,
    // because we have no signal that it is DNS-derived.
    expect(ipSourceTag(undefined)).toBeNull()
    expect(ipSourceTag(null)).toBeNull()
    expect(ipSourceTag('')).toBeNull()
  })

  it('ignores unrecognised source values rather than guessing', () => {
    expect(ipSourceTag('scim')).toBeNull()
    expect(ipSourceTag('manual')).toBeNull()
  })

  it('is case- and whitespace-insensitive', () => {
    expect(ipSourceTag('  AD_DNS ')).not.toBeNull()
    expect(ipSourceTag('Dns_Lookup')!.tooltip).toBe(
      'Resolved from a live DNS lookup — not directly reported by a connector.',
    )
  })
})
