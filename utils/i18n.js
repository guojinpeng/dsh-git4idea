/*
 * i18n tool for dsh-git4idea (m04501).
 *
 * Why this file exists: the DSH client half of a plugin is a single bundled
 * module. A dynamic bundle may only resolve the frozen platform module table,
 * so it cannot read locale/*.json at runtime. The JSON files stay the source of
 * truth and this tool writes them into src/client.js as marked blocks; run
 * `node utils/i18n.js sync` after editing either language.
 *
 * Language resolution lives here so nothing has to reason about tags again:
 * any zh-* tag reads zh, everything else reads en, and en is key-complete, so
 * an unsupported language never renders a raw key.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SUPPORTED_LOCALES = ['en', 'zh']
export const DEFAULT_LOCALE = 'en'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOCALE_DIR = join(ROOT, 'locale')
const CLIENT_FILE = join(ROOT, 'src', 'client.js')
const TABLE = { zh: 'ZH', en: 'EN' }

/* One tag in, one shipped language out. */
export function resolveLocale(tag) {
  if (tag === undefined || tag === null || tag === '') return DEFAULT_LOCALE
  const primary = String(tag).toLowerCase().replace(/_/g, '-').split('-')[0]
  return SUPPORTED_LOCALES.indexOf(primary) >= 0 ? primary : DEFAULT_LOCALE
}

export function localeFile(tag) {
  return join(LOCALE_DIR, resolveLocale(tag) + '.json')
}

/* { meta, messages } for one tag, resolved through resolveLocale(). */
export function readLocale(tag) {
  const locale = resolveLocale(tag)
  const parsed = JSON.parse(readFileSync(localeFile(locale), 'utf8'))
  return {
    locale,
    meta: parsed.meta === undefined ? {} : parsed.meta,
    messages: parsed.messages === undefined ? {} : parsed.messages,
  }
}

/* {name} placeholders; unknown keys come back as the key itself. */
export function translate(messages, key, params) {
  const bag = messages === undefined || messages === null ? {} : messages
  const template = Object.prototype.hasOwnProperty.call(bag, key) ? bag[key] : key
  if (params === undefined || params === null) return String(template)
  return String(template).replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  ))
}

function quote(value) {
  const text = String(value)
  return text.indexOf("'") < 0 ? "'" + text + "'" : JSON.stringify(text)
}

/* The exact block shape embedded in src/client.js. */
export function embed(tag, messages) {
  const locale = resolveLocale(tag)
  const name = TABLE[locale]
  const lines = Object.keys(messages).map((key) => '      ' + quote(key) + ': ' + quote(messages[key]) + ',')
  return [
    '    /* i18n:generated:' + locale + ' — locale/' + locale + '.json is the source of truth;',
    '       regenerate with `node utils/i18n.js sync`. */',
    '    const ' + name + ' = {',
  ].concat(lines, [
    '    }',
    '    /* /i18n:generated:' + locale + ' */',
  ]).join('\n')
}

function boundsOf(text, locale) {
  const start = text.indexOf('    /* i18n:generated:' + locale + ' ')
  if (start < 0) throw new Error('missing the generated ' + locale + ' block in src/client.js')
  const endMark = '    /* /i18n:generated:' + locale + ' */'
  const end = text.indexOf(endMark, start)
  if (end < 0) throw new Error('missing the end marker for the ' + locale + ' block in src/client.js')
  return { start, end: end + endMark.length }
}

/* Rewrite every generated block from locale/*.json. check:true only reports. */
export function sync({ check = false } = {}) {
  let text = readFileSync(CLIENT_FILE, 'utf8')
  const origin = text
  const changed = []
  for (const locale of SUPPORTED_LOCALES) {
    const { messages } = readLocale(locale)
    const block = embed(locale, messages)
    const bounds = boundsOf(text, locale)
    if (text.slice(bounds.start, bounds.end) === block) continue
    text = text.slice(0, bounds.start) + block + text.slice(bounds.end)
    changed.push(locale)
  }
  if (check === true) return { changed, ok: changed.length === 0 }
  if (changed.length > 0) writeFileSync(CLIENT_FILE, text)
  return { changed, ok: true, written: origin !== text }
}

function main(argv) {
  const command = argv[0] === undefined ? 'check' : argv[0]
  if (command === 'locales') { console.log(SUPPORTED_LOCALES.join(' ')); return 0 }
  if (command === 'show') {
    const one = readLocale(argv[1])
    console.log(JSON.stringify({ locale: one.locale, meta: one.meta, keys: Object.keys(one.messages).length }, null, 2))
    return 0
  }
  const result = sync({ check: command === 'check' })
  if (command === 'check') {
    if (result.ok === true) { console.log('i18n: src/client.js matches locale/*.json'); return 0 }
    console.error('i18n: src/client.js is out of date for ' + result.changed.join(', ') + '; run `node utils/i18n.js sync`')
    return 1
  }
  if (command === 'sync') {
    console.log(result.changed.length === 0
      ? 'i18n: src/client.js already matches locale/*.json'
      : 'i18n: rewrote ' + result.changed.join(', '))
    return 0
  }
  console.error('usage: node utils/i18n.js [sync|check|locales|show <tag>]')
  return 2
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2))
}
