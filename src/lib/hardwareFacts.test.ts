import { describe, expect, it } from 'vitest'

import {
  FIRMWARE_PREVIEW_ROWS,
  deviceFieldsCovered,
  firmwareKindLabel,
  firmwarePreview,
  hardwareFacts,
  hardwareSummary,
  isHardwareAsset,
  type FirmwareComponent,
  type HardwareFacts,
} from './hardwareFacts'

// The Dell OpenManage server row the backend golden pins
// (attestiv-go internal/httpapi/testdata/inventory_hardware_golden.json).
const OPENMANAGE_SERVER = {
  bios_version: '1.14.1',
  bmc_address: '10.0.2.31',
  bmc_firmware_version: '7.00.00.181',
  bmc_product: 'iDRAC9',
  bmc_type: 'iDRAC',
  device_id: '10075',
  firmware: [
    { component_id: '159', kind: 'BIOS', name: 'BIOS', version: '1.14.1' },
    { component_id: '25227', kind: 'FRMW', name: 'Integrated Dell Remote Access Controller', version: '7.00.00.181' },
    { kind: 'FRMW', name: 'Lifecycle Controller', version: '7.00.00.181' },
    { component_id: '105137', kind: 'FRMW', name: 'Broadcom Gigabit Ethernet BCM5720 - 20:88:10:AA:BB:CC', version: '22.5.7' },
    { component_id: '104298', kind: 'FRMW', name: 'PERC H755 Front', version: '52.26.0-5179' },
    { kind: 'APAC', name: 'iDRAC Service Module', version: '5.3.0.0' },
  ],
  health: 'normal',
  management_address: '10.0.2.31',
  manufacturer: 'Dell',
  model: 'PowerEdge R650xs',
  os_hostname: 'srvsql01.example.lan',
  os_name: 'Microsoft Windows Server 2022 Standard',
  os_version: '10.0.20348',
  power_state: 'on',
  service_tag: 'ABC1234',
  source: 'dell_openmanage:dell-open-manage',
}

// The Redfish (iDRAC) row from connectors/testdata/hardware/redfish_assets.json.
const REDFISH_SERVER = {
  bios_version: '1.14.1',
  bmc_address: '127.0.0.1',
  bmc_firmware_version: '7.00.00.181',
  bmc_model: '15G Monolithic',
  bmc_product: 'iDRAC9',
  bmc_type: 'iDRAC',
  firmware: [
    { name: 'BIOS', version: '1.14.1' },
    { name: 'Integrated Dell Remote Access Controller', version: '7.00.00.181' },
    { name: 'PERC H755 Front', version: '52.26.0-5179' },
  ],
  health: 'ok',
  manufacturer: 'Dell Inc.',
  model: 'PowerEdge R650xs',
  serial_number: 'CNFCP0012345AB',
  service_tag: 'ABC1234',
}

// A vCenter ESXi host as vcenter_host_facts.go stamps it: a Dell host's
// serial number IS its service tag.
const VCENTER_ESXI_HOST = {
  vcenter_cluster: 'domain-c14059',
  connection_state: 'CONNECTED',
  esxi_version: '8.0.3',
  esxi_build: '24585383',
  esxi_full_name: 'VMware ESXi 8.0.3 build-24585383',
  os_name: 'VMware ESXi',
  os_version: '8.0.3',
  manufacturer: 'Dell Inc.',
  model: 'VxRail E660F',
  cpu_model: 'Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz',
  serial_number: 'HX7K9J3',
  service_tag: 'HX7K9J3',
  bios_version: '1.14.1',
  bios_release_date: '2025-03-14',
}

const POWERSTORE_ARRAY = {
  manufacturer: 'Dell',
  model: 'PowerStore 1200T',
  service_tag: '8XY1Z23',
  express_service_code: '19283746510',
  software_version: '4.3.1.1',
  software_build: '4.3.1.1.2345678',
  management_address: '10.0.5.10',
}

function row(facts: HardwareFacts, key: string) {
  return facts.rows.find((r) => r.key === key)
}

