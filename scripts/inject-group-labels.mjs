import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const i18nPath = path.join(__dirname, '..', 'src', 'lib', 'i18n.tsx')

const additions = {
  fr: { 'nav.group.monitor': 'Surveiller', 'nav.group.act': 'Agir', 'nav.group.report': 'Rapporter' },
  es: { 'nav.group.monitor': 'Supervisar', 'nav.group.act': 'Actuar', 'nav.group.report': 'Informar' },
  de: { 'nav.group.monitor': 'Überwachen', 'nav.group.act': 'Handeln', 'nav.group.report': 'Berichten' },
  lt: { 'nav.group.monitor': 'Stebėti',   'nav.group.act': 'Veikti', 'nav.group.report': 'Ataskaita' },
}

let src = fs.readFileSync(i18nPath, 'utf8')

for (const [lang, keys] of Object.entries(additions)) {
  // Extract this language's block to check for existing keys
  const openRe2 = new RegExp(`^\\s+${lang}:\\s*\\{`, 'm')
  const open2 = openRe2.exec(src)
  let block = ''
  if (open2) {
    let d = 1, j = open2.index + open2[0].length
    while (j < src.length && d > 0) { if (src[j] === '{') d++; else if (src[j] === '}') d--; j++ }
    block = src.slice(open2.index + open2[0].length, j - 1)
  }
  const toAdd = Object.entries(keys).filter(([k]) => !block.includes(`'${k}'`))
  if (toAdd.length === 0) { console.log(`${lang}: already injected`); continue }

  const openRe = new RegExp(`^\\s+${lang}:\\s*\\{`, 'm')
  const open = openRe.exec(src)
  if (!open) { console.log(`MISSING block ${lang}`); continue }

  let depth = 1
  let i = open.index + open[0].length
  while (i < src.length && depth > 0) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') depth--
    i++
  }
  const closePos = i - 1

  const lines = toAdd
    .map(([k, v]) => `    '${k}': '${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`)
    .join('\n')

  src = src.slice(0, closePos) + '\n' + lines + '\n  ' + src.slice(closePos)
  console.log(`${lang}: injected ${toAdd.length} keys`)
}

fs.writeFileSync(i18nPath, src, 'utf8')
console.log('Done')
