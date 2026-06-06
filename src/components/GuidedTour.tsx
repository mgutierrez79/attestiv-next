'use client';

// GuidedTour — the in-app "show me where to click" overlay.
//
// Backend contract (deterministic; the assistant only SELECTS a tour, the
// catalog drives the pointer):
//   GET /v1/guided-tours            list (role-filtered)
//   GET /v1/guided-tours/match?q=   rank tours for a question, returns `best`
//   GET /v1/guided-tours/{id}       one tour with ordered steps
// Each step points at a stable UI anchor — an element carrying
// data-tour-id="<anchor>". This component spotlights that element and shows the
// instruction. It POINTS; the user clicks. No new dependency: the spotlight is
// a single box-shadow cutout, repositioned each frame while a tour is active.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter } from 'next/navigation';

import { apiJson } from '../lib/api';
import { useI18n } from '../lib/i18n';

type TourStep = { anchor: string; title: string; instruction: string; route?: string };
type Tour = {
  id: string;
  title: string;
  description: string;
  keywords?: string[];
  min_role?: string;
  steps: TourStep[];
};
type MatchResult = { tour: Tour; score: number };
type Citation = { id: string; title: string; route?: string };
type AskResult = {
  answer: string;
  source: string;
  citations?: Citation[];
  suggested_tour?: { id: string; title: string } | null;
  route?: string;
};

type Ctx = {
  startTour: (id: string) => void;
  openLauncher: () => void;
};

const GuidedTourContext = createContext<Ctx | null>(null);

export function useGuidedTour(): Ctx {
  const ctx = useContext(GuidedTourContext);
  if (!ctx) throw new Error('useGuidedTour must be used inside GuidedTourProvider');
  return ctx;
}

type Rect = { top: number; left: number; width: number; height: number };

export function GuidedTourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { t } = useI18n();

  const [mounted, setMounted] = useState(false);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [tours, setTours] = useState<Tour[]>([]);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<MatchResult[] | null>(null);
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [asking, setAsking] = useState(false);

  const [active, setActive] = useState<Tour | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load the role-filtered tour catalog once when the launcher first opens.
  useEffect(() => {
    if (!launcherOpen || tours.length > 0) return;
    apiJson<{ tours: Tour[] }>('/guided-tours')
      .then((r) => setTours(r.tours || []))
      .catch(() => setTours([]));
  }, [launcherOpen, tours.length]);

  // Debounced deterministic match as the user types a question.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setMatches(null);
      return;
    }
    const handle = setTimeout(() => {
      apiJson<{ matches: MatchResult[] }>(`/guided-tours/match?q=${encodeURIComponent(q)}`)
        .then((r) => setMatches(r.matches || []))
        .catch(() => setMatches([]));
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  const stopTour = useCallback(() => {
    setActive(null);
    setStepIndex(0);
    setRect(null);
  }, []);

  const startTour = useCallback(
    async (id: string) => {
      try {
        const tour = await apiJson<Tour>(`/guided-tours/${encodeURIComponent(id)}`);
        if (!tour?.steps?.length) return;
        setLauncherOpen(false);
        setActive(tour);
        setStepIndex(0);
      } catch {
        /* ignore — tour not available */
      }
    },
    []
  );

  const openLauncher = useCallback(() => setLauncherOpen(true), []);

  // Ask the AI help assistant a free-text question (grounded "manual").
  const ask = useCallback(async (q: string) => {
    const question = q.trim();
    if (!question) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await apiJson<AskResult>('/assistant/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      setAnswer(res);
    } catch {
      setAnswer({ answer: 'Sorry — I could not reach the help assistant.', source: 'error' });
    } finally {
      setAsking(false);
    }
  }, []);

  const step = active?.steps[stepIndex] ?? null;

  // When the step changes, navigate to its route if needed, then locate the
  // anchored element (retry a few times to absorb route-transition + render
  // delay), scroll it into view, and start tracking its rect each frame.
  useEffect(() => {
    if (!step) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    if (step.route && pathname !== step.route) {
      router.push(step.route);
    }

    let cancelled = false;
    let tries = 0;
    const selector = `[data-tour-id="${step.anchor}"]`;

    const track = () => {
      if (cancelled) return;
      const el = document.querySelector(selector) as HTMLElement | null;
      if (el) {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        rafRef.current = requestAnimationFrame(track);
        return;
      }
      // not found yet — retry for ~3s (route transition / lazy render)
      tries += 1;
      if (tries === 1) setRect(null);
      if (tries < 90) {
        rafRef.current = requestAnimationFrame(track);
      }
    };

    // scroll into view once, then track
    const initial = document.querySelector(selector) as HTMLElement | null;
    initial?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    rafRef.current = requestAnimationFrame(track);

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step?.anchor, step?.route, stepIndex, active?.id]);

  const next = () => {
    if (!active) return;
    if (stepIndex + 1 >= active.steps.length) stopTour();
    else setStepIndex((i) => i + 1);
  };
  const prev = () => setStepIndex((i) => Math.max(0, i - 1));

  // Esc closes an active tour or the launcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (active) stopTour();
      else if (launcherOpen) setLauncherOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, launcherOpen, stopTour]);

  const visibleTours = matches ? matches.map((m) => m.tour) : tours;

  return (
    <GuidedTourContext.Provider value={{ startTour, openLauncher }}>
      {children}
      {mounted
        ? createPortal(
            <>
              {/* Spotlight overlay while a tour is active */}
              {active && step ? (
                <TourOverlay
                  rect={rect}
                  step={step}
                  index={stepIndex}
                  total={active.steps.length}
                  onNext={next}
                  onPrev={prev}
                  onStop={stopTour}
                  t={t}
                />
              ) : null}

              {/* Floating launcher button (hidden while a tour runs) */}
              {!active ? (
                <button
                  type="button"
                  onClick={() => setLauncherOpen((o) => !o)}
                  aria-label={t('Guides', 'Guides')}
                  title={t('Show me how', 'Show me how')}
                  style={launcherBtnStyle}
                >
                  <i className={`ti ${launcherOpen ? 'ti-x' : 'ti-help'}`} aria-hidden="true" />
                </button>
              ) : null}

              {/* Launcher panel */}
              {launcherOpen && !active ? (
                <TourLauncher
                  query={query}
                  setQuery={setQuery}
                  tours={visibleTours}
                  isSearch={!!matches}
                  onPick={startTour}
                  onAsk={ask}
                  asking={asking}
                  answer={answer}
                  onNavigate={(rt) => {
                    setLauncherOpen(false);
                    router.push(rt);
                  }}
                  onClose={() => setLauncherOpen(false)}
                  t={t}
                />
              ) : null}
            </>,
            document.body
          )
        : null}
    </GuidedTourContext.Provider>
  );
}

