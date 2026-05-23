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
} from 'react'
import { useMemo, useState } from 'react'
import { useI18n } from '../lib/i18n'

type Tone =
  | 'green'
  | 'amber'
  | 'red'
  | 'blue'
  | 'navy'
  | 'gray'

const badgePalette: Record<Tone, CSSProperties> = {
  green: { background: 'var(--color-status-green-bg)', color: 'var(--color-status-green-deep)' },
  amber: { background: 'var(--color-status-amber-bg)', color: 'var(--color-status-amber-deep)' },
  red:   { background: 'var(--color-status-red-bg)',   color: 'var(--color-status-red-deep)' },
  blue:  { background: 'var(--color-status-blue-bg)',  color: 'var(--color-status-blue-deep)' },
  navy:  { background: 'var(--color-brand-navy)',      color: 'var(--color-brand-blue-pale)' },
  gray:  { background: 'var(--color-background-tertiary)', color: '#444441' },
}

const baseBadge: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10,
  padding: '2px 7px',
  borderRadius: 20,
  fontWeight: 500,
  whiteSpace: 'nowrap',
}

export function Badge({
  tone = 'gray',
  icon,
  children,
}: PropsWithChildren<{ tone?: Tone; icon?: string }>) {
  return (
    <span style={{ ...baseBadge, ...badgePalette[tone] }}>
      {icon ? <i className={`ti ${icon}`} aria-hidden="true" style={{ fontSize: 11 }} /> : null}
      {children}
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
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '12px 14px',
        marginBottom: 10,
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
        padding: '10px 12px',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--color-text-tertiary)',
          marginBottom: 5,
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 500, lineHeight: 1, color: valueColor }}>
        {value}
      </div>
      {sub ? (
        <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 4 }}>{sub}</div>
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
        background: 'var(--color-brand-blue)',
        color: 'white',
        opacity: disabled ? 0.5 : 1,
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
}: {
  name: string
  percent: number
  tone?: 'green' | 'amber' | 'red' | 'auto'
}) {
  const resolved = tone === 'auto'
    ? percent >= 95 ? 'green' : percent >= 85 ? 'amber' : 'red'
    : tone
  const fillColor =
    resolved === 'green' ? 'var(--color-status-green-mid)' :
    resolved === 'amber' ? 'var(--color-status-amber-mid)' :
    'var(--color-status-red-mid)'
  const textColor =
    resolved === 'green' ? 'var(--color-status-green-deep)' :
    resolved === 'amber' ? 'var(--color-status-amber-text)' :
    'var(--color-status-red-deep)'
  return (
    <div
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
        }}
      >
        <div style={{ height: '100%', borderRadius: 3, width: `${percent}%`, background: fillColor }} />
      </div>
      <div style={{ fontSize: 11, fontWeight: 500, width: 32, textAlign: 'right', color: textColor }}>
        {percent}%
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
}: PropsWithChildren<{
  tone?: 'info' | 'success' | 'warning' | 'error'
  title?: string
  onDismiss?: () => void
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
        border: '0.5px solid var(--color-border-tertiary)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '12px 14px',
        marginBottom: 10,
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
