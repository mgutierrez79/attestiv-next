// Hardware and firmware facts for an inventoried asset.
//
// The hardware connectors (Dell OpenManage, Redfish BMCs, vCenter ESXi
// hosts, PowerStore) stamp one shared vocabulary onto asset.metadata
// (attestiv-go internal/connectors/hardware_facts.go) — the inventory keeps
// only metadata, so that is where the facts live:
//
//   manufacturer, model, service_tag, serial_number, express_service_code
//   bios_version, bios_release_date                        (vCenter date)
//   bmc_type ("iDRAC"), bmc_product ("iDRAC9"), bmc_firmware_version,
//   bmc_address, bmc_model                                 (Redfish model)
//   os_name, os_version, os_hostname
//   esxi_version, esxi_build, esxi_full_name, cpu_model    (vCenter hosts)
//   software_version, software_build                       (storage arrays)
//   firmware: [{ name, version, kind?, component_id? }]    (≤ 64 entries)
//
// Every key is optional and present only when known. One metadata object
// can also be a cross-source merge — an OpenManage server row unified with
// its vCenter ESXi sibling carries OME's bmc_* / firmware / service_tag AND
// vCenter's esxi_* keys — so each fact reads whichever keys are there.
//
// Pure and UI-free, like displayMeta / ipSource: labels are English source
// strings for t(); values are vendor text (model names, versions, iDRAC,
// VMware ESXi, PowerStoreOS) and are never translated.

import { displayableMetaString } from './displayMeta'

type Metadata = Record<string, unknown> | null | undefined

export type HardwareFactKey =
  | 'manufacturer'
  | 'model'
  | 'service_tag'
  | 'express_service_code'
  | 'serial_number'
  | 'bios'
  | 'management_controller'
  | 'operating_system'
  | 'storage_os'
  | 'cpu_model'

export type HardwareFactRow = {
  key: HardwareFactKey
  // English source string for the row label (passed through t()).
  label: string
  // Vendor text, rendered as-is.
  value: string
  // Secondary vendor text under the value: the controller's address, the
  // hostname the OS reports, a storage OS build.
  detail?: string
  // Identifiers and versions render monospaced.
  mono?: boolean
}

export type FirmwareComponent = {
  name: string
  version: string
  // OpenManage component type: BIOS, FRMW (firmware), APAC (application
  // package), DRVR (driver). Absent for Redfish.
  kind?: string
  componentId?: string
}

export type HardwareFacts = {
  rows: HardwareFactRow[]
  firmware: FirmwareComponent[]
}

// Types that are a physical box the hardware connectors describe.
const HARDWARE_ASSET_TYPES = new Set(['server', 'host', 'hypervisor_host', 'storage_array', 'backup_appliance'])

// Types that never get hardware facts: guests, logical objects, and the
// network gear whose model / software / serial the Device card already
// owns (NetworkDeviceDetails reads that gear's own key spellings).
const NON_HARDWARE_ASSET_TYPES = new Set([
  'vm',
  'virtual_machine',
  'cluster',
  'storage_volume',
  'network_link',
  'network_link_member',
  'network_device',
  'switch',
  'router',
  'firewall',
  'firewall_manager',
])

// Storage types, whose OS is a storage OS (PowerStoreOS, DD OS) and whose
// older records carry the release as a plain `version`.
const STORAGE_ASSET_TYPES = new Set(['storage_array', 'backup_appliance'])

// Keys only a hardware connector stamps. They let an asset whose merged
// type is none of the hardware types (a server an EDR or directory source
// typed as an endpoint) still count as hardware.
const HARDWARE_ONLY_KEYS = [
  'bios_version',
  'bmc_firmware_version',
  'bmc_product',
  'bmc_type',
  'esxi_version',
  'esxi_build',
  'esxi_full_name',
]

// Beyond this many firmware components the table shows a preview and a
// "show all" toggle; a PowerEdge reports 20-40.
export const FIRMWARE_PREVIEW_ROWS = 8

