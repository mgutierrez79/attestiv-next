'use client'

// CountUp — animates a number from 0 up to its target on mount (and
// from the previous value to the new one when it changes). Used for the
// headline metrics so the dashboard "lands" with motion instead of
// snapping into place. Honours prefers-reduced-motion (jumps straight to
// the value) and uses tabular-friendly integer/decimal formatting.

import { useEffect, useRef, useState } from 'react'

export function CountUp({
  value,
  durationMs = 700,
  decimals = 0,
  prefix = '',
  suffix = '',
  format,
}: {
  value: number
  durationMs?: number
  decimals?: number
  prefix?: string
  suffix?: string
  format?: (n: number) => string
}) {
  // Start from 0 so the first paint animates upward. SSR and the initial
  // client render both produce 0 → no hydration mismatch.
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const from = fromRef.current
    const to = Number.isFinite(value) ? value : 0

    if (prefersReduced || durationMs <= 0 || from === to) {
      setDisplay(to)
      fromRef.current = to
      return
    }

    let start: number | null = null
    const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3)
    const tick = (ts: number) => {
      if (start === null) start = ts
      const p = Math.min(1, (ts - start) / durationMs)
      setDisplay(from + (to - from) * easeOutCubic(p))
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      // Land on the target so a mid-flight value change animates from it.
      fromRef.current = to
    }
  }, [value, durationMs])

  const body =
    decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString()
  const text = format ? format(display) : `${prefix}${body}${suffix}`
  return <>{text}</>
}
