import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const i18nPath = path.join(__dirname, '..', 'src', 'lib', 'i18n.tsx')

const additions = {
  en: { 'dashboard.narrative.focus_hint': 'Focus here to lift all frameworks' },
  fr: { 'dashboard.narrative.focus_hint': 'Priorité — améliore tous les frameworks' },
  es: { 'dashboard.narrative.focus_hint': 'Prioridad — mejora todos los marcos' },
  de: { 'dashboard.narrative.focus_hint': 'Priorität — hebt alle Frameworks an' },
  lt: { 'dashboard.narrative.focus_hint': 'Prioritetas — pakelia visus karkasus' },
}

let src = fs.readFileSync(i18nPath, 'utf8')

for (const [lang, keys] of Object.entries(additions)) {
  const openRe = new RegExp(`^\\s+${lang}:\\s*\\{`, 'm')
  const open = openRe.exec(src)
  if (!open) { console.log(`MISSING block ${lang}`); continue }

  let depth = 1, i = open.index + open[0].length
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
    i++
  }
  const closePos = i - 1
  const block = src.slice(open.index + open[0].length, closePos)
  const toAdd = Object.entries(keys).filter(([k]) => !block.includes(`'${k}'`))
  if (toAdd.length === 0) { console.log(`${lang}: already present`); continue }

  const lines = toAdd
    .map(([k, v]) => `    '${k}': '${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`)
    .join('\n')
  src = src.slice(0, closePos) + '\n' + lines + '\n  ' + src.slice(closePos)
  console.log(`${lang}: injected ${toAdd.length} key(s)`)
}

fs.writeFileSync(i18nPath, src, 'utf8')
console.log('Done')
