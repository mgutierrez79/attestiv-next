'use client'
// Settings ▸ Scoring poll.
//
// Operator-facing knobs for the background scoring evaluator: an
// interval slider AND an enable/disable toggle. Both are stored
// overrides; clearing either falls back to the env default
// (ATTESTIV_SCORING_POLL_ENABLED / ATTESTIV_SCORING_POLL_INTERVAL_SECONDS).
//
// Backend API:
//   GET /v1/settings/scoring-poll
//   PUT /v1/settings/scoring-poll  body: { interval_seconds?, enabled? }
//     interval_seconds=0 → clear override (env default wins)
//     enabled=null       → clear override (env default wins)

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
  enabled: boolean
  enabled_override: '' | 'true' | 'false'
  enabled_env_default: boolean
  enabled_source: 'store' | 'env'
}

export function AttestivScoringPollSettingsPage() {
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
      const response = await apiFetch('/settings/scoring-poll')
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.detail || body?.error || `${response.status} ${response.statusText}`)
      }
      const body = (await response.json()) as PollSettings
      setSettings(body)
      setInput(body.interval_seconds > 0 ? String(body.interval_seconds) : '')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load scoring poll settings')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function save(body: Record<string, unknown>, successMessage: string) {
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      const response = await apiFetch('/settings/scoring-poll', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const responseBody = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(responseBody?.detail || responseBody?.error || `${response.status} ${response.statusText}`)
      }
      const next = responseBody as PollSettings
      setSettings(next)
      setInput(next.interval_seconds > 0 ? String(next.interval_seconds) : '')
      setInfo(successMessage)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save scoring poll settings')
    } finally {
      setBusy(false)
    }
  }

  function onSaveInterval() {
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
    void save(
      { interval_seconds: parsed },
      parsed === 0
        ? t('Override cleared. The loop now uses the env default.', 'Override cleared. The loop now uses the env default.')
        : t('Saved. Next iteration will sleep for the new interval.', 'Saved. Next iteration will sleep for the new interval.'),
    )
  }

  function onClearInterval() {
    setInput('')
    void save({ interval_seconds: 0 }, t('Override cleared.', 'Override cleared.'))
  }

  function onToggleEnabled(next: boolean) {
    void save(
      { enabled: next },
      next
        ? t('Scoring scheduler enabled.', 'Scoring scheduler enabled.')
        : t('Scoring scheduler paused. The loop sleeps without evaluating.', 'Scoring scheduler paused. The loop sleeps without evaluating.'),
    )
  }

  function onClearEnabledOverride() {
    void save({ enabled: null }, t('Enable override cleared. Falls back to env default.', 'Enable override cleared. Falls back to env default.'))
  }

  return (
    <>
      <Topbar
        title={t('Scoring poll', 'Scoring poll')}
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

        <Card>
          <CardTitle>{t('Enable scoring scheduler', 'Enable scoring scheduler')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
            {t(
              'When enabled, every framework is re-evaluated against the latest collected evidence at the interval below. Disable to pause the loop without losing the configured interval.',
              'When enabled, every framework is re-evaluated against the latest collected evidence at the interval below. Disable to pause the loop without losing the configured interval.',
            )}
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
            <Badge tone={settings?.enabled ? 'green' : 'gray'}>
              {settings?.enabled ? t('enabled', 'enabled') : t('disabled', 'disabled')}
            </Badge>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {settings
                ? settings.enabled_source === 'store'
                  ? t('via store override', 'via store override')
                  : t('via env default', 'via env default')
                : ''}
            </span>
            <div style={{ flex: 1 }} />
            {settings?.enabled ? (
              <GhostButton onClick={() => onToggleEnabled(false)} disabled={busy}>
                <i className="ti ti-player-pause" aria-hidden="true" /> {t('Pause', 'Pause')}
              </GhostButton>
            ) : (
              <PrimaryButton onClick={() => onToggleEnabled(true)} disabled={busy}>
                <i className="ti ti-player-play" aria-hidden="true" /> {t('Enable', 'Enable')}
              </PrimaryButton>
            )}
            <GhostButton
              onClick={onClearEnabledOverride}
              disabled={busy || !settings || settings.enabled_override === ''}
            >
              <i className="ti ti-x" aria-hidden="true" /> {t('Clear override', 'Clear override')}
            </GhostButton>
          </div>
        </Card>

        <Card>
          <CardTitle>{t('Poll interval', 'Poll interval')}</CardTitle>
          <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 0 }}>
            {t(
              'How often the scoring engine re-evaluates every framework. Lower values give fresher scores but more CPU load per pilot. Changes take effect on the next loop iteration — no restart needed.',
              'How often the scoring engine re-evaluates every framework. Lower values give fresher scores but more CPU load per pilot. Changes take effect on the next loop iteration — no restart needed.',
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
            <PrimaryButton onClick={onSaveInterval} disabled={busy}>
              <i className="ti ti-device-floppy" aria-hidden="true" /> {t('Save', 'Save')}
            </PrimaryButton>
            <GhostButton onClick={onClearInterval} disabled={busy || (settings ? settings.interval_seconds === 0 : true)}>
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
                    : t('fallback (1h)', 'fallback (1h)')
              }
            />
            <KV label={t('Env default interval', 'Env default interval')} value={`${settings.env_default_seconds}s`} />
            <KV label={t('Loop enabled', 'Loop enabled')} value={settings.enabled ? t('yes', 'yes') : t('no', 'no')} />
            <KV
              label={t('Enable source', 'Enable source')}
              value={settings.enabled_source === 'store' ? t('store override', 'store override') : t('env default', 'env default')}
            />
            <KV
              label={t('Env default enabled', 'Env default enabled')}
              value={settings.enabled_env_default ? t('yes', 'yes') : t('no', 'no')}
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
