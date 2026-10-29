/*
 * Client bundle builder for dsh-git4idea (m05309).
 *
 * Why this file exists: the DSH client half is ONE module — window.__ModuleLoader__
 * gives each plugin a single factory and resolves only frozen platform modules, so
 * the client code cannot use relative ESM imports. To keep the source readable it
 * lives as ordered fragments in src/client/ and this tool concatenates them into
 * src/client.js, the file the host loads. The fragments are verbatim slices of the
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

/* Fragment order is the file-name order: 00-head, 10-locale, 20-core, … 90-app. */
export function fragmentNames() {
  return readdirSync(FRAGMENT_DIR).filter((name) => name.endsWith('.js')).sort()
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
