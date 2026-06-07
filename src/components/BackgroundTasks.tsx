'use client';

// BackgroundTasksProvider — a tiny global registry for long-running actions
// (e.g. "update inventory from connectors") so the UI can show a RUNNING
// indicator that survives page navigation. It lives in the console layout, so
// it stays mounted while the user moves between pages; the indicator is a fixed
// pill rendered via a portal. Keyed tasks let a page reflect "still running"
// even after you navigate away and come back.

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

type Task = { key: string; label: string };

type Ctx = {
  // run registers a keyed task, runs fn, and clears it on settle. Returns fn's
  // result. A second call with the same key while one is in flight is ignored
  // (returns undefined) to avoid duplicate work.
  run: <T>(key: string, label: string, fn: () => Promise<T>) => Promise<T | undefined>;
  isRunning: (key: string) => boolean;
};

const BackgroundTasksContext = createContext<Ctx | null>(null);

export function useBackgroundTasks(): Ctx {
  const ctx = useContext(BackgroundTasksContext);
  if (!ctx) throw new Error('useBackgroundTasks must be used inside BackgroundTasksProvider');
  return ctx;
}

export function BackgroundTasksProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const run = useCallback(async <T,>(key: string, label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    let started = false;
    setTasks((prev) => {
      if (prev.some((t) => t.key === key)) return prev;
      started = true;
      return [...prev, { key, label }];
    });
    if (!started) return undefined;
    try {
      return await fn();
    } finally {
      setTasks((prev) => prev.filter((t) => t.key !== key));
    }
  }, []);

  const isRunning = useCallback((key: string) => tasks.some((t) => t.key === key), [tasks]);

  return (
    <BackgroundTasksContext.Provider value={{ run, isRunning }}>
      {children}
      {mounted && tasks.length > 0
        ? createPortal(
            <div
              style={{
                position: 'fixed',
                left: 20,
                bottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 14px',
                borderRadius: 20,
                background: 'var(--color-brand-navy, #0d2e4d)',
                color: '#fff',
                fontSize: 12,
                boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
                zIndex: 9997,
              }}
              role="status"
              aria-live="polite"
            >
              <span
                aria-hidden="true"
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  display: 'inline-block',
                  animation: 'attestiv-bgtask-spin 0.8s linear infinite',
                }}
              />
              {tasks[0].label}
              {tasks.length > 1 ? ` (+${tasks.length - 1})` : ''}
              <style>{'@keyframes attestiv-bgtask-spin{to{transform:rotate(360deg)}}'}</style>
            </div>,
            document.body
          )
        : null}
    </BackgroundTasksContext.Provider>
  );
}
