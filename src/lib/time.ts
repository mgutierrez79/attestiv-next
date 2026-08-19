import { loadSettings } from './settings'

const LOCALE_BY_LANGUAGE: Record<'en' | 'es' | 'fr' | 'de' | 'lt', string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  lt: 'lt-LT',
}

function resolveLocaleAndZone(): { locale: string; timeZone: string } {
  const settings = loadSettings()
  const locale = LOCALE_BY_LANGUAGE[settings.language] ?? 'en-US'
  const timeZone =
    settings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  return { locale, timeZone }
}

// formatTimestamp renders an absolute, unambiguous timestamp in the
// user's locale and configured zone, WITH the zone designator — an
// audit trail row that reads "19 Aug 2026, 15:58" without a zone is
// ambiguous the moment the packet leaves the building. Relative time
// ("4m ago") is a hint, never the primary rendering; see relativeTime.
export function formatTimestamp(value?: string | null) {
  if (!value) return 'n/a'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return value
  const { locale, timeZone } = resolveLocaleAndZone()
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  })
    .format(date)
    // Append the zone designator. Intl can't combine dateStyle/timeStyle
    // with timeZoneName, so we format it separately and join.
    .concat(' ', zoneDesignator(date, locale, timeZone))
}

function zoneDesignator(date: Date, locale: string, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'short' }).formatToParts(date)
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value
    return tz || timeZone
  } catch {
    return timeZone
  }
}

// relativeTime: "just now" / "4m ago" / "3h ago" / "2d ago". Locale-aware
// via Intl.RelativeTimeFormat so the five locales don't all read "ago".
// Returns an empty string for missing/invalid input so callers can fall
// back to their own "never"/"—" copy.
export function relativeTime(value?: string | null, now: number = Date.now()): string {
  if (!value) return ''
  const ms = now - new Date(value).getTime()
  if (!Number.isFinite(ms)) return ''
  const { locale } = resolveLocaleAndZone()
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always', style: 'narrow' })
  const abs = Math.abs(ms)
  const sign = ms >= 0 ? -1 : 1
  if (abs < 60_000) return rtf.format(sign * Math.max(1, Math.floor(abs / 1000)), 'second')
  if (abs < 3_600_000) return rtf.format(sign * Math.floor(abs / 60_000), 'minute')
  if (abs < 86_400_000) return rtf.format(sign * Math.floor(abs / 3_600_000), 'hour')
  return rtf.format(sign * Math.floor(abs / 86_400_000), 'day')
}

// formatAge renders the pair every freshness readout should carry:
// "19 Aug 2026, 15:58 GMT+3 (4m ago)". Absolute first, relative as the
// secondary hint.
export function formatAge(value?: string | null, now: number = Date.now()): string {
  if (!value) return 'n/a'
  const absolute = formatTimestamp(value)
  const rel = relativeTime(value, now)
  return rel ? `${absolute} (${rel})` : absolute
}
