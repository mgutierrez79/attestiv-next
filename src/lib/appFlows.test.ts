import { describe, it, expect } from 'vitest'
import {
  buildFlowsCsv,
  buildUserAccessCsv,
  buildFlowValidationLookup,
  cleanFlows,
  countFlows,
  csvCell,
  emptyFlow,
  flowValidationKey,
  suggestionToFlow,
  userAccessFlowSource,
  userAccessToFlows,
  USER_ACCESS_DEP_PREFIX,
  validationTone,
  type DependencyFlow,
  type FlowExportDependency,
} from './appFlows'
import type { UserAccessNetwork } from './appUserAccess'

// These helpers back the per-dependency network flow matrix: the edit-form
// normalization (cleanFlows), the detail-page CSV export (buildFlowsCsv),
// and the validation-badge tone mapping. The contract that matters is that
// the persisted/export shapes line up with the locked backend contract.

describe('emptyFlow', () => {
  it('defaults protocol to tcp and leaves the rest blank', () => {
    expect(emptyFlow()).toEqual({
      source: '',
      destination: '',
      protocol: 'tcp',
      ports: '',
      direction: undefined,
      description: '',
    })
  })
})

describe('cleanFlows', () => {
  it('trims strings and drops empty optional fields', () => {
    const rows: DependencyFlow[] = [
      { source: '  10.0.0.1 ', destination: 'db.internal ', protocol: 'tcp', ports: ' 443 ', description: ' web ' },
    ]
    expect(cleanFlows(rows)).toEqual([
      { source: '10.0.0.1', destination: 'db.internal', protocol: 'tcp', ports: '443', description: 'web' },
    ])
  })

  it('drops rows with no source, destination, ports or description', () => {
    const rows: DependencyFlow[] = [
      { source: '', destination: '', protocol: 'tcp', ports: '', description: '' },
      { source: 'a', destination: 'b', protocol: 'udp', ports: '53' },
    ]
    expect(cleanFlows(rows)).toHaveLength(1)
    expect(cleanFlows(rows)[0].source).toBe('a')
  })

  it('only includes direction when set', () => {
    expect(cleanFlows([{ source: 'a', destination: 'b' }])[0]).not.toHaveProperty('direction')
    expect(cleanFlows([{ source: 'a', destination: 'b', direction: 'egress' }])[0].direction).toBe('egress')
  })

  it('defaults a missing protocol to tcp', () => {
    expect(cleanFlows([{ source: 'a' }])[0].protocol).toBe('tcp')
  })

  it('returns [] for undefined / non-array input', () => {
    expect(cleanFlows(undefined)).toEqual([])
  })

  it('never persists client-side validation', () => {
    const rows: DependencyFlow[] = [
      { source: 'a', destination: 'b', validation: { status: 'permitted' } },
    ]
    expect(cleanFlows(rows)[0]).not.toHaveProperty('validation')
  })
})

describe('validationTone', () => {
  it('maps statuses to badge tones', () => {
    expect(validationTone('permitted')).toBe('green')
    expect(validationTone('not_permitted')).toBe('red')
    expect(validationTone('unknown')).toBe('gray')
  })
})

describe('csvCell', () => {
  it('quotes values containing commas, quotes or newlines', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })
  it('renders null / undefined as empty', () => {
    expect(csvCell(undefined)).toBe('')
    expect(csvCell(null)).toBe('')
  })
})

describe('buildFlowsCsv', () => {
  it('flattens every flow across dependencies with the fixed header', () => {
    const deps: FlowExportDependency[] = [
      {
        application_id: 'ad-core',
        flows: [
          { source: '10.0.0.1', destination: 'dc1', protocol: 'tcp', ports: '389,636', direction: 'egress', description: 'ldap' },
        ],
      },
      {
        application_id: 'sql-fin',
        flows: [
          { source: 'app01', destination: 'sql01', protocol: 'tcp', ports: '1433', description: 'db, primary' },
        ],
      },
      { application_id: 'no-flows' },
    ]
    const csv = buildFlowsCsv(deps)
    const lines = csv.split('\n')
    expect(lines[0]).toBe('dependency_application_id,source,destination,protocol,ports,direction,description')
    expect(lines[1]).toBe('ad-core,10.0.0.1,dc1,tcp,"389,636",egress,ldap')
    // commas inside a free-text field are quoted; missing direction is blank
    expect(lines[2]).toBe('sql-fin,app01,sql01,tcp,1433,,"db, primary"')
    expect(lines).toHaveLength(3)
  })

  it('returns just the header when there are no flows', () => {
    expect(buildFlowsCsv([])).toBe('dependency_application_id,source,destination,protocol,ports,direction,description')
    expect(buildFlowsCsv(undefined)).toBe('dependency_application_id,source,destination,protocol,ports,direction,description')
  })
})

describe('countFlows', () => {
  it('totals flows across dependencies', () => {
    expect(
      countFlows([
        { application_id: 'a', flows: [emptyFlow(), emptyFlow()] },
        { application_id: 'b' },
        { application_id: 'c', flows: [emptyFlow()] },
      ]),
    ).toBe(3)
    expect(countFlows([])).toBe(0)
    expect(countFlows(undefined)).toBe(0)
  })
})

