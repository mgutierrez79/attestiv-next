'use client'

// Connector registry — mockup 01 connectors page.
//
// Card grid showing every configured connector with: status border
// color, icon + accent matching the connector family, real-time
// metrics (events/min for streaming, last poll for polling), and
// the connector version string in mono. Final card is a dashed
// "Add connector" call-to-action that links to the wizard route
// (Phase B-3).
//
// Status mapping:
//   live (streaming + recently active)            → green border + Live badge
//   ok (polling + recent successful collection)   → green border + OK badge
//   retrying (failures > 0, still under retry)    → amber border + Retrying badge
//   stale (no event within 2× poll interval)      → amber border + Stale badge
//   error (failure_count rising, no recent ok)    → red border + Error badge

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ApiError, apiFetch, apiJson } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useRoles } from '../lib/roles'
import { Badge, Banner, Card, EmptyState, GhostButton, PrimaryButton, Skeleton, Topbar } from '../components/AttestivUi'
import { ConnectorLogo, connectorBrandHex } from '../components/ConnectorLogo'

type ConnectorStatus = {
  name: string
  label?: string
  category?: string
  status?: string
  last_status?: string
  delivery_mode?: string
  last_run?: string | null
  last_success?: string | null
  last_error?: { timestamp?: string | null; message?: string | null } | string | null
  success_count?: number
  failure_count?: number
  events_per_minute?: number
  last_event_count?: number
  poll_interval_seconds?: number
  connector_version?: string
}
type ConnectorsResponse = { connectors: ConnectorStatus[] }

function relativeTime(iso?: string | null): string {
  if (!iso) return 'never'
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'never'
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}

type RowState = {
  border: string
  badge: { tone: 'green' | 'amber' | 'red' | 'gray'; label: string }
  metrics: string
  errorLine?: string
}

function classifyConnector(connector: ConnectorStatus): RowState {
  // Disabled wins over every other signal. The backend reports
  // status="disabled" when the connector isn't in connector_sources;
  // we render that as a grey "Disabled" badge with no metrics so a
  // tenant can tell at a glance which entries are catalog-only.
  if ((connector.status ?? '').toLowerCase() === 'disabled') {
    return {
      border: 'var(--color-border-tertiary)',
      badge: { tone: 'gray', label: 'Disabled' },
      metrics: 'Not enabled for this tenant',
    }
  }
  const failures = connector.failure_count || 0
  const lastSeen = connector.last_success || connector.last_run
  const interval = (connector.poll_interval_seconds ||
    (connector.delivery_mode === 'stream' ? 60 : 21600)) * 2 * 1000
  const isStale = !lastSeen || Date.now() - new Date(lastSeen).getTime() > interval
  const errorMessage = (() => {
    if (!connector.last_error) return null
    if (typeof connector.last_error === 'string') return connector.last_error || null
    return connector.last_error.message || null
  })()
  // failure_count is a LIFETIME counter — a connector with 1 failure
  // out of 500 successful runs would otherwise show "Retrying"
  // forever. Use last_status (or fall back to last_error presence) so
  // the badge reflects the CURRENT attempt's outcome.
  const lastStatus = (connector.last_status ?? '').toLowerCase()
  const currentlyErroring =
    lastStatus === 'error' || lastStatus === 'failed' || (!!errorMessage && !connector.last_success)

  if (currentlyErroring && !isStale) {
    return {
      border: 'var(--color-status-red-mid)',
      badge: { tone: 'red', label: 'Error' },
      metrics: `${failures} lifetime failures · ${errorMessage || 'see logs'}`,
      errorLine: errorMessage || undefined,
    }
  }
  if (isStale) {
    return {
      border: 'var(--color-status-amber-mid)',
      badge: { tone: 'amber', label: 'Stale' },
      metrics: lastSeen ? `last: ${relativeTime(lastSeen)}` : 'never reported',
    }
  }
  if (connector.delivery_mode === 'stream') {
    const epm = connector.events_per_minute ?? connector.last_event_count
    return {
      border: 'var(--color-status-green-mid)',
      badge: { tone: 'green', label: 'Live' },
      metrics: epm ? `${epm} events/min · last: ${relativeTime(lastSeen)}` : `last: ${relativeTime(lastSeen)}`,
    }
  }
  const intervalLabel = connector.poll_interval_seconds
    ? connector.poll_interval_seconds >= 60
      ? `polling ${Math.round(connector.poll_interval_seconds / 60)}min`
      : `polling ${connector.poll_interval_seconds}s`
    : 'polling'
  return {
    border: 'var(--color-status-green-mid)',
    badge: { tone: 'green', label: 'OK' },
    metrics: `Last poll: ${relativeTime(lastSeen)} · ${intervalLabel}`,
  }
}

