'use client';

// Settings → AI engine. Controls the document content-validation engine
// (internal/docvalidate): the local LLM endpoint it calls, the model, an
// optional bearer key, and the attestation-gate kill switch. Values are
// overrides stored server-side (env is the fallback default); the backend
// rebuilds the validation kit live, so changes take effect without a redeploy.
//
// Backend: GET/PUT /v1/settings/ai-engine, POST /v1/settings/ai-engine/test.
// Admin-only (the API enforces it; non-admins get a notice here).

import { useEffect, useState } from 'react';

import { Badge, Banner, Card, CardTitle, PrimaryButton, GhostButton, Skeleton, Topbar } from '../components/AttestivUi';
import { apiFetch } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useRoles } from '../lib/roles';

type AIEngine = {
  enabled: boolean;
  enabledSource: string;
  llm_url: string;
  llm_model: string;
  key_set: boolean;
  config_source: string;
  extractor: string;
  doc_types: number;
  llm_prompt: string;
  default_prompt: string;
  prompt_source: string;
};

type TestResult = { ok: boolean; reason?: string; endpoint?: string; model?: string; extractor?: string; elapsed_ms?: number };

export function AttestivAIEngineSettingsPage() {
  const { t } = useI18n();
  const { isAdmin, ready } = useRoles();

  const [data, setData] = useState<AIEngine | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<TestResult | null>(null);

  // form
  const [enabled, setEnabled] = useState(false);
  const [llmUrl, setLlmUrl] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [llmKey, setLlmKey] = useState('');
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await apiFetch('/settings/ai-engine');
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const body: AIEngine = await r.json();
      setData(body);
      setEnabled(body.enabled);
      setLlmUrl(body.llm_url || '');
      setLlmModel(body.llm_model || '');
      setLlmKey('');
      setPrompt(body.llm_prompt || '');
      setDefaultPrompt(body.default_prompt || '');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setTest(null);
    try {
      const body: Record<string, unknown> = {
        enabled,
        llm_url: llmUrl.trim(),
        llm_model: llmModel.trim(),
        // Send "" when the prompt equals the built-in default so we clear the
        // override (prompt_source → "default") rather than storing a redundant copy.
        llm_prompt: prompt.trim() === defaultPrompt.trim() ? '' : prompt,
      };
      // Only send the key when the admin typed one (write-only; blank = leave as-is is
      // not expressible, so blank means "clear" — make that explicit in the UI copy).
      if (llmKey.trim() !== '') body.llm_key = llmKey.trim();
      const r = await apiFetch('/settings/ai-engine', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const b = await r.json().catch(() => ({}));
        throw new Error(b?.detail || `${r.status} ${r.statusText}`);
      }
      setNotice(t('Saved. The engine reloads on the next validation.', 'Saved. The engine reloads on the next validation.'));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setBusy(false);
    }
  }

  async function runTest() {
    setBusy(true);
    setError(null);
    setTest(null);
    try {
      const r = await apiFetch('/settings/ai-engine/test', { method: 'POST' });
      const body: TestResult = await r.json();
      setTest(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Test failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading || !ready) {
    return (
      <>
        <Topbar title={t('AI engine', 'AI engine')} />
        <div className="attestiv-content">
          <Skeleton />
        </div>
      </>
    );
  }

  return (
    <>
      <Topbar title={t('AI engine', 'AI engine')} />
      <div className="attestiv-content">
        {error ? <Banner tone="error">{error}</Banner> : null}
        {notice ? <Banner tone="success">{notice}</Banner> : null}
        {!isAdmin ? (
          <Banner tone="info" title={t('Read-only', 'Read-only')}>
            {t('Only admins can change the AI engine settings.', 'Only admins can change the AI engine settings.')}
          </Banner>
        ) : null}

        {/* Current status */}
        <Card>
          <CardTitle
            right={
              <Badge tone={data?.extractor === 'llm' ? 'green' : 'gray'} icon={data?.extractor === 'llm' ? 'ti-sparkles' : 'ti-list-check'}>
                {data?.extractor === 'llm' ? t('Local model', 'Local model') : t('Rule-based', 'Rule-based')}
              </Badge>
            }
          >
            {t('Status', 'Status')}
          </CardTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
            <Stat label={t('Attestation gate', 'Attestation gate')}>
              {data?.enabled ? (
                <span style={{ color: 'var(--color-status-green-mid)' }}>{t('On', 'On')}</span>
              ) : (
                <span style={{ color: 'var(--color-text-tertiary)' }}>{t('Off', 'Off')}</span>
              )}
              <span style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}> ({data?.enabledSource})</span>
            </Stat>
            <Stat label={t('Extractor', 'Extractor')}>{data?.extractor}</Stat>
            <Stat label={t('Config source', 'Config source')}>{data?.config_source}</Stat>
            <Stat label={t('Rubrics loaded', 'Rubrics loaded')}>{data?.doc_types}</Stat>
          </div>
          <p style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 12, marginBottom: 0 }}>
            {t(
              'The engine validates that uploaded documents contain the elements their type requires. With a model endpoint set it uses the local LLM; otherwise a deterministic rule-based extractor (no model). The attestation gate, when on, also blocks incomplete documents from counting as evidence during scoring.',
              'The engine validates that uploaded documents contain the elements their type requires. With a model endpoint set it uses the local LLM; otherwise a deterministic rule-based extractor (no model). The attestation gate, when on, also blocks incomplete documents from counting as evidence during scoring.'
            )}
          </p>
        </Card>

        {/* Configuration */}
        <Card style={{ marginTop: 12 }}>
          <CardTitle
            right={
              <span style={{ display: 'flex', gap: 8 }}>
                <GhostButton onClick={runTest} disabled={busy}>
                  <i className="ti ti-plug-connected" aria-hidden="true" /> {t('Test connection', 'Test connection')}
                </GhostButton>
                {isAdmin ? (
                  <PrimaryButton onClick={save} disabled={busy}>
                    <i className="ti ti-device-floppy" aria-hidden="true" /> {t('Save', 'Save')}
                  </PrimaryButton>
                ) : null}
              </span>
            }
          >
            {t('Configuration', 'Configuration')}
          </CardTitle>

          <Field label={t('Model endpoint (OpenAI-compatible base URL)', 'Model endpoint (OpenAI-compatible base URL)')}>
            <input
              value={llmUrl}
              onChange={(e) => setLlmUrl(e.target.value)}
              disabled={!isAdmin || busy}
              placeholder="http://attestiv-ai:8081/v1"
              style={inputStyle}
            />
            <Hint>{t('Leave empty to use the rule-based extractor (no model).', 'Leave empty to use the rule-based extractor (no model).')}</Hint>
          </Field>

          <Field label={t('Model name', 'Model name')}>
            <input value={llmModel} onChange={(e) => setLlmModel(e.target.value)} disabled={!isAdmin || busy} placeholder="qwen2.5-7b-instruct" style={inputStyle} />
          </Field>

          <Field label={t('Bearer key (optional)', 'Bearer key (optional)')}>
            <input
              type="password"
              value={llmKey}
              onChange={(e) => setLlmKey(e.target.value)}
              disabled={!isAdmin || busy}
              placeholder={data?.key_set ? t('•••••••• (set — leave blank to keep)', '•••••••• (set — leave blank to keep)') : t('none', 'none')}
              style={inputStyle}
            />
            <Hint>{t('Most local servers ignore this. Leave blank to keep the current key.', 'Most local servers ignore this. Leave blank to keep the current key.')}</Hint>
          </Field>

          <Field label={t('Attestation gate', 'Attestation gate')}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} disabled={!isAdmin || busy} />
              {t('Block incomplete documents from counting as evidence during scoring', 'Block incomplete documents from counting as evidence during scoring')}
            </label>
            <Hint>
              {t(
                'Off by default. When on, an attested document judged incomplete is dropped from scoring evidence. Verify your model first.',
                'Off by default. When on, an attested document judged incomplete is dropped from scoring evidence. Verify your model first.'
              )}
            </Hint>
          </Field>

          <Field label={t('Extraction prompt (advanced)', 'Extraction prompt (advanced)')}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={!isAdmin || busy}
              rows={6}
              style={{ ...inputStyle, maxWidth: 720, fontFamily: 'var(--font-mono, monospace)', resize: 'vertical' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
              {isAdmin ? (
                <GhostButton onClick={() => setPrompt(defaultPrompt)} disabled={busy}>
                  <i className="ti ti-restore" aria-hidden="true" /> {t('Reset to default', 'Reset to default')}
                </GhostButton>
              ) : null}
              <span style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)' }}>
                {prompt.trim() === defaultPrompt.trim() ? t('Using default', 'Using default') : t('Custom', 'Custom')}
              </span>
            </div>
            <Banner tone="warning">
              {t(
                'The prompt steers how the model judges evidence. The JSON response format is always enforced by the system, but a biased prompt can skew results — changes are audit-logged. Keep it to language/domain guidance; do not tell the model to pass everything.',
                'The prompt steers how the model judges evidence. The JSON response format is always enforced by the system, but a biased prompt can skew results — changes are audit-logged. Keep it to language/domain guidance; do not tell the model to pass everything.'
              )}
            </Banner>
          </Field>

          {test ? (
            <Banner tone={test.ok ? 'success' : 'warning'} title={test.ok ? t('Model answered', 'Model answered') : t('No answer', 'No answer')}>
              {test.ok
                ? `${test.extractor} · ${test.elapsed_ms}ms`
                : test.reason || t('The endpoint did not respond.', 'The endpoint did not respond.')}
            </Banner>
          ) : null}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 13, marginTop: 2, fontWeight: 500 }}>{children}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10.5, color: 'var(--color-text-tertiary)', marginTop: 3 }}>{children}</div>;
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  fontSize: 12.5,
  padding: '7px 9px',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--border-radius-md)',
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  fontFamily: 'inherit',
};
