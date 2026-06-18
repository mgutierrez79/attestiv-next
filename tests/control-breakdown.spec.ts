import { test, expect } from '@playwright/test'

// E2E for the per-control "How did I pass?" explainability drill-down.
//
// The page composes two endpoints — the existing /evidence detail and the
// NEW /breakdown route a parallel backend task is implementing. Until that
// route is live against a real deployment, this spec mocks BOTH responses
// at the proxy boundary so the user flow (narrative → gap list → CSV export
// → create-remediation dedup warning) can be driven deterministically.
//
// Guarded: set E2E_RUN_BREAKDOWN=1 to run it. Without the flag it is
// skipped so CI doesn't fail before the contract is wired end to end.
const RUN = process.env.E2E_RUN_BREAKDOWN === '1'
const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000'
const STORAGE_KEY = 'compliantly.ui.settings'

const FRAMEWORK = 'iso27001'
const CONTROL = 'A.8.24'

const evidenceBody = {
  tenant_id: 't1',
  framework_id: FRAMEWORK,
  control_id: CONTROL,
  control_name: 'Encryption of information at rest',
  status: 'fail',
  score: 0.87,
  evidence_count: 3,
  records: [],
  requirements: [],
}

const breakdownBody = {
  framework_id: FRAMEWORK,
  control_id: CONTROL,
  presentation_mode: 'proportional',
  narrative: {
    requirement: 'All production data volumes must be encrypted at rest.',
    citation: 'ISO 27001:2022 A.8.24',
    citation_status: 'draft',
    method: 'Counted encrypted volumes from the CMDB de-duplicated inventory.',
    result: '1,236 of 1,420 production volumes are encrypted.',
    gap: '184 volumes are unencrypted, 47 of them unowned.',
    remediation: 'Enable volume encryption and assign owners to the 47 unowned assets.',
  },
  measured: { numerator: 1236, denominator: 1420 },
  threshold: { pass_pct: 95 },
  confidence: { level: 'medium', reason: '2 of 6 sources stale', healthy_sources: 4, total_sources: 6 },
  provenance: {
    dedup_rule: 'Merge on hostname, then serial; survivor keeps newest last_seen.',
    sources: [
      { connector: 'vcenter', pre_dedup_count: 900, status: 'healthy', last_success: '2026-06-18T08:00:00Z' },
      { connector: 'aws', pre_dedup_count: 520, status: 'stale', last_success: '2026-06-10T08:00:00Z' },
    ],
    silent_sources: ['azure'],
    unmergeable: { count: 7, reason: 'no hostname or serial' },
  },
  freshness: { as_of: '2026-06-18T08:00:00Z', degraded: true },
  failing_items: [
    { id: 'vol-1', name: 'fin-db-01', asset_type: 'volume', owner: '', business_unit: 'Finance', criticality: 'high', crown_jewel: true },
    { id: 'vol-2', name: 'logs-02', asset_type: 'volume', owner: 'ops@acme', business_unit: 'Platform', criticality: 'low', crown_jewel: false },
  ],
  grouping: { unowned_count: 47, crown_jewel_count: 12, by_criticality: [{ key: 'high', count: 30 }] },
  as_scored: {
    scored_at: '2026-06-17T08:00:00Z',
    run_id: 'run-123',
    numerator: 1236,
    denominator: 1420,
    consistency: 'inventory_changed_since_scoring',
  },
  linkage: {
    rollup: { gaps: 184, open_risks: 1, tasks: 3, overdue_tasks: 1, accepted_exceptions: 0 },
    risks: [{ risk_id: 'r-1', title: 'Unencrypted finance volumes', status: 'open', owner: 'ciso@acme', due: '2026-07-01', overdue: false, auto_created: true }],
    remediation_tasks: [{ task_id: 't-1', title: 'Encrypt fin-db-01', status: 'in_progress', owner: 'ops@acme', due: '2026-06-01', overdue: true }],
  },
  as_recomputed_at: '2026-06-18T08:05:00Z',
}

