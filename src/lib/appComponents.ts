// Pure helpers for the application "Components" multi-select field
// (src/components/AppComponentsField.tsx). Kept dependency-free so they
// can be unit-tested in the node test environment without pulling in
// React or the i18n/client module graph.
//
// The wire contract is unchanged: the create/edit pages still submit a
// comma-separated VM-display-name string. These helpers only convert
// between that string and the internal string[] the picker holds.

// dedupeComponents trims, drops empties, and removes duplicates while
// preserving first-seen order.
export function dedupeComponents(value: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value ?? []) {
    const v = String(item ?? '').trim()
    if (!v) continue
    if (seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

// parseComponentList turns the legacy comma-separated string into a
// stable, de-duplicated array (trim, drop empties, keep first-seen
// order). Used by the edit page when loading an existing app.
export function parseComponentList(raw: string): string[] {
  return dedupeComponents(
    String(raw ?? '')
      .split(',')
      .map((s) => s.trim()),
  )
}

// formatComponentList joins the array back to the exact comma-separated
// string the old free-text field produced (", " separator), so the
// submit payload is byte-for-byte identical.
export function formatComponentList(value: string[]): string {
  return dedupeComponents(value).join(', ')
}

// addComponent appends a name if non-empty and not already present
// (returns the same array reference when nothing changes, so callers can
// skip a re-render).
export function addComponent(value: string[], name: string): string[] {
  const v = String(name ?? '').trim()
  if (!v) return value
  if (value.some((x) => x === v)) return value
  return [...value, v]
}

// removeComponent drops the name at the given index.
export function removeComponent(value: string[], index: number): string[] {
  return value.filter((_, i) => i !== index)
}
