import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts'
import { loadSettings } from './settings'
import { setServerDemo } from './demoMode'

// Auth configuration is OWNED BY THE SERVER, not the browser. The login
// page and the OIDC client read it from /v1/public/auth-config instead
// of asking the user to type an issuer/client_id (which used to live in
// localStorage). None of it is secret — the client_id ships in the
// bundle and the issuer is the IdP's public well-known URL.
export type AuthConfig = {
  local_auth_enabled: boolean
  oidc_configured: boolean
  oidc_issuer: string
  oidc_client_id: string
  oidc_scope: string
  idp_name: string
  default_tenant: string
  single_tenant: boolean
  auth_enabled: boolean
  dev_mode: boolean
  // profile: named deployment posture (dev / demo / production / "").
  profile: string
  // demo: server-authoritative demo-data switch (Profile=demo).
  demo: boolean
}

function apiBase(): string {
  const base = loadSettings().apiBaseUrl?.trim()?.replace(/\/+$/, '')
  return base || '/api'
}

let _configPromise: Promise<AuthConfig> | null = null

// fetchAuthConfig caches the result for the page lifetime; pass force to
// re-fetch (e.g. after an admin changes the IdP and the operator reloads).
export async function fetchAuthConfig(force = false): Promise<AuthConfig> {
  if (_configPromise && !force) return _configPromise
  _configPromise = (async () => {
    const res = await fetch(`${apiBase()}/v1/public/auth-config`, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
    if (!res.ok) throw new Error(`auth-config request failed: ${res.status}`)
    const cfg = (await res.json()) as AuthConfig
    // Make the demo-data gate server-authoritative: cache the backend's
    // demo posture so isDemoMode() reflects COMPLIANCE_PROFILE, not a
    // per-browser localStorage value.
    setServerDemo(Boolean(cfg.demo))
    return cfg
  })()
  return _configPromise
}

function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

let _managerPromise: Promise<UserManager> | null = null

async function buildOidcManager(): Promise<UserManager> {
  const config = await fetchAuthConfig()
  if (!config.oidc_configured) {
    throw new Error('SSO is not configured on this server.')
  }
  const issuer = normalizeIssuer(config.oidc_issuer)
  // redirect_uri is derived from the live browser origin so it always
  // matches the URL the user is actually on (the registered SPA URI in
  // the IdP must equal <origin>/auth/callback).
  const redirectUri = `${window.location.origin}/auth/callback`
  const postLogoutRedirectUri = `${window.location.origin}/login`

  // sessionStorage (not localStorage) so the IdP token isn't persisted
  // across browser restarts — the credential of record is the httpOnly
  // session cookie minted by /v1/auth/oidc/exchange.
  return new UserManager({
    authority: issuer,
    client_id: config.oidc_client_id.trim(),
    redirect_uri: redirectUri,
    post_logout_redirect_uri: postLogoutRedirectUri,
    response_type: 'code',
    scope: config.oidc_scope.trim() || 'openid profile email',
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
    loadUserInfo: true,
  })
}

async function oidcManager(): Promise<UserManager> {
  if (_managerPromise) return _managerPromise
  _managerPromise = buildOidcManager()
  return _managerPromise
}

export async function oidcSignIn(): Promise<void> {
  const manager = await oidcManager()
  await manager.clearStaleState()
  await manager.signinRedirect()
}

export async function oidcHandleCallback(): Promise<User> {
  const manager = await oidcManager()
  const user = await manager.signinRedirectCallback()
  // Trade the IdP token for a server session cookie, then drop the OIDC
  // user so nothing falls back to sending the IdP token as a Bearer.
  await exchangeOidcTokenForSession(user)
  await manager.removeUser()
  return user
}

async function exchangeOidcTokenForSession(user: User): Promise<void> {
  const token = user.id_token ?? user.access_token
  if (!token) return
  const response = await fetch(`${apiBase()}/v1/auth/oidc/exchange`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    credentials: 'include',
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `OIDC exchange failed: ${response.status}`)
  }
}

export async function oidcSignOut(): Promise<void> {
  const manager = await oidcManager()
  const user = await manager.getUser()
  if (!user) {
    await manager.removeUser()
    return
  }
  await manager.signoutRedirect()
}

export async function oidcAccessToken(): Promise<string | null> {
  const manager = await oidcManager()
  const user = await manager.getUser()
  if (!user || user.expired) return null
  return user.access_token
}
