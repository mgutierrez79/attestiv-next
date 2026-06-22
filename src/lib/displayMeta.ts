// Defensive display guard for free-form asset metadata strings.
//
// Some connectors (notably the Dell host enrichment pass) have, in pilot,
// stamped raw / un-mapped enum codes onto fields meant to be human-readable
// words. Observed junk: power_state = "17" (a bare vSphere enum code) and
// health = "[1 2 3 4 5 ... 1020]" (a Go slice stringified into the field).
// The backend connector is being fixed to map these to words ("on"/"off",
// "normal"/"degraded"), but the page must also never display obvious garbage.
//
// `displayableMetaString` is the pure sanitizer: given a raw metadata value it
// returns the trimmed string to render, or "" when the value is junk — at which
// point the page's existing `value ? <Stat/> : null` guard omits the field.
// It is deliberately UI-free so it can be unit-tested and reused.

// A string is "array/object-shaped" if, once trimmed, it begins with the
// opening bracket of a stringified array or object. Backend slice/map values
// leaking into a string field look like "[1 2 3]" or "{a:1}".
function looksLikeStructuredString(s: string): boolean {
  return s.startsWith('[') || s.startsWith('{')
}

// displayableMetaString sanitizes a raw metadata value for display in the
// Server-details / VM-details cards.
//
// Returns "" (→ field omitted) when the value is obvious junk:
//   - an Array or non-null object (e.g. metadata.health came back as an array)
//   - a string that looks like a stringified array/object (starts with "[" / "{")
//   - an ALL-DIGITS string — only when `digitsAreJunk` is set (power_state /
//     health specifically): a bare number there is a raw enum code, not a word.
//     This is opt-in so legitimately-numeric stats elsewhere aren't nuked.
//
// Otherwise returns the trimmed string form of the value.
export function displayableMetaString(
  value: unknown,
  opts?: { digitsAreJunk?: boolean },
): string {
  if (value == null) return ''
  // Arrays and objects are never displayable here — they only appear when a
  // structured backend value leaked into a scalar field.
  if (typeof value === 'object') return ''

  const s = String(value).trim()
  if (s === '') return ''
  if (looksLikeStructuredString(s)) return ''
  // A bare integer code (e.g. "17") is junk for the word-valued power_state /
  // health fields. Guard is opt-in to avoid clobbering numeric stats elsewhere.
  if (opts?.digitsAreJunk && /^\d+$/.test(s)) return ''
  return s
}