function text(metadata: Metadata, key: string): string {
  return displayableMetaString(metadata?.[key])
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function firmwareList(metadata: Metadata): FirmwareComponent[] {
  const raw = metadata?.['firmware']
  if (!Array.isArray(raw)) return []
  const out: FirmwareComponent[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
    const record = entry as Record<string, unknown>
    const version = displayableMetaString(record['version'])
    // A component without a version says nothing about what is installed
    // (the collectors drop those too).
    if (!version) continue
    const componentId = displayableMetaString(record['component_id'])
    const component: FirmwareComponent = {
      name: displayableMetaString(record['name']) || componentId,
      version,
    }
    const kind = displayableMetaString(record['kind'])
    if (kind) component.kind = kind
    if (componentId) component.componentId = componentId
    out.push(component)
  }
  return out
}

// isHardwareAsset reports whether an asset is a physical box whose
// hardware facts belong on it: a server / host / hypervisor host / storage
// array / backup appliance, or any other non-guest, non-network type that
// carries a key only a hardware connector stamps.
export function isHardwareAsset(assetType: string | null | undefined, metadata: Metadata): boolean {
  const type = String(assetType ?? '').trim().toLowerCase()
  if (HARDWARE_ASSET_TYPES.has(type)) return true
  if (NON_HARDWARE_ASSET_TYPES.has(type)) return false
  if (HARDWARE_ONLY_KEYS.some((key) => text(metadata, key) !== '')) return true
  return firmwareList(metadata).length > 0
}

type ESXiRelease = { version: string; build: string; fullName: string }

// esxiRelease reads the hypervisor release from vCenter's esxi_* keys,
// falling back to the full name ("VMware ESXi 8.0.3 build-24585383") and
// to an os_name that says ESXi. null when the asset is not an ESXi host.
function esxiRelease(metadata: Metadata): ESXiRelease | null {
  const fullName = text(metadata, 'esxi_full_name')
  const osName = text(metadata, 'os_name')
  let version = text(metadata, 'esxi_version')
  let build = text(metadata, 'esxi_build')
  if (!version && !build && !fullName && !/esxi/i.test(osName)) return null
  if (!version) version = fullName.match(/\d+(?:\.\d+)+/)?.[0] ?? ''
  if (!build) build = fullName.match(/build[-\s]?(\d+)/i)?.[1] ?? ''
  if (!version && /esxi/i.test(osName)) {
    version = text(metadata, 'os_version') || osName.match(/\d+(?:\.\d+)+/)?.[0] || ''
  }
  if (!version && !build && !fullName) return null
  return { version, build, fullName }
}

// esxiDisplayName renders the release the way VMware prints it, with the
// build separated by a space: "VMware ESXi 8.0.3 build 24585383".
function esxiDisplayName(release: ESXiRelease): string {
  if (release.fullName) {
    const name = release.fullName.replace(/build-(\d)/i, 'build $1')
    if (release.build && !name.includes(release.build)) return `${name} build ${release.build}`
    return name
  }
  return ['VMware ESXi', release.version, release.build ? `build ${release.build}` : '']
    .filter(Boolean)
    .join(' ')
}

// operatingSystem renders the OS row: the ESXi release for a hypervisor
// host, else the OS name with its version appended unless the name
// already carries it.
function operatingSystem(metadata: Metadata): { value: string; detail?: string } | null {
  const hostname = text(metadata, 'os_hostname')
  const release = esxiRelease(metadata)
  if (release) return { value: esxiDisplayName(release), detail: hostname || undefined }
  const name = text(metadata, 'os_name')
  const version = text(metadata, 'os_version')
  const value = name && version && !name.includes(version) ? `${name} ${version}` : name || version
  if (!value) return null
  return { value, detail: hostname || undefined }
}

// storageOSName names the storage OS a platform array runs, from its model
// or the connector that collected it. "" when the family is unknown — the
// version then stands alone.
function storageOSName(metadata: Metadata): string {
  const haystack = [text(metadata, 'model'), text(metadata, 'source')].join(' ').toLowerCase()
  if (haystack.includes('powerstore')) return 'PowerStoreOS'
  if (/data ?domain|datadomain|powerprotect dd|\bdd\d/.test(haystack)) return 'DD OS'
  return ''
}

type StorageRelease = { name: string; version: string; build: string }

function storageRelease(metadata: Metadata, assetType: string): StorageRelease | null {
  if (!STORAGE_ASSET_TYPES.has(assetType)) return null
  const version = text(metadata, 'software_version') || text(metadata, 'version')
  if (!version) return null
  const build = text(metadata, 'software_build')
  return { name: storageOSName(metadata), version, build: build && !sameText(build, version) ? build : '' }
}

// managementController renders the BMC row: "iDRAC9 7.00.00.181" with the
// controller's address (and Redfish's model) underneath.
function managementController(metadata: Metadata): { value: string; detail?: string } | null {
  const product = text(metadata, 'bmc_product') || text(metadata, 'bmc_type')
  const firmware = text(metadata, 'bmc_firmware_version')
  const head = [product, firmware].filter(Boolean).join(' ')
  const tail = [text(metadata, 'bmc_address'), text(metadata, 'bmc_model')].filter(Boolean)
  if (head) return { value: head, detail: tail.join(' · ') || undefined }
  if (tail.length === 0) return null
  return { value: tail.join(' · ') }
}

// hardwareFacts picks the hardware card's rows (only known values, in
// display order) and the installed firmware from an asset's metadata.
// Empty for an asset that is not hardware (see isHardwareAsset).
export function hardwareFacts(metadata: Metadata, assetType: string | null | undefined): HardwareFacts {
  const type = String(assetType ?? '').trim().toLowerCase()
  if (!isHardwareAsset(type, metadata)) return { rows: [], firmware: [] }
  const rows: HardwareFactRow[] = []
  const push = (row: HardwareFactRow) => {
    if (row.value) rows.push(row)
  }

  push({ key: 'manufacturer', label: 'Manufacturer', value: text(metadata, 'manufacturer') })
  push({ key: 'model', label: 'Model', value: text(metadata, 'model') })
  const serviceTag = text(metadata, 'service_tag')
  push({ key: 'service_tag', label: 'Service tag', value: serviceTag, mono: true })
  push({ key: 'express_service_code', label: 'Express service code', value: text(metadata, 'express_service_code'), mono: true })
  // vCenter reports a Dell host's service tag as its serial number too;
  // the same value twice is noise. Redfish's board serial differs and stays.
  const serial = text(metadata, 'serial_number')
  if (!(serial && serviceTag && sameText(serial, serviceTag))) {
    push({ key: 'serial_number', label: 'Serial number', value: serial, mono: true })
  }

  const bios = text(metadata, 'bios_version')
  if (bios) {
    const released = text(metadata, 'bios_release_date')
    push({ key: 'bios', label: 'BIOS', value: released ? `${bios} (${released})` : bios, mono: true })
  }
  const bmc = managementController(metadata)
  if (bmc) push({ key: 'management_controller', label: 'Management controller', value: bmc.value, detail: bmc.detail, mono: true })

  // A storage array's OS is its storage OS row; its os_* keys (if any)
  // would only repeat it.
  const storage = storageRelease(metadata, type)
  if (storage) {
    push({
      key: 'storage_os',
      label: 'Storage OS',
      value: [storage.name, storage.version].filter(Boolean).join(' '),
      detail: storage.build ? `build ${storage.build}` : undefined,
    })
  } else {
    const os = operatingSystem(metadata)
    if (os) push({ key: 'operating_system', label: 'Operating system', value: os.value, detail: os.detail })
  }
  push({ key: 'cpu_model', label: 'CPU model', value: text(metadata, 'cpu_model') })

  return { rows, firmware: firmwareList(metadata) }
}

// hardwareSummary is the one-line hint the inventory list shows under a
// hardware asset's name: the model, then the versions that matter for
// patching — "PowerEdge R650xs · BIOS 1.14.1 · iDRAC9 7.00.00.181",
// "VxRail E660F · ESXi 8.0.3 (24585383)", "PowerStore 1200T ·
// PowerStoreOS 4.3.1.1". "" when there is nothing to say.
export function hardwareSummary(metadata: Metadata, assetType: string | null | undefined): string {
  const type = String(assetType ?? '').trim().toLowerCase()
  if (!isHardwareAsset(type, metadata)) return ''
  const parts: string[] = []
  const storage = storageRelease(metadata, type)
  if (storage) {
    parts.push([storage.name, storage.version].filter(Boolean).join(' '))
  } else {
    const release = esxiRelease(metadata)
    if (release?.version) parts.push(`ESXi ${release.version}${release.build ? ` (${release.build})` : ''}`)
  }
  const bios = text(metadata, 'bios_version')
  if (bios) parts.push(`BIOS ${bios}`)
  const bmcFirmware = text(metadata, 'bmc_firmware_version')
  if (bmcFirmware) {
    const product = text(metadata, 'bmc_product') || text(metadata, 'bmc_type')
    parts.push([product, bmcFirmware].filter(Boolean).join(' '))
  }
  // Lead with the model; a bare manufacturer only earns the slot when
  // there are versions to qualify.
  const model = text(metadata, 'model')
  if (model) parts.unshift(model)
  else if (parts.length > 0 && text(metadata, 'manufacturer')) parts.unshift(text(metadata, 'manufacturer'))
  return parts.join(' · ')
}

// firmwareKindLabel turns an OpenManage component type into an English
// source string for t(); an unknown type passes through as-is.
export function firmwareKindLabel(kind: string | undefined): string {
  const raw = String(kind ?? '').trim()
  switch (raw.toUpperCase()) {
    case 'BIOS':
      return 'BIOS'
    case 'FRMW':
      return 'Firmware'
    case 'APAC':
      return 'Application'
    case 'DRVR':
      return 'Driver'
    default:
      return raw
  }
}

// firmwarePreview splits the firmware list for the collapsed table: every
// component when expanded or short, else the first FIRMWARE_PREVIEW_ROWS
// plus how many are hidden.
export function firmwarePreview(
  firmware: FirmwareComponent[],
  expanded: boolean,
): { shown: FirmwareComponent[]; hidden: number } {
  if (expanded || firmware.length <= FIRMWARE_PREVIEW_ROWS) return { shown: firmware, hidden: 0 }
  return { shown: firmware.slice(0, FIRMWARE_PREVIEW_ROWS), hidden: firmware.length - FIRMWARE_PREVIEW_ROWS }
}

// The Device card's identity rows (NetworkDeviceDetails) that repeat a
// hardware-card row.
export type DeviceIdentityField = 'vendor' | 'model' | 'serial' | 'software'

// deviceFieldsCovered names the Device card rows the hardware card already
// shows, so a server or host renders each fact once: vendor ↔ Manufacturer,
// model ↔ Model, serial ↔ Service tag / Serial number, software ↔
// Operating system / Storage OS (for a host the Device card's software is
// the ESXi version).
export function deviceFieldsCovered(facts: HardwareFacts): DeviceIdentityField[] {
  const keys = new Set(facts.rows.map((row) => row.key))
  const covered: DeviceIdentityField[] = []
  if (keys.has('manufacturer')) covered.push('vendor')
  if (keys.has('model')) covered.push('model')
  if (keys.has('service_tag') || keys.has('serial_number')) covered.push('serial')
  if (keys.has('operating_system') || keys.has('storage_os')) covered.push('software')
  return covered
}