function TourOverlay({
  rect,
  step,
  index,
  total,
  onNext,
  onPrev,
  onStop,
  t,
}: {
  rect: Rect | null;
  step: TourStep;
  index: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onStop: () => void;
  t: (k: string, f?: string) => string;
}) {
  // Popover position: below the target if there's room, else above; falls back
  // to centered when the element isn't found (rect null).
  const pad = 6;
  const popWidth = 320;
  let popStyle: React.CSSProperties;
  if (rect) {
    const below = rect.top + rect.height + 12;
    const above = rect.top - 12;
    const placeBelow = below < window.innerHeight - 160;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - popWidth - 8);
    popStyle = placeBelow
      ? { top: below, left }
      : { top: Math.max(8, above - 150), left };
  } else {
    popStyle = { top: '40%', left: `calc(50% - ${popWidth / 2}px)` };
  }

  return (
    <>
      {/* Dimmer + spotlight cutout (box-shadow trick). Clicking the dimmer does
          nothing so the user can't lose the tour by a stray click; Esc / Done
          dismiss it. The target itself stays interactive (overlay has the hole). */}
      {rect ? (
        <div
          style={{
            position: 'fixed',
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            borderRadius: 8,
            boxShadow: '0 0 0 9999px rgba(13,46,77,0.55)',
            border: '2px solid var(--color-brand-blue, #2f6df6)',
            pointerEvents: 'none',
            zIndex: 9998,
            transition: 'all 0.15s ease',
          }}
        />
      ) : (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(13,46,77,0.55)', zIndex: 9998, pointerEvents: 'none' }}
        />
      )}

      <div style={{ position: 'fixed', width: popWidth, zIndex: 9999, ...popStyle }}>
        <div
          style={{
            background: 'var(--color-background-primary, #fff)',
            border: '1px solid var(--color-border, #e3e3df)',
            borderRadius: 8,
            boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
            padding: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {t('Step', 'Step')} {index + 1}/{total}
            </span>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              onClick={onStop}
              aria-label={t('Close', 'Close')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)' }}
            >
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>{step.title}</div>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginBottom: 12 }}>{step.instruction}</div>
          {!rect ? (
            <div style={{ fontSize: 11, color: 'var(--color-status-amber-text)', marginBottom: 10 }}>
              <i className="ti ti-loader-2" aria-hidden="true" /> {t('Looking for that on this page…', 'Looking for that on this page…')}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {index > 0 ? (
              <button type="button" onClick={onPrev} style={ghostBtn}>
                {t('Back', 'Back')}
              </button>
            ) : null}
            <button type="button" onClick={onNext} style={primaryBtn}>
              {index + 1 >= total ? t('Done', 'Done') : t('Next', 'Next')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function TourLauncher({
  query,
  setQuery,
  tours,
  isSearch,
  onPick,
  onAsk,
  asking,
  answer,
  onNavigate,
  onClose,
  t,
}: {
  query: string;
  setQuery: (v: string) => void;
  tours: Tour[];
  isSearch: boolean;
  onPick: (id: string) => void;
  onAsk: (q: string) => void;
  asking: boolean;
  answer: AskResult | null;
  onNavigate: (route: string) => void;
  onClose: () => void;
  t: (k: string, f?: string) => string;
}) {
  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        bottom: 76,
        width: 340,
        maxHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-background-primary, #fff)',
        border: '1px solid var(--color-border, #e3e3df)',
        borderRadius: 10,
        boxShadow: '0 12px 34px rgba(0,0,0,0.2)',
        zIndex: 9999,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border, #eee)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          <i className="ti ti-sparkles" aria-hidden="true" /> {t('Ask for help', 'Ask for help')}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAsk(query);
          }}
          style={{ display: 'flex', gap: 6 }}
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('e.g. how do I add a connector?', 'e.g. how do I add a connector?')}
            style={{
              flex: 1,
              padding: '8px 10px',
              fontSize: 12.5,
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: 6,
              outline: 'none',
            }}
          />
          <button type="submit" disabled={asking || !query.trim()} style={primaryBtn}>
            {asking ? <i className="ti ti-loader-2" aria-hidden="true" /> : t('Ask', 'Ask')}
          </button>
        </form>
      </div>

      {/* Assistant answer */}
      {answer ? (
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--color-border, #eee)', background: 'var(--color-background-secondary, #f8f8f6)' }}>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--color-text-primary)' }}>{answer.answer}</div>
          {answer.suggested_tour ? (
            <button type="button" onClick={() => onPick(answer.suggested_tour!.id)} style={{ ...primaryBtn, marginTop: 10 }}>
              <i className="ti ti-pointer" aria-hidden="true" /> {t('Show me', 'Show me')}: {answer.suggested_tour.title}
            </button>
          ) : answer.route ? (
            <button type="button" onClick={() => onNavigate(answer.route!)} style={{ ...primaryBtn, marginTop: 10 }}>
              <i className="ti ti-external-link" aria-hidden="true" /> {t('Open page', 'Open page')}
            </button>
          ) : null}
          {answer.citations && answer.citations.length > 0 ? (
            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 8 }}>
              {t('Source', 'Source')}: {answer.citations.map((c) => c.title).join(' · ')}
              {answer.source?.startsWith('llm:') ? ' · AI' : answer.source === 'manual' ? ' · manual' : ''}
            </div>
          ) : null}
        </div>
      ) : null}
      <div style={{ overflowY: 'auto', padding: 8 }}>
        {tours.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
            {isSearch ? t('No matching guide.', 'No matching guide.') : t('No guides available.', 'No guides available.')}
          </div>
        ) : (
          tours.map((tour) => (
            <button
              key={tour.id}
              type="button"
              onClick={() => onPick(tour.id)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '9px 10px',
                marginBottom: 4,
                background: 'none',
                border: '1px solid transparent',
                borderRadius: 6,
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-background-secondary, #f6f6f4)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{tour.title}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 2 }}>{tour.description}</div>
            </button>
          ))
        )}
      </div>
      <div style={{ padding: '8px 14px', borderTop: '1px solid var(--color-border, #eee)', textAlign: 'right' }}>
        <button type="button" onClick={onClose} style={ghostBtn}>
          {t('Close', 'Close')}
        </button>
      </div>
    </div>
  );
}

const launcherBtnStyle: React.CSSProperties = {
  position: 'fixed',
  right: 20,
  bottom: 20,
  width: 44,
  height: 44,
  borderRadius: '50%',
  border: 'none',
  cursor: 'pointer',
  background: 'var(--color-brand-navy, #0d2e4d)',
  color: '#fff',
  fontSize: 18,
  boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
  zIndex: 9997,
};

const primaryBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 12,
  fontWeight: 600,
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'var(--color-brand-navy, #0d2e4d)',
  color: '#fff',
};

const ghostBtn: React.CSSProperties = {
  padding: '6px 12px',
  fontSize: 12,
  border: '1px solid var(--color-border, #ddd)',
  borderRadius: 6,
  cursor: 'pointer',
  background: 'none',
  color: 'var(--color-text-secondary, #444)',
};
