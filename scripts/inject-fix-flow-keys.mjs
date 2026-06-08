import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const i18nPath = path.join(__dirname, '..', 'src', 'lib', 'i18n.tsx')

const additions = {
  en: {
    'dashboard.narrative.fix_cta': 'Fix failing controls',
    'Remediation task created for': 'Remediation task created for',
    'Could not create a remediation task for': 'Could not create a remediation task for',
    'View in Remediation': 'View in Remediation',
  },
  fr: {
    'dashboard.narrative.fix_cta': 'Corriger les contrôles en échec',
    'Remediation task created for': 'Tâche de remédiation créée pour',
    'Could not create a remediation task for': 'Impossible de créer une tâche de remédiation pour',
    'View in Remediation': 'Voir dans Remédiation',
  },
  es: {
    'dashboard.narrative.fix_cta': 'Corregir controles fallidos',
    'Remediation task created for': 'Tarea de remediación creada para',
    'Could not create a remediation task for': 'No se pudo crear una tarea de remediación para',
    'View in Remediation': 'Ver en Remediación',
  },
  de: {
    'dashboard.narrative.fix_cta': 'Fehlende Kontrollen beheben',
    'Remediation task created for': 'Behebungsaufgabe erstellt für',
    'Could not create a remediation task for': 'Behebungsaufgabe konnte nicht erstellt werden für',
    'View in Remediation': 'In Behebung anzeigen',
  },
  lt: {
    'dashboard.narrative.fix_cta': 'Taisyti nepavykusias kontroles',
    'Remediation task created for': 'Taisymo užduotis sukurta',
    'Could not create a remediation task for': 'Nepavyko sukurti taisymo užduoties',
    'View in Remediation': 'Žiūrėti taisyme',
  },
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
  const toAdd = Object.entries(keys).filter(([k]) => !block.includes(`'${k}'`) && !block.includes(`"${k}"`))
  if (toAdd.length === 0) { console.log(`${lang}: all present`); continue }

  const lines = toAdd
    .map(([k, v]) => `    '${k}': '${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`)
    .join('\n')
  src = src.slice(0, closePos) + '\n' + lines + '\n  ' + src.slice(closePos)
  console.log(`${lang}: injected ${toAdd.length} key(s)`)
}

fs.writeFileSync(i18nPath, src, 'utf8')
console.log('Done')