describe('isHardwareAsset', () => {
  it('accepts the hardware types regardless of metadata', () => {
    for (const type of ['server', 'host', 'hypervisor_host', 'storage_array', 'backup_appliance', 'SERVER']) {
      expect(isHardwareAsset(type, {})).toBe(true)
    }
  })

  it('never treats guests or network gear as hardware, even with hardware keys', () => {
    for (const type of ['vm', 'virtual_machine', 'firewall', 'switch', 'router', 'network_device', 'storage_volume', 'cluster']) {
      expect(isHardwareAsset(type, OPENMANAGE_SERVER)).toBe(false)
    }
  })

  it('accepts another type only when a hardware-only key is present', () => {
    expect(isHardwareAsset('endpoint', { bios_version: '2.19.1' })).toBe(true)
    expect(isHardwareAsset('endpoint', { firmware: [{ name: 'BIOS', version: '2.19.1' }] })).toBe(true)
    expect(isHardwareAsset('endpoint', { manufacturer: 'Dell', model: 'Latitude 7440' })).toBe(false)
    expect(isHardwareAsset(undefined, null)).toBe(false)
  })
})

describe('hardwareFacts', () => {
  it('renders an OpenManage server in display order with only known rows', () => {
    const facts = hardwareFacts(OPENMANAGE_SERVER, 'server')
    expect(facts.rows.map((r) => r.key)).toEqual([
      'manufacturer',
      'model',
      'service_tag',
      'bios',
      'management_controller',
      'operating_system',
    ])
    expect(row(facts, 'bios')?.value).toBe('1.14.1')
    expect(row(facts, 'management_controller')).toMatchObject({ value: 'iDRAC9 7.00.00.181', detail: '10.0.2.31' })
    expect(row(facts, 'operating_system')).toMatchObject({
      value: 'Microsoft Windows Server 2022 Standard 10.0.20348',
      detail: 'srvsql01.example.lan',
    })
    expect(row(facts, 'service_tag')).toMatchObject({ label: 'Service tag', value: 'ABC1234', mono: true })
  })

  it('keeps the installed firmware components in collector order', () => {
    const { firmware } = hardwareFacts(OPENMANAGE_SERVER, 'server')
    expect(firmware).toHaveLength(6)
    expect(firmware[0]).toEqual({ name: 'BIOS', version: '1.14.1', kind: 'BIOS', componentId: '159' })
    expect(firmware[2]).toEqual({ name: 'Lifecycle Controller', version: '7.00.00.181', kind: 'FRMW' })
    expect(firmware[5].kind).toBe('APAC')
  })

  it('shows a Redfish board serial that differs from the service tag, and the BMC model', () => {
    const facts = hardwareFacts(REDFISH_SERVER, 'server')
    expect(row(facts, 'serial_number')?.value).toBe('CNFCP0012345AB')
    expect(row(facts, 'service_tag')?.value).toBe('ABC1234')
    expect(row(facts, 'management_controller')).toMatchObject({
      value: 'iDRAC9 7.00.00.181',
      detail: '127.0.0.1 · 15G Monolithic',
    })
    expect(row(facts, 'operating_system')).toBeUndefined()
    expect(facts.firmware.every((c) => c.kind === undefined)).toBe(true)
  })

  it('renders a vCenter ESXi host: ESXi release, BIOS date, CPU, one serial', () => {
    const facts = hardwareFacts(VCENTER_ESXI_HOST, 'host')
    expect(row(facts, 'operating_system')?.value).toBe('VMware ESXi 8.0.3 build 24585383')
    expect(row(facts, 'bios')?.value).toBe('1.14.1 (2025-03-14)')
    expect(row(facts, 'cpu_model')?.value).toBe('Intel(R) Xeon(R) Gold 6338 CPU @ 2.00GHz')
    // serial_number equals the service tag on a Dell ESXi host — shown once.
    expect(row(facts, 'serial_number')).toBeUndefined()
    expect(row(facts, 'service_tag')?.value).toBe('HX7K9J3')
    expect(row(facts, 'management_controller')).toBeUndefined()
    expect(facts.firmware).toEqual([])
  })

  it('composes the ESXi name from version + build when the full name is missing', () => {
    const facts = hardwareFacts({ esxi_version: '7.0.3', esxi_build: '21930508' }, 'hypervisor_host')
    expect(row(facts, 'operating_system')?.value).toBe('VMware ESXi 7.0.3 build 21930508')
  })

  it('reads the ESXi release from the full name alone', () => {
    const facts = hardwareFacts({ esxi_full_name: 'VMware ESXi 8.0.2 build-22380479' }, 'host')
    expect(row(facts, 'operating_system')?.value).toBe('VMware ESXi 8.0.2 build 22380479')
    expect(hardwareSummary({ esxi_full_name: 'VMware ESXi 8.0.2 build-22380479' }, 'host')).toBe('ESXi 8.0.2 (22380479)')
  })

  it('handles an OpenManage + vCenter merge: OME hardware and the ESXi release together', () => {
    const merged = {
      ...VCENTER_ESXI_HOST,
      bmc_type: 'iDRAC',
      bmc_product: 'iDRAC9',
      bmc_firmware_version: '7.10.50.00',
      bmc_address: '10.0.2.40',
      // OME's own OS report for the same box.
      os_name: 'VMware ESXi 8.0.3',
      firmware: OPENMANAGE_SERVER.firmware,
    }
    const facts = hardwareFacts(merged, 'host')
    expect(facts.rows.map((r) => r.key)).toEqual([
      'manufacturer',
      'model',
      'service_tag',
      'bios',
      'management_controller',
      'operating_system',
      'cpu_model',
    ])
    expect(row(facts, 'operating_system')?.value).toBe('VMware ESXi 8.0.3 build 24585383')
    expect(row(facts, 'management_controller')?.value).toBe('iDRAC9 7.10.50.00')
    expect(facts.firmware).toHaveLength(6)
    expect(hardwareSummary(merged, 'host')).toBe('VxRail E660F · ESXi 8.0.3 (24585383) · BIOS 1.14.1 · iDRAC9 7.10.50.00')
  })

  it('treats an OS reported only as VMware ESXi + version as an ESXi release', () => {
    const facts = hardwareFacts({ os_name: 'VMware ESXi', os_version: '8.0.3' }, 'server')
    expect(row(facts, 'operating_system')?.value).toBe('VMware ESXi 8.0.3')
  })

  it('does not repeat an OS version the name already carries', () => {
    const facts = hardwareFacts({ os_name: 'Ubuntu 22.04', os_version: '22.04' }, 'server')
    expect(row(facts, 'operating_system')?.value).toBe('Ubuntu 22.04')
    expect(row(hardwareFacts({ os_version: '10.0.20348' }, 'server'), 'operating_system')?.value).toBe('10.0.20348')
  })

  it('renders a PowerStore array: storage OS with build, express service code, no OS row', () => {
    const facts = hardwareFacts({ ...POWERSTORE_ARRAY, os_name: 'ignored' }, 'storage_array')
    expect(facts.rows.map((r) => r.key)).toEqual(['manufacturer', 'model', 'service_tag', 'express_service_code', 'storage_os'])
    expect(row(facts, 'storage_os')).toMatchObject({ value: 'PowerStoreOS 4.3.1.1', detail: 'build 4.3.1.1.2345678' })
  })

  it('falls back to an array plain version, and names the OS from the collecting connector', () => {
    const facts = hardwareFacts({ version: '4.2.0.0', source: 'powerstore:dca' }, 'storage_array')
    expect(row(facts, 'storage_os')?.value).toBe('PowerStoreOS 4.2.0.0')
    const dd = hardwareFacts({ model: 'DD9400', version: '7.10.1.0' }, 'backup_appliance')
    expect(row(dd, 'storage_os')?.value).toBe('DD OS 7.10.1.0')
    const unknown = hardwareFacts({ model: 'ME5024', software_version: '5.3.0' }, 'storage_array')
    expect(row(unknown, 'storage_os')?.value).toBe('5.3.0')
  })

  it('never reads a plain version as an OS on a server', () => {
    const facts = hardwareFacts({ version: '3.1', model: 'PowerEdge R640' }, 'server')
    expect(row(facts, 'storage_os')).toBeUndefined()
    expect(row(facts, 'operating_system')).toBeUndefined()
  })

  it('shows a controller known only by its address', () => {
    const facts = hardwareFacts({ bmc_address: '10.0.2.99' }, 'server')
    expect(row(facts, 'management_controller')).toMatchObject({ value: '10.0.2.99' })
    expect(row(facts, 'management_controller')?.detail).toBeUndefined()
  })

  it('omits the BIOS release date without a BIOS version', () => {
    expect(row(hardwareFacts({ bios_release_date: '2025-03-14' }, 'host'), 'bios')).toBeUndefined()
  })

  it('drops junk values and malformed firmware entries', () => {
    const facts = hardwareFacts(
      {
        model: '  ',
        manufacturer: ['Dell'],
        bios_version: '[1 2 3]',
        firmware: [
          { name: 'NIC', version: '' },
          'BIOS 1.0',
          null,
          { name: '', component_id: '777', version: '1.2.3' },
          { name: 'PSU', version: 42 },
        ],
      },
      'server',
    )
    expect(facts.rows).toEqual([])
    expect(facts.firmware).toEqual([
      { name: '777', version: '1.2.3', componentId: '777' },
      { name: 'PSU', version: '42' },
    ])
  })

  it('returns nothing for a non-hardware asset', () => {
    expect(hardwareFacts(OPENMANAGE_SERVER, 'vm')).toEqual({ rows: [], firmware: [] })
    expect(hardwareFacts(undefined, 'server')).toEqual({ rows: [], firmware: [] })
  })
})

