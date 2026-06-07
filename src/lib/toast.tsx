'use client'

// Toast notification system.
//
// Provides a lightweight, auto-dismissing toast stack rendered at the
// bottom-right of the viewport. Pages call useToast() to get a toast
// object with success/error/info/warning methods. The stack is managed
// by ToastProvider which should wrap the app root (in Providers.tsx).
//
// Usage:
//   const { toast } = useToast()
//   toast.success('Report generated')
//   toast.error('Failed to load frameworks')

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties, ReactNode } from 'react'

type ToastTone = 'success' | 'error' | 'info' | 'warning'

type ToastEntry = {
  id: string
  tone: ToastTone
  message: string
  duration: number
}

type ToastContextValue = {
  addToast: (tone: ToastTone, message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextValue>({ addToast: () => {} })

const PALETTE: Record<ToastTone, { bg: string; fg: string; border: string; icon: string }> = {
  success: {
    bg: 'var(--color-status-green-bg)',
    fg: 'var(--color-status-green-deep)',
    border: 'var(--color-status-green-mid)',
    icon: 'ti-circle-check',
  },
  error: {
    bg: 'var(--color-status-red-bg)',
    fg: 'var(--color-status-red-deep)',
    border: 'var(--color-status-red-mid)',
    icon: 'ti-alert-circle',
  },
  info: {
    bg: 'var(--color-status-blue-bg)',
    fg: 'var(--color-status-blue-deep)',
    border: 'var(--color-brand-blue-soft)',
    icon: 'ti-info-circle',
  },
  warning: {
    bg: 'var(--color-status-amber-bg)',
    fg: 'var(--color-status-amber-text)',
    border: 'var(--color-status-amber-mid)',
    icon: 'ti-alert-triangle',
  },
}

function ToastItem({
  entry,
  onRemove,
}: {
  entry: ToastEntry
  onRemove: (id: string) => void
}) {
  useEffect(() => {
    const t = setTimeout(() => onRemove(entry.id), entry.duration)
    return () => clearTimeout(t)
  }, [entry.id, entry.duration, onRemove])

  const p = PALETTE[entry.tone]
  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '11px 14px',
    background: p.bg,
    color: p.fg,
    border: `1px solid ${p.border}50`,
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,0.13)',
    fontSize: 13,
    lineHeight: 1.45,
    minWidth: 260,
    maxWidth: 400,
    animation: 'attestiv-toast-in 200ms ease',
    fontFamily: 'var(--font-sans)',
  }
  return (
    <div style={style} role="status" aria-live="polite">
      <i
        className={`ti ${p.icon}`}
        aria-hidden="true"
        style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}
      />
      <span style={{ flex: 1 }}>{entry.message}</span>
      <button
        type="button"
        onClick={() => onRemove(entry.id)}
        aria-label="Dismiss"
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: p.fg,
          opacity: 0.6,
          padding: 2,
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 13 }} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const counter = useRef(0)

  const addToast = useCallback(
    (tone: ToastTone, message: string, duration = 4000) => {
      const id = `toast-${++counter.current}`
      setToasts((prev) => [...prev, { id, tone, message, duration }])
    },
    [],
  )

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const containerStyle: CSSProperties = {
    position: 'fixed',
    bottom: 24,
    right: 24,
    zIndex: 9999,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    pointerEvents: toasts.length > 0 ? 'auto' : 'none',
  }

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div style={containerStyle} aria-label="Notifications">
        {toasts.map((entry) => (
          <ToastItem key={entry.id} entry={entry} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const { addToast } = useContext(ToastContext)
  return {
    toast: {
      success: (message: string, duration?: number) =>
        addToast('success', message, duration),
      error: (message: string, duration?: number) =>
        addToast('error', message, duration),
      info: (message: string, duration?: number) =>
        addToast('info', message, duration),
      warning: (message: string, duration?: number) =>
        addToast('warning', message, duration),
    },
  }
}
