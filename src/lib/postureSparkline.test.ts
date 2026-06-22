import { describe, it, expect } from 'vitest'

import {
  areaPath,
  downsample,
  formatScore,
  smoothPath,
  toPoints,
  yDomain,
} from './postureSparkline'

describe('formatScore', () => {
  it('renders a 2-decimal percentage value', () => {
    expect(formatScore(60.720526644981064)).toBe('60.72')
  })

  it('keeps integers as 2-decimal for consistency', () => {
    expect(formatScore(60)).toBe('60.00')
  })

  it('rounds half away as toFixed does', () => {
    expect(formatScore(99.999)).toBe('100.00')
  })

  it('collapses non-finite input to an em dash', () => {
    expect(formatScore(NaN)).toBe('—')
    expect(formatScore(undefined)).toBe('—')
    expect(formatScore(null)).toBe('—')
    expect(formatScore(Infinity)).toBe('—')
  })
})

describe('downsample', () => {
  it('returns input unchanged when already within target', () => {
    const v = [90, 91, 92]
    expect(downsample(v, 10)).toEqual(v)
    expect(downsample(v, 10)).not.toBe(v) // copy, not same ref
  })

  it('reduces a long series to at most target points', () => {
    const v = Array.from({ length: 1040 }, (_, i) => 80 + (i % 5))
    expect(downsample(v, 120).length).toBe(120)
  })

  it('suppresses a lone transient dip (median outvotes the outlier)', () => {
    // A bucket that is mostly 90 with one 0 spike should not read as 0.
    const v = [90, 90, 90, 0, 90, 90, 90, 90, 90, 90]
    const out = downsample(v, 1)
    expect(out[0]).toBe(90)
  })

  it('preserves a sustained drop (most of the bucket is low)', () => {
    const v = [10, 12, 11, 9, 13, 90, 88, 91, 89, 90]
    // first half sustained-low, second half high
    const first = downsample(v.slice(0, 5), 1)[0]
    const second = downsample(v.slice(5), 1)[0]
    expect(first).toBeLessThan(20)
    expect(second).toBeGreaterThan(85)
  })

  it('returns empty for non-positive target', () => {
    expect(downsample([1, 2, 3], 0)).toEqual([])
  })
})

describe('yDomain', () => {
  it('fixes the top at the ceiling and pads below the data minimum', () => {
    const d = yDomain([88, 90, 95], 4, 100)
    expect(d.max).toBe(100)
    expect(d.min).toBe(84)
  })

  it('clamps the bottom at zero for a deep dip', () => {
    const d = yDomain([2, 90, 91], 4, 100)
    expect(d.min).toBe(0)
  })

  it('never produces a zero range when all values equal the ceiling', () => {
    const d = yDomain([100, 100, 100], 4, 100)
    expect(d.max).toBeGreaterThan(d.min)
  })
})

describe('toPoints', () => {
  const domain = { min: 0, max: 100 }

  it('places the first point left and last point right', () => {
    const pts = toPoints([50, 50, 50], 320, 60, domain)
    expect(pts[0].x).toBe(0)
    expect(pts[2].x).toBe(320)
  })

  it('inverts y so a high score sits near the top (small y)', () => {
    const pts = toPoints([100, 0], 320, 60, domain)
    expect(pts[0].y).toBe(0)
    expect(pts[1].y).toBe(60)
  })

  it('clamps values outside the domain', () => {
    const pts = toPoints([150, -50], 320, 60, domain)
    expect(pts[0].y).toBe(0) // clamped to max
    expect(pts[1].y).toBe(60) // clamped to min
  })
})

describe('smoothPath', () => {
  it('returns an empty string for no points', () => {
    expect(smoothPath([])).toBe('')
  })

  it('emits a move-only path for a single point', () => {
    expect(smoothPath([{ x: 10, y: 20 }])).toBe('M 10.0 20.0')
  })

  it('passes through every point (each becomes a curve endpoint)', () => {
    const pts = toPoints([90, 80, 95], 320, 60, { min: 70, max: 100 })
    const d = smoothPath(pts)
    expect(d.startsWith('M ')).toBe(true)
    // one cubic segment per gap between points
    expect((d.match(/ C /g) ?? []).length).toBe(pts.length - 1)
    // last endpoint coordinates appear in the path
    expect(d).toContain(`${pts[2].x.toFixed(1)} ${pts[2].y.toFixed(1)}`)
  })
})

describe('areaPath', () => {
  it('closes the line down to the baseline', () => {
    const area = areaPath('M 0 10 C 1 1, 2 2, 320 5', 320, 60)
    expect(area).toContain('L 320.0 60.0')
    expect(area).toContain('L 0 60.0')
    expect(area.endsWith('Z')).toBe(true)
  })

  it('returns empty for an empty line', () => {
    expect(areaPath('', 320, 60)).toBe('')
  })
})
