'use client'

// Attestiv base UI components.
//
// These are the small primitives that compose into pages. Keep them
// dumb and styled via the design tokens in globals.css — no
// component should bake in colors. If a new visual variant comes up,
// add a token first, then add the component variant; never inline.

import type {
  CSSProperties,
  InputHTMLAttributes,
  PropsWithChildren,
  ReactNode,
  SelectHTMLAttributes,
  ThHTMLAttributes,
} from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'

type Tone =
  | 'green'
  | 'amber'
  | 'red'
  | 'blue'
  | 'navy'
  | 'gray'

// Tone palette — bg / deep / mid (mid is used for the optional 1px
// outline + leading status dot, deep for the text, bg for the
// surface). Enterprise-grade restraint: low-saturation tints, sharp
// 4px corners (not the 20px pill that read as "marketing chip"),
// 1px border that pulls the badge off the page without dominating.
const badgePalette: Record<Tone, { bg: string; deep: string; mid: string }> = {
  green: { bg: 'var(--color-status-green-bg)', deep: 'var(--color-status-green-deep)', mid: 'var(--color-status-green-mid)' },
  amber: { bg: 'var(--color-status-amber-bg)', deep: 'var(--color-status-amber-deep)', mid: 'var(--color-status-amber-mid)' },
  red:   { bg: 'var(--color-status-red-bg)',   deep: 'var(--color-status-red-deep)',   mid: 'var(--color-status-red-mid)' },
  blue:  { bg: 'var(--color-status-blue-bg)',  deep: 'var(--color-status-blue-deep)',  mid: 'var(--color-status-blue-mid)' },
  navy:  { bg: 'var(--color-brand-navy)',      deep: 'var(--color-brand-blue-pale)',   mid: 'var(--color-brand-blue)' },
  gray:  { bg: 'var(--color-background-tertiary)', deep: '#444441',                    mid: '#9c9b95' },
}

export function Badge({
  tone = 'gray',
  icon,
  dot,
  title,
  children,
}: PropsWithChildren<{ tone?: Tone; icon?: string; dot?: boolean; title?: string }>) {
  const colors = badgePalette[tone]
  const baseBadge: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 10.5,
    lineHeight: 1,
    padding: '4px 9px',
    borderRadius: 4,
    fontWeight: 500,
    letterSpacing: '0.01em',
    whiteSpace: 'nowrap',
    background: colors.bg,
    color: colors.deep,
    border: `1px solid ${colors.mid}33`, // 33 = 20% alpha — visible only on close inspection
  }
  return (
    <span style={baseBadge} title={title}>
      {dot ? (
        <span
          aria-hidden="true"
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: colors.mid,
          }}
        />
      ) : null}
      {icon ? <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 11 }} /> : null}
      {children}
    </span>
  )
}

// ScoreBadge — for the framework cards. Shows the percentage with a
// leading status dot + the number in a slightly heavier weight than
// the regular Badge, so an auditor scanning the page reads "85%"
// before they read the framework name. Stays inside the same tone
// system so the visual language is consistent with StatusBadge.
export function ScoreBadge({
  tone,
  value,
}: {
  tone: Tone
  value: string
}) {
  const colors = badgePalette[tone]
  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'baseline',
    gap: 6,
    fontSize: 12,
    lineHeight: 1,
    padding: '5px 11px',
    borderRadius: 4,
    fontWeight: 600,
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap',
    background: colors.bg,
    color: colors.deep,
    border: `1px solid ${colors.mid}40`,
  }
  return (
    <span style={style}>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-block',
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: colors.mid,
          alignSelf: 'center',
        }}
      />
      {value}
    </span>
  )
}

// StatusBadge is a thin wrapper around Badge that picks the right
// tone + icon for a control / framework status string. Used across
// the scoring views so PASS/REVIEW/WARN/FAIL look identical
// everywhere (no tone-only color labels — every status carries an
// icon glyph for color-blind users + faster scanning).
export function StatusBadge({ status }: { status: string }) {
  const upper = String(status || '').toUpperCase()
  const map: Record<string, { tone: Tone; icon: string; label: string }> = {
    PASS:           { tone: 'green', icon: 'ti-circle-check',     label: 'PASS' },
    REVIEW:         { tone: 'amber', icon: 'ti-zoom-question',    label: 'REVIEW' },
    WARN:           { tone: 'amber', icon: 'ti-alert-triangle',   label: 'WARN' },
    FAIL:           { tone: 'red',   icon: 'ti-circle-x',         label: 'FAIL' },
    NO_DATA:        { tone: 'gray',  icon: 'ti-circle-dashed',    label: 'NO DATA' },
    NOT_APPLICABLE: { tone: 'gray',  icon: 'ti-minus',            label: 'N/A' },
  }
  const entry = map[upper] ?? { tone: 'gray' as Tone, icon: 'ti-circle', label: status || '—' }
  return (
    <Badge tone={entry.tone} icon={entry.icon}>
      {entry.label}
    </Badge>
  )
}

export function Pulse() {
  return <span className="attestiv-pulse" aria-hidden="true" />
}

