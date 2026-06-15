'use client';
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Banner, Card } from '../components/AttestivUi'
import { oidcHandleCallback } from '../lib/auth'
import { setSessionMarker } from '../lib/session'

import { useI18n } from '../lib/i18n';

export function OidcCallbackPage() {
  const {
    t
  } = useI18n();

  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        await oidcHandleCallback()
        // The httpOnly session cookie is now minted by the backend;
        // set the route-guard marker so middleware lets us into the
        // console instead of bouncing back to /login.
        setSessionMarker()
        if (!cancelled) setDone(true)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (done) router.replace('/dashboard')
  }, [done, router])

  if (done) return null

  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '12vh 16px' }}>
      <Card>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, textAlign: 'center', minWidth: 280, padding: '8px 12px' }}>
          {error ? (
            <i className="ti ti-alert-triangle" aria-hidden="true" style={{ fontSize: 28, color: 'var(--color-status-red-mid, #c73030)' }} />
          ) : (
            <i className="ti ti-loader-2" aria-hidden="true" style={{ fontSize: 28, color: 'var(--color-status-blue-deep)', animation: 'attestiv-spin 1s linear infinite' }} />
          )}
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {error ? t('Sign-in failed', 'Sign-in failed') : t('Signing in…', 'Signing in…')}
          </div>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0, maxWidth: 360 }}>
            {error
              ? t('We could not complete the single sign-on flow.', 'We could not complete the single sign-on flow.')
              : t('Finishing the single sign-on flow and returning to the app.', 'Finishing the single sign-on flow and returning to the app.')}
          </p>
          {error ? (
            <div style={{ width: '100%', marginTop: 4 }}>
              <Banner tone="error">{error}</Banner>
              <div style={{ marginTop: 10 }}>
                <a href="/login" style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-status-blue-deep)', textDecoration: 'none' }}>
                  {t('Back to sign in', 'Back to sign in')} <i className="ti ti-arrow-right" aria-hidden="true" />
                </a>
              </div>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