describe('hardwareSummary', () => {
  it('summarises a server as model · BIOS · controller', () => {
    expect(hardwareSummary(OPENMANAGE_SERVER, 'server')).toBe('PowerEdge R650xs · BIOS 1.14.1 · iDRAC9 7.00.00.181')
  })

  it('summarises an ESXi host as model · ESXi version (build) · BIOS', () => {
    expect(hardwareSummary(VCENTER_ESXI_HOST, 'host')).toBe('VxRail E660F · ESXi 8.0.3 (24585383) · BIOS 1.14.1')
  })

  it('summarises a PowerStore array as model · PowerStoreOS version', () => {
    expect(hardwareSummary(POWERSTORE_ARRAY, 'storage_array')).toBe('PowerStore 1200T · PowerStoreOS 4.3.1.1')
  })

  it('uses the controller type when the product generation is unknown', () => {
    expect(hardwareSummary({ model: 'ProLiant DL380 Gen10', bmc_type: 'iLO', bmc_firmware_version: '2.78' }, 'server')).toBe(
      'ProLiant DL380 Gen10 · iLO 2.78',
    )
  })

  it('leads with the manufacturer only when there are versions to qualify', () => {
    expect(hardwareSummary({ manufacturer: 'Dell', bios_version: '2.19.1' }, 'server')).toBe('Dell · BIOS 2.19.1')
    expect(hardwareSummary({ manufacturer: 'Dell' }, 'server')).toBe('')
  })

  it('shows the model alone when that is all that is known', () => {
    expect(hardwareSummary({ model: 'PowerEdge R640' }, 'server')).toBe('PowerEdge R640')
  })

  it('is empty for guests, network gear and bare assets', () => {
    expect(hardwareSummary(OPENMANAGE_SERVER, 'vm')).toBe('')
    expect(hardwareSummary({ model: 'PA-5220', 'sw-version': '10.2.4' }, 'firewall')).toBe('')
    expect(hardwareSummary({}, 'server')).toBe('')
    expect(hardwareSummary(null, 'host')).toBe('')
  })
})

