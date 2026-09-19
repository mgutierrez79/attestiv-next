import { describe, expect, it } from 'vitest'

import { hardwareFacts } from './hardwareFacts'
import { hasVCenterServerFacts, isVCenterServer, vcenterServerFacts } from './vcenterServer'

const metadata = {
  product_name: 'VMware vCenter Server',
  product_full_name: 'VMware vCenter Server 8.0.3 build-24322831',
  software_version: '8.0.3',
  software_build: '24322831',
  api_version: '8.0.3.0',
  instance_uuid: '5c1d0e2a-aaaa-bbbb-cccc-0123456789ab',
  management_address: 'vcsa-dca.auxia.lan',
  extension_count: 42,
  third_party_extension_count: 2,
  extensions: [
    { key: 'com.dell.plugin.OMIVV', label: 'OpenManage Integration', version: '7.3.0', company: 'Dell Inc.', third_party: true, last_heartbeat: '2026-09-18T10:00:00Z' },
    { key: 'com.veeam.backup', label: 'Veeam Backup', version: '12.1', company: 'Veeam Software', third_party: true },
    { key: 'com.vmware.vim.sms', label: 'Storage Monitoring Service', version: '8.0', company: 'VMware, Inc.', third_party: false },
    { key: '', label: 'no key, skipped' },
    'not an object',
  ],
}

describe('vCenter Server facts', () => {
  it('recognises the vCenter Server asset type', () => {
    expect(isVCenterServer('virtualization_manager')).toBe(true)
    expect(isVCenterServer(' Virtualization_Manager ')).toBe(true)
    expect(isVCenterServer('host')).toBe(false)
    expect(isVCenterServer(undefined)).toBe(false)
  })

  it('reads the version facts and splits third-party plugins from built-ins', () => {
    const facts = vcenterServerFacts(metadata)
    expect(facts).toMatchObject({
      productFullName: 'VMware vCenter Server 8.0.3 build-24322831',
      version: '8.0.3',
      build: '24322831',
      apiVersion: '8.0.3.0',
      managementAddress: 'vcsa-dca.auxia.lan',
      extensionCount: 42,
      thirdPartyCount: 2,
    })
    expect(facts.thirdPartyPlugins.map((p) => p.key)).toEqual(['com.dell.plugin.OMIVV', 'com.veeam.backup'])
    expect(facts.thirdPartyPlugins[0]).toMatchObject({ version: '7.3.0', company: 'Dell Inc.', lastHeartbeat: '2026-09-18T10:00:00Z' })
    expect(facts.builtInPlugins.map((p) => p.key)).toEqual(['com.vmware.vim.sms'])
    expect(hasVCenterServerFacts(facts)).toBe(true)
  })

  it('shows nothing for a record without facts', () => {
    const facts = vcenterServerFacts({ management_address: 'vcsa' })
    expect(hasVCenterServerFacts(facts)).toBe(false)
    expect(facts.extensionCount).toBe(0)
  })

  it('never renders as a hardware asset', () => {
    const hw = hardwareFacts(metadata, 'virtualization_manager')
    expect(hw.rows).toEqual([])
    expect(hw.firmware).toEqual([])
  })
})