describe('flowValidationKey', () => {
  it('joins the identifying tuple with pipes in a fixed order', () => {
    expect(
      flowValidationKey({
        dependency_application_id: 'ad-core',
        source: '10.0.0.1',
        destination: 'dc1',
        protocol: 'tcp',
        ports: '389,636',
      }),
    ).toBe('ad-core|10.0.0.1|dc1|tcp|389,636')
  })

  it('treats missing parts as empty so both sides of a match align', () => {
    expect(flowValidationKey({})).toBe('||||')
    // A displayed flow with no ports and a backend entry with no ports
    // produce the same key.
    expect(flowValidationKey({ dependency_application_id: 'a', source: 's', destination: 'd', protocol: 'udp' })).toBe(
      flowValidationKey({ dependency_application_id: 'a', source: 's', destination: 'd', protocol: 'udp', ports: '' }),
    )
  })
})

describe('buildFlowValidationLookup', () => {
  it('keys entries by flowValidationKey and carries status/rule/reason', () => {
    const lookup = buildFlowValidationLookup({
      application_id: 'app1',
      flows: [
        {
          dependency_application_id: 'ad-core',
          source: '10.0.0.1',
          destination: 'dc1',
          protocol: 'tcp',
          ports: '389',
          status: 'permitted',
          matched_rule: 'allow-ldap',
          reason: 'explicit allow',
        },
      ],
    })
    const key = flowValidationKey({
      dependency_application_id: 'ad-core',
      source: '10.0.0.1',
      destination: 'dc1',
      protocol: 'tcp',
      ports: '389',
    })
    expect(lookup.get(key)).toEqual({ status: 'permitted', matched_rule: 'allow-ldap', reason: 'explicit allow' })
  })

  it('returns an empty map for null / missing input', () => {
    expect(buildFlowValidationLookup(null).size).toBe(0)
    expect(buildFlowValidationLookup(undefined).size).toBe(0)
    expect(buildFlowValidationLookup({}).size).toBe(0)
  })
})

describe('suggestionToFlow', () => {
  it('maps source/destination/protocol/ports onto an emptyFlow base', () => {
    expect(
      suggestionToFlow({
        dependency_application_id: 'sql-fin',
        source: 'app01',
        destination: 'sql01',
        protocol: 'tcp',
        ports: '1433',
        source_addresses: ['10.1.1.5'],
        destination_addresses: ['10.2.2.9'],
      }),
    ).toEqual({
      source: 'app01',
      destination: 'sql01',
      protocol: 'tcp',
      ports: '1433',
      direction: undefined,
      description: '',
    })
  })

  it('defaults protocol to tcp and blanks missing fields', () => {
    expect(suggestionToFlow({ dependency_application_id: 'x' })).toEqual({
      source: '',
      destination: '',
      protocol: 'tcp',
      ports: '',
      direction: undefined,
      description: '',
    })
  })
})

describe('userAccessFlowSource', () => {
  it('labels the network type, appending the source range when present', () => {
    expect(userAccessFlowSource({ network_type: 'vpn', source: '10.8.0.0/24' })).toBe('VPN (10.8.0.0/24)')
    expect(userAccessFlowSource({ network_type: 'internet' })).toBe('Internet')
  })
})

describe('userAccessToFlows', () => {
  it('renders each entry as an ingress flow into the app', () => {
    const entries: UserAccessNetwork[] = [
      { network_type: 'vpn', source: '10.8.0.0/24', protocol: 'tcp', ports: '443', description: 'remote staff' },
    ]
    expect(userAccessToFlows(entries, 'Billing')).toEqual([
      {
        source: 'VPN (10.8.0.0/24)',
        destination: 'Billing',
        protocol: 'tcp',
        ports: '443',
        description: 'remote staff',
        direction: 'ingress',
      },
    ])
  })

  it('drops an unrecognised protocol and blanks missing optional fields', () => {
    const [flow] = userAccessToFlows([{ network_type: 'internet', protocol: 'quic' }], 'app-x')
    expect(flow.protocol).toBeUndefined()
    expect(flow.ports).toBeUndefined()
    expect(flow.description).toBeUndefined()
    expect(flow.direction).toBe('ingress')
    expect(flow.destination).toBe('app-x')
  })

  it('returns [] for undefined input', () => {
    expect(userAccessToFlows(undefined, 'app')).toEqual([])
  })
})

describe('buildUserAccessCsv', () => {
  it('flattens entries with the user-access marker in the dependency column', () => {
    const entries: UserAccessNetwork[] = [
      { network_type: 'external', source: '203.0.113.0/24', protocol: 'tcp', ports: '443', description: 'partner, edge' },
    ]
    const csv = buildUserAccessCsv(entries, 'Billing')
    expect(csv).toBe(`${USER_ACCESS_DEP_PREFIX},External Network (203.0.113.0/24),Billing,tcp,443,ingress,"partner, edge"`)
  })

  it('returns an empty string when there are no entries', () => {
    expect(buildUserAccessCsv([], 'Billing')).toBe('')
    expect(buildUserAccessCsv(undefined, 'Billing')).toBe('')
  })
})
