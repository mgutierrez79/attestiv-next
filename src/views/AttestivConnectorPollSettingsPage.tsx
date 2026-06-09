'use client'
// Settings ▸ Connector poll.
//
// Operator-facing knob for the connector poll loop's cadence. The two
// kill switches (COMPLIANCE_CONNECTOR_POLL_ENABLED and
// COMPLIANCE_CONNECTOR_POLL_IN_PROCESS) intentionally stay env-only —
// a global "stop polling" toggle in the UI is a foot-gun.
//
// Backend API:
//   GET /v1/settings/connector-poll  -> { interval_seconds, effective_seconds, env_default_seconds, source, poll_enabled, poll_in_process }
//   PUT /v1/settings/connector-poll  body: { interval_seconds }  (0 clears the override, falls back to env)

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type PollSettings = {
  interval_seconds: number
  effective_seconds: number
  env_default_seconds: number
  source: 'store' | 'env' | 'fallback'
  poll_enabled: boolean
  poll_in_process: boolean
}

export function AttestivConnectorPollSettingsPage() {
  const { t } = useI18n()
  const router = useRouter()
  const [settings, setSettings] = useState<PollSettings | null>(null)
  const [input, setInput] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const response = await apiFetch('/settings/connector-poll')
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
      }
      const body = (await response.json()) as PollSettings
      setSettings(body)
      // Seed the input with the stored override (0 => empty, so the
      // placeholder shows "uses env default" instead of a literal 0).
      setInput(body.interval_seconds > 0 ? String(body.interval_seconds) : '')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load connector poll settings')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function save(rawSeconds: number) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch('/settings/connector-poll', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval_seconds: rawSeconds }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
      }
      setSettings(body as PollSettings)
      setInput((body as PollSettings).interval_seconds > 0 ? String((body as PollSettings).interval_seconds) : '')
      setInfo(
        rawSeconds === 0
          ? t('Override cleared. The loop now uses the env default.', 'Override cleared. The loop now uses the env default.')
          : t('Saved. Next iteration will sleep for the new interval.', 'Saved. Next iteration will sleep for the new interval.'),
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save connector poll settings')
    } finally {
      setBusy(false)
    }
  }

  function onSave() {
    const parsed = input.trim() === '' ? 0 : Number(input)
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      setError(t('Interval must be a non-negative integer (0 clears the override).', 'Interval must be a non-negative integer (0 clears the override).'))
      return
    }
    if (parsed > 0 && parsed < 60) {
      setError(t('Interval must be 0 or at least 60 seconds.', 'Interval must be 0 or at least 60 seconds.'))
      return
    }
    if (parsed > 86400) {
      setError(t('Interval must be at most 86400 seconds (24h).', 'Interval must be at most 86400 seconds (24h).'))
      return
    }
    void save(parsed)
  }

  function onClear() {
    setInput('')
    void save(0)
  }

  return (
    <>
      <Topbar
        title={t('Connector poll', 'Connector poll')}
        left={<Badge tone="navy">{t('admin only', 'admin only')}</Badge>}
        right={
          <GhostButton onClick={() => router.push('/settings')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('Settings', 'Settings')}
          </GhostButton>
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {info ? <Banner tone="success">{info}</Banner> : null}
        {settings && !settings.poll_enabled ? (
          <Banner tone="warning" title={t('Poll loop is disabled', 'Poll loop is disabled')}>
            {t(
              'COMPLIANCE_CONNECTOR_POLL_ENABLED is 0 in the environment. Set it to 1 (and COMPLIANCE_CONNECTOR_POLL_IN_PROCESS to 1) and restart the API service for this interval to take effect.',
              'COMPLIANCE_CONNECTOR_POLL_ENABLED is 0 in the environment. Set it to 1 (and COMPLIANCE_CONNECTOR_POLL_IN_PROCESS to 1) and restart the API service for this interval to take effect.',
            )}
          </Banner>
        ) : null}

        <Card>
          <CardTitle>{t('Poll interval', 'Poll interval')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
            {t(
              'How often the API process polls every configured connector for telemetry. Lower values give fresher health data but more upstream load. Changes take effect on the next loop iteration — no restart needed.',
              'How often the API process polls every configured connector for telemetry. Lower values give fresher health data but more upstream load. Changes take effect on the next loop iteration — no restart needed.',
            )}
          </p>

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <input
              type="number"
              min={0}
              max={86400}
              step={60}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={settings ? `${t('env default', 'env default')}: ${settings.env_default_seconds}` : ''}
              disabled={busy}
              style={{
                width: 160,
                padding: '6px 8px',
                border: '1px solid var(--color-border-secondary)',
                borderRadius: 'var(--border-radius-md)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                background: 'var(--color-background-primary)',
                color: 'var(--color-text-primary)',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{t('seconds', 'seconds')}</span>
            <div style={{ flex: 1 }} />
            <PrimaryButton onClick={onSave} disabled={busy}>
              <i className="ti ti-device-floppy" aria-hidden="true" /> {t('Save', 'Save')}
            </PrimaryButton>
            <GhostButton onClick={onClear} disabled={busy || (settings ? settings.interval_seconds === 0 : true)}>
              <i className="ti ti-x" aria-hidden="true" /> {t('Clear override', 'Clear override')}
            </GhostButton>
          </div>

          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
            {t('Min 60s, max 86400s (24h). Leave blank or set to 0 to use the env default.', 'Min 60s, max 86400s (24h). Leave blank or set to 0 to use the env default.')}
          </div>
        </Card>

        {settings ? (
          <Card>
            <CardTitle>{t('Current state', 'Current state')}</CardTitle>
            <KV label={t('Effective interval', 'Effective interval')} value={`${settings.effective_seconds}s`} />
            <KV
              label={t('Source', 'Source')}
              value={
                settings.source === 'store'
                  ? t('store override', 'store override')
                  : settings.source === 'env'
                    ? t('env default', 'env default')
                    : t('fallback (6h)', 'fallback (6h)')
              }
            />
            <KV label={t('Env default', 'Env default')} value={`${settings.env_default_seconds}s`} />
            <KV
              label={t('Loop enabled', 'Loop enabled')}
              value={settings.poll_enabled ? t('yes', 'yes') : t('no', 'no')}
            />
            <KV
              label={t('In-process worker', 'In-process worker')}
              value={settings.poll_in_process ? t('yes', 'yes') : t('no', 'no')}
            />
          </Card>
        ) : null}
      </div>
    </>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12 }}>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}