describe('firmwareKindLabel', () => {
  it('maps OpenManage component types to source strings and passes others through', () => {
    expect(firmwareKindLabel('BIOS')).toBe('BIOS')
    expect(firmwareKindLabel('FRMW')).toBe('Firmware')
    expect(firmwareKindLabel('frmw')).toBe('Firmware')
    expect(firmwareKindLabel('APAC')).toBe('Application')
    expect(firmwareKindLabel('DRVR')).toBe('Driver')
    expect(firmwareKindLabel('OTHR')).toBe('OTHR')
    expect(firmwareKindLabel(undefined)).toBe('')
  })
})

describe('firmwarePreview', () => {
  const components = (n: number): FirmwareComponent[] =>
    Array.from({ length: n }, (_, i) => ({ name: `Component ${i}`, version: `1.${i}` }))

  it('shows a short list whole', () => {
    expect(firmwarePreview(components(FIRMWARE_PREVIEW_ROWS), false)).toMatchObject({ hidden: 0 })
    expect(firmwarePreview(components(FIRMWARE_PREVIEW_ROWS), false).shown).toHaveLength(FIRMWARE_PREVIEW_ROWS)
  })

  it('previews a long list until expanded', () => {
    const list = components(30)
    const collapsed = firmwarePreview(list, false)
    expect(collapsed.shown).toHaveLength(FIRMWARE_PREVIEW_ROWS)
    expect(collapsed.hidden).toBe(30 - FIRMWARE_PREVIEW_ROWS)
    expect(firmwarePreview(list, true)).toEqual({ shown: list, hidden: 0 })
  })
})

describe('deviceFieldsCovered', () => {
  it('names the Device card rows the hardware card repeats', () => {
    expect(deviceFieldsCovered(hardwareFacts(OPENMANAGE_SERVER, 'server'))).toEqual(['vendor', 'model', 'serial', 'software'])
    expect(deviceFieldsCovered(hardwareFacts({ bios_version: '1.0' }, 'server'))).toEqual([])
    expect(deviceFieldsCovered(hardwareFacts({ serial_number: 'X1' }, 'host'))).toEqual(['serial'])
    expect(deviceFieldsCovered(hardwareFacts(POWERSTORE_ARRAY, 'storage_array'))).toEqual(['vendor', 'model', 'serial', 'software'])
  })
})
