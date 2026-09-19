'use client'

// VCenterServerCard renders what the vCenter connector reports about the
// vCenter Server itself: the release (product, version, build, patch
// level, API version) and the plugins registered with it — third-party
// integrations (backup, storage, hardware vendors) listed in full, vCenter's
// own built-in extensions behind a toggle. Facts come from
// src/lib/vcenterServer.ts; the asset detail page gates the card on the
// virtualization_manager type.

import { useState } from 'react'

import { Badge, Card, CardTitle } from '../components/AttestivUi'
import { useI18n } from '../lib/i18n'
import type { VCenterPlugin, VCenterServerFacts } from '../lib/vcenterServer'

export function VCenterServerCard({ facts }: { facts: VCenterServerFacts }) {
  const { t } = useI18n()
  const [showBuiltIn, setShowBuiltIn] = useState(false)

  const stats: Array<{ key: string; label: string; value: string; mono?: boolean }> = [
    { key: 'product', label: t('Product', 'Product'), value: facts.productFullName || facts.productName },
    { key: 'version', label: t('Version', 'Version'), value: facts.version, mono: true },
    { key: 'build', label: t('Build', 'Build'), value: facts.build, mono: true },
    { key: 'patch', label: t('Patch level', 'Patch level'), value: facts.patchLevel, mono: true },
    { key: 'api', label: t('API version', 'API version'), value: facts.apiVersion, mono: true },
    { key: 'address', label: t('Management address', 'Management address'), value: facts.managementAddress, mono: true },
    { key: 'uuid', label: t('Instance UUID', 'Instance UUID'), value: facts.instanceUuid, mono: true },
  ].filter((s) => s.value)

  return (
    <Card>
      <CardTitle>{t('vCenter Server', 'vCenter Server')}</CardTitle>
      {stats.length > 0 ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginTop: 8, fontSize: 13 }}>
          {stats.map((stat) => (
            <div key={stat.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {stat.label}
              </span>
              <span style={{ fontSize: 13, fontWeight: 500, fontFamily: stat.mono ? 'var(--font-mono)' : undefined, overflowWrap: 'anywhere' }}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      <div style={{ marginTop: stats.length > 0 ? 16 : 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          {t('Installed plugins', 'Installed plugins')}
          <Badge tone="navy">{facts.thirdPartyCount}</Badge>
        </div>
        {facts.thirdPartyPlugins.length > 0 ? (
          <PluginTable plugins={facts.thirdPartyPlugins} />
        ) : (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 6 }}>
            {t('No third-party plugins are registered with this vCenter.', 'No third-party plugins are registered with this vCenter.')}
          </div>
        )}
      </div>

      {facts.builtInPlugins.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <button
            type="button"
            onClick={() => setShowBuiltIn((open) => !open)}
            aria-expanded={showBuiltIn}
            style={{
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
            <i className={`ti ${showBuiltIn ? 'ti-chevron-up' : 'ti-chevron-down'}`} aria-hidden="true" />
            {showBuiltIn
              ? t('Hide VMware built-in extensions', 'Hide VMware built-in extensions')
              : t('Show {n} VMware built-in extensions', 'Show {n} VMware built-in extensions', { n: facts.builtInPlugins.length })}
          </button>
          {showBuiltIn ? <PluginTable plugins={facts.builtInPlugins} /> : null}
        </div>
      ) : null}
    </Card>
  )
}

function PluginTable({ plugins }: { plugins: VCenterPlugin[] }) {
  const { t } = useI18n()
  return (
    <div style={{ overflowX: 'auto', marginTop: 6 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            <th style={{ padding: '6px 10px 6px 0' }}>{t('Plugin', 'Plugin')}</th>
            <th style={{ padding: '6px 10px' }}>{t('Version', 'Version')}</th>
            <th style={{ padding: '6px 10px' }}>{t('Vendor', 'Vendor')}</th>
            <th style={{ padding: '6px 0 6px 10px' }}>{t('Last heartbeat', 'Last heartbeat')}</th>
          </tr>
        </thead>
        <tbody>
          {plugins.map((plugin) => (
            <tr key={plugin.key} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
              <td style={{ padding: '6px 10px 6px 0' }}>
                <div style={{ fontWeight: 500 }}>{plugin.label || plugin.key}</div>
                {plugin.label ? (
                  <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', fontFamily: 'var(--font-mono)', overflowWrap: 'anywhere' }}>{plugin.key}</div>
                ) : null}
              </td>
              <td style={{ padding: '6px 10px', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{plugin.version || '—'}</td>
              <td style={{ padding: '6px 10px', color: 'var(--color-text-secondary)' }}>{plugin.company || '—'}</td>
              <td style={{ padding: '6px 0 6px 10px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>
                {plugin.lastHeartbeat ? new Date(plugin.lastHeartbeat).toLocaleString() : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
