'use client';
// Attestiv login.
//
// The page is intentionally thin: authentication CONFIGURATION (OIDC
// issuer/client, which methods are enabled, the tenant) is owned by the
// server and fetched from /v1/public/auth-config. The user never types
// an issuer or client ID — they just see a username/password form
// (local) and/or a "Sign in with <IdP>" button (SSO). An API-key path
// is kept for automation behind an "Advanced" toggle.

import type { FormEvent, ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Card, FormField, PrimaryButton, TextInput } from '../components/AttestivUi'
import { loadSettings, saveSettings } from '../lib/settings'
import { setSessionMarker } from '../lib/session'
import { oidcSignIn, fetchAuthConfig, type AuthConfig } from '../lib/auth'

import { useI18n } from '../lib/i18n'

export function AttestivLoginPage() {
  const { t } = useI18n()
  const router = useRouter()

  const [config, setConfig] = useState<AuthConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  const [localSubject, setLocalSubject] = useState('')
  const [localPassword, setLocalPassword] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  useEffect(() => {
    fetchAuthConfig(true)
      .then(setConfig)
      .catch((e) => setConfigError(e instanceof Error ? e.message : String(e)))
  }, [])

  function apiBase(): string {
    const base = loadSettings().apiBaseUrl?.trim()?.replace(/\/+$/, '')
    return base || '/api'
  }

  // Persist the resolved tenant from the server so api.ts sends the
  // right X-Tenant-ID (OIDC tokens carry no tenant claim).
  function persist(authMode: 'local' | 'oidc' | 'apiKey', key = '') {
    const current = loadSettings()
    saveSettings({
      ...current,
      authMode,
      apiKey: key,
      localToken: '',
      tenantId: config?.default_tenant || current.tenantId,
    })
  }

  function redirectTarget(): string {
    if (typeof window === 'undefined') return '/dashboard'
    const search = new URLSearchParams(window.location.search)
    const next = search.get('next')
    if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login')) {
      return next
    }
    return '/dashboard'
  }

  async function onLocalSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setInfo(null)
    if (!localSubject.trim() || !localPassword) {
      setError(t('Username and password are required.', 'Username and password are required.'))
      return
    }
    setBusy(true)
    try {
      const response = await fetch(`${apiBase()}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: localSubject.trim(), password: localPassword }),
        // The server sets an httpOnly session cookie on success;
        // credentials:'include' is what lets the browser store it.
        credentials: 'include',
      })
      if (!response.ok) {
        const bodyText = await response.text().catch(() => '')
        throw new Error(bodyText || `${response.status} ${response.statusText}`)
      }
      persist('local')
      setSessionMarker()
      setInfo(t('Signed in. Redirecting…', 'Signed in. Redirecting…'))
      router.push(redirectTarget())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local login failed')
    } finally {
      setBusy(false)
    }
  }

  async function onSsoSignIn() {
    setError(null)
    setInfo(null)
    // Persist tenant + mode BEFORE redirecting so the post-callback
    // session sends the right X-Tenant-ID. The OIDC issuer/client come
    // from the server (lib/auth → /v1/public/auth-config), not here.
    persist('oidc')
    setInfo(t('Redirecting to your identity provider…', 'Redirecting to your identity provider…'))
    try {
      await oidcSignIn()
    } catch (e) {
      setError(`Could not start SSO sign-in: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function onApiKeySubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setInfo(null)
    if (!apiKey.trim()) {
      setError(t('API key is required.', 'API key is required.'))
      return
    }
    persist('apiKey', apiKey.trim())
    setSessionMarker()
    setInfo(t('Saved. Redirecting…', 'Saved. Redirecting…'))
    router.push(redirectTarget())
  }

  const idp = config?.idp_name || 'SSO'
  const showLocal = config?.local_auth_enabled
  const showSso = config?.oidc_configured
  const devMode = config ? (config.dev_mode || !config.auth_enabled) : false

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--color-background-tertiary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        <BrandHeader />

        <Card style={{ padding: '22px 24px' }}>
          {configError ? (
            <Banner tone="red">
              {t('Could not reach the server to load sign-in options:', 'Could not reach the server to load sign-in options:')}{' '}
              {configError}
            </Banner>
          ) : null}

          {!config && !configError ? (
            <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '8px 0' }}>
              {t('Loading sign-in options…', 'Loading sign-in options…')}
            </div>
          ) : null}

          {devMode ? (
            <Banner tone="blue">
              {t(
                'Authentication is disabled on this server (dev mode) — anyone reaching it has full access.',
                'Authentication is disabled on this server (dev mode) — anyone reaching it has full access.'
              )}
            </Banner>
          ) : null}

          {showSso ? (
            <button
              type="button"
              onClick={onSsoSignIn}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 14px',
                fontSize: 14,
                fontWeight: 500,
                fontFamily: 'inherit',
                cursor: 'pointer',
                border: 'none',
                borderRadius: 'var(--border-radius-md)',
                background: 'var(--color-brand-blue)',
                color: 'white',
                marginBottom: showLocal ? 8 : 0,
              }}
            >
              <i className="ti ti-id" aria-hidden="true" />
              {t('Sign in with', 'Sign in with')} {idp}
            </button>
          ) : null}

          {showSso && showLocal ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                margin: '14px 0',
                color: 'var(--color-text-tertiary)',
                fontSize: 11,
              }}
            >
              <div style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
              {t('or', 'or')}
              <div style={{ flex: 1, height: 1, background: 'var(--color-border-subtle)' }} />
            </div>
          ) : null}

          {showLocal ? (
            <form onSubmit={onLocalSubmit}>
              <FormField label={t('Username', 'Username')}>
                <TextInput
                  value={localSubject}
                  onChange={(event) => setLocalSubject(event.target.value)}
                  placeholder={t('you@company.com', 'you@company.com')}
                  autoComplete="username"
                />
              </FormField>
              <FormField label={t('Password', 'Password')}>
                <TextInput
                  type="password"
                  value={localPassword}
                  onChange={(event) => setLocalPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              </FormField>
              <SubmitRow busy={busy} label={t('Sign in', 'Sign in')} />
            </form>
          ) : null}

          {config && !showLocal && !showSso ? (
            <Banner tone="red">
              {t(
                'No sign-in method is enabled. An administrator must enable local auth or configure SSO.',
                'No sign-in method is enabled. An administrator must enable local auth or configure SSO.'
              )}
            </Banner>
          ) : null}

          {/* Automation / break-glass only — not a normal user path. */}
          <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border-subtle)', paddingTop: 10 }}>
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 11,
                color: 'var(--color-text-tertiary)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: 0,
              }}
            >
              <i className={`ti ${showAdvanced ? 'ti-chevron-down' : 'ti-chevron-right'}`} aria-hidden="true" />
              {t('Advanced: sign in with an API key (automation)', 'Advanced: sign in with an API key (automation)')}
            </button>
            {showAdvanced ? (
              <form onSubmit={onApiKeySubmit} style={{ marginTop: 10 }}>
                <FormField label={t('API key (Bearer)', 'API key (Bearer)')}>
                  <TextInput
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={t('key-admin / key-reporter / …', 'key-admin / key-reporter / …')}
                  />
                </FormField>
                <SubmitRow busy={busy} label={t('Save and continue', 'Save and continue')} />
              </form>
            ) : null}
          </div>

          {error ? <Banner tone="red" mt={12}>{error}</Banner> : null}
          {info ? <Banner tone="blue" mt={8}>{info}</Banner> : null}
        </Card>

        {config && !config.single_tenant ? (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-tertiary)',
              textAlign: 'center',
              marginTop: 14,
              lineHeight: 1.5,
            }}
          >
            {t('New tenant?', 'New tenant?')}{' '}
            <a
              href="/onboarding"
              style={{ color: 'var(--color-brand-blue)', textDecoration: 'none', fontWeight: 500 }}
            >
              {t('Run first-time setup', 'Run first-time setup')}
            </a>.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Banner({ tone, mt, children }: { tone: 'red' | 'blue'; mt?: number; children: ReactNode }) {
  const red = tone === 'red'
  return (
    <div
      style={{
        marginTop: mt ?? 0,
        marginBottom: mt ? 0 : 12,
        fontSize: 12,
        color: red ? 'var(--color-status-red-deep)' : 'var(--color-status-blue-deep)',
        background: red ? 'var(--color-status-red-bg)' : 'var(--color-status-blue-bg)',
        padding: '8px 10px',
        borderRadius: 'var(--border-radius-md)',
      }}
    >
      {children}
    </div>
  )
}

function BrandHeader() {
  const { t } = useI18n()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 12,
          background: 'var(--color-brand-navy)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
        }}
      >
        <i className="ti ti-shield-check" aria-hidden="true" style={{ color: 'var(--color-brand-blue-pale)', fontSize: 28 }} />
      </div>
      <div style={{ fontSize: 20, fontWeight: 500, color: 'var(--color-text-primary)' }}>{t('Attestiv', 'Attestiv')}</div>
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 2 }}>
        {t('Sign in to the compliance console', 'Sign in to the compliance console')}
      </div>
    </div>
  )
}

function SubmitRow({ busy, label }: { busy: boolean; label: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? 'Working…' : label}
        <i className="ti ti-arrow-right" aria-hidden="true" />
      </PrimaryButton>
    </div>
  )
}
