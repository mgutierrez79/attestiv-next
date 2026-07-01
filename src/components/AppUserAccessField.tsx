'use client';
// Repeatable user-access-row editor used by the create + edit application
// forms. Each row declares WHERE users connect FROM: a network type (one of
// the six backend types), an optional source range, protocol, ports and
// description. Mirrors the add/remove/edit pattern of AppDependenciesField's
// FlowEditor so the two editors feel identical to the operator.
//
// The parent owns the array; this component is a controlled add/remove/update
// grid. cleanUserAccess() (src/lib/appUserAccess.ts) normalizes the rows into
// the persisted shape before they go into the POST/PATCH body.

import { useI18n } from '../lib/i18n'
import {
  NETWORK_TYPES,
  emptyUserAccess,
  networkTypeLabel,
  type NetworkType,
  type UserAccessNetwork,
} from '../lib/appUserAccess'

// Protocol options for the user-access select — mirrors the flow-editor
// protocol set, with an explicit "unset" first entry. Kept local because
// user-access protocol is a free-ish string on the wire (backend accepts
// tcp/udp/icmp/any) and we only need the picker values here.
const PROTOCOL_OPTIONS = ['tcp', 'udp', 'icmp', 'any'] as const

export function AppUserAccessField({
  value,
  onChange,
}: {
  value: UserAccessNetwork[]
  onChange: (next: UserAccessNetwork[]) => void
}) {
  const { t } = useI18n()

  function update(index: number, patch: Partial<UserAccessNetwork>) {
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }
  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }
  function add() {
    onChange([...value, emptyUserAccess()])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {value.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
          {t('No user-access networks declared.', 'No user-access networks declared.')}
        </div>
      ) : (
        value.map((row, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.4fr 1.4fr 0.9fr 1fr 1.8fr auto',
              gap: 6,
              alignItems: 'center',
            }}
          >
            <select
              value={row.network_type}
              onChange={(e) => update(i, { network_type: e.target.value as NetworkType })}
              aria-label={t('Network type', 'Network type')}
              style={rowInputStyle}
            >
              {NETWORK_TYPES.map((nt) => (
                <option key={nt} value={nt}>
                  {networkTypeLabel(nt)}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={row.source ?? ''}
              onChange={(e) => update(i, { source: e.target.value })}
              placeholder={t('Source (e.g. 10.8.0.0/24)', 'Source (e.g. 10.8.0.0/24)')}
              aria-label={t('Source', 'Source')}
              style={rowInputStyle}
            />
            <select
              value={row.protocol ?? ''}
              onChange={(e) => update(i, { protocol: e.target.value || undefined })}
              aria-label={t('Protocol', 'Protocol')}
              style={rowInputStyle}
            >
              <option value="">{t('— protocol —', '— protocol —')}</option>
              {PROTOCOL_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={row.ports ?? ''}
              onChange={(e) => update(i, { ports: e.target.value })}
              placeholder="443,8443"
              aria-label={t('Ports', 'Ports')}
              style={rowInputStyle}
            />
            <input
              type="text"
              value={row.description ?? ''}
              onChange={(e) => update(i, { description: e.target.value })}
              placeholder={t('Description', 'Description')}
              aria-label={t('Description', 'Description')}
              style={rowInputStyle}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              title={t('Remove this user-access network', 'Remove this user-access network')}
              style={removeButtonStyle}
            >
              ×
            </button>
          </div>
        ))
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={add} style={addButtonStyle}>
          + {t('Add user access', 'Add user access')}
        </button>
      </div>
    </div>
  )
}

const rowInputStyle: React.CSSProperties = {
  padding: '6px 8px',
  borderRadius: 4,
  border: '0.5px solid var(--color-border-tertiary)',
  background: 'var(--color-surface-primary)',
  fontSize: 12,
  fontFamily: 'inherit',
  minWidth: 0,
}

const removeButtonStyle: React.CSSProperties = {
  background: 'transparent',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 4,
  width: 26,
  height: 26,
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  color: 'var(--color-text-danger, #b53b3b)',
  fontFamily: 'inherit',
}

const addButtonStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  background: 'transparent',
  border: '0.5px solid var(--color-border-tertiary)',
  borderRadius: 4,
  padding: '6px 10px',
  fontSize: 11,
  cursor: 'pointer',
  color: 'var(--color-text-secondary)',
  fontFamily: 'inherit',
}
