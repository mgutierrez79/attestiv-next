// Pure helpers for the posture-history sparkline (src/views/AttestivPostureHistoryPage.tsx).
//
// Kept framework-free and side-effect-free so the geometry/formatting logic is
// unit-testable without rendering React. The view layer turns the geometry this
// module produces into an inline SVG.

/**
 * Format a 0–100 score as a fixed 2-decimal percentage string (no '%' suffix).
 * Non-finite input collapses to '—' so a bad datapoint never renders as 'NaN%'.
 */
export function formatScore(value: number | undefined | null): string {
  if (value === null || value === undefined) return '—'
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

/**
 * Reduce a long value series to at most `target` points so a chart packed with
 * ~1000 samples reads as a clean trend rather than dense noise.
 *
 * Each output point is the MEDIAN of its bucket. Median (not min) is deliberate:
 * a single transient dip/spike inside a bucket is outvoted by its neighbours, so
 * lone-sample noise does not dominate — but a SUSTAINED drop (most of a bucket
 * sitting low) survives, because the median of a mostly-low bucket is low. This
 * cleans noise without flattening real regressions.
 */
export function downsample(values: number[], target: number): number[] {
  if (target < 1) return []
  if (values.length <= target) return values.slice()
  const bucketSize = values.length / target
  const out: number[] = []
  for (let i = 0; i < target; i += 1) {
    const start = Math.floor(i * bucketSize)
    const end = Math.min(values.length, Math.floor((i + 1) * bucketSize))
    const bucket = values.slice(start, Math.max(end, start + 1))
    out.push(median(bucket))
  }
  return out
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

export type Domain = { min: number; max: number }

/**
 * Pick a sensible y-domain around the data instead of a hard floor.
 *
 * Top is fixed at `ceiling` (100 — the score cap). Bottom is the data minimum
 * minus `pad`, clamped to >= 0, so the trend uses the available vertical space
 * and isn't squished against the top. A genuine dip toward 0 widens the domain
 * (the line dives) rather than being clipped flat.
 */
export function yDomain(values: number[], pad = 4, ceiling = 100): Domain {
  if (values.length === 0) return { min: ceiling - 1, max: ceiling }
  const dataMin = Math.min(...values)
  const min = Math.max(0, dataMin - pad)
  // Guarantee a non-zero range even when every sample equals the ceiling.
  const max = Math.max(ceiling, min + 1)
  return { min, max }
}

export type Pt = { x: number; y: number }

/**
 * Map values to evenly-spaced SVG points within [0,width] × [0,height],
 * inverting y (SVG origin is top-left) against the supplied domain.
 */
export function toPoints(values: number[], width: number, height: number, domain: Domain): Pt[] {
  const range = Math.max(1e-6, domain.max - domain.min)
  const stepX = values.length > 1 ? width / (values.length - 1) : 0
  return values.map((value, index) => {
    const clamped = Math.min(domain.max, Math.max(domain.min, value))
    const x = values.length > 1 ? stepX * index : width / 2
    const y = height - ((clamped - domain.min) / range) * height
    return { x, y }
  })
}

/**
 * Build a smoothed line path (Catmull-Rom converted to cubic béziers).
 * `tension` near 0 hugs the points; the curve passes through every point, so
 * no real value is invented or hidden — only the segments between points bow
 * gently instead of forming hard jagged corners.
 */
export function smoothPath(points: Pt[], tension = 0.5): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${fmt(points[0].x)} ${fmt(points[0].y)}`
  let d = `M ${fmt(points[0].x)} ${fmt(points[0].y)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension * 2
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension * 2
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension * 2
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension * 2
    d += ` C ${fmt(c1x)} ${fmt(c1y)}, ${fmt(c2x)} ${fmt(c2y)}, ${fmt(p2.x)} ${fmt(p2.y)}`
  }
  return d
}

/**
 * Close a smoothed line into an area by dropping to the baseline and back,
 * so it can be filled with a fading gradient.
 */
export function areaPath(linePath: string, width: number, height: number): string {
  if (!linePath) return ''
  return `${linePath} L ${fmt(width)} ${fmt(height)} L 0 ${fmt(height)} Z`
}

function fmt(n: number): string {
  return Number.isFinite(n) ? n.toFixed(1) : '0'
}
