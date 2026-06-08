#!/usr/bin/env node
// i18n-inject — insert missing translations into a language block in i18n.tsx.
//
// Usage:
//   node scripts/i18n-inject.mjs --lang fr --file scripts/fr-translations-merged.json
//   node scripts/i18n-inject.mjs --lang es --file scripts/es-translations-merged.json
//
// The script:
//   1. Reads the existing i18n.tsx
//   2. Finds the language block (e.g. `fr: {`)
//   3. Reads the existing keys already in that block
//   4. Appends only the MISSING keys at the end of the block (before closing `},`)
//   5. Writes back

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const i18nPath = path.join(projectRoot, 'src', 'lib', 'i18n.tsx')

const argv = process.argv.slice(2)
const langIdx = argv.indexOf('--lang')
const fileIdx = argv.indexOf('--file')

if (langIdx < 0 || fileIdx < 0) {
  console.error('Usage: node scripts/i18n-inject.mjs --lang <lang> --file <translations.json>')
  process.exit(1)
}

const lang = argv[langIdx + 1]
const translationsFile = path.resolve(projectRoot, argv[fileIdx + 1])

const newTranslations = JSON.parse(fs.readFileSync(translationsFile, 'utf8'))
const source = fs.readFileSync(i18nPath, 'utf8')

// Find the language block start
const openRe = new RegExp(`^\\s+${lang}:\\s*\\{`, 'm')
const open = openRe.exec(source)
if (!open) {
  console.error(`Language block '${lang}' not found in i18n.tsx`)
  process.exit(1)
}

// Find balanced closing brace
let depth = 1
let i = open.index + open[0].length
while (i < source.length && depth > 0) {
  const c = source[i]
  if (c === '{') depth++
  else if (c === '}') depth--
  i++
}
// i is now just past the closing `}`
const blockClose = i - 1 // position of the `}`

const block = source.slice(open.index + open[0].length, blockClose)

// Collect existing keys (same logic as coverage script)
const unescape = (s) =>
  s.replace(/\\(.)/g, (_, c) => {
    if (c === 'n') return '\n'
    if (c === 't') return '\t'
    if (c === 'r') return '\r'
    if (c === 'b') return '\b'
    if (c === 'f') return '\f'
    if (c === '0') return '\0'
    return c
  })

const existingKeys = new Set()
const singleQ = /^[ \t]+'((?:[^'\\]|\\.)+)'\s*:/gm
for (const m of block.matchAll(singleQ)) existingKeys.add(unescape(m[1]))
const doubleQ = /^[ \t]+"((?:[^"\\]|\\.)+)"\s*:/gm
for (const m of block.matchAll(doubleQ)) existingKeys.add(unescape(m[1]))
const bareK = /^[ \t]+([A-Za-z_][A-Za-z0-9_]*)\s*:/gm
for (const m of block.matchAll(bareK)) existingKeys.add(m[1])

// Build lines for missing keys only
const escapeValue = (s) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')

const escapeKey = (s) => {
  // Use double-quoted key if it contains a single quote, otherwise single-quoted
  if (s.includes("'")) {
    const escaped = s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
    return `"${escaped}"`
  }
  const escaped = s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
  return `'${escaped}'`
}

const missing = Object.entries(newTranslations).filter(([k]) => !existingKeys.has(k))
console.log(`${lang}: ${existingKeys.size} existing, ${missing.length} to inject (${Object.keys(newTranslations).length - missing.length} already present)`)

if (missing.length === 0) {
  console.log('Nothing to inject.')
  process.exit(0)
}

const newLines = missing
  .map(([k, v]) => `    ${escapeKey(k)}: '${escapeValue(String(v))}',`)
  .join('\n')

// Insert before the closing brace of the language block
// Find the last non-whitespace position before blockClose to append after it
const insertAt = blockClose
const newSource =
  source.slice(0, insertAt) +
  '\n    // Auto-injected translations\n' +
  newLines +
  '\n  ' +
  source.slice(insertAt)

fs.writeFileSync(i18nPath, newSource, 'utf8')
console.log(`Injected ${missing.length} ${lang} translations into src/lib/i18n.tsx`)
