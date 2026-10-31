/*
 * Client bundle builder for dsh-git4idea (m05309).
 *
 * Why this file exists: the DSH client half is ONE module — window.__ModuleLoader__
 * gives each plugin a single factory and resolves only frozen platform modules, so
 * the client code cannot use relative ESM imports. To keep the source readable it
 * lives as ordered fragments in src/client/ (subdirectories allowed) and this tool
 * concatenates them into
 * src/client.js, the file the host loads. FRAGMENT_ORDER pins the order; the
 * fragment file names carry no ordering. The fragments are verbatim slices of the
 * bundle: regeneration is byte-identical.
 *
 * Run `node src/utils/build-client.js` after editing a fragment; `--check` only
 * reports (`npm run build:check`). `node src/utils/i18n.js sync` rebuilds too.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const FRAGMENT_DIR = join(ROOT, 'src', 'client')
export const CLIENT_FILE = join(ROOT, 'src', 'client.js')

/* The fragments share one closure, so the order below is load order: a
   declaration must precede its first reader. Names carry no order; only this
   list decides the bundle, and it must name every fragment. */
export const FRAGMENT_ORDER = [
  'head.js',
  'locale.js',
  'ui/icons.js',
  'core.js',
  'diff.js',
  'tree.js',
  'changes.js',
  'workbench.js',
  'panel.js',
  'styles.js',
  'composer.js',
  'dialogs.js',
  'preview.js',
  'conflict.js',
  'ui/theme.js',
  'ui/components.js',
  'app.js',
]

export function fragmentNames() {
  const present = walkFragments(FRAGMENT_DIR, '')
  const unlisted = present.filter((name) => FRAGMENT_ORDER.includes(name) === false).sort()
  const missing = FRAGMENT_ORDER.filter((name) => present.includes(name) === false)
  if (unlisted.length > 0 || missing.length > 0) {
    throw new Error('src/client fragments and FRAGMENT_ORDER disagree'
      + (unlisted.length > 0 ? ' (unlisted: ' + unlisted.join(', ') + ')' : '')
      + (missing.length > 0 ? ' (missing: ' + missing.join(', ') + ')' : ''))
  }
  return FRAGMENT_ORDER.slice()
}

function walkFragments(directory, prefix) {
  const names = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      names.push(...walkFragments(join(directory, entry.name), prefix + entry.name + '/'))
    } else if (entry.name.endsWith('.js')) {
      names.push(prefix + entry.name)
    }
  }
  return names
}

export function bundleOf(names) {
  return (names === undefined ? fragmentNames() : names)
    .map((name) => readFileSync(join(FRAGMENT_DIR, name), 'utf8'))
    .join('')
}

export function buildClient({ check = false } = {}) {
  const names = fragmentNames()
  const text = bundleOf(names)
  if (check === true) return { ok: readFileSync(CLIENT_FILE, 'utf8') === text, files: names }
  writeFileSync(CLIENT_FILE, text)
  return { ok: true, files: names }
}

function main(argv) {
  const check = argv[0] === '--check' || argv[0] === 'check'
  const result = buildClient({ check: check })
  if (check === true) {
    if (result.ok === true) { console.log('client: src/client.js matches src/client/*.js (' + result.files.length + ' fragments)'); return 0 }
    console.error('client: src/client.js is out of date; run `node src/utils/build-client.js`')
    return 1
  }
  console.log('client: wrote src/client.js from ' + result.files.length + ' fragments')
  return 0
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2))
}
