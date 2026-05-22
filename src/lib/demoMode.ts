// Demo-mode gate.
//
// Several console pages used to fall back to hard-coded `DEMO_X`
// fixtures whenever the API returned no rows yet — useful for
// screenshots and prospect demos, dangerous in a pilot or
// production environment where an empty list is meaningful (it
// might be the difference between "no DLQ entries" and "we're
// quietly faking your audit trail").
//
// Pilot operators explicitly asked: fabricated rows must never
// appear in pilot or production. So every page that wants to
// show a demo fixture now gates the fallback behind
// `isDemoMode()`, which reads the tenant profile.
//
// The profile lives in localStorage today under PROFILE_KEY and
// carries `environment: 'demo' | 'pilot' | 'production'`. Pilot
// is the default; only an explicit `demo` value unlocks the
// fallback.
//
// Why a tiny shared module rather than checking `loadSettings()`
// in every page:
//   1. The profile key is canonical and a single source-of-truth
//      means changing the storage shape later touches one file.
//   2. SSR safety — `localStorage` is undefined on the server, so
//      the check has to early-return there or the page crashes.
//      Centralising the guard prevents copy-paste mistakes.

const PROFILE_KEY = 'compliantly.tenant.profile'
// Server-authoritative demo flag, cached from /v1/public/auth-config
// (COMPLIANCE_PROFILE=demo). When the server has spoken, it overrides the
// per-browser tenant profile — so a production deployment can never be
// flipped into showing fabricated data by a stray localStorage value.
const SERVER_DEMO_KEY = 'compliantly.server.demo'

export type TenantEnvironment = 'demo' | 'pilot' | 'production'

// setServerDemo records the server's demo posture (called once
// auth-config loads). Persisted so the gate is correct on the next
// render before auth-config re-fetches. SSR-safe.
export function setServerDemo(demo: boolean): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SERVER_DEMO_KEY, demo ? '1' : '0')
  } catch {
    // ignore storage failures (private mode, quota)
  }
}

// readServerDemo returns the cached server demo flag, or null when the
// server hasn't been heard from yet (SSR, or before first auth-config).
function readServerDemo(): boolean | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(SERVER_DEMO_KEY)
    if (raw === '1') return true
    if (raw === '0') return false
    return null
  } catch {
    return null
  }
}

// readEnvironment returns the persisted environment string or the
// safe default ('pilot') when:
//   - we're running server-side (no localStorage),
//   - the key isn't present,
//   - the stored JSON is malformed,
//   - the stored value isn't one of the three known modes.
//
// Pilot is the default because the previous behaviour was "show
// demo data when the API is empty," which we now treat as a
// regression on real deployments. Defaulting to pilot suppresses
// demo data unless someone deliberately opts in via the Tenant
// Settings page or by editing the profile directly.
export function readEnvironment(): TenantEnvironment {
  if (typeof window === 'undefined') return 'pilot'
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY)
    if (!raw) return 'pilot'
    const profile = JSON.parse(raw) as { environment?: unknown }
    const value = profile?.environment
    if (value === 'demo' || value === 'pilot' || value === 'production') return value
    return 'pilot'
  } catch {
    return 'pilot'
  }
}

// isDemoMode is the predicate every page should call before
// populating a DEMO_X fixture or flipping a `usingDemo` flag.
//
// Server-authoritative: when the backend has declared its demo posture
// (COMPLIANCE_PROFILE=demo, surfaced via auth-config), that wins — a
// production server forces demo OFF regardless of any local profile, and
// a demo server forces it ON. Only when the server hasn't been heard
// from do we fall back to the per-browser tenant profile.
export function isDemoMode(): boolean {
  const server = readServerDemo()
  if (server !== null) return server
  return readEnvironment() === 'demo'
}
