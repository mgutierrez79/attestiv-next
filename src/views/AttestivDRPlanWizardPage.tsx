'use client'
// DR Plan wizard — per-site detail view. The "wizard" framing is
// a guided layered narrative: global strategy at the top, then
// network → storage → virtualization → backup, each with the
// observed signals + concrete recommendations + a "test this layer"
// button. Ransomware readiness is a cross-cutting card.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  GhostButton,
  PrimaryButton,
  Skeleton,
  Topbar,
} from '../components/AttestivUi'
import { apiFetch } from '../lib/api'
import { useI18n } from '../lib/i18n'

type LayerReport = {
  status: 'ok' | 'warning' | 'critical' | 'absent'
  summary: string
  signals?: Record<string, unknown>
  recommendations?: string[]
  testable_scenarios?: string[]
}

type DRPlan = {
  site_id: string
  site_name: string
  generated_at: string
  global_strategy: string
  global_summary: string
  dr_site_pair?: string
  ransomware_readiness: {
    score: number
    immutable_storage: boolean
    immutable_backup: boolean
    air_gapped_backup: boolean
    recent_restore_test: boolean
    offsite_present: boolean
    recommendations?: string[]
  }
  layers: Record<string, LayerReport>
}

const LAYER_ORDER: { key: string; label: string; icon: string }[] = [
  { key: 'network',        label: 'Network',        icon: 'ti-network' },
  { key: 'storage',        label: 'Storage',        icon: 'ti-database' },
  { key: 'virtualization', label: 'Virtualization', icon: 'ti-device-desktop' },
  { key: 'backup',         label: 'Backup',         icon: 'ti-cloud-upload' },
]

