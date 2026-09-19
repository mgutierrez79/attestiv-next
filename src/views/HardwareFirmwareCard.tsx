'use client'

// HardwareFirmwareCard renders what the hardware connectors (Dell
// OpenManage, Redfish BMCs, vCenter ESXi hosts, PowerStore) report about
// a physical box: its identity (manufacturer, model, service tag, serial),
// the versions that matter for patching (BIOS, management controller,
// operating system / ESXi release, storage OS) and the installed firmware
// components. The rows are picked by src/lib/hardwareFacts.ts, which also
// handles an OpenManage row merged with its vCenter ESXi sibling.
//
// The asset detail page owns the gate (hardware assets that are not VMs)
// and drops the rows this card repeats from the Server details and Device
// cards.

import { useState } from 'react'

import { Badge, Card, CardTitle } from '../components/AttestivUi'
import { useI18n } from '../lib/i18n'
import { firmwareKindLabel, firmwarePreview, type HardwareFacts } from '../lib/hardwareFacts'

export function HardwareFirmwareCard({ facts }: { facts: HardwareFacts }) {
  const { t } = useI18n()
  const [showAllFirmware, setShowAllFirmware] = useState(false)
  const { shown, hidden } = firmwarePreview(facts.firmware, showAllFirmware)
  const collapsible = hidden > 0 || showAllFirmware

  return (
    <Card>
      <CardTitle>{t('Hardware & firmware', 'Hardware & firmware')}</CardTitle>
      {facts.rows.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 8, fontSize: 13 }}>
          {facts.rows.map((row) => (
            <HardwareStat
              key={row.key}
              label={t(row.label, row.label)}
              value={row.value}
              detail={row.detail}
              mono={row.mono}
            />
          ))}
        </div>
      ) : null}
      {facts.firmware.length > 0 ? (
        <div style={{ marginTop: facts.rows.length > 0 ? 16 : 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            {t('Firmware components', 'Firmware components')}
            <Badge tone="navy">{facts.firmware.length}</Badge>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 6 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ padding: '6px 10px 6px 0' }}>{t('Component', 'Component')}</th>
                  <th style={{ padding: '6px 10px' }}>{t('Version', 'Version')}</th>
                  <th style={{ padding: '6px 0 6px 10px' }}>{t('Type', 'Type')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((component, i) => {
                  const kind = firmwareKindLabel(component.kind)
                  return (
                    <tr key={`${component.componentId ?? component.name}-${component.version}-${i}`} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={{ padding: '6px 10px 6px 0' }}>{component.name || '—'}</td>
                      <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{component.version}</td>
                      <td style={{ padding: '6px 0 6px 10px', color: 'var(--color-text-secondary)' }}>
                        {kind ? t(kind, kind) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {collapsible ? (
            <button
              type="button"
              onClick={() => setShowAllFirmware((open) => !open)}
              aria-expanded={showAllFirmware}
              style={{
                marginTop: 8,
                fontSize: 12,
                fontWeight: 600,
                color: 'var(--color-status-blue-deep)',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <i className={`ti ${showAllFirmware ? 'ti-chevron-up' : 'ti-chevron-down'}`} aria-hidden="true" />
              {showAllFirmware
                ? t('Show fewer', 'Show fewer')
                : t('Show all {n} components', 'Show all {n} components', { n: facts.firmware.length })}
            </button>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function HardwareStat({ label, value, detail, mono }: { label: string; value: string; detail?: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 500, fontFamily: mono ? 'var(--font-mono)' : undefined, overflowWrap: 'anywhere' }}>
        {value}
      </span>
      {detail ? (
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>
          {detail}
        </span>
      ) : null}
    </div>
  )
}
