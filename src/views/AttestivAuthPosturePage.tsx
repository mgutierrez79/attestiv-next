'use client';
// Settings ▸ Auth posture — one page that answers the three
// questions every auditor asks before reviewing controls:
//
//   1. SSO: are users signing in via the customer IdP, or
//      relying on local API keys?
//   2. MFA: is multi-factor enforced (today: rely on the IdP)?
//   3. SoD: can the same user both create AND approve a record?
//      (mode=enforce blocks; audit_only logs; disabled bypasses)
//
// Every line on this page is read directly from
// /v1/settings/auth-posture. Operators don't change posture here —
// it's a snapshot. Changes happen via env vars (SoD mode) or the
// OIDC configuration on the IdP side.

import { useEffect, useState } from 'react'
import {
  Badge,
  Banner,
  Card,
  CardTitle,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'

import { useI18n } from '../lib/i18n'

type Flow = {
  flow: string
  enforced: boolean
  since?: string
  reason?: string
}

type Posture = {
  sso: {
    oidc_configured: boolean
    oidc_issuer?: string
    oidc_audience?: string
    oidc_client_id?: string
    local_auth_enabled: boolean
    api_key_count: number
    auth_enabled: boolean
    dev_mode: boolean
  }
  mfa: {
    required_via_idp: boolean
    reason?: string
    admin_api_key_count?: number
    admin_api_keys_bypass_mfa?: boolean
    admin_api_keys_blocked_by_mfa?: boolean
    admin_api_key_warning?: string
  }
  sod: {
    mode: 'enforce' | 'audit_only' | 'disabled' | string
    healthy: boolean
    flows: Flow[]
  }
  profile?: string
  demo?: boolean
  healthy: boolean
}

export function AttestivAuthPosturePage() {
  const { t } = useI18n()
  const [posture, setPosture] = useState<Posture | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch('/settings/auth-posture')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status}`))))
      .then((b: Posture) => {
        if (!cancelled) setPosture(b)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load auth posture')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <Topbar
        title={t('Auth posture', 'Auth posture')}
        left={
          posture ? (
            posture.healthy ? (
              <Badge tone="green">{t('Production-grade', 'Production-grade')}</Badge>
            ) : (
              <Badge tone="amber">{t('Pilot / bootstrap', 'Pilot / bootstrap')}</Badge>
            )
          ) : null
        }
      />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}

        <Banner tone="info" title={t('Why this page exists', 'Why this page exists')}>
          {t(
            'The three questions every auditor asks before reviewing controls: how do users sign in (SSO), is MFA required, and can one person both create and approve a record (Segregation of Duties). This page reports each one with the exact configuration line that controls it — no inference, no marketing claims.',
            'The three questions every auditor asks before reviewing controls: how do users sign in (SSO), is MFA required, and can one person both create and approve a record (Segregation of Duties). This page reports each one with the exact configuration line that controls it — no inference, no marketing claims.',
          )}
        </Banner>

        {loading ? (
          <Skeleton lines={10} height={32} />
        ) : !posture ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>
            {t('No posture data', 'No posture data')}
          </div>
        ) : (
          <>
            <Card style={{ marginTop: 10 }}>
              <CardTitle
                right={
                  <Badge tone={posture.demo ? 'amber' : posture.profile === 'production' ? 'green' : 'gray'}>
                    {posture.profile ? posture.profile : t('unset', 'unset')}
                  </Badge>
                }
              >
                {t('Deployment profile', 'Deployment profile')}
              </CardTitle>
              <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                {t(
                  'COMPLIANCE_PROFILE sets the auth + demo posture coherently (dev = no auth; demo = real auth + fabricated demo data; production = real auth, real data). Individual env vars override it. "unset" means each flag uses its own default.',
                  'COMPLIANCE_PROFILE sets the auth + demo posture coherently (dev = no auth; demo = real auth + fabricated demo data; production = real auth, real data). Individual env vars override it. "unset" means each flag uses its own default.',
                )}
              </p>
              {posture.demo ? (
                <Banner tone="warning">
                  {t(
                    'Demo data is ON — the UI may fabricate sample findings/rows. Never run a real customer in demo profile.',
                    'Demo data is ON — the UI may fabricate sample findings/rows. Never run a real customer in demo profile.',
                  )}
                </Banner>
              ) : null}
            </Card>

            <Card style={{ marginTop: 10 }}>
              <CardTitle
                right={
                  posture.sso.oidc_configured ? (
                    <Badge tone="green">OIDC</Badge>
                  ) : posture.sso.api_key_count > 0 ? (
                    <Badge tone="amber">API keys</Badge>
                  ) : (
                    <Badge tone="red">{t('No auth', 'No auth')}</Badge>
                  )
                }
              >
                {t('Single sign-on (SSO)', 'Single sign-on (SSO)')}
              </CardTitle>
              <table style={tableStyle}>
                <tbody>
                  <Row label={t('Auth enabled', 'Auth enabled')} value={posture.sso.auth_enabled ? 'yes' : 'NO'} />
                  <Row label={t('OIDC configured', 'OIDC configured')} value={posture.sso.oidc_configured ? 'yes' : 'no'} />
                  {posture.sso.oidc_issuer ? <Row label={t('OIDC issuer', 'OIDC issuer')} value={posture.sso.oidc_issuer} /> : null}
                  {posture.sso.oidc_audience ? <Row label={t('OIDC audience', 'OIDC audience')} value={posture.sso.oidc_audience} /> : null}
                  {posture.sso.oidc_client_id ? <Row label={t('OIDC client ID', 'OIDC client ID')} value={posture.sso.oidc_client_id} /> : null}
                  <Row label={t('Local auth enabled', 'Local auth enabled')} value={posture.sso.local_auth_enabled ? 'yes' : 'no'} />
                  <Row label={t('API keys configured', 'API keys configured')} value={`${posture.sso.api_key_count}`} />
                  <Row label={t('Dev mode', 'Dev mode')} value={posture.sso.dev_mode ? 'yes' : 'no'} tone={posture.sso.dev_mode ? 'amber' : undefined} />
                </tbody>
              </table>
            </Card>

            <Card style={{ marginTop: 10 }}>
              <CardTitle right={posture.mfa.required_via_idp ? <Badge tone="green">{t('required', 'required')}</Badge> : <Badge tone="amber">{t('rely on IdP', 'rely on IdP')}</Badge>}>
                {t('Multi-factor authentication (MFA)', 'Multi-factor authentication (MFA)')}
              </CardTitle>
              <table style={tableStyle}>
                <tbody>
                  <Row label={t('Enforced via IdP claim', 'Enforced via IdP claim')} value={posture.mfa.required_via_idp ? 'yes' : 'no'} />
                  <Row
                    label={t('Admin API keys', 'Admin API keys')}
                    value={`${posture.mfa.admin_api_key_count ?? 0}`}
                    tone={posture.mfa.admin_api_keys_bypass_mfa ? 'amber' : undefined}
                  />
                  {posture.mfa.admin_api_keys_blocked_by_mfa ? (
                    <Row label={t('Static admin keys', 'Static admin keys')} value={t('blocked under MFA', 'blocked under MFA')} />
                  ) : null}
                  {posture.mfa.reason ? <Row label={t('Note', 'Note')} value={posture.mfa.reason} /> : null}
                </tbody>
              </table>
              {posture.mfa.admin_api_keys_bypass_mfa && posture.mfa.admin_api_key_warning ? (
                <Banner tone="warning">{posture.mfa.admin_api_key_warning}</Banner>
              ) : null}
            </Card>

            <Card style={{ marginTop: 10 }}>
              <CardTitle
                right={
                  posture.sod.mode === 'enforce' ? (
                    <Badge tone="green">{t('enforce', 'enforce')}</Badge>
                  ) : posture.sod.mode === 'audit_only' ? (
                    <Badge tone="amber">{t('audit_only', 'audit_only')}</Badge>
                  ) : (
                    <Badge tone="red">{t('disabled', 'disabled')}</Badge>
                  )
                }
              >
                {t('Segregation of Duties (SoD)', 'Segregation of Duties (SoD)')}
              </CardTitle>
              <p style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 4 }}>
                {t(
                  'A user cannot both create AND approve a record. SOX / GxP / SOC2 all require this. Mode is controlled by COMPLIANCE_SOD_MODE: enforce (block), audit_only (log only — bootstrap with a single admin), disabled (pilot/test only).',
                  'A user cannot both create AND approve a record. SOX / GxP / SOC2 all require this. Mode is controlled by COMPLIANCE_SOD_MODE: enforce (block), audit_only (log only — bootstrap with a single admin), disabled (pilot/test only).',
                )}
              </p>
              <table style={{ ...tableStyle, marginTop: 8 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-tertiary)', fontSize: 11 }}>
                    <th style={cellHeaderStyle}>{t('Flow', 'Flow')}</th>
                    <th style={cellHeaderStyle}>{t('Enforced', 'Enforced')}</th>
                    <th style={cellHeaderStyle}>{t('Note', 'Note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {posture.sod.flows.map((f) => (
                    <tr key={f.flow} style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
                      <td style={cellStyle}><code style={{ fontSize: 11 }}>{f.flow}</code></td>
                      <td style={cellStyle}>
                        {f.enforced ? <Badge tone="green">yes</Badge> : <Badge tone="gray">no</Badge>}
                      </td>
                      <td style={{ ...cellStyle, color: 'var(--color-text-tertiary)' }}>
                        {f.enforced ? (f.since ? `${t('since', 'since')} ${f.since}` : '') : f.reason || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </>
        )}
      </div>
    </>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'amber' | 'red' }) {
  return (
    <tr style={{ borderTop: '0.5px solid var(--color-border-tertiary)' }}>
      <td style={{ ...cellStyle, color: 'var(--code-text-tertiary)', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, width: 220 }}>
        {label}
      </td>
      <td style={{ ...cellStyle, color: tone === 'amber' ? 'var(--color-status-amber-mid)' : tone === 'red' ? 'var(--color-status-red-mid)' : 'var(--color-text-primary)' }}>
        <code style={{ fontSize: 12 }}>{value}</code>
      </td>
    </tr>
  )
}

const tableStyle: React.CSSProperties = { width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 4 }
const cellHeaderStyle: React.CSSProperties = { padding: '6px 8px', fontWeight: 500, textTransform: 'uppercase', letterSpacing: 0.4 }
const cellStyle: React.CSSProperties = { padding: '8px', fontSize: 12, verticalAlign: 'top' }