export function AttestivDRPlanWizardPage() {
  const { t } = useI18n()
  const router = useRouter()
  const params = useParams<{ id: string | string[] }>()
  const siteID = Array.isArray(params.id) ? params.id[0] : params.id

  const [plan, setPlan] = useState<DRPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [testMessage, setTestMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!siteID) return
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const resp = await apiFetch(`/dr/plans/${encodeURIComponent(siteID!)}`)
        if (!resp.ok) throw new Error(`${resp.status} ${resp.statusText}`)
        const data = (await resp.json()) as DRPlan
        if (!cancelled) setPlan(data)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load plan')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [siteID])

  async function triggerLayerTest(layer: string) {
    if (!siteID) return
    setTesting(layer)
    setTestMessage(null)
    try {
      const resp = await apiFetch(`/dr/plans/${encodeURIComponent(siteID)}/test/${layer}`, {
        method: 'POST',
      })
      if (!resp.ok) {
        let detail = `${resp.status} ${resp.statusText}`
        try {
          const d = await resp.json()
          if (d?.detail) detail = d.detail
        } catch { /* ignore */ }
        throw new Error(detail)
      }
      const data = await resp.json()
      setTestMessage(
        `${t('Test queued:', 'Test queued:')} ${layer}. ${data?.hint ?? ''}`,
      )
    } catch (err) {
      setTestMessage(err instanceof Error ? err.message : 'Failed to queue test')
    } finally {
      setTesting(null)
    }
  }

  if (loading) {
    return (
      <>
        <Topbar title={t('DR Plan', 'DR Plan')} />
        <div className="attestiv-content"><Skeleton lines={6} height={32} /></div>
      </>
    )
  }
  if (!plan) {
    return (
      <>
        <Topbar title={t('DR Plan', 'DR Plan')} />
        <div className="attestiv-content">
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Card>
            <p>{t('Site not found.', 'Site not found.')}</p>
          </Card>
        </div>
      </>
    )
  }

  const ransomwareTone = plan.ransomware_readiness.score >= 0.7 ? 'green' :
    plan.ransomware_readiness.score >= 0.4 ? 'amber' : 'red'

  return (
    <>
      <Topbar
        title={plan.site_name}
        left={
          <GhostButton onClick={() => router.push('/dr/plans')}>
            <i className="ti ti-arrow-left" aria-hidden="true" /> {t('All sites', 'All sites')}
          </GhostButton>
        }
        right={
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Badge tone="navy"><code style={{ fontSize: 11 }}>{plan.site_id}</code></Badge>
            {plan.dr_site_pair ? (
              <Badge tone="navy">{t('DR pair', 'DR pair')}: {plan.dr_site_pair}</Badge>
            ) : null}
          </div>
        }
      />
      <div className="attestiv-content">
        {testMessage ? <Banner tone="info">{testMessage}</Banner> : null}

        <Card>
          <CardTitle right={<Badge tone="navy">{plan.global_strategy}</Badge>}>
            {t('Global strategy', 'Global strategy')}
          </CardTitle>
          <p style={{ fontSize: 13, marginTop: 0, marginBottom: 0 }}>{plan.global_summary}</p>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <CardTitle right={<Badge tone={ransomwareTone}>{Math.round(plan.ransomware_readiness.score * 100)}%</Badge>}>
            {t('Ransomware readiness', 'Ransomware readiness')}
          </CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
            <RansomwareSignal label={t('Immutable storage', 'Immutable storage')} ok={plan.ransomware_readiness.immutable_storage} />
            <RansomwareSignal label={t('Immutable backup', 'Immutable backup')} ok={plan.ransomware_readiness.immutable_backup} />
            <RansomwareSignal label={t('Air-gapped copy', 'Air-gapped copy')} ok={plan.ransomware_readiness.air_gapped_backup} />
            <RansomwareSignal label={t('Recent restore test', 'Recent restore test')} ok={plan.ransomware_readiness.recent_restore_test} />
            <RansomwareSignal label={t('Off-site replication', 'Off-site replication')} ok={plan.ransomware_readiness.offsite_present} />
          </div>
          {plan.ransomware_readiness.recommendations && plan.ransomware_readiness.recommendations.length > 0 ? (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                {t('Recommendations', 'Recommendations')}
              </div>
              <ul style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, paddingLeft: 18 }}>
                {plan.ransomware_readiness.recommendations.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          ) : null}
        </Card>

        {LAYER_ORDER.map(({ key, label, icon }) => {
          const layer = plan.layers[key]
          if (!layer) return null
          const tone = layer.status === 'ok' ? 'green' :
            layer.status === 'warning' ? 'amber' :
            layer.status === 'critical' ? 'red' : 'gray'
          return (
            <Card key={key} style={{ marginTop: 12 }}>
              <CardTitle right={<Badge tone={tone}>{layer.status}</Badge>}>
                <i className={`ti ${icon}`} aria-hidden="true" /> {label}
              </CardTitle>
              <p style={{ fontSize: 13, marginTop: 0 }}>{layer.summary}</p>
              {layer.signals && Object.keys(layer.signals).length > 0 ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8, marginTop: 8 }}>
                  {Object.entries(layer.signals).map(([k, v]) => (
                    <Field key={k} label={k.replace(/_/g, ' ')} value={formatSignal(v)} />
                  ))}
                </div>
              ) : null}
              {layer.recommendations && layer.recommendations.length > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                    {t('Recommendations', 'Recommendations')}
                  </div>
                  <ul style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, paddingLeft: 18 }}>
                    {layer.recommendations.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              ) : null}
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
                  {layer.testable_scenarios && layer.testable_scenarios.length > 0
                    ? `${t('Test scenarios', 'Test scenarios')}: ${layer.testable_scenarios.join(' · ')}`
                    : null}
                </div>
                <PrimaryButton onClick={() => void triggerLayerTest(key)} disabled={testing === key}>
                  <i className={testing === key ? 'ti ti-loader' : 'ti ti-rocket'} aria-hidden="true" />{' '}
                  {testing === key ? t('Queueing…', 'Queueing…') : t('Test this layer', 'Test this layer')}
                </PrimaryButton>
              </div>
            </Card>
          )
        })}
      </div>
    </>
  )
}

function RansomwareSignal({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
      <Badge tone={ok ? 'green' : 'red'}>
        <i className={ok ? 'ti ti-check' : 'ti ti-x'} aria-hidden="true" />
      </Badge>
      {label}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div style={{ fontSize: 12, marginTop: 2, fontFamily: 'var(--font-mono)' }}>{value}</div>
    </div>
  )
}

function formatSignal(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v)
    return v.toFixed(2)
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return '—'
    return v.slice(0, 3).map(String).join(', ') + (v.length > 3 ? ` (+${v.length - 3})` : '')
  }
  if (typeof v === 'string') return v
  return JSON.stringify(v)
}
