'use client';
// Frameworks page.
//
// One card per enabled framework. Each card shows the framework's
// overall posture (percent), a breakdown by control area with
// progress bars, and a Generate report button that triggers the
// async report endpoint.
//
// Why this view is the primary surface for compliance managers: the
// posture per framework is the fact they answer to leadership for.
// The dashboard's Framework posture card is a glance — this page is
// the working view, where they read each control area, decide which
// areas need an evidence push, and trigger the signed PDF for an
// auditor.

import { useEffect, useMemo, useRef, useState } from 'react'

import {
  Badge,
  Banner,
  Card,
  CardTitle,
  ScoreBadge,
  FrameworkBar,
  GhostButton,
  HeroBand,
  PrimaryButton,
  Skeleton,
  StatPill,
  Topbar,
} from '../components/AttestivUi'
import { useBackgroundTasks } from '../components/BackgroundTasks'
import { apiFetch } from '../lib/api'
import { isDemoMode } from '../lib/demoMode'
import { deriveFrameworksHero } from '../lib/frameworksHero'

import { useI18n } from '../lib/i18n';

type ControlArea = {
  name: string
  percent: number
}

// Honest declaration of how much of the regulation the framework's
// evidenceable control set covers, with the deferred controls listed.
type Coverage = {
  regulation_total: number
  covered: number
  status?: string
  statement?: string
  deferred?: { ref: string; name: string; reason?: string }[]
}

type FrameworkPosture = {
  id: string
  name: string
  overall: number
  control_areas: ControlArea[]
  last_updated?: string
  // Real backend fields. When the scoring engine has actually
  // evaluated this framework, status is one of pass/warn/review/
  // fail; when no run exists yet, status is no_data and the
  // control_areas array is empty so the card renders an honest
  // "not evaluated yet" rather than fake percentages.
  status?: 'pass' | 'warn' | 'review' | 'fail' | 'no_data' | string
  total_controls?: number
  passing_controls?: number
  review_controls?: number
  warn_controls?: number
  fail_controls?: number
  coverage?: Coverage
  // Attestation split: `overall` is the connector-MEASURED score; these
  // carry the management-asserted augmentation when attestable-only
  // controls lifted it. See scoring.ts FrameworkSummary for the contract.
  score_with_attestation?: number
  attested_synthetic_count?: number
  weighted_attested_pct?: number
}

type ScoringFrameworkResult = {
  framework_id: string
  framework_name: string
  score?: number
  status?: string
  total_controls?: number
  passing_controls?: number
  review_controls?: number
  warn_controls?: number
  fail_controls?: number
  evaluated_at?: string
  coverage?: Coverage
  score_with_attestation?: number
  status_with_attestation?: string
  attested_synthetic_count?: number
  weighted_attested_pct?: number
}

const DEMO_POSTURE: FrameworkPosture[] = [
  {
    id: 'soc2',
    name: 'SOC 2',
    overall: 96,
    control_areas: [
      { name: 'Security', percent: 98 },
      { name: 'Availability', percent: 95 },
      { name: 'Confidentiality', percent: 96 },
      { name: 'Processing integrity', percent: 92 },
      { name: 'Privacy', percent: 99 },
    ],
  },
  {
    id: 'iso27001',
    name: 'ISO 27001',
    overall: 91,
    control_areas: [
      { name: 'A.5 Information security policies', percent: 100 },
      { name: 'A.8 Asset management', percent: 88 },
      { name: 'A.9 Access control', percent: 92 },
      { name: 'A.12 Operations security', percent: 89 },
      { name: 'A.16 Incident management', percent: 86 },
    ],
  },
  {
    id: 'pci_dss',
    name: 'PCI DSS 4.0',
    overall: 84,
    control_areas: [
      { name: 'Build and maintain network', percent: 90 },
      { name: 'Protect cardholder data', percent: 88 },
      { name: 'Maintain vulnerability program', percent: 76 },
      { name: 'Implement access control', percent: 82 },
      { name: 'Monitor and test networks', percent: 80 },
    ],
  },
  {
    id: 'cis',
    name: 'CIS Controls v8',
    overall: 89,
    control_areas: [
      { name: 'Inventory and control of assets', percent: 95 },
      { name: 'Data protection', percent: 88 },
      { name: 'Secure configuration', percent: 84 },
      { name: 'Audit log management', percent: 92 },
      { name: 'Incident response', percent: 86 },
    ],
  },
]

// enqueueJob POSTs to an async endpoint and returns the worker job_id. Used
// by the re-evaluate flow so a slow connector poll / framework evaluation
// doesn't hold the request open past the front proxy's timeout.
async function enqueueJob(path: string, body: Record<string, unknown>): Promise<string> {
  const resp = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(text || `${resp.status} ${resp.statusText}`)
  }
  const b = await resp.json().catch(() => ({}))
  const jobID = typeof b?.job_id === 'string' ? b.job_id : undefined
  if (!jobID) throw new Error('backend returned no job_id')
  return jobID
}

