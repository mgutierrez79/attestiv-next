import { describe, it, expect } from 'vitest'
import {
  NETWORK_TYPES,
  cleanUserAccess,
  countUserAccess,
  emptyUserAccess,
  networkTypeLabel,
  networkTypeTone,
  type UserAccessNetwork,
} from './appUserAccess'

// These helpers back the user-access (ingress) editor + detail card: the
// edit-form normalization (cleanUserAccess), the network-type badge
// label/tone, and the empty-row shape. The contract that matters is that the
// persisted shape lines up with the locked backend contract (network_type +
// optional source / protocol / ports / description).

describe('NETWORK_TYPES', () => {
  it('lists the six backend network types in order', () => {
    expect(NETWORK_TYPES).toEqual(['external', 'private', 'vpn', 'partner', 'internet', 'other'])
  })
})

describe('emptyUserAccess', () => {
  it('defaults network_type to external and leaves the rest blank', () => {
    expect(emptyUserAccess()).toEqual({
      network_type: 'external',
      source: '',
      protocol: '',
      ports: '',
      description: '',
    })
  })
})

describe('cleanUserAccess', () => {
  it('trims strings and drops empty optional fields, keeping network_type', () => {
    const rows: UserAccessNetwork[] = [
      { network_type: 'vpn', source: ' 10.8.0.0/24 ', protocol: ' tcp ', ports: ' 443 ', description: ' remote staff ' },
    ]
    expect(cleanUserAccess(rows)).toEqual([
      { network_type: 'vpn', source: '10.8.0.0/24', protocol: 'tcp', ports: '443', description: 'remote staff' },
    ])
  })

  it('drops rows with no source, protocol, ports or description', () => {
    const rows: UserAccessNetwork[] = [
      { network_type: 'external', source: '', protocol: '', ports: '', description: '' },
      { network_type: 'internet', source: '0.0.0.0/0' },
    ]
    expect(cleanUserAccess(rows)).toHaveLength(1)
    expect(cleanUserAccess(rows)[0].network_type).toBe('internet')
    expect(cleanUserAccess(rows)[0].source).toBe('0.0.0.0/0')
  })

  it('omits optional fields entirely rather than persisting empty strings', () => {
    const cleaned = cleanUserAccess([{ network_type: 'private', source: 'lan' }])[0]
    expect(cleaned).toEqual({ network_type: 'private', source: 'lan' })
    expect(cleaned).not.toHaveProperty('protocol')
    expect(cleaned).not.toHaveProperty('ports')
    expect(cleaned).not.toHaveProperty('description')
  })

  it('returns [] for undefined / non-array input', () => {
    expect(cleanUserAccess(undefined)).toEqual([])
  })
})

describe('networkTypeLabel', () => {
  it('maps each type to its friendly label', () => {
    expect(networkTypeLabel('external')).toBe('External Network')
    expect(networkTypeLabel('private')).toBe('Private Network')
    expect(networkTypeLabel('vpn')).toBe('VPN')
    expect(networkTypeLabel('partner')).toBe('Partner Network')
    expect(networkTypeLabel('internet')).toBe('Internet')
    expect(networkTypeLabel('other')).toBe('Other')
  })

  it('falls back to the raw value for an unknown type', () => {
    expect(networkTypeLabel('satellite')).toBe('satellite')
  })
})

describe('networkTypeTone', () => {
  it('maps higher-exposure networks to hotter tones', () => {
    expect(networkTypeTone('internet')).toBe('red')
    expect(networkTypeTone('external')).toBe('amber')
    expect(networkTypeTone('private')).toBe('navy')
    expect(networkTypeTone('vpn')).toBe('blue')
    expect(networkTypeTone('partner')).toBe('gray')
    expect(networkTypeTone('other')).toBe('gray')
  })

  it('falls back to gray for an unknown type', () => {
    expect(networkTypeTone('satellite')).toBe('gray')
  })
})

describe('countUserAccess', () => {
  it('totals the user-access entries', () => {
    expect(countUserAccess([emptyUserAccess(), emptyUserAccess()])).toBe(2)
    expect(countUserAccess([])).toBe(0)
    expect(countUserAccess(undefined)).toBe(0)
  })
})