function categoryLabel(connector: ConnectorStatus): string {
  const category = connector.category || ''
  const mode = connector.delivery_mode === 'stream' ? 'streaming' : 'polling'
  const protocol = (() => {
    if (category.includes('network')) return 'Network · CEF syslog'
    if (category === 'virtualization' || connector.name === 'vcenter') return 'Virtualisation · vSphere API'
    if (category === 'storage') return 'Storage · REST API'
    if (category === 'backup') return 'Backup · REST API'
    if (category === 'observability') return 'Observability · REST API'
    if (category === 'cmdb') return 'CMDB · REST API'
    return 'REST API'
  })()
  return `${protocol} · ${mode}`
}

export function AttestivConnectorRegistry() {
  const router = useRouter()
  const { t } = useI18n()
  const { canWrite } = useRoles()
  const [connectors, setConnectors] = useState<ConnectorStatus[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDisabled, setShowDisabled] = useState(false)
  const [toggling, setToggling] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await apiJson<ConnectorsResponse>('/connectors')
        if (!cancelled) setConnectors(response.connectors || [])
      } catch (err) {
        if (!cancelled) setError(err as ApiError)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    const handle = window.setInterval(load, 30_000)
    return () => {
      cancelled = true
      window.clearInterval(handle)
    }
  }, [])

  // toggleConnector flips the connector's membership in
  // connector_sources via the PATCH endpoint. Optimistic local
  // update — the status flips immediately, then a refresh from
  // /v1/connectors confirms.
  async function toggleConnector(connector: ConnectorStatus, enable: boolean) {
    setToggling(connector.name)
    setToggleError(null)
    try {
      const response = await apiFetch(`/config/connectors/${encodeURIComponent(connector.name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enable }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      // Optimistic: flip status locally so the card updates without
      // waiting for the polling interval.
      setConnectors((current) =>
        current.map((c) =>
          c.name === connector.name ? { ...c, status: enable ? 'configured' : 'disabled' } : c,
        ),
      )
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Toggle failed'
      setToggleError(`${connector.label || connector.name}: ${message}`)
    } finally {
      setToggling(null)
    }
  }

  // deleteConnector removes a row from the registry permanently.
  //
  // After the flat-instance migration, each connector row is its own
  // top-level entry in connector_settings (named either kind or
  // kind:slug). One DELETE wipes config + sources + telemetry for
  // exactly that row — no parent/instance juggling required.
  async function deleteConnector(connector: ConnectorStatus) {
    const label = connector.label || connector.name
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return

    setToggling(connector.name)
    setToggleError(null)
    try {
      const response = await apiFetch(`/config/connectors/${encodeURIComponent(connector.name)}`, {
        method: 'DELETE',
      })
      if (!response.ok && response.status !== 404) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || `${response.status} ${response.statusText}`)
      }
      // Drop the row optimistically so the UI reflects the delete
      // before the next /v1/connectors poll. The full list refresh
      // on the next tick re-syncs from server truth.
      setConnectors((current) => current.filter((c) => c.name !== connector.name))
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Delete failed'
      setToggleError(`${connector.label || connector.name}: ${message}`)
    } finally {
      setToggling(null)
    }
  }

  const activeConnectors = useMemo(
    () => connectors.filter((c) => (c.status ?? '').toLowerCase() !== 'disabled'),
    [connectors],
  )
  const visibleConnectors = useMemo(
    () => (showDisabled ? connectors : activeConnectors),
    [connectors, activeConnectors, showDisabled],
  )
  const activeCount = activeConnectors.length

  return (
    <>
      <Topbar
        title={t('connectors.title')}
        left={
          <Badge tone="blue">
            {t('connectors.summary_active', { active: activeCount })} ·{' '}
            {t('connectors.summary_disabled', { disabled: connectors.length - activeCount })}
          </Badge>
        }
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--color-text-tertiary)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={showDisabled}
                onChange={(e) => setShowDisabled(e.target.checked)}
              />
              {t('connectors.show_disabled')}
            </label>
            <PrimaryButton onClick={() => router.push('/connectors/new')}>
              <i className="ti ti-plus" aria-hidden="true" style={{ fontSize: 12 }} /> {t('connectors.add_button')}
            </PrimaryButton>
          </div>
        }
      />
      <div className="attestiv-content">
        {error ? (
          <Banner tone="error">{t('Failed to load connectors:', 'Failed to load connectors:')} {error.message}</Banner>
        ) : null}
        {toggleError ? (
          <Banner tone="error">{toggleError}</Banner>
        ) : null}

        {loading && connectors.length === 0 ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: 14,
            }}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Skeleton width={44} height={44} rounded={10} />
                  <Skeleton width={50} height={18} rounded={9} />
                </div>
                <Skeleton width="70%" height={14} />
                <div style={{ marginTop: 6 }}>
                  <Skeleton width="55%" height={11} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <Skeleton width="80%" height={11} />
                </div>
              </Card>
            ))}
          </div>
        ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 14,
          }}
        >
          {visibleConnectors.map((connector) => {
            const {
              t
            } = useI18n();

            const brandHex = connectorBrandHex(connector.name)
            const state = classifyConnector(connector)
            const isDisabled = (connector.status ?? '').toLowerCase() === 'disabled'
            const isToggling = toggling === connector.name
            return (
              <div
                key={connector.name}
                style={{
                  border: 'none',
                  borderLeft: `3px solid ${state.border}`,
                  borderRadius: 'var(--border-radius-lg)',
                  padding: '16px 18px',
                  background: 'var(--color-background-primary)',
                  boxShadow: 'var(--shadow-card)',
                  opacity: isDisabled ? 0.7 : 1,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: 12,
                  }}
                >
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: brandHex ? `${brandHex}14` : 'var(--color-background-tertiary)',
                    }}
                  >
                    <ConnectorLogo name={connector.name} size={28} />
                  </div>
                  <Badge tone={state.badge.tone}>{state.badge.label}</Badge>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 3 }}>
                  {connector.label || connector.name}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--color-text-tertiary)',
                    marginBottom: 8,
                  }}
                >
                  {categoryLabel(connector)}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color:
                      state.badge.tone === 'amber' || state.badge.tone === 'red'
                        ? 'var(--color-status-red-deep)'
                        : 'var(--color-text-secondary)',
                  }}
                >
                  {state.metrics}
                </div>
                {connector.connector_version ? (
                  <div
                    style={{
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--color-text-tertiary)',
                      marginTop: 6,
                    }}
                  >
                    {connector.connector_version}
                  </div>
                ) : null}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
                  {/* Disable / Enable only applies to bare catalog rows.
                     Instance rows (name = "palo_alto:new-fw-lan") have
                     no on/off state in the backend - the items[] entry
                     either exists or it doesn't. Hide the toggle on
                     instance rows so it can't 404. */}
                  {canWrite && !connector.name.includes(':') ? (
                    <GhostButton
                      onClick={() => toggleConnector(connector, isDisabled)}
                      disabled={isToggling}
                    >
                      <i
                        className={`ti ${isDisabled ? 'ti-toggle-left' : 'ti-toggle-right'}`}
                        aria-hidden="true"
                      />
                      {isToggling ? '…' : isDisabled ? t('common.enable') : t('common.disable')}
                    </GhostButton>
                  ) : null}
                  {/* Edit jumps into the wizard pre-populated with
                      the existing config. The same wizard handles
                      create + edit; the `edit=<row-name>` query
                      param toggles edit mode. */}
                  {canWrite ? (
                    <>
                      <GhostButton
                        onClick={() => router.push(`/connectors/new?edit=${encodeURIComponent(connector.name)}`)}
                        disabled={isToggling}
                      >
                        <i className="ti ti-edit" aria-hidden="true" />
                        {t('Edit', 'Edit')}
                      </GhostButton>
                      <GhostButton
                        onClick={() => deleteConnector(connector)}
                        disabled={isToggling}
                      >
                        <i className="ti ti-trash" aria-hidden="true" />
                        {t('common.delete')}
                      </GhostButton>
                    </>
                  ) : null}
                </div>
              </div>
            )
          })}

          {canWrite ? (
          <button
            type="button"
            onClick={() => router.push('/connectors/new')}
            style={{
              border: '0.5px dashed var(--color-border-secondary)',
              borderRadius: 'var(--border-radius-lg)',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 130,
              cursor: 'pointer',
              background: 'var(--color-background-secondary)',
              color: 'var(--color-text-tertiary)',
              fontFamily: 'inherit',
            }}
          >
            <i className="ti ti-plus" aria-hidden="true" style={{ fontSize: 22, marginBottom: 6 }} />
            <div style={{ fontSize: 12 }}>{t('connectors.add_card_label')}</div>
            <div style={{ fontSize: 10, marginTop: 2 }}>{t('connectors.add_card_sub', { count: 8 })}</div>
          </button>
          ) : null}
        </div>
        )}

        {!loading && connectors.length === 0 ? (
          <EmptyState
            icon="ti-plug-off"
            title={t('connectors.no_connectors_title')}
            description={t('connectors.no_connectors_sub')}
            action={
              <PrimaryButton onClick={() => router.push('/connectors/new')}>
                <i className="ti ti-plus" aria-hidden="true" /> {t('connectors.add_button')}
              </PrimaryButton>
            }
          />
        ) : null}
      </div>
    </>
  );
}