export function Card({ children, style }: PropsWithChildren<{ style?: CSSProperties }>) {
  return (
    <div
      style={{
        background: 'var(--color-background-primary)',
        border: 'none',
        borderRadius: 'var(--border-radius-lg)',
        padding: '16px 20px',
        marginBottom: 12,
        boxShadow: 'var(--shadow-card)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function CardTitle({ children, right }: PropsWithChildren<{ right?: ReactNode }>) {
  return (
    <div
      style={{
        fontSize: 12,
        fontWeight: 500,
        marginBottom: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 4,
      }}
    >
      <span>{children}</span>
      {right ? <span>{right}</span> : null}
    </div>
  )
}

export function MetricCard({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  valueColor?: string
}) {
  return (
    <div
      style={{
        background: 'var(--color-background-secondary)',
        borderRadius: 'var(--border-radius-md)',
        padding: '12px 16px',
        boxShadow: '0 0 0 0.5px rgba(0, 0, 0, 0.04)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: 'var(--color-text-tertiary)',
          marginBottom: 8,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: '-0.02em',
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 4 }}>{sub}</div>
      ) : null}
    </div>
  )
}

// StatPill — compact metric tile used inside hero bands (smaller than
// MetricCard, sits four-up next to a big headline number). Shared so
// every page's hero reads identically.
export function StatPill({
  label,
  value,
  sub,
  valueColor,
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  valueColor?: string
}) {
  return (
    <div
      style={{
        background: 'var(--color-background-secondary)',
        borderRadius: 'var(--border-radius-md)',
        padding: '12px 14px',
        boxShadow: '0 0 0 0.5px rgba(0, 0, 0, 0.04)',
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-tertiary)',
          marginBottom: 6,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          lineHeight: 1,
          letterSpacing: '-0.01em',
          fontVariantNumeric: 'tabular-nums',
          color: valueColor,
        }}
      >
        {value}
      </div>
      {sub ? (
        <div
          style={{
            fontSize: 11,
            color: 'var(--color-text-tertiary)',
            marginTop: 5,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {sub}
        </div>
      ) : null}
    </div>
  )
}

// HeroBand — the trust-grade headline band: a big posture number with a
// progress bar on the left, and a grid of StatPills on the right. Used
// at the top of the Dashboard, Frameworks, and other summary pages so
// the primary number always reads the same way.
// HeroSegment describes one slice of the layered posture bar. Used
// when the headline metric has a meaningful three-way decomposition
// (e.g. passing vs measured-but-not-passing vs unevidenced), where a
// single-color bar would hide the gap between "measured" and "passing".
export type HeroSegment = {
  // 0..100 — width of this segment as a percentage of the bar.
  percent: number
  // CSS color value for the segment fill.
  color: string
  // Legend label (e.g. "passing", "measured · not passing"). Optional;
  // when absent the segment renders without a legend entry.
  label?: string
  // Raw count (e.g. 47 passing controls). Shown next to the label.
  count?: number
}

export function HeroBand({
  label,
  value,
  percent,
  caption,
  pills,
  segments,
}: {
  label: string
  value: string
  // When omitted, the progress bar is hidden and the headline renders
  // in the primary text color — for count-style heroes (e.g. an audit
  // entry count) where there's no natural percentage.
  percent?: number
  caption?: ReactNode
  pills?: ReactNode
  // When provided, replaces the single-color bar with a layered
  // composition. The bar's grey background is the implicit "rest" —
  // segments should not sum to 100% unless the entire denominator is
  // accounted for. A legend renders under the bar.
  segments?: HeroSegment[]
}) {
  const hasBar = typeof percent === 'number'
  const color = !hasBar
    ? 'var(--color-text-primary)'
    : percent! >= 85
      ? 'var(--color-status-green-deep)'
      : percent! >= 60
        ? 'var(--color-status-amber-text)'
        : 'var(--color-status-red-deep)'
  const fill =
    (percent ?? 0) >= 85
      ? 'var(--color-status-green-mid)'
      : (percent ?? 0) >= 60
        ? 'var(--color-status-amber-mid)'
        : 'var(--color-status-red-mid)'
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: pills ? 'minmax(280px, 1.3fr) 1fr' : '1fr',
        gap: 28,
        background: 'var(--color-background-primary)',
        borderRadius: 'var(--border-radius-lg)',
        boxShadow: 'var(--shadow-card)',
        padding: '28px 32px',
        marginBottom: 20,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--color-text-tertiary)',
            marginBottom: 12,
          }}
        >
          {label}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
          <span
            style={{
              fontSize: 56,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '-0.03em',
              fontVariantNumeric: 'tabular-nums',
              color,
            }}
          >
            {value}
          </span>
        </div>
        {hasBar && segments && segments.length > 0 ? (
          <>
            <div
              style={{
                height: 10,
                borderRadius: 999,
                background: 'var(--color-background-tertiary)',
                overflow: 'hidden',
                marginBottom: 8,
                display: 'flex',
              }}
            >
              {segments.map((seg, idx) => (
                <div
                  key={idx}
                  style={{
                    height: '100%',
                    width: `${Math.max(0, Math.min(100, seg.percent))}%`,
                    background: seg.color,
                    transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)',
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 12, fontSize: 11, color: 'var(--color-text-tertiary)' }}>
              {segments.filter((s) => s.label).map((seg, idx) => (
                <span key={idx} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: seg.color, display: 'inline-block' }} />
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {seg.label}
                    {typeof seg.count === 'number' ? ` ${seg.count}` : ''}
                  </span>
                </span>
              ))}
            </div>
          </>
        ) : hasBar ? (
          <div
            style={{
              height: 10,
              borderRadius: 999,
              background: 'var(--color-background-tertiary)',
              overflow: 'hidden',
              marginBottom: 12,
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${Math.max(0, Math.min(100, percent!))}%`,
                borderRadius: 999,
                background: fill,
                transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            />
          </div>
        ) : null}
        {caption ? (
          <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{caption}</div>
        ) : null}
      </div>
      {pills ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignContent: 'center' }}>
          {pills}
        </div>
      ) : null}
    </div>
  )
}

const buttonBase: CSSProperties = {
  borderRadius: 'var(--border-radius-md)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontFamily: 'inherit',
  padding: '6px 14px',
  border: 'none',
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = 'button',
  ...rest
}: PropsWithChildren<{
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
  'data-tour-id'?: string
}>) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      {...rest}
      style={{
        ...buttonBase,
        background: 'var(--color-brand-blue)',
        color: 'white',
        opacity: disabled ? 0.5 : 1,
        boxShadow: '0 1px 2px rgba(4, 44, 83, 0.16), inset 0 1px 0 rgba(255, 255, 255, 0.16)',
      }}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  disabled,
  type = 'button',
}: PropsWithChildren<{
  onClick?: () => void
  disabled?: boolean
  type?: 'button' | 'submit'
}>) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...buttonBase,
        background: 'transparent',
        border: '0.5px solid var(--color-border-secondary)',
        color: 'var(--color-text-primary)',
        padding: '5px 12px',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

// FrameworkBar: a compact "name | progress | percent" row. Used on the
// dashboard's framework posture card and on framework detail pages.
export function FrameworkBar({
  name,
  percent,
  tone = 'auto',
  passing,
  regulationTotal,
  covered,
}: {
  name: string
  // When the layered breakdown props (passing + regulationTotal) are
  // supplied, percent is recomputed as the coverage-adjusted score
  // (passing / regulationTotal). The legacy `percent` is still
  // accepted as a fallback for callers that don't yet have the
  // regulation_total wired.
  percent: number
  tone?: 'green' | 'amber' | 'red' | 'auto'
  // Optional: pass these to render a layered bar
  // (green passing · amber measured-not-passing · grey unevidenced)
  // and override the percent display with the coverage-adjusted figure.
  passing?: number
  regulationTotal?: number
  covered?: number
}) {
  const hasLayered = typeof passing === 'number' && typeof regulationTotal === 'number' && regulationTotal > 0
  const displayPercent = hasLayered ? Math.round((passing! / regulationTotal!) * 100) : percent
  const measuredNotPassing = hasLayered ? Math.max(0, (covered ?? passing!) - passing!) : 0
  const passingPct = hasLayered ? Math.round((passing! / regulationTotal!) * 100) : 0
  const measuredPct = hasLayered ? Math.round((measuredNotPassing / regulationTotal!) * 100) : 0
  const resolved = tone === 'auto'
    ? displayPercent >= 95 ? 'green' : displayPercent >= 85 ? 'amber' : 'red'
    : tone
  const fillColor =
    resolved === 'green' ? 'var(--color-status-green-mid)' :
    resolved === 'amber' ? 'var(--color-status-amber-mid)' :
    'var(--color-status-red-mid)'
  const textColor =
    resolved === 'green' ? 'var(--color-status-green-deep)' :
    resolved === 'amber' ? 'var(--color-status-amber-text)' :
    'var(--color-status-red-deep)'
  const tooltip = hasLayered
    ? `${passing} passing · ${measuredNotPassing} measured but not passing · ${Math.max(0, regulationTotal! - (covered ?? passing!))} unevidenced of ${regulationTotal}`
    : undefined
  return (
    <div
      title={tooltip}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 12,
      }}
    >
      <div style={{ fontWeight: 500, flex: 1 }}>{name}</div>
      <div
        style={{
          width: 80,
          height: 5,
          background: 'var(--color-border-tertiary)',
          borderRadius: 3,
          overflow: 'hidden',
          flexShrink: 0,
          display: 'flex',
        }}
      >
        {hasLayered ? (
          <>
            <div style={{ height: '100%', width: `${passingPct}%`, background: 'var(--color-status-green-mid)' }} />
            <div style={{ height: '100%', width: `${measuredPct}%`, background: 'var(--color-status-amber-mid)' }} />
          </>
        ) : (
          <div style={{ height: '100%', borderRadius: 3, width: `${percent}%`, background: fillColor }} />
        )}
      </div>
      <div style={{ fontSize: 11, fontWeight: 500, width: 32, textAlign: 'right', color: textColor }}>
        {displayPercent}%
      </div>
    </div>
  )
}

// SourceRow: connector status row for the dashboard. Icon + name +
// sub + progress bar + status badge.
export function SourceRow({
  icon,
  iconBg,
  iconColor,
  logo,
  name,
  sub,
  bar,
  barColor,
  badge,
}: {
  icon?: string
  iconBg: string
  iconColor?: string
  logo?: ReactNode
  name: string
  sub: string
  bar: number
  barColor: string
  badge: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '7px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 12,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 6,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: iconBg,
        }}
      >
        {logo ? logo : icon ? (
          <i className={`ti ${icon}`} aria-hidden="true" style={{ color: iconColor, fontSize: 13 }} />
        ) : null}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {name}
        </div>
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 1 }}>{sub}</div>
        <div
          style={{
            height: 4,
            background: 'var(--color-border-tertiary)',
            borderRadius: 2,
            marginTop: 4,
            overflow: 'hidden',
          }}
        >
          <div style={{ height: '100%', borderRadius: 2, width: `${bar}%`, background: barColor }} />
        </div>
      </div>
      {badge}
    </div>
  )
}

// PipelineStep: timeline step with colored dot, name, description,
// and right-aligned timestamp. Used for "Recent pipeline activity".
export function PipelineStep({
  dotColor,
  name,
  desc,
  time,
}: {
  dotColor: string
  name: string
  desc: string
  time: string
}) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 10,
        padding: '9px 0',
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        fontSize: 12,
        alignItems: 'flex-start',
      }}
    >
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 3,
          background: dotColor,
        }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, marginBottom: 2 }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{desc}</div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>
        {time}
      </div>
    </div>
  )
}

// Topbar: the per-page header strip. Title left, slot for badge, slot
// for actions on the right.
//
// When `title` is a plain string, the component looks it up in the i18n
// dictionary using the English string itself as the key (with the same
// string as the default fallback). This means every page that does
// <Topbar title="Dashboard" /> automatically gets translated when the
// dictionary has an entry — no per-page edits needed. ReactNode titles
// (badges, icons) pass through untouched.
export function Topbar({
  title,
  left,
  right,
}: {
  title: ReactNode
  left?: ReactNode
  right?: ReactNode
}) {
  const { t } = useI18n()
  const translatedTitle = typeof title === 'string' ? t(title, title) : title
  return (
    <div className="attestiv-topbar">
      <div className="attestiv-topbar-left">
        <span className="attestiv-topbar-title">{translatedTitle}</span>
        {left}
      </div>
      <div className="attestiv-topbar-right">{right}</div>
    </div>
  )
}

// SignatureBox: monospace block for displaying an Ed25519 signature,
// public-key URL, manifest digest, or any other long opaque token.
// Truncates with ellipsis when content overflows the box width;
// hovering or clicking the copy button pulls the full value to the
// clipboard. Copy is the primary affordance because these values are
// consumed by external auditor tooling, not read by humans.
export function SignatureBox({
  label,
  value,
  mono = true,
}: {
  label?: string
  value: string
  mono?: boolean
}) {
  const {
    t
  } = useI18n();

  return (
    <div
      style={{
        background: 'var(--color-background-secondary)',
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-md)',
        padding: '8px 10px',
        fontSize: 11,
        color: 'var(--color-text-secondary)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        overflow: 'hidden',
      }}
    >
      {label ? (
        <span
          style={{
            color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            fontSize: 10,
            flexShrink: 0,
          }}
        >
          {label}
        </span>
      ) : null}
      <span
        style={{
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          color: 'var(--color-text-primary)',
        }}
      >
        {value}
      </span>
      <button
        type="button"
        onClick={() => {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            void navigator.clipboard.writeText(value)
          }
        }}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          color: 'var(--color-text-tertiary)',
          padding: 2,
          flexShrink: 0,
        }}
        aria-label={t('Copy', 'Copy')}
      >
        <i className="ti ti-copy" aria-hidden="true" style={{ fontSize: 14 }} />
      </button>
    </div>
  );
}

// RTODisplay: large recovery-time-objective number with target
// comparison. Used on the DR schedules page and the run-readout for
// each test. The colour comes from whether the measured RTO meets the
// target — green if `met`, amber if borderline, red if missed.
export function RTODisplay({
  value,
  unit = 'minutes',
  target,
  met = true,
  caption,
}: {
  value: number | string
  unit?: string
  target?: number | string
  met?: boolean
  caption?: string
}) {
  const valueColor = met
    ? 'var(--color-status-green-deep)'
    : 'var(--color-status-red-deep)'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 32, fontWeight: 500, lineHeight: 1, color: valueColor }}>
          {value}
        </span>
        <span style={{ fontSize: 12, color: 'var(--color-text-tertiary)' }}>{unit}</span>
        {target !== undefined ? (
          <span style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginLeft: 4 }}>
            target {target} {unit}
          </span>
        ) : null}
      </div>
      {caption ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{caption}</div>
      ) : null}
    </div>
  )
}

// TestTimeline: phase strip used for DR test runs. Each phase is a
// chip with a state — pending, running, pass, fail, skipped. Phases
// are connected by hairlines so the user can see at a glance which
// phase is currently executing or where a failure stopped the run.
export function TestTimeline({
  phases,
}: {
  phases: Array<{ name: string; state: 'pending' | 'running' | 'pass' | 'fail' | 'skipped' }>
}) {
  function chipColor(state: string): { bg: string; fg: string; icon: string } {
    switch (state) {
      case 'pass':
        return { bg: 'var(--color-status-green-bg)', fg: 'var(--color-status-green-deep)', icon: 'ti-check' }
      case 'fail':
        return { bg: 'var(--color-status-red-bg)', fg: 'var(--color-status-red-deep)', icon: 'ti-x' }
      case 'running':
        return { bg: 'var(--color-status-blue-bg)', fg: 'var(--color-status-blue-deep)', icon: 'ti-loader-2' }
      case 'skipped':
        return { bg: 'var(--color-background-tertiary)', fg: 'var(--color-text-tertiary)', icon: 'ti-minus' }
      default:
        return { bg: 'var(--color-background-tertiary)', fg: 'var(--color-text-tertiary)', icon: 'ti-circle' }
    }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
      {phases.map((phase, index) => {
        const palette = chipColor(phase.state)
        return (
          <div
            key={phase.name}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              flex: index === phases.length - 1 ? '0 0 auto' : '1 1 0',
              minWidth: 0,
            }}
          >
            <div
              style={{
                background: palette.bg,
                color: palette.fg,
                padding: '4px 8px',
                borderRadius: 999,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontWeight: phase.state === 'running' ? 500 : 400,
                whiteSpace: 'nowrap',
              }}
            >
              <i
                className={`ti ${palette.icon}`}
                aria-hidden="true"
                style={{
                  fontSize: 12,
                  animation: phase.state === 'running' ? 'attestiv-spin 1s linear infinite' : undefined,
                }}
              />
              {phase.name}
            </div>
            {index < phases.length - 1 ? (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: 'var(--color-border-tertiary)',
                }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// Stepper: horizontal progress for multi-step wizards (onboarding,
// connector creation). Each step shows index, label, and a connector
// line; the active step is highlighted with the brand blue, completed
// steps show a checkmark, future steps are muted.
//
// The pattern matches the Attestiv mockup: numbered chips connected by
// hairlines, the chip swapping to a check-icon once the step is past.
export function Stepper({
  steps,
  current,
}: {
  steps: string[]
  current: number
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '14px 0',
      }}
    >
      {steps.map((label, index) => {
        const state: 'done' | 'active' | 'todo' =
          index < current ? 'done' : index === current ? 'active' : 'todo'
        const chipBg =
          state === 'done'
            ? 'var(--color-status-blue-bg)'
            : state === 'active'
              ? 'var(--color-brand-blue)'
              : 'var(--color-background-tertiary)'
        const chipColor =
          state === 'done'
            ? 'var(--color-brand-blue)'
            : state === 'active'
              ? 'white'
              : 'var(--color-text-tertiary)'
        const labelColor =
          state === 'todo'
            ? 'var(--color-text-tertiary)'
            : 'var(--color-text-primary)'
        return (
          <div
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: index === steps.length - 1 ? '0 0 auto' : '1 1 0',
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 24,
                height: 24,
                borderRadius: '50%',
                background: chipBg,
                color: chipColor,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 500,
                flexShrink: 0,
              }}
            >
              {state === 'done' ? (
                <i className="ti ti-check" aria-hidden="true" style={{ fontSize: 13 }} />
              ) : (
                index + 1
              )}
            </div>
            <span
              style={{
                fontSize: 12,
                color: labelColor,
                fontWeight: state === 'active' ? 500 : 400,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {label}
            </span>
            {index < steps.length - 1 ? (
              <div
                style={{
                  flex: 1,
                  height: 1,
                  background: 'var(--color-border-tertiary)',
                  margin: '0 4px',
                }}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

// FormField: label + optional hint + input slot. Keeps spacing
// consistent across login, onboarding, connector wizard, settings.
export function FormField({
  label,
  hint,
  children,
}: PropsWithChildren<{ label: string; hint?: string }>) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--color-text-secondary)',
          marginBottom: 5,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      {children}
      {hint ? (
        <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  )
}

const inputBase: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 'var(--border-radius-md)',
  background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)',
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { style, ...rest } = props
  return <input {...rest} style={{ ...inputBase, ...style }} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { style, ...rest } = props
  return <select {...rest} style={{ ...inputBase, ...style }} />
}

// Skeleton renders a shimmering placeholder block while async data
// loads. The shimmer is a CSS background-image gradient that
// translates left→right; no JS animation, so it stays performant
// even when dozens are on screen. Use lines={n} to stack n bars
// of the same width for list-style loading states.
export function Skeleton({
  width = '100%',
  height = 14,
  lines = 1,
  rounded = 4,
}: {
  width?: string | number
  height?: string | number
  lines?: number
  rounded?: number
}) {
  if (lines <= 1) {
    return (
      <span
        className="attestiv-skeleton"
        style={{
          display: 'inline-block',
          width,
          height,
          borderRadius: rounded,
        }}
        aria-hidden="true"
      />
    )
  }
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <span
          key={index}
          className="attestiv-skeleton"
          style={{
            display: 'block',
            width: index === lines - 1 ? '70%' : width,
            height,
            borderRadius: rounded,
          }}
        />
      ))}
    </span>
  )
}

// EmptyState is the standard treatment for "nothing to show yet"
// pages — list views with no rows, search results with no hits,
// pre-evaluation framework cards. Shows a circled icon, a title,
// a short description, and an optional CTA button. Use this
// instead of an inline `<div style={{color: tertiary}}>No data</div>`
// — the iconified version reads as "intentional empty state",
// the inline text reads as "the page is broken".
// EmptyState: title + optional description + optional action.
// Both text props go through i18n with the English string as the key,
// so any page rendering <EmptyState title="No data" /> picks up
// translations without page-level changes.
export function EmptyState({
  icon = 'ti-inbox',
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <div
      style={{
        margin: '24px auto',
        maxWidth: 420,
        textAlign: 'center',
        padding: '24px 20px',
        background: 'var(--color-background-secondary)',
        border: '0.5px dashed var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-lg)',
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-tertiary)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 12px',
        }}
      >
        <i
          className={`ti ${icon}`}
          aria-hidden="true"
          style={{ fontSize: 20, color: 'var(--color-text-tertiary)' }}
        />
      </div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-primary)', marginBottom: 6 }}>
        {t(title, title)}
      </div>
      {description ? (
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: action ? 12 : 0 }}>
          {t(description, description)}
        </div>
      ) : null}
      {action ? <div style={{ marginTop: 6 }}>{action}</div> : null}
    </div>
  )
}

// Banner replaces the dozen inline `<div style={{red box}}>` /
// blue-info-box copies sprinkled across the views. One source of
// truth for tone palettes, icon mapping, and dismissibility.
export function Banner({
  tone = 'info',
  title,
  children,
  onDismiss,
  onRetry,
}: PropsWithChildren<{
  tone?: 'info' | 'success' | 'warning' | 'error'
  title?: string
  onDismiss?: () => void
  onRetry?: () => void
}>) {
  const {
    t
  } = useI18n();

  const palette: Record<typeof tone, { bg: string; fg: string; icon: string }> = {
    info:    { bg: 'var(--color-status-blue-bg)',  fg: 'var(--color-status-blue-deep)',  icon: 'ti-info-circle' },
    success: { bg: 'var(--color-status-green-bg)', fg: 'var(--color-status-green-deep)', icon: 'ti-circle-check' },
    warning: { bg: 'var(--color-status-amber-bg)', fg: 'var(--color-status-amber-text)', icon: 'ti-alert-triangle' },
    error:   { bg: 'var(--color-status-red-bg)',   fg: 'var(--color-status-red-deep)',   icon: 'ti-alert-circle' },
  }
  const entry = palette[tone]
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      style={{
        background: entry.bg,
        color: entry.fg,
        borderRadius: 'var(--border-radius-md)',
        padding: '10px 12px',
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        marginBottom: 12,
      }}
    >
      <i className={`ti ${entry.icon}`} aria-hidden="true" style={{ fontSize: 16, marginTop: 1, flexShrink: 0 }} />
      <div style={{ flex: 1, fontSize: 12, lineHeight: 1.5 }}>
        {title ? <div style={{ fontWeight: 500, marginBottom: children ? 4 : 0 }}>{title}</div> : null}
        {children}
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          style={{
            background: 'transparent',
            border: `1px solid ${entry.fg}40`,
            borderRadius: 5,
            color: entry.fg,
            cursor: 'pointer',
            padding: '2px 10px',
            fontSize: 11,
            fontWeight: 500,
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          {t('Retry', 'Retry')}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('Dismiss', 'Dismiss')}
          style={{
            background: 'transparent',
            border: 'none',
            color: entry.fg,
            cursor: 'pointer',
            padding: 2,
            opacity: 0.7,
          }}
        >
          <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 14 }} />
        </button>
      ) : null}
    </div>
  );
}

// ClickableCard is a Card that responds to hover + provides keyboard
// focus + emits a click. Use this for cards that navigate or expand
// — plain Card is for static content. The visual change vs Card is
// subtle (slight lift on hover) but consistent across the app.
export function ClickableCard({
  children,
  onClick,
  ariaLabel,
  style,
}: PropsWithChildren<{
  onClick: () => void
  ariaLabel?: string
  style?: CSSProperties
}>) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="attestiv-clickable-card"
      style={{
        background: 'var(--color-background-primary)',
        border: 'none',
        borderRadius: 'var(--border-radius-lg)',
        padding: '16px 20px',
        marginBottom: 12,
        boxShadow: 'var(--shadow-card)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        color: 'var(--color-text-primary)',
        width: '100%',
        ...style,
      }}
    >
      {children}
    </button>
  )
}

// Stub: standardized "this page is coming in Phase B" content so all
// 20 placeholder routes have the same shape. Replace as each page is
// migrated.
// PagePlaceholder is the "under construction" treatment for routes
// that exist in the IA but whose UI has not been built yet. Showing
// these as a clear, neutral panel — rather than an empty page — sets
// the right expectation: the route is intentional and reachable, the
// surface is just not finished. The description copy should describe
// what the page will eventually do so a customer browsing the IA
// understands the product's shape.
export function PagePlaceholder({
  title,
  description,
}: {
  title: string
  description: string
}) {
  const {
    t
  } = useI18n();

  return (
    <>
      <Topbar
        title={title}
        left={<Badge tone="gray">{t('Under construction', 'Under construction')}</Badge>}
      />
      <div className="attestiv-content">
        <div
          style={{
            margin: '40px auto',
            maxWidth: 480,
            background: 'var(--color-background-secondary)',
            border: '0.5px solid var(--color-border-tertiary)',
            borderRadius: 'var(--border-radius-lg)',
            padding: '32px 28px',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: 'var(--color-status-blue-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 14px',
            }}
          >
            <i
              className="ti ti-tools"
              aria-hidden="true"
              style={{ fontSize: 22, color: 'var(--color-brand-blue)' }}
            />
          </div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              marginBottom: 6,
            }}
          >
            {t('Under construction', 'Under construction')}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}
          >
            {description}
          </div>
        </div>
      </div>
    </>
  );
}

// Pagination is the controlled footer (page-size selector 10/20/50/100 +
// prev/next + "from–to of total"). Use it directly for <table> lists and
// server-paged lists: the parent owns page/pageSize state and slices its
// own rows (or refetches with limit/offset). `total` is the FULL count
// (server total for server paging). Pages are 0-based.
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 20, 50, 100],
  label,
}: {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  pageSizes?: number[]
  label?: string
}) {
  const { t } = useI18n()
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(0, page), pageCount - 1)
  const from = total === 0 ? 0 : current * pageSize + 1
  const to = Math.min((current + 1) * pageSize, total)
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        fontSize: 12,
        color: 'var(--color-text-tertiary)',
        paddingTop: 6,
        borderTop: '0.5px solid var(--color-border-tertiary)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span>{t('Rows', 'Rows')}</span>
        <Select
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{ width: 'auto', padding: '4px 8px', fontSize: 12 }}
          aria-label={label ? `${label} ${t('rows per page', 'rows per page')}` : t('rows per page', 'rows per page')}
        >
          {pageSizes.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>
      <span>{t('{from}–{to} of {total}', '{from}–{to} of {total}', { from, to, total })}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <GhostButton onClick={() => onPageChange(Math.max(0, current - 1))} disabled={current <= 0}>
          <i className="ti ti-chevron-left" aria-hidden="true" /> {t('Prev', 'Prev')}
        </GhostButton>
        <span>{t('Page {n}/{m}', 'Page {n}/{m}', { n: current + 1, m: pageCount })}</span>
        <GhostButton onClick={() => onPageChange(Math.min(pageCount - 1, current + 1))} disabled={current >= pageCount - 1}>
          {t('Next', 'Next')} <i className="ti ti-chevron-right" aria-hidden="true" />
        </GhostButton>
      </div>
    </div>
  )
}

// Modal — accessible dialog with backdrop, Escape-key close, and
// focus-trap. Renders above all content via fixed positioning (no
// portal needed). The footer slot holds action buttons; pass null to
// omit (e.g. for info-only modals).
export function Modal({
  open,
  onClose,
  title,
  width = 520,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  width?: number
  children: ReactNode
  footer?: ReactNode
}) {
  const { t } = useI18n()
  const dialogRef = useRef<HTMLDivElement>(null)

  // Escape key support
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Focus the dialog on open
  useEffect(() => {
    if (open) dialogRef.current?.focus()
  }, [open])

  if (!open) return null

  const backdropStyle: CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: 'rgba(3, 35, 74, 0.38)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    animation: 'attestiv-fade-in 160ms ease',
  }
  const dialogStyle: CSSProperties = {
    background: 'var(--color-background-primary)',
    borderRadius: 'var(--border-radius-lg)',
    boxShadow: '0 8px 32px rgba(4, 44, 83, 0.22)',
    width: '100%',
    maxWidth: width,
    maxHeight: '90vh',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  }
  return (
    // Backdrop click closes the modal
    <div style={backdropStyle} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={dialogRef}
        tabIndex={-1}
        style={dialogStyle}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 20px',
            borderBottom: '0.5px solid var(--color-border-tertiary)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 500 }}>{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Close', 'Close')}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-tertiary)',
              padding: 4,
              borderRadius: 6,
              lineHeight: 1,
            }}
          >
            <i className="ti ti-x" aria-hidden="true" style={{ fontSize: 16 }} />
          </button>
        </div>
        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '18px 20px' }}>
          {children}
        </div>
        {/* Footer */}
        {footer != null && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              padding: '12px 20px',
              borderTop: '0.5px solid var(--color-border-tertiary)',
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// SortableTable — generic table with sortable column headers and the
// shared Pagination footer. Accepts typed column definitions so each
// column knows its accessor, label, and whether it's sortable.
//
// Usage:
//   <SortableTable
//     columns={[{ key: 'title', label: 'Title', sortable: true }, ...]}
//     rows={risks}
//     rowKey={(r) => r.risk_id}
//     renderCell={(row, col) => <span>{row[col.key]}</span>}
//   />
export type TableColumn<T> = {
  key: keyof T & string
  label: string
  sortable?: boolean
  width?: number | string
  align?: 'left' | 'right' | 'center'
  thProps?: ThHTMLAttributes<HTMLTableCellElement>
}

export function SortableTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  renderCell,
  defaultPageSize = 20,
  pageSizes = [10, 20, 50, 100],
  empty,
  label,
  onRowClick,
}: {
  columns: TableColumn<T>[]
  rows: T[]
  rowKey: (row: T, index: number) => string
  renderCell: (row: T, column: TableColumn<T>, index: number) => ReactNode
  defaultPageSize?: number
  pageSizes?: number[]
  empty?: ReactNode
  label?: string
  onRowClick?: (row: T) => void
}) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortKey] ?? ''
      const bv = b[sortKey] ?? ''
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortKey, sortDir])

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const current = Math.min(page, pageCount - 1)
  const slice = useMemo(
    () => sorted.slice(current * pageSize, (current + 1) * pageSize),
    [sorted, current, pageSize],
  )

  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return key
      }
      setSortDir('asc')
      return key
    })
    setPage(0)
  }, [])

  if (rows.length === 0) {
    return <>{empty ?? null}</>
  }

  const thBase: CSSProperties = {
    padding: '8px 12px',
    fontSize: 10,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'var(--color-text-tertiary)',
    borderBottom: '0.5px solid var(--color-border-secondary)',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    background: 'var(--color-background-secondary)',
  }
  const tdBase: CSSProperties = {
    padding: '9px 12px',
    fontSize: 12,
    borderBottom: '0.5px solid var(--color-border-tertiary)',
    verticalAlign: 'middle',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ overflowX: 'auto', borderRadius: 'var(--border-radius-md)', border: '0.5px solid var(--color-border-tertiary)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  {...col.thProps}
                  style={{
                    ...thBase,
                    width: col.width,
                    textAlign: col.align ?? 'left',
                    cursor: col.sortable ? 'pointer' : 'default',
                    ...(col.thProps?.style ?? {}),
                  }}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                  aria-sort={
                    sortKey === col.key
                      ? sortDir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : col.sortable
                        ? 'none'
                        : undefined
                  }
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {col.label}
                    {col.sortable && (
                      <i
                        className={`ti ${
                          sortKey === col.key
                            ? sortDir === 'asc'
                              ? 'ti-sort-ascending'
                              : 'ti-sort-descending'
                            : 'ti-selector'
                        }`}
                        aria-hidden="true"
                        style={{ fontSize: 11, opacity: sortKey === col.key ? 1 : 0.35 }}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => (
              <tr
                key={rowKey(row, current * pageSize + i)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={{ cursor: onRowClick ? 'pointer' : 'default' }}
                className={onRowClick ? 'attestiv-table-row-hover' : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{ ...tdBase, textAlign: col.align ?? 'left' }}
                  >
                    {renderCell(row, col, current * pageSize + i)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination
        page={current}
        pageSize={pageSize}
        total={sorted.length}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(0) }}
        pageSizes={pageSizes}
        label={label}
      />
    </div>
  )
}

// PaginatedList renders any list of objects in a fixed-height scroll
// container with the shared Pagination footer. Drop-in for client-side
// (card/row) datasets: pass the full items array and a row renderer.
// For <table> lists or server paging, use Pagination directly.
export function PaginatedList<T>({
  items,
  renderItem,
  itemKey,
  defaultPageSize = 20,
  pageSizes = [10, 20, 50, 100],
  maxHeight = 560,
  empty,
  label,
}: {
  items: T[]
  renderItem: (item: T, index: number) => ReactNode
  itemKey?: (item: T, index: number) => string
  defaultPageSize?: number
  pageSizes?: number[]
  maxHeight?: number | string
  empty?: ReactNode
  label?: string
}) {
  const [pageSize, setPageSize] = useState(defaultPageSize)
  const [page, setPage] = useState(0)

  const total = items.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount - 1)
  const start = current * pageSize
  const slice = useMemo(() => items.slice(start, start + pageSize), [items, start, pageSize])

  if (total === 0) {
    return <>{empty ?? null}</>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ maxHeight, overflowY: 'auto' }}>
        {slice.map((item, i) => (
          <div key={itemKey ? itemKey(item, start + i) : start + i}>{renderItem(item, start + i)}</div>
        ))}
      </div>
      <Pagination
        page={current}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(0)
        }}
        pageSizes={pageSizes}
        label={label}
      />
    </div>
  )
}