test.describe('control breakdown drill-down', () => {
  test.skip(!RUN, 'set E2E_RUN_BREAKDOWN=1 to run (needs the /breakdown backend route or these mocks)')

  test('narrative → gap list → CSV export → create-remediation dedup warning', async ({ page }) => {
    const apiBaseUrl = process.env.E2E_API_BASE_URL ?? `${baseURL.replace(/\/$/, '')}/api`

    await page.route(/\/v1\/scoring\/frameworks\/[^/]+\/controls\/[^/]+\/evidence/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(evidenceBody) })
    })
    await page.route(/\/v1\/scoring\/frameworks\/[^/]+\/controls\/[^/]+\/breakdown/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(breakdownBody) })
    })
    await page.route(/\/v1\/remediation$/, async (route) => {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ task_id: 't-new' }) })
    })

    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      {
        key: STORAGE_KEY,
        value: JSON.stringify({ apiBaseUrl, tenantId: '', authMode: 'apiKey', apiKey: 'key-smoke', localToken: '' }),
      },
    )

    await page.goto(`/scoring/frameworks/${FRAMEWORK}/controls/${CONTROL}`)

    // 1. Narrative lead — obligation first + unverified-citation caption.
    await expect(page.getByText('All production data volumes must be encrypted at rest.')).toBeVisible()
    await expect(page.getByText(/do not rely on in audit/i)).toBeVisible()

    // 2. Headline confidence badge distinct from the score.
    await expect(page.getByText(/2 of 6 sources stale/i)).toBeVisible()

    // 3. Gap list with unowned + crown-jewel callouts.
    await expect(page.getByText('47 unowned')).toBeVisible()
    await expect(page.getByText('12 crown jewels')).toBeVisible()

    // 4. CSV export downloads a file.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export CSV/i }).click(),
    ])
    expect(download.suggestedFilename()).toContain('gap-')

    // 5. "As scored" consistency badge — amber, inventory drifted since scoring.
    await expect(page.getByText(/Inventory changed since this control was scored/i)).toBeVisible()

    // 6. Signed-breakdown export downloads a zip.
    await page.route(/\/v1\/scoring\/frameworks\/[^/]+\/controls\/[^/]+\/breakdown\/export/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/zip',
        headers: { 'content-disposition': `attachment; filename="breakdown-${FRAMEWORK}-${CONTROL}.zip"` },
        body: 'PK fake-zip',
      })
    })
    const [signedDownload] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Export signed breakdown/i }).click(),
    ])
    expect(signedDownload.suggestedFilename()).toContain('breakdown-')

    // 7. Create-remediation → dedup warning because an open risk/task exists.
    await page.getByRole('button', { name: /Create task \/ risk/i }).click()
    await expect(page.getByTestId('linkage-warning')).toBeVisible()
    await expect(page.getByText(/already exists for this control/i)).toBeVisible()
  })

  test('signed export surfaces the 409 "evaluate first" message without downloading', async ({ page }) => {
    const apiBaseUrl = process.env.E2E_API_BASE_URL ?? `${baseURL.replace(/\/$/, '')}/api`

    await page.route(/\/v1\/scoring\/frameworks\/[^/]+\/controls\/[^/]+\/evidence/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(evidenceBody) })
    })
    // Breakdown export route is registered BEFORE the generic /breakdown route
    // below so the more specific pattern wins.
    await page.route(/\/v1\/scoring\/frameworks\/[^/]+\/controls\/[^/]+\/breakdown\/export/, async (route) => {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ detail: 'no scored snapshot' }) })
    })
    await page.route(/\/v1\/scoring\/frameworks\/[^/]+\/controls\/[^/]+\/breakdown$/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(breakdownBody) })
    })

    await page.addInitScript(
      ({ key, value }) => localStorage.setItem(key, value),
      {
        key: STORAGE_KEY,
        value: JSON.stringify({ apiBaseUrl, tenantId: '', authMode: 'apiKey', apiKey: 'key-smoke', localToken: '' }),
      },
    )

    await page.goto(`/scoring/frameworks/${FRAMEWORK}/controls/${CONTROL}`)

    await page.getByRole('button', { name: /Export signed breakdown/i }).click()
    await expect(page.getByTestId('export-signed-notice')).toBeVisible()
    await expect(page.getByText(/Evaluate this framework first/i)).toBeVisible()
  })
})