// pollJob polls the generic worker-job-status endpoint until the job reaches
// a terminal state, returning its result on success. label sharpens any
// error/timeout message.
async function pollJob(jobID: string, label: string): Promise<Record<string, unknown>> {
  const POLL_MS = 2500
  const MAX_MS = 10 * 60 * 1000
  const startedAt = Date.now()
  for (;;) {
    if (Date.now() - startedAt > MAX_MS) {
      throw new Error(`${label} exceeded 10 min — check /v1/worker/jobs for the job state`)
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
    const resp = await apiFetch(`/worker/report/${encodeURIComponent(jobID)}`)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(text || `poll: ${resp.status} ${resp.statusText}`)
    }
    const b = await resp.json().catch(() => ({}))
    const status = String(b?.status ?? '')
    if (status === 'completed') return (b?.result as Record<string, unknown>) ?? {}
    if (status === 'failed') throw new Error(String(b?.error ?? `${label} failed`))
    if (status === 'cancelled') throw new Error(`${label} cancelled`)
  }
}

export function AttestivFrameworksPage() {
  const {
    t
  } = useI18n();

  const { run: runTask, isRunning } = useBackgroundTasks()
  const [frameworks, setFrameworks] = useState<FrameworkPosture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usingDemo, setUsingDemo] = useState(false)
  const [generating, setGenerating] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const cancelRef = useRef<{ cancelled: boolean; jobID: string | null }>({ cancelled: false, jobID: null })
  const [generated, setGenerated] = useState<{ id: string; path: string } | null>(null)
  // Re-evaluate state: 'idle' | 'refreshing' (inventory poll) | 'scoring'
  // (engine running). Two-phase because manual /scoring/evaluate against a
  // cold connector snapshot halves the score — see feedback_cold_snapshot
  // _eval_clobber. We force a connector refresh first so the engine reads
  // fresh evidence.
  const [reevalPhase, setReevalPhase] = useState<'idle' | 'refreshing' | 'scoring'>('idle')
  const [reevalDone, setReevalDone] = useState<{ at: string; frameworks: number } | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Honest-denominator overlay: the scored-controls count (140) is the
  // MEASURED subset, not the regulation universe. Pull the coverage
  // register rollup so the hero can show "N scored of 682 auditable" +
  // real regulation coverage, instead of implying 140 is everything.
  const [coverageAgg, setCoverageAgg] = useState<{ regTotal: number; covered: number } | null>(null)
  const [coverageByFw, setCoverageByFw] = useState<Record<string, { total: number; covered: number }>>({})

  useEffect(() => {
    let cancelled = false
    const allowDemo = isDemoMode()
    async function load() {
      try {
        // Pull real scoring data, not the static "enabled IDs"
        // catalog. Each item carries the framework's real score and
        // control summary; frameworks that haven't been evaluated
        // yet come back with status="no_data" so we can render an
        // honest "not yet scored" instead of fake percentages.
        const response = await apiFetch('/scoring/frameworks')
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}`)
        }
        const body = await response.json().catch(() => ({}))
        const items: ScoringFrameworkResult[] = Array.isArray(body?.items) ? body.items : []
        if (!cancelled) {
          if (items.length > 0) {
            setFrameworks(items.map(scoringResultToPosture))
            setUsingDemo(false)
          } else if (allowDemo) {
            setFrameworks(DEMO_POSTURE)
            setUsingDemo(true)
          } else {
            setFrameworks([])
            setUsingDemo(false)
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          if (allowDemo) {
            setFrameworks(DEMO_POSTURE)
            setUsingDemo(true)
          } else {
            setFrameworks([])
            setUsingDemo(false)
          }
          setError(err?.message ?? 'Failed to load frameworks')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const overallTotals = useMemo(() => {
    if (frameworks.length === 0) return { passing: 0, total: 0 }
    const total = frameworks.length
    const passing = frameworks.filter((framework) => framework.overall >= 95).length
    return { passing, total }
  }, [frameworks])

  // Hero stats are derived in src/lib/frameworksHero and pinned by
  // frameworksHero.test.ts (W0-4 UI == signed source). Same function
  // used by Dashboard and the tests means hero values can't drift from
  // the underlying scoring output.
  //
  // Flatten coverage.regulation_total to the top level — the pure hero
  // function reads regulation_total off each framework directly, which
  // keeps the lib decoupled from the view's nested API shape. Missing
  // coverage block ⇒ regulation_total undefined ⇒ hero falls back to
  // its legacy scored-subset average.
  const hero = useMemo(
    () =>
      deriveFrameworksHero(
        frameworks.map((f) => ({
          overall: f.overall,
          status: f.status,
          passing_controls: f.passing_controls,
          total_controls: f.total_controls,
          regulation_total: f.coverage?.regulation_total,
        }))
      ),
    [frameworks]
  )

  // Aggregate the coverage register so the hero's denominator is the
  // honest 682 auditable units, with covered = evidenced + attested.
  useEffect(() => {
    let cancelled = false
    async function loadCoverage() {
      try {
        const r = await apiFetch('/scoring/coverage-register')
        if (!r.ok) return
        const body = await r.json()
        const fws: Array<{ framework_id?: string; rollup?: { total?: number; evidenced?: number; attested?: number } }> = body?.frameworks ?? []
        let regTotal = 0
        let covered = 0
        const map: Record<string, { total: number; covered: number }> = {}
        for (const f of fws) {
          const tot = f.rollup?.total ?? 0
          const cov = (f.rollup?.evidenced ?? 0) + (f.rollup?.attested ?? 0)
          regTotal += tot
          covered += cov
          if (f.framework_id) map[f.framework_id] = { total: tot, covered: cov }
        }
        if (!cancelled && regTotal > 0) {
          setCoverageAgg({ regTotal, covered })
          setCoverageByFw(map)
        }
      } catch {
        // leave null — the tile renders "—" rather than a wrong number
      }
    }
    void loadCoverage()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  // Async generate-and-download:
  //   1. POST /v1/generate-report/async — enqueues a worker job and
  //      returns { job_id } immediately so the UI doesn't block.
  //   2. Poll GET /v1/worker/report/{job_id} until status="completed"
  //      (or "failed"/"cancelled"). result.run_id arrives once the
  //      worker finishes evaluating + rendering the markdown report.
  //   3. GET /v1/runs/{run_id}/report/pdf — pulls the PDF and triggers
  //      the browser download.
  //
  // The old synchronous /v1/generate-report path blocked the request
  // for 60+s on tenants with hundreds of assets, which read as
  // "broken" in the UI. The async flow surfaces an elapsed counter and
  // a Cancel button so the user can leave or abort. Polling cap: 10
  // min — long enough for big tenants, short enough that a wedged
  // worker doesn't keep polling forever.
  async function generateReport(framework: FrameworkPosture) {
    cancelRef.current = { cancelled: false, jobID: null }
    setGenerating(framework.id)
    setGenerated(null)
    setError(null)
    setElapsed(0)
    const startedAt = Date.now()
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    const POLL_MS = 2000
    const MAX_MS = 10 * 60 * 1000

    try {
      const enqueueResponse = await apiFetch('/generate-report/async', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          framework: framework.id,
          frameworks: [framework.id],
        }),
      })
      if (!enqueueResponse.ok) {
        const text = await enqueueResponse.text().catch(() => '')
        throw new Error(text || `${enqueueResponse.status} ${enqueueResponse.statusText}`)
      }
      const enqueueBody = await enqueueResponse.json().catch(() => ({}))
      const jobID: string | undefined = typeof enqueueBody?.job_id === 'string' ? enqueueBody.job_id : undefined
      if (!jobID) {
        throw new Error('Backend returned no job_id; cannot track report')
      }
      cancelRef.current.jobID = jobID

      let result: any = null
      while (true) {
        if (cancelRef.current.cancelled) {
          throw new Error('cancelled')
        }
        if (Date.now() - startedAt > MAX_MS) {
          throw new Error('Report generation exceeded 10 min — check /v1/worker/jobs for the job state')
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS))
        const pollResponse = await apiFetch(`/worker/report/${encodeURIComponent(jobID)}`)
        if (!pollResponse.ok) {
          const text = await pollResponse.text().catch(() => '')
          throw new Error(text || `poll: ${pollResponse.status} ${pollResponse.statusText}`)
        }
        const pollBody = await pollResponse.json().catch(() => ({}))
        const status = String(pollBody?.status ?? '')
        if (status === 'completed') {
          result = pollBody?.result ?? {}
          break
        }
        if (status === 'failed') {
          throw new Error(String(pollBody?.error ?? 'job failed'))
        }
        if (status === 'cancelled') {
          throw new Error('cancelled')
        }
      }

      // Backend result shape varies: some paths put run_id at top
      // level, others nest it under .run, and the worker pipeline
      // currently emits neither — only report_path with the run_id
      // baked into the filename (`reports/run-YYYYMMDD-HHMMSS.md`).
      // Parse the basename as a fallback so the download still fires.
      const parseRunIDFromPath = (path: unknown): string | undefined => {
        if (typeof path !== 'string') return undefined
        const base = path.split(/[\\/]/).pop() ?? ''
        const match = base.match(/^(run-\d{8}-\d{6})/)
        return match ? match[1] : undefined
      }
      const runID: string | undefined =
        (typeof result?.run?.run_id === 'string' && result.run.run_id) ||
        (typeof result?.run_id === 'string' && result.run_id) ||
        (typeof result?.summary?.run_id === 'string' && result.summary.run_id) ||
        parseRunIDFromPath(result?.report_path) ||
        parseRunIDFromPath(result?.manifest_path) ||
        undefined
      if (!runID) {
        throw new Error('Job finished without a run_id; cannot fetch PDF')
      }

      const pdfResponse = await apiFetch(`/runs/${encodeURIComponent(runID)}/report/pdf`)
      if (!pdfResponse.ok) {
        const text = await pdfResponse.text().catch(() => '')
        throw new Error(text || `pdf: ${pdfResponse.status} ${pdfResponse.statusText}`)
      }
      const blob = await pdfResponse.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `${runID}-${framework.id}.pdf`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)

      setGenerated({ id: framework.id, path: runID })
    } catch (err: any) {
      if (err?.message === 'cancelled') {
        setError(t('Report generation cancelled.', 'Report generation cancelled.'))
      } else {
        setError(err?.message ?? 'Failed to generate report')
      }
    } finally {
      clearInterval(tick)
      setGenerating(null)
      setElapsed(0)
    }
  }

  async function cancelGenerate() {
    cancelRef.current.cancelled = true
    const jobID = cancelRef.current.jobID
    if (!jobID) return
    try {
      await apiFetch(`/worker/jobs/${encodeURIComponent(jobID)}/cancel`, { method: 'POST' })
    } catch {
      // The polling loop will surface the cancellation regardless;
      // ignore network failures from the cancel call itself.
    }
  }

  // Two-phase manual re-evaluate. Refresh connector snapshots first so the
  // engine doesn't score against stale/empty inventory (cold-snapshot
  // clobber), then trigger /scoring/evaluate. NOT chained to a report — a
  // synchronous report run OOM'd the pilot host previously. User reads the
  // refreshed cards; if they want a PDF, the per-card Generate button
  // already does that.
  async function reevaluate() {
    if (reevalPhase !== 'idle' || isRunning('framework-reevaluate')) return
    setError(null)
    setReevalDone(null)
    try {
      // Run as a GLOBAL background task so the "validating" indicator
      // survives navigation and the button reflects "still running" if you
      // come back — same pattern as the inventory Update button.
      const result = await runTask(
        'framework-reevaluate',
        t('Validating frameworks…', 'Validating frameworks…'),
        async () => {
          try {
            // Both phases run as async worker jobs and are polled to
            // completion. Running them synchronously held the request open
            // for the full multi-connector poll + multi-framework evaluation,
            // which outlasts the front proxy's timeout — the "upstream
            // request failed" the operator hit. The connector refresh still
            // runs FIRST so the engine scores against fresh evidence (the
            // backend's cold-snapshot guard is the backstop).
            setReevalPhase('refreshing')
            const refreshJob = await enqueueJob('/inventory/import', { refresh: true, async: true })
            await pollJob(refreshJob, 'Connector refresh')

            setReevalPhase('scoring')
            const evalJob = await enqueueJob('/scoring/evaluate?async=true', {})
            const evalResult = await pollJob(evalJob, 'Framework evaluation')
            const count =
              typeof evalResult?.frameworks_evaluated === 'number'
                ? (evalResult.frameworks_evaluated as number)
                : Array.isArray(evalResult?.results)
                  ? (evalResult.results as unknown[]).length
                  : 0
            return { at: new Date().toISOString(), frameworks: count }
          } finally {
            setReevalPhase('idle')
          }
        },
      )
      if (result === undefined) return // a validation was already running
      setReevalDone(result)
      setReloadKey((k) => k + 1)
    } catch (err: any) {
      setError(err?.message ?? 'Re-evaluation failed')
    }
  }

  return (
    <>
      <Topbar
        title={t('Frameworks', 'Frameworks')}
        left={
          usingDemo ? <Badge tone="amber">{t(
            'Demo posture — backend has no run summaries yet',
            'Demo posture — backend has no run summaries yet'
          )}</Badge> : null
        }
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {overallTotals.passing}/{overallTotals.total} {t('frameworks ≥95%', 'frameworks ≥95%')}
            </span>
            <PrimaryButton onClick={reevaluate} disabled={reevalPhase !== 'idle' || isRunning('framework-reevaluate')}>
              {reevalPhase === 'refreshing' ? (
                <>
                  <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                  {t('Refreshing connectors…', 'Refreshing connectors…')}
                </>
              ) : reevalPhase === 'scoring' ? (
                <>
                  <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                  {t('Scoring…', 'Scoring…')}
                </>
              ) : isRunning('framework-reevaluate') ? (
                <>
                  <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                  {t('Validating…', 'Validating…')}
                </>
              ) : (
                <>
                  <i className="ti ti-refresh" aria-hidden="true" />
                  {t('Re-evaluate now', 'Re-evaluate now')}
                </>
              )}
            </PrimaryButton>
          </div>
        }
      />
      <div className="attestiv-content">
        {usingDemo ? (
          <Banner tone="warning" title={t('Showing demo data', 'Showing demo data')}>
            {t(
              'The scoring engine has no run summaries yet — these are illustrative percentages, not your actual posture. Connect your infrastructure and run Re-evaluate to see real scores.',
              'The scoring engine has no run summaries yet — these are illustrative percentages, not your actual posture. Connect your infrastructure and run Re-evaluate to see real scores.',
            )}
          </Banner>
        ) : null}
        {error ? <Banner tone="error" onRetry={() => setReloadKey((k) => k + 1)}>{error}</Banner> : null}
        {reevalDone ? (
          <Banner tone="success" title={t('Scoring refreshed', 'Scoring refreshed')}>
            <span>
              {t('Evaluated', 'Evaluated')} <strong>{reevalDone.frameworks}</strong> {t('frameworks at', 'frameworks at')}{' '}
              {new Date(reevalDone.at).toLocaleTimeString()}.
            </span>
          </Banner>
        ) : null}
        {generated ? (
          <Banner tone="success" title={t('Report downloaded', 'Report downloaded')}>
            <span>
              <strong>{labelFor(generated.id)}</strong> {t('· run', '· run')} <code>{generated.path}</code> {t(
                '— also available from Audit / Reports.',
                '— also available from Audit / Reports.'
              )}
            </span>
          </Banner>
        ) : null}

        {!loading && frameworks.length > 0 ? (
          <HeroBand
            label={t('Overall posture', 'Overall posture')}
            value={hero.evaluatedCount > 0 ? `${hero.avg}%` : '—'}
            percent={hero.avg}
            segments={
              hero.regulationTotal > 0 && coverageAgg
                ? [
                    {
                      // PASSING: controls with a PASS verdict, against the
                      // full regulation. This is the auditor-honest "what
                      // we can prove is met" segment.
                      percent: Math.round((hero.passing / hero.regulationTotal) * 100),
                      color: 'var(--color-status-green-mid)',
                      label: t('passing', 'passing'),
                      count: hero.passing,
                    },
                    {
                      // MEASURED · NOT PASSING: we have evidence or a
                      // signed attestation, but the verdict is WARN / REVIEW
                      // / FAIL. Work-to-do that's already visible.
                      percent: Math.round((Math.max(0, coverageAgg.covered - hero.passing) / hero.regulationTotal) * 100),
                      color: 'var(--color-status-amber-mid)',
                      label: t('measured · not passing', 'measured · not passing'),
                      count: Math.max(0, coverageAgg.covered - hero.passing),
                    },
                    // The grey remainder of the bar is the implicit
                    // UNEVIDENCED slice — controls with no signal at all.
                    // The unevidenced count is shown in the caption so the
                    // legend stays uncluttered.
                  ]
                : undefined
            }
            caption={
              hero.evaluatedCount === 0
                ? t('No scoring run yet', 'No scoring run yet')
                : hero.regulationTotal > 0 && coverageAgg
                ? `${hero.passing} ${t('passing', 'passing')} · ${Math.max(0, coverageAgg.covered - hero.passing)} ${t('measured but not passing', 'measured but not passing')} · ${Math.max(0, hero.regulationTotal - coverageAgg.covered)} ${t('unevidenced of', 'unevidenced of')} ${hero.regulationTotal} ${t('auditable controls', 'auditable controls')}`
                : hero.regulationTotal > 0
                ? `${hero.passing} ${t('passing of', 'passing of')} ${hero.regulationTotal} ${t('auditable controls across', 'auditable controls across')} ${hero.evaluatedCount} ${t('frameworks · subset score', 'frameworks · subset score')} ${hero.scoredAvg}% ${t('of the', 'of the')} ${hero.total} ${t('measured', 'measured')}`
                : `${t('score of scored controls across', 'score of scored controls across')} ${hero.evaluatedCount} ${t('evaluated frameworks — coverage register not loaded', 'evaluated frameworks — coverage register not loaded')}`
            }
            pills={
              <>
                <StatPill
                  label={t('Frameworks', 'Frameworks')}
                  value={String(frameworks.length)}
                  sub={`${hero.evaluatedCount} ${t('evaluated', 'evaluated')}`}
                />
                <StatPill
                  label={t('At or above 95%', 'At or above 95%')}
                  value={String(overallTotals.passing)}
                  sub={`${t('of', 'of')} ${overallTotals.total}`}
                  valueColor="var(--color-status-green-deep)"
                />
                <StatPill
                  label={t('Scored controls passing', 'Scored controls passing')}
                  value={hero.total > 0 ? `${hero.passingPct}%` : '—'}
                  sub={hero.total > 0 ? `${hero.passing} / ${hero.total}` : undefined}
                />
                <StatPill
                  label={t('Scored controls', 'Scored controls')}
                  value={hero.total > 0 ? String(hero.total) : '—'}
                  sub={coverageAgg ? `${t('of', 'of')} ${coverageAgg.regTotal} ${t('auditable', 'auditable')}` : undefined}
                />
                <StatPill
                  label={t('Regulation coverage', 'Regulation coverage')}
                  value={coverageAgg && coverageAgg.regTotal > 0 ? `${Math.round((coverageAgg.covered / coverageAgg.regTotal) * 100)}%` : '—'}
                  sub={coverageAgg ? `${coverageAgg.covered} / ${coverageAgg.regTotal} ${t('covered', 'covered')}` : undefined}
                />
              </>
            }
          />
        ) : null}

        {loading ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: 16,
            }}
          >
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <Skeleton width="60%" height={18} />
                <div style={{ marginTop: 12 }}>
                  <Skeleton lines={4} height={10} />
                </div>
                <div style={{ marginTop: 14 }}>
                  <Skeleton width={120} height={28} rounded={8} />
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
              gap: 16,
            }}
          >
            {frameworks.map((framework) => (
              <FrameworkCard
                key={framework.id}
                framework={framework}
                liveCovered={coverageByFw[framework.id]?.covered}
                generating={generating === framework.id}
                elapsed={generating === framework.id ? elapsed : 0}
                onGenerate={() => generateReport(framework)}
                onCancel={() => void cancelGenerate()}
                demoMode={usingDemo}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function FrameworkCard({
  framework,
  liveCovered,
  generating,
  elapsed,
  onGenerate,
  onCancel,
  demoMode = false,
}: {
  framework: FrameworkPosture
  liveCovered?: number
  generating: boolean
  elapsed: number
  onGenerate: () => void
  onCancel: () => void
  demoMode?: boolean
}) {
  const {
    t
  } = useI18n();

  const noData = framework.status === 'no_data'
  // Coverage-adjusted badge: passing / regulation_total — the same
  // auditor-honest math the hero uses. Falls back to framework.overall
  // (legacy score-of-scored-subset) when the coverage block isn't
  // available so older payloads still render a badge.
  const regTotal = framework.coverage?.regulation_total ?? 0
  const passing = framework.passing_controls ?? 0
  const coverageAdjusted = regTotal > 0 ? Math.round((passing / regTotal) * 100) : framework.overall
  // Source-split counts: how many controls are backed by live connector
  // evidence vs. signed management attestation only.
  const attestedOnly = framework.attested_synthetic_count ?? 0
  const totalCovered = typeof liveCovered === 'number' ? liveCovered : (framework.coverage?.covered ?? 0)
  const measuredCount = Math.max(0, totalCovered - attestedOnly)
  const tone: 'green' | 'amber' | 'red' | 'gray' = noData
    ? 'gray'
    : coverageAdjusted >= 95
      ? 'green'
      : coverageAdjusted >= 85
        ? 'amber'
        : 'red'
  // ScoreBadge for evaluated frameworks (number + status dot reads
  // as a single auditor-friendly chip); fall back to a quiet Badge
  // with a dot for the "not evaluated" state so the visual language
  // stays consistent.
  const headerBadge = noData ? (
    <Badge tone="gray" dot>{t('not evaluated', 'not evaluated')}</Badge>
  ) : (
    <ScoreBadge tone={tone} value={`${coverageAdjusted}%`} />
  )
  return (
    <Card>
      <CardTitle right={headerBadge}>
        {framework.name}
      </CardTitle>
      <div style={{ marginBottom: 10 }}>
        {framework.control_areas.length > 0 ? (
          // Legacy DEMO data path (only reached in actual demo mode).
          framework.control_areas.map((area) => (
            <FrameworkBar key={area.name} name={area.name} percent={area.percent} />
          ))
        ) : noData ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
            {t(
              'No scoring run yet. Run /v1/scoring/evaluate to compute a real score against your current evidence.',
              'No scoring run yet. Run /v1/scoring/evaluate to compute a real score against your current evidence.',
            )}
          </div>
        ) : (
          <ControlBreakdown framework={framework} />
        )}
      </div>
      {framework.coverage ? <CoverageBlock coverage={framework.coverage} liveCovered={liveCovered} /> : null}
      {totalCovered > 0 ? (
        <div
          style={{
            marginBottom: 10,
            fontSize: 11,
            color: 'var(--color-text-tertiary)',
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span>
            <i className="ti ti-plug" aria-hidden="true" style={{ marginRight: 3, fontSize: 10 }} />
            <strong style={{ color: 'var(--color-text-secondary)' }}>{measuredCount}</strong>
            {' '}{t('connector-measured', 'connector-measured')}
          </span>
          <span style={{ color: 'var(--color-border-secondary)' }}>·</span>
          <span>
            <i className="ti ti-writing-sign" aria-hidden="true" style={{ marginRight: 3, fontSize: 10 }} />
            <strong style={{ color: attestedOnly > 0 ? 'var(--color-status-amber-deep, var(--color-text-secondary))' : 'var(--color-text-secondary)' }}>
              {attestedOnly}
            </strong>
            {' '}{t('manually attested', 'manually attested')}
          </span>
        </div>
      ) : null}
      <AttestationSplit framework={framework} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
          {framework.last_updated
            ? `${t('Evaluated', 'Evaluated')} ${formatEvaluatedAt(framework.last_updated)}`
            : t('No scoring run yet', 'No scoring run yet')}
        </span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <GhostButton onClick={() => { if (typeof window !== 'undefined') window.location.href = `/scoring/trend/${framework.id}` }}>
            <i className="ti ti-chart-line" aria-hidden="true" />
            {t('Trend', 'Trend')}
          </GhostButton>
          <GhostButton onClick={() => { if (typeof window !== 'undefined') window.location.href = `/scoring/calculator` }}>
            <i className="ti ti-math-function" aria-hidden="true" />
            {t('How scored', 'How scored')}
          </GhostButton>
          {generating ? (
            <GhostButton onClick={onCancel}>
              <i className="ti ti-x" aria-hidden="true" />
              {t('Cancel', 'Cancel')}
            </GhostButton>
          ) : null}
          <span title={demoMode ? t('Not available on demo data — run Re-evaluate first', 'Not available on demo data — run Re-evaluate first') : undefined}>
          <PrimaryButton
            onClick={onGenerate}
            disabled={generating || demoMode}
          >
            {generating ? (
              <>
                <i className="ti ti-loader-2" aria-hidden="true" style={{ animation: 'attestiv-spin 1s linear infinite' }} />
                {t('Generating…', 'Generating…')} {elapsed > 0 ? `${elapsed}s` : null}
              </>
            ) : (
              <>
                <i className="ti ti-file-export" aria-hidden="true" />
                {demoMode ? t('Demo — no report', 'Demo — no report') : t('Generate report', 'Generate report')}
              </>
            )}
          </PrimaryButton>
          </span>
        </div>
      </div>
    </Card>
  );
}

// ControlBreakdown renders the real pass/review/warn/fail tally the
// scoring engine emits. Four colored segments + an implicit grey
// "unevidenced" rest when the regulation_total is known, so the bar
// honestly conveys what fraction of the FULL regulation has each
// verdict — instead of showing "53% passing of the 14 measured" which
// hides the ~140 controls with no evidence at all.
function ControlBreakdown({ framework }: { framework: FrameworkPosture }) {
  const { t } = useI18n()
  const scoredTotal = framework.total_controls ?? 0
  const passing = framework.passing_controls ?? 0
  const review = framework.review_controls ?? 0
  const warn = framework.warn_controls ?? 0
  const fail = framework.fail_controls ?? 0
  // Honest denominator: the framework's regulation total when the
  // coverage block has shipped, else fall back to the scored subset
  // (legacy behaviour for frameworks without a coverage register).
  const regTotal = framework.coverage?.regulation_total ?? 0
  const denominator = regTotal > 0 ? regTotal : scoredTotal
  const unevidenced = Math.max(0, denominator - scoredTotal)
  if (denominator === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', padding: '8px 0' }}>
        {t('Framework has no controls loaded.', 'Framework has no controls loaded.')}
      </div>
    )
  }
  const pct = (n: number) => (n / denominator) * 100
  const segments: Array<{ key: string; pct: number; color: string; label: string; count: number }> = [
    { key: 'pass', pct: pct(passing), color: 'var(--color-status-green-mid)', label: t('Passing', 'Passing'), count: passing },
    { key: 'review', pct: pct(review), color: 'var(--color-status-blue-mid)', label: t('Review', 'Review'), count: review },
    { key: 'warn', pct: pct(warn), color: 'var(--color-status-amber-mid)', label: t('Warn', 'Warn'), count: warn },
    { key: 'fail', pct: pct(fail), color: 'var(--color-status-red-mid)', label: t('Fail', 'Fail'), count: fail },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div
        style={{
          display: 'flex',
          height: 10,
          borderRadius: 'var(--border-radius-sm)',
          overflow: 'hidden',
          background: 'var(--color-background-tertiary)',
        }}
        title={`${passing}/${denominator} ${t('passing', 'passing')}${regTotal > 0 ? ` · ${unevidenced} ${t('unevidenced', 'unevidenced')}` : ''}`}
      >
        {segments.map((seg) =>
          seg.pct > 0 ? (
            <div key={seg.key} style={{ width: `${seg.pct}%`, background: seg.color }} />
          ) : null,
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, color: 'var(--color-text-secondary)' }}>
        {segments
          .filter((seg) => seg.count > 0)
          .map((seg) => (
            <span key={seg.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: seg.color, display: 'inline-block' }} />
              {seg.count} {seg.label.toLowerCase()}
            </span>
          ))}
        {regTotal > 0 && unevidenced > 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-background-tertiary)', border: '1px solid var(--color-border-tertiary)', display: 'inline-block' }} />
            {unevidenced} {t('unevidenced', 'unevidenced')}
          </span>
        ) : null}
        <span style={{ marginLeft: 'auto', color: 'var(--color-text-tertiary)' }}>
          {regTotal > 0
            ? `${denominator} ${t('auditable controls', 'auditable controls')}`
            : `${denominator} ${t('scored controls', 'scored controls')}`}
        </span>
      </div>
    </div>
  )
}

// CoverageBlock makes the framework's regulation coverage explicit:
// "X / Y controls covered" + the deferred controls (and why), so an
// auditor sees what is automated vs. what still needs manual
// attestation. Coverage is a best-effort assessment until juriste-
// reviewed (status=verified).
function CoverageBlock({ coverage, liveCovered }: { coverage: Coverage; liveCovered?: number }) {
  const { t } = useI18n()
  const total = coverage.regulation_total || 0
  // Prefer the live register rollup (evidenced + attested) over the
  // static `covered` field, which is hand-set in YAML and drifts as
  // controls are promoted/wired. Falls back to the static value when the
  // register rollup hasn't loaded.
  const covered = typeof liveCovered === 'number' ? liveCovered : coverage.covered || 0
  const verified = (coverage.status || '').toLowerCase() === 'verified'
  const deferredCount = coverage.deferred?.length ?? 0
  const hasDetail = Boolean(coverage.statement) || deferredCount > 0
  return (
    <div style={{ marginBottom: 10, fontSize: 11.5 }}>
      {/* Card face stays clean — just the coverage ratio + status. The
          prose statement and the deferred list live behind a disclosure
          so the card isn't cluttered; the rich per-control narrative is
          on the control-detail pages where there's room. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>
          {t('Regulation coverage', 'Regulation coverage')}: {covered} / {total}
        </span>
        <Badge tone={verified ? 'green' : 'amber'}>
          {verified ? t('verified', 'verified') : t('draft — verify', 'draft — verify')}
        </Badge>
      </div>
      {hasDetail ? (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', color: 'var(--color-text-tertiary)' }}>
            {deferredCount > 0
              ? `${deferredCount} ${t('deferred — what & why', 'deferred — what & why')}`
              : t('coverage details', 'coverage details')}
          </summary>
          {coverage.statement ? (
            <p style={{ margin: '6px 0 0', color: 'var(--color-text-secondary)' }}>{coverage.statement}</p>
          ) : null}
          {deferredCount > 0 ? (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--color-text-secondary)' }}>
              {coverage.deferred!.map((d) => (
                <li key={d.ref} style={{ marginBottom: 2 }}>
                  <code style={{ fontSize: 10 }}>{d.ref}</code> — {d.name}
                  {d.reason ? <span style={{ color: 'var(--color-text-tertiary)' }}> ({d.reason})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}
    </div>
  )
}

// AttestationSplit makes the two scores impossible to conflate: the
// MEASURED score (connector-evidenced controls only — what the platform
// can prove) and the AUGMENTED score (measured + attestable-only controls
// the operator signed off on, with no connector evidence behind them).
//
// Why this matters to a CISO/auditor: blending the two into one headline
// number lets a management assertion ("we have a policy for that") read
// as a tested control. An auditor will challenge that immediately. We
// show both, label the augmented one as asserted-not-measured, and state
// how many controls and how much weight came from attestation — so the
// number on the dashboard is the same number that survives the audit.
function AttestationSplit({ framework }: { framework: FrameworkPosture }) {
  const { t } = useI18n()
  const augmented = framework.score_with_attestation
  const synthCount = framework.attested_synthetic_count ?? 0
  // Backend only stamps these when synthetics actually lifted the score.
  // Absent ⇒ measured == augmented ⇒ nothing to disambiguate.
  if (typeof augmented !== 'number' || synthCount <= 0) return null
  const measuredPct = framework.overall
  const augmentedPct = Math.round(augmented <= 1 ? augmented * 100 : augmented)
  const weightedPct = framework.weighted_attested_pct
  return (
    <div
      style={{
        marginBottom: 10,
        fontSize: 11.5,
        border: '1px solid var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-sm)',
        padding: '8px 10px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-text-tertiary)' }}>
            {t('Measured', 'Measured')}
          </span>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-text-primary)' }}>{measuredPct}%</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('connector-evidenced', 'connector-evidenced')}</span>
        </span>
        <span style={{ color: 'var(--color-text-tertiary)', alignSelf: 'center' }}>→</span>
        <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--color-status-amber-deep, var(--color-text-tertiary))' }}>
            {t('With attestations', 'With attestations')}
          </span>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--color-text-primary)' }}>{augmentedPct}%</span>
          <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>{t('incl. management assertions', 'incl. management assertions')}</span>
        </span>
      </div>
      <div style={{ marginTop: 6, color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 4 }}>
        <i className="ti ti-alert-triangle" aria-hidden="true" style={{ color: 'var(--color-status-amber-mid)' }} />
        <span>
          {synthCount} {synthCount === 1 ? t('control', 'control') : t('controls', 'controls')}{' '}
          {t('counted by signed attestation, not connector evidence', 'counted by signed attestation, not connector evidence')}
          {typeof weightedPct === 'number' && weightedPct > 0
            ? ` · ${Math.round(weightedPct * 100)}% ${t('of weight', 'of weight')}`
            : ''}
        </span>
      </div>
    </div>
  )
}

function formatEvaluatedAt(iso: string): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return iso
  const delta = Date.now() - ts
  if (delta < 60_000) return 'just now'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`
  return new Date(iso).toLocaleDateString()
}

// scoringResultToPosture maps the real scoring-engine result into
// the page's FrameworkPosture shape. The backend's score is a
// normalized 0-1 weighted sum; we render as 0-100 percent.
//
// The fake "control areas" breakdown that lived here when this page
// was wired to DEMO_POSTURE is gone — that concept doesn't exist in
// the real backend (controls are flat under a framework, not grouped
// into named areas). The card now renders a real pass/warn/review/
// fail summary instead, which is the actual signal an auditor reads.
function scoringResultToPosture(result: ScoringFrameworkResult): FrameworkPosture {
  const rawScore = typeof result.score === 'number' ? result.score : 0
  const percent = Math.round(rawScore <= 1 ? rawScore * 100 : rawScore)
  return {
    id: result.framework_id,
    name: result.framework_name || labelFor(result.framework_id),
    overall: percent,
    control_areas: [],
    last_updated: result.evaluated_at,
    status: result.status,
    total_controls: result.total_controls,
    passing_controls: result.passing_controls,
    review_controls: result.review_controls,
    warn_controls: result.warn_controls,
    fail_controls: result.fail_controls,
    coverage: result.coverage,
    score_with_attestation: result.score_with_attestation,
    attested_synthetic_count: result.attested_synthetic_count,
    weighted_attested_pct: result.weighted_attested_pct,
  }
}

function labelFor(id: string): string {
  const known: Record<string, string> = {
    soc2: 'SOC 2',
    iso27001: 'ISO 27001',
    pci_dss: 'PCI DSS 4.0',
    cis: 'CIS Controls v8',
    nist_800_53: 'NIST SP 800-53',
    hipaa: 'HIPAA',
    gdpr: 'GDPR',
  }
  return known[id] ?? id
}
