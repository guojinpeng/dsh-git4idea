/**
 * dsh-git4idea — smoke test (file-level only: no Cordis runtime, no browser).
 *
 * Guards the invariants that would silently break the plugin at load time:
 * manifest/bookkeeping consistency, the no-build client wrapper, the baseline
 * require whitelist, and the argv-only git posture of the host half.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const read = (name) => readFileSync(join(root, name), 'utf8')
const exists = (name) => existsSync(join(root, name))

const pkg = JSON.parse(read('package.json'))
const manifest = JSON.parse(read('dsh.plugin.json'))
/** Every host module, concatenated: the entry plus src/server/** (m01807 split). */
const hostTree = () => {
  const parts = [read('src/index.js')]
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const rel = dir + '/' + entry.name
      if (entry.isDirectory()) walk(rel)
      else if (entry.name.endsWith('.js')) parts.push(read(rel))
    }
  }
  for (const dir of ['src/server/core', 'src/server/services', 'src/server/controller']) walk(dir)
  return parts.join('\n')
}
const host = hostTree()
const client = read('src/client.js')
const patch = read('cordis.patch.yml')

/** The dsh client baseline modules a no-build client half may require. */
const BASELINE = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
])

test('release bookkeeping: package.json and dsh.plugin.json agree', () => {
  assert.equal(manifest.version, pkg.version)
  assert.equal(manifest.main, './' + pkg.main)
  assert.equal(pkg.name, '@guojinpeng/dsh-git4idea')
  assert.equal(manifest.id, 'guojinpeng/dsh-git4idea')
  assert.equal(pkg.license, 'MIT')
  assert.ok(exists('LICENSE'))
})

test('every published entry exists on disk', () => {
  assert.ok(exists(pkg.main), 'host entry missing')
  assert.ok(exists('cordis.patch.yml'))
  for (const file of pkg.files) {
    if (file.includes('*')) continue
    assert.ok(exists(file), 'files[] entry missing: ' + file)
  }
  assert.equal(pkg.exports['.'], './' + pkg.main)
  assert.equal(pkg.exports['./client'], './src/client.js')
  // The Electron renderer has no loader-internal resolver, so client-module
  // discovery falls back to createRequire(baseUrl).resolve('<pkg>/package.json')
  // — which honours the exports map. Without this key the client half never
  // enters the boot graph and every host log stays green (v0.5.6, issue #2).
  assert.equal(pkg.exports['./package.json'], './package.json')
})

test('the dsh peer survives the runtime compatibility check', () => {
  // dsh 0.1.7+ enforces peerDependencies entries named @deepseek-ai/dsh* and
  // ignores engines.dsh entirely (packages/boot/app-boot/src/plugin-compatibility.ts),
  // so the plugin's floor has to live in BOTH fields with the same value.
  const peer = pkg.peerDependencies['@deepseek-ai/dsh']
  assert.equal(peer, pkg.engines.dsh, 'the dsh peer must mirror engines.dsh exactly')
  // Open floor with a prerelease tag, NO ceiling. The floor tracks the oldest
  // supported host (0.1.6-alpha.2 — the first one with the plugins.bundle.config
  // seat; 0.1.6 never shipped a stable). The host gate satisfies with
  // includePrerelease:true (app-boot plugin-compatibility.ts), so a single
  // `>=X.Y.Z-tag` comparator is both honest and sufficient; the tag keeps a
  // future prerelease floor expressible without a second branch.
  const floor = /^>=(\d+)\.(\d+)\.(\d+)(-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(peer)
  assert.ok(floor, 'the dsh peer must stay an open >=X.Y.Z[-tag] floor: ' + peer)
  const required = floor.slice(1, 4).map(Number)
  const floorTag = floor[5] || null
  // semver prerelease identifier compare: numeric fields compare numerically,
  // numeric < alphanumeric, longer wins when one is a prefix of the other.
  const compareTag = (a, b) => {
    const as = a === null ? [] : String(a).split('.')
    const bs = b === null ? [] : String(b).split('.')
    for (let i = 0; i < Math.max(as.length, bs.length); i += 1) {
      const x = as[i]; const y = bs[i]
      if (x === undefined) return -1
      if (y === undefined) return 1
      const xn = /^\d+$/.test(x); const yn = /^\d+$/.test(y)
      if (xn && yn) { const d = Number(x) - Number(y); if (d !== 0) return d }
      else if (xn !== yn) return xn ? -1 : 1
      else if (x !== y) return x < y ? -1 : 1
    }
    return 0
  }
  // Mirror of the host gate (semver.satisfies with includePrerelease:true) at
  // numeric + prerelease granularity.
  const satisfies = (version) => {
    const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/.exec(version)
    assert.ok(m, 'unparsable version ' + version)
    const got = m.slice(1, 4).map(Number)
    for (let i = 0; i < 3; i += 1) {
      if (got[i] !== required[i]) return got[i] > required[i]
    }
    if (floorTag === null) return true
    if (m[4] === undefined) return true // a stable release outranks any prerelease
    return compareTag(m[4], floorTag) >= 0
  }
  // Mirror of the host gate at numeric + prerelease granularity: 0.1.6-alpha.1
  // and older hosts predate the plugins.bundle.config seat and are rejected.
  for (const version of ['0.1.2', '0.1.5', '0.1.6-alpha.1']) {
    assert.ok(!satisfies(version), 'the dsh peer must reject ' + version)
  }
  for (const version of ['0.1.6-alpha.2', '0.1.6-alpha.3', '0.1.6', '0.1.7-alpha.1', '0.1.7-rc.1', '0.2.0']) {
    assert.ok(satisfies(version), 'the dsh peer would reject ' + version)
  }
  // OPTIONAL keeps the gate intact while removing the install hazard: the gate
  // reads peerDependencies only, but a package manager with autoInstallPeers
  // (pnpm's default) resolves the range against the registry — and every
  // published @deepseek-ai/dsh version is a prerelease, which a plain range
  // excludes (ERR_PNPM_NO_MATCHING_VERSION for the whole install).
  assert.equal(pkg.peerDependenciesMeta?.['@deepseek-ai/dsh']?.optional, true)
})

test('cordis patch mounts exactly one row named @guojinpeng/dsh-git4idea', () => {
  // Commented-out examples must not count: only live YAML lines are the mount.
  const active = patch.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
  assert.match(active, /- insert:/)
  const names = active.match(/name: '([^']+)'/g) || []
  assert.deepEqual(names, ["name: '@guojinpeng/dsh-git4idea'"])
  assert.match(active, /id: guojinpeng\/dsh-git4idea/)
})

test('client half uses the no-build ModuleLoader wrapper', () => {
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/)
  assert.match(client, /id: '@guojinpeng\/dsh-git4idea'/)
  assert.match(client, /factory: \(require\) =>/)
  assert.doesNotMatch(client, /^\s*import\s/m, 'client half must not use import')
  assert.doesNotMatch(client, /\bexport\s+(default\s+)?(const|function|class)\b/)
})

test('client half requires only baseline modules', () => {
  const calls = client.match(/require\((['"])([^'"]+)\1\)/g) || []
  assert.ok(calls.length > 0, 'expected at least one require call')
  for (const call of calls) {
    const name = call.slice(call.indexOf('(') + 2, call.length - 2)
    assert.ok(BASELINE.has(name), 'non-baseline require: ' + name)
  }
})

test('send-to-chat rides the composer facade with a guarded primitives require', () => {
  // The insertion channel is ui-conversation's SessionInput facade, reached
  // through ctx.get() probes (research brief docs/research/host-api-notes.md):
  // files insert structured reference chips, plain text rides the scoped
  // insert-text bail event. `inputTriggers...openReference` is a PREVIEW — it
  // never inserts, so the panel must not even call it.
  assert.match(client, /function composerTargetOf\(ctx, sessionId\)/, 'the probed composer target must exist')
  assert.match(client, /function insertIntoComposer\(ctx, sessionId, apply\)/, 'the CAS-retrying insert must exist')
  assert.match(client, /ctx\.get\('conversation'\)/, 'the conversation service is the insertion channel')
  assert.match(client, /ctx\.get\('sessions'\)/, 'the retained session scope comes from the sessions service')
  assert.match(client, /input\.insertReference\(/, 'file rows insert structured reference chips')
  assert.match(client, /slash\/input-insert-text/, 'plain text rides the scoped insert-text bail event')
  assert.match(client, /function fileMentionOf\(relPath\)/, 'the @-mention grammar must be inlined (the grammar package is not on the seed table)')
  assert.doesNotMatch(client, /\.openReference\(/, 'openReference opens a preview and must never be called for insertion')
  // Spans are DETECT coordinates; the published draft is the CLIPBOARD one.
  // Every span construction must go through the conversion — a bare
  // draft.length tail points past detectLength once a chip exists and the
  // edit silently fails (the v0.13.5 real-machine report).
  assert.match(client, /function detectTailSpanOf\(state\)/, 'the detect-coordinate conversion must exist')
  assert.match(client, /const span = detectTailSpanOf\(state\)/, 'the funnel must build its span through the conversion')
  assert.match(client, /const tail = detectTailSpanOf\(state\)/, 'the chip+text second leg must rebuild its tail through the conversion')
  assert.doesNotMatch(client, /start: state\.draft\.length/, 'a raw clipboard-length span would regress the probe failure')
  // A host without the seed module must degrade, not throw (invariant 1's spirit).
  assert.match(client, /let UIPrimitives = null/, 'the primitives module handle must default to null')
  assert.match(client, /try \{ UIPrimitives = require\('@deepseek-ai\/dsh-client-ui-primitives'\) \} catch/, 'the require must be guarded')
  assert.match(client, /UIPrimitives !== null && typeof UIPrimitives\.DiffBlock === 'function'/, 'the diff block must check the handle before use')
  assert.match(client, /UIPrimitives === null \|\| typeof UIPrimitives\.FileTypeIcon !== 'function'/, 'the file glyph must check the handle before use')
})

test('every send-to-chat surface is wired to the shared funnel', () => {
  // Branch rows and commit rows send plain text; change rows AND the
  // commit-detail file list send the reference. v0.14.1 removed the raw
  // PATH send on purpose (user feedback: two "send" items read as a
  // duplicate — the chip covers the file case, and 复制路径 + paste covers
  // the rare raw-string need), so the path key must be GONE everywhere.
  const hits = (key) => (client.match(new RegExp("t\\('" + key.replace(/\./g, '\\.') + "'\\)", 'g')) || []).length
  assert.ok(hits('menu.sendToChat') >= 4, 'menu.sendToChat must appear in branch, commit, change and detail-file menus (saw ' + hits('menu.sendToChat') + ')')
  assert.equal(hits('menu.sendFilePathToChat'), 0, 'the raw-path send item was removed (the @-chip covers it; 复制路径 remains)')
  assert.doesNotMatch(client, /'menu\.sendFilePathToChat'/, 'the path-send dictionary key is gone from every locale')
  assert.match(client, /commit\.hash\.slice\(0, 7\)/, 'commit rows send the short hash')
  assert.match(client, /onFileMenu: detailFileMenu/, 'the commit-detail file list must carry the context menu')
})

test('send payloads are self-describing (git commit / branch + repo, v0.13.3 feedback)', () => {
  // A bare short hash or branch name reads as noise out of context (v0.13.3
  // user feedback): the commit and branch sends must say WHAT they are and
  // WHERE from. The wording rides the fill() templates send.commitText /
  // send.branchText; the channel itself is unchanged. The file @-chip is
  // already self-describing and keeps its insertReference channel untouched.
  assert.match(client, /sendGitSummaryToChat\('send\.commitText', \{ hash: shortHash, subject: subject, repo: repoLabel \}\)/,
    'the commit payload carries hash + subject + repo')
  assert.match(client, /sendGitSummaryToChat\('send\.branchText', \{ name: entry\.name, repo: repoLabel \}\)/,
    'the branch payload carries the branch name + repo')
  assert.match(client, /const text = fill\(t\(key\), Object\.assign\(\{\}, values, \{ repo: repo \}\)\)/,
    'the payload text is a fill() template lookup, not a hand-built string')
  assert.match(client, /const repoLabel = repoRoot === null \? '' : baseName\(repoRoot\)/,
    'the repo label is the repo root basename')
  // fill() leaves unknown keys verbatim, so an unknown repo must become a
  // neutral placeholder INSIDE the helper — a literal {repo} must never reach
  // the chat.
  assert.match(client, /values\.repo === undefined \|\| values\.repo === '' \? '—' : values\.repo/,
    'an unknown repo degrades to a placeholder, never a literal {repo}')
  // A commit without a subject (git tolerates empty messages) must not fake
  // one: it degrades to the old bare-hash payload.
  assert.match(client, /if \(subject === ''\) \{ sendToComposer\(\{ text: shortHash, fallback: shortHash \}\); return \}/,
    'a commit without a subject degrades to the bare hash')
  // Both templates ship in ZH + EN + every LOCALES entry (21; the key-set test
  // would also catch a missing one, a named guard says WHY they must stay).
  for (const key of ['send.commitText', 'send.branchText']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 2, key + ' must ship in both shipped dictionaries (saw ' + occurrences + ')')
  }
  // Both git-summary menus (branch + commit) close over the funnel and the
  // label; a stale closure would send the PREVIOUS repo's name (invariant 12:
  // dependency arrays are evaluated during render). The multi-select episode
  // (issue #13) appended copyValues to both arrays — the guard needs the pair
  // PRESENT, not last, so a lookahead tolerates trailing deps.
  const menuDeps = (client.match(/sendGitSummaryToChat, repoLabel(?=[,\]])/g) || []).length
  assert.ok(menuDeps >= 2, 'branch and commit menus must both list the funnel + repoLabel (saw ' + menuDeps + ')')
})

/* The host DiffBlock paints rows WITHOUT line-number attributes (a row is a
   plain div carrying `row.text`; the +/- prefixes live in CSS ::before
   content), so the diff-pane menu reconstructs numbers by replaying the row
   kinds from the patch's first hunk header. That plumbing sits between two
   markers as a PURE block — slice it out and drive the real implementation,
   exactly like the pane sizing core. `fill` (used by the payload templates)
   and `diffLines` (used by the hand-drawn rows) are sliced along. */
function diffSelectionCore() {
  const fillStart = client.indexOf('function fill(template, values)')
  const fillEnd = client.indexOf('/* ============================== api')
  assert.ok(fillStart >= 0 && fillEnd > fillStart, 'the fill() helper must stay sliceable')
  const start = client.indexOf('function diffLines(patch)')
  const coreStart = client.indexOf('/* ---- diff selection core')
  const coreEnd = client.indexOf('/* ---- end diff selection core')
  assert.ok(start >= 0 && coreStart > start && coreEnd > coreStart, 'the diff selection core must keep its markers')
  return new Function(client.slice(fillStart, fillEnd) + '\n' + client.slice(start, coreEnd)
    + '\nreturn { DIFF_SNIPPET_MAX: DIFF_SNIPPET_MAX, hunkStartOf: hunkStartOf, hunkHeadersOf: hunkHeadersOf,'
    + ' beforeContentKind: beforeContentKind, lineSpanFromKinds: lineSpanFromKinds, rowSpanOfRows: rowSpanOfRows,'
    + ' linesLabelOf: linesLabelOf, lineSpanLabelOf: lineSpanLabelOf, diffSpanTextOf: diffSpanTextOf,'
    + ' diffLines: diffLines, fill: fill }')()
}

function composerSendCore() {
  const start = client.indexOf('function fileMentionOf(relPath)')
  const end = client.indexOf('/* ============================== diff ============================== */')
  assert.ok(start >= 0 && end > start, 'the composer send core must stay sliceable')
  return new Function(client.slice(start, end)
    + '\nreturn { fileMentionOf: fileMentionOf, detectTailSpanOf: detectTailSpanOf }')()
}

test('composer tail spans are built in DETECT coordinates, not clipboard ones (v0.13.5 real-machine fix)', () => {
  // projection.ts: detectText counts every chip as ONE U+FFFC, while the
  // published InputState.draft is the clipboard projection where a chip
  // expands to its full @path. selectSpan rejects end > detectLength, so a
  // tail from draft.length silently kills the text leg once a chip exists —
  // the conversion subtracts every occurrence's (length - 1).
  const core = composerSendCore()
  // No chips: the two projections agree, the tail is the plain draft length.
  assert.deepEqual(core.detectTailSpanOf({ draft: 'abc', draftRev: 2, occurrences: [] }),
    { start: 3, end: 3, draftRev: 2 })
  // One chip (the exact failing shape): '@deploy/x/f.md' is 14 clipboard
  // chars but ONE detect char — the tail moves back by 13 (draft 18 → 5,
  // exactly detectText = '\uFFFC 第3行').
  assert.deepEqual(core.detectTailSpanOf({ draft: '@deploy/x/f.md 第3行', draftRev: 5, occurrences: [
    { offset: 0, length: 14, clipboardText: '@deploy/x/f.md' },
  ] }), { start: 5, end: 5, draftRev: 5 }, 'the text leg span must land inside detectLength even right after the chip leg')
  // A draft the USER already seeded with a chip affects the plain-text sends too.
  assert.deepEqual(core.detectTailSpanOf({ draft: 'todo @src/a.ts then', draftRev: 9, occurrences: [
    { offset: 5, length: 9, clipboardText: '@src/a.ts' },
  ] }), { start: 11, end: 11, draftRev: 9 })
  // Two chips subtract twice.
  assert.deepEqual(core.detectTailSpanOf({ draft: '@a/x @b/y!', draftRev: 4, occurrences: [
    { offset: 0, length: 4, clipboardText: '@a/x' },
    { offset: 5, length: 4, clipboardText: '@b/y' },
  ] }), { start: 4, end: 4, draftRev: 4 })
  // Degenerate states refuse instead of inventing a span.
  assert.equal(core.detectTailSpanOf(null), null)
  assert.equal(core.detectTailSpanOf({ draft: 5, draftRev: 1, occurrences: [] }), null)
  assert.equal(core.detectTailSpanOf({ draft: 'abc', occurrences: [] }), null)
  assert.equal(core.detectTailSpanOf({ draft: '', draftRev: 1, occurrences: [
    { offset: 0, length: 99, clipboardText: '@ghost' },
  ] }), null, 'a negative tail must never be handed to the editor')
})

test('the diff selection core maps hunk headers to file line numbers (v0.13.5)', () => {
  const core = diffSelectionCore()

  /* A realistic two-hunk patch. Hunk 1: @@ -10,7 +10,8 @@ — 3 ctx + 1 del + 3
     add + ... let the numbers below carry it. Hunk 2 sits 40 lines lower, so
     every replay has to CROSS the second header to prove the first header
     seeds the whole walk and per-kind counters do the rest. */
  const PATCH = [
    'diff --git a/src/app.js b/src/app.js',
    'index 1111111..2222222 100644',
    '--- a/src/app.js',
    '+++ b/src/app.js',
    '@@ -10,7 +10,8 @@ const config = {',
    ' const a = 1',        // ctx: old 10, new 10
    ' const b = 2',        // ctx: old 11, new 11
    '-const removed = 3',  // del: old 12
    '+const added = 4',    // add: new 12
    '+const added2 = 5',   // add: new 13
    ' const c = 6',        // ctx: old 13, new 14
    ' const d = 7',        // ctx: old 14, new 15
    ' const e = 8',        // ctx: old 15, new 16
    '@@ -50,6 +52,7 @@ export function main() {',
    ' main()',             // ctx: old 50, new 52
    ' prep()',             // ctx: old 51, new 53
    '-gone()',             // del: old 52
    '-gone2()',            // del: old 53
    '+here()',             // add: new 54
    '+here2()',            // add: new 55
    '+here3()',            // add: new 56
    ' finish()',           // ctx: old 54, new 57
    ' end()',              // ctx: old 55, new 58
  ].join('\n')

  // The first header seeds the replay, and only the first one counts.
  assert.deepEqual(core.hunkStartOf(PATCH), { oldLine: 10, newLine: 10 })
  assert.deepEqual(core.hunkStartOf('@@ -3,1 +3,1 @@\n x'), { oldLine: 3, newLine: 3 })
  assert.equal(core.hunkStartOf('diff --git a/x b/x\nbinary'), null, 'a headerless patch has no coordinates')
  // A multi-hunk diff restarts BOTH counters at every @@ line: the replay
  // needs one seed per hunk, in patch order.
  const headers = core.hunkHeadersOf(PATCH)
  assert.deepEqual(headers, [{ oldLine: 10, newLine: 10 }, { oldLine: 50, newLine: 52 }])

  /* Host-diffBlock path. A real body renders: the path row (chrome), hunk 1,
     a `⋯` gap row (chrome), hunk 2 — and the CHROME ROWS are what re-bases
     the counters to the next header. A flat kinds list without them would
     keep counting straight through the second header, so the cross-hunk
     assertions run against the WITH-chrome sequence only. */
  const rows = core.diffLines(PATCH)
  const kinds = rows.filter((row) => row.kind === 'ctx' || row.kind === 'del' || row.kind === 'add').map((row) => row.kind)
  assert.equal(kinds.length, 17)
  const withChrome = [null].concat(kinds.slice(0, 8), [null], kinds.slice(8))
  // path row, hunk 1 (8 rows), gap row, hunk 2 (9 rows)
  assert.equal(withChrome.length, 19)
  // First hunk, flat kinds: numbers from the first header.
  assert.deepEqual(core.lineSpanFromKinds(kinds, 0, 1, headers), { start: 10, end: 11, old: false })
  assert.deepEqual(core.lineSpanFromKinds(kinds, 2, 4, headers), { start: 12, end: 13, old: false },
    'mixed del+add span rides the new side')
  assert.deepEqual(core.lineSpanFromKinds(kinds, 2, 2, headers), { start: 12, end: 12, old: true },
    'a pure deletion reports OLD numbers, flagged as such')
  assert.deepEqual(core.lineSpanFromKinds(kinds, 3, 3, headers), { start: 12, end: 12, old: false },
    'one added line reports its new number, start == end')
  // With the chrome rows in: the gap re-bases to the second header.
  assert.equal(core.lineSpanFromKinds(withChrome, 0, 0, headers), null, 'the path row alone has no numbers')
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 1, 2, headers), { start: 10, end: 11, old: false })
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 12, 15, headers), { start: 54, end: 55, old: false },
    'a span across the gap reads on the NEW side of the SECOND header')
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 12, 13, headers), { start: 52, end: 53, old: true },
    "a pure deletion in the second hunk reports that hunk's OLD numbers")
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 14, 14, headers), { start: 54, end: 54, old: false })
  assert.deepEqual(core.lineSpanFromKinds(withChrome, 17, 18, headers), { start: 57, end: 58, old: false },
    'context after the additions keeps counting from the same header')
  // Chrome-only span (path row or gap): no numbers at all.
  assert.equal(core.lineSpanFromKinds(withChrome, 9, 9, headers), null)
  assert.equal(core.lineSpanFromKinds([null, null], 0, 1, headers), null, 'a selection on path/gap rows has no line numbers')
  assert.equal(core.lineSpanFromKinds('nope', 0, 0, headers), null, 'non-array input degrades to null')
  assert.equal(core.lineSpanFromKinds(kinds, 0, 1, []), null, 'no headers, no coordinates')

  /* Hand-drawn path: diffLines rows carry both numbers already; the span
     must agree with the replayed one (row indexes include meta/hunk rows). */
  // rows: 0 diff, 1 index, 2 ---, 3 +++, 4 @@1, 5..12 body1, 13 @@2, 14..22 body2
  assert.deepEqual(core.rowSpanOfRows(rows, 7, 7), { start: 12, end: 12, old: true }, 'the deleted row reports its old number')
  assert.deepEqual(core.rowSpanOfRows(rows, 7, 9), { start: 12, end: 13, old: false }, 'mixed span rides the new side')
  assert.deepEqual(core.rowSpanOfRows(rows, 14, 15), { start: 52, end: 53, old: false }, 'the second hunk header re-bases both counters')
  assert.deepEqual(core.rowSpanOfRows(rows, 16, 19), { start: 54, end: 55, old: false }, 'cross-header spans stay on the new side')
  assert.deepEqual(core.rowSpanOfRows(rows, 20, 22), { start: 56, end: 58, old: false }, 'context after the additions keeps counting')
  assert.equal(core.rowSpanOfRows(rows, 0, 1), null, 'meta rows carry no numbers')
  assert.equal(core.rowSpanOfRows(rows, 3, 2), null, 'an inverted range is refused')

  // Labels: a single line stays bare, a range takes the en dash.
  assert.equal(core.linesLabelOf(7, 7), '7')
  assert.equal(core.linesLabelOf(7, 9), '7–9')
})

test('diff line payloads are self-describing in the 21-gate dictionaries (v0.13.5)', () => {
  const core = diffSelectionCore()
  const zhStart = client.indexOf('const ZH = {')
  let depth = 0
  let zhEnd = -1
  for (let index = client.indexOf('{', zhStart); index < client.length; index += 1) {
    if (client[index] === '{') depth += 1
    else if (client[index] === '}') {
      depth -= 1
      if (depth === 0) { zhEnd = index + 1; break }
    }
  }
  const ZH = new Function(client.slice(zhStart, zhEnd) + '\nreturn ZH')()
  const t = (key) => ZH[key]
  assert.equal(t('send.diffLinesCommit'), '{lines}(提交 {hash}「{subject}」@ {branch})', 'the zh templates must stay intact for this test to read them')

  // Commit context: short hash, subject truncated to 60, HEAD branch.
  const long = 'word '.repeat(30).trim()
  assert.equal(core.diffSpanTextOf(t, { kind: 'commit', hash: 'a1b2c3d4e5f6', subject: 'Fix the thing' }, { start: 7, end: 9, old: false }, 'main'),
    '第 7–9 行(提交 a1b2c3d「Fix the thing」@ main)')
  assert.equal(core.diffSpanTextOf(t, { kind: 'commit', hash: 'a1b2c3d4e5f6', subject: long }, { start: 3, end: 3, old: false }, ''),
    '第 3 行(提交 a1b2c3d「' + long.slice(0, 60) + '」@ —)', 'the subject is truncated and a missing branch degrades to a dash')
  assert.equal(core.diffSpanTextOf(t, { kind: 'commit', hash: '', subject: '' }, { start: 5, end: 6, old: true }, 'dev'),
    '第 5–6 行(旧行号)(提交 —「—」@ dev)', 'an old-numbered span says so; an unknown hash/subject degrade, never fake')

  // Worktree context: staged vs uncommitted comes from the pane's own state.
  assert.equal(core.diffSpanTextOf(t, { kind: 'worktree', staged: true }, { start: 12, end: 12, old: false }, ''),
    '第 12 行(工作区已暂存)')
  assert.equal(core.diffSpanTextOf(t, null, { start: 18, end: 19, old: true }, ''),
    '第 18–19 行(旧行号)(工作区未提交)', 'a null context reads as the working tree, uncommitted')
})

test('the diff pane context menu reads the selection before the menu opens (v0.13.5)', () => {
  // The pane carries its own menu; a selection OUTSIDE the diff rows keeps
  // the browser's own menu (no preventDefault, no items).
  assert.match(client, /onContextMenu: onDiffPaneContextMenu/, 'the diff pane must carry its own context menu')
  const handler = client.slice(client.indexOf('const onDiffPaneContextMenu'), client.indexOf('const submitDialog'))
  assert.ok(handler.length > 200 && handler.length < 4000, 'the handler must be found whole')
  assert.match(handler, /const saved = savedSelectionOf\(\)/, 'the window selection is captured FIRST')
  assert.match(client, /getRangeAt\(0\)\.cloneRange\(\)/, 'the captured range is a CLONE — some platforms clear it under the menu')
  assert.match(handler, /if \(saved === null \|\| resolved === null\) return/, 'no diff selection keeps the browser menu (preventDefault skipped)')
  assert.ok(handler.indexOf('preventDefault') < handler.indexOf('openMenuAt'), 'the browser menu is only suppressed for real diff selections')
  assert.match(handler, /DIFF_SNIPPET_MAX/, 'the snippet degradation truncates like the core promises')

  // Forward-compat guard (v0.13.5): the rows may be HOST-rendered
  // (ui-primitives DiffBlock), and a future DSH may give that component its
  // own context-menu surface. React dispatches inner handlers first, so the
  // pane handler MUST defer to defaultPrevented before doing anything —
  // the host menu stands alone, never two menus, never an override. This
  // assertion pins the check to the FIRST statement of the handler so a
  // casual refactor cannot drop it.
  const deferPos = handler.indexOf('if (event.defaultPrevented === true) return')
  assert.ok(deferPos >= 0, 'the pane handler must defer to inner defaultPrevented (ours is a last resort, the host menu wins)')
  assert.ok(deferPos < handler.indexOf('const saved = savedSelectionOf()'), 'the defer check runs before the selection is even read')

  // The funnel gains a chip+text leg: the @file chip first, then the line
  // sentence at the NEW draft tail (the chip changed draft and rev).
  assert.match(client, /slash\/input-insert-text', \{ text: payload\.text, span: tail \}/,
    'the line-range sentence rides the text leg after the chip')
  assert.match(client, /if \(chipApplied === false\) return false/, 'a lost chip leg retries the whole payload')
  assert.match(client, /return true\n          \}\n          if \(payload\.appearance !== undefined\) \{/,
    'a chip that landed reads as sent even when the text leg lost its race')

  // The pane context rides the patch state and clears wherever the patch does
  // (pickRepo, selectCommit, onBack, pane close, view switch).
  assert.match(client, /const \[diffContext, setDiffContext\] = useState\(null\)/)
  const clears = (client.match(/setDiffContext\(null\)/g) || []).length
  assert.ok(clears >= 5, 'the diff context must clear wherever the patch clears (saw ' + clears + ')')
  // v0.14: the open verbs moved into ONE funnel, showDiff (external preview
  // first, inline pane as the fallback). The context contract survives
  // verbatim inside the funnel's inline legs.
  assert.match(client, /setDiffContext\(\{ kind: 'worktree', staged: seed\.staged === true \}\)/,
    'the worktree pane remembers whether it shows staged or unstaged (showDiff inline leg)')
  assert.match(client, /setDiffContext\(\{ kind: 'commit', hash: seed\.hash, subject: seed\.subject \|\| '' \}\)/,
    'the commit-detail pane carries hash + subject at open time (showDiff inline leg)')
  // The funnel itself: the right sidebar's preview tab first, inline only as a
  // fallback — and the seed carries the repo root beside cwd (the route needs
  // cwd, repoRoot skips the rev-parse) so a multi-root workspace cannot land
  // the diff in the wrong repository.
  assert.match(client, /if \(previewDiff\(seed\) === true\) return/,
    'every diff verb goes through the external-first funnel')
  assert.match(client, /repoRoot: repoRoot, sessionId: scopeObject\.sessionId/,
    'the external diff seed pins the repository root')
  assert.match(client, /const dialogSeed = commitHash !== null/,
    'the seed is built once, before either the card or the sidebar leg runs')
  assert.match(client, /previewStore\.set\(dialogSeed\)/,
    'the sidebar fallback still stores the seed before its preview tab opens')

  // Nine new keys × 21 gates (the key-set test checks exact equality; this
  // says WHY they exist).
  for (const key of ['menu.sendDiffLinesToChat', 'menu.sendDiffSnippetToChat', 'menu.copyDiffRef', 'send.diffLinesCommit', 'send.diffLinesWorktree', 'send.diffStaged', 'send.diffUnstaged', 'send.diffNewLines', 'send.diffOldLines']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 2, key + ' must ship in both shipped dictionaries (saw ' + occurrences + ')')
  }
})

test('the conversation seat convergence is a controlled loop with a content trigger (v0.13.3 fix)', () => {
  // One feedback pass was not enough on the real host: content mounts AFTER
  // the first pass (composer, hero, diff) and re-opens the overflow, and the
  // ResizeObserver only sees the scrollport's own size. The seat must own a
  // bounded convergence LOOP (4 rAF rounds, overwrite-style so rounds cannot
  // compound, 240 floor) re-run by every trigger — and a host without the
  // conversation scrollport must skip the whole thing silently.
  const start = client.indexOf('Leftover wheel scroll, root cause')
  const end = client.indexOf('const scope = useMemo(() => ({ cwd: cwd, sessionId: sessionId }), [cwd, sessionId])')
  assert.ok(start >= 0 && end > start, 'the seat sizing effect block must exist')
  const effect = client.slice(start, end)
  assert.match(effect, /base\.current = Math\.round\(scroll\.clientHeight - offset - 8\)/,
    'measure() recomputes the UNCORRECTED base on every pass')
  assert.match(effect, /const overflow = scroll\.scrollHeight - scroll\.clientHeight\n            if \(overflow <= 1\) return/,
    'a convergence round stops once no meaningful overflow (>1px) is left')
  assert.match(effect, /leftover\.current = overflow\n            setSeatHeight\(Math\.max\(240, base\.current - overflow\)\)/,
    'the correction is recorded overwrite-style and clamps at 240')
  assert.match(effect, /if \(rounds < 4\) requestAnimationFrame\(step\)/,
    'the convergence loop is bounded (at most 4 rAF rounds)')
  assert.match(effect, /typeof MutationObserver === 'function'/,
    'the content watcher is feature-probed like the resize one')
  assert.match(effect, /mutationObserver\.observe\(scroll, \{ childList: true, subtree: true \}\)/,
    'the watcher covers content mounting later (childList + subtree)')
  assert.match(effect, /setTimeout\(\(\) => \{ mutationTimer = null; measure\(\) \}, 120\)/,
    'the mutation burst is debounced (~120ms)')
  assert.match(effect, /if \(mutationTimer !== null\) clearTimeout\(mutationTimer\)/,
    'a new burst replaces the pending debounce')
  assert.match(effect, /if \(mutationObserver !== undefined\) mutationObserver\.disconnect\(\)/,
    'unmount disconnects the watcher together with the resize one')
  assert.match(effect, /try \{ scroll = el\.closest\('\[data-conversation-scroll\]'\) \} catch/,
    'probing the host structure rides a try/catch: a missing scrollport skips silently')
})

test('client API base is mount-relative (sub-path support, issue #4)', () => {
  // dsh 0.1.7 serves the shell with <base href="./">: document.baseURI is the
  // mount the page loaded from, and fetch() resolves relative URLs against it.
  // An origin-absolute base ('/dsh-git4idea/api') would escape the mount and
  // 404 behind any strict prefix-stripping proxy.
  const match = client.match(/const API_BASE = '([^']+)'/)
  assert.ok(match, 'API_BASE declaration missing')
  const base = match[1]
  assert.ok(!base.startsWith('/'), 'API_BASE must be document-relative, not origin-absolute: ' + base)
  // Resolve the SHIPPED constant exactly the way the browser does, under both
  // serving shapes: a prefix-stripping proxy mount and the origin root.
  assert.equal(
    new URL(base + '/repos', 'http://dsh.internal/dsh/').pathname,
    '/dsh/dsh-git4idea/api/repos',
    'under a sub-path mount the call must stay inside the mount',
  )
  assert.equal(
    new URL(base + '/repos', 'http://dsh.internal/').pathname,
    '/dsh-git4idea/api/repos',
    'at the origin root the call must keep today\'s upstream path',
  )
  // The desktop renderer is the other document owner: it loads dsh-app://app/
  // and injects no <base> (its document directory already is the root), so the
  // relative form has to resolve to exactly the absolute form it replaced.
  assert.equal(
    new URL(base + '/repos', 'dsh-app://app/').href,
    new URL('/' + base + '/repos', 'dsh-app://app/').href,
    'the desktop document base must not change what the call resolves to',
  )
})

test('plugin API calls fall back to the remote pairing proxy on auth rejection (issue #9)', () => {
  // dsh-remote-web-ui's browser channel rewrites only the host's own /api/,
  // /sidebar/, /git/ and /pet/ prefixes onto its /remote/ proxy — a
  // plugin-owned route is not on the list, so from a paired remote client the
  // direct call reaches the harness browser-auth gate and comes back
  // 401/403 'forbidden' (both the sidebar tab and the dock panel refused to
  // open). The fix retries the same request through the proxy, which serves
  // any loopback path under /remote/<full pathname> with the device
  // credentials — admitted by our own loopback fence.
  const core = client.slice(
    client.indexOf('/* ---- remote channel fallback core'),
    client.indexOf('/* ---- end remote channel fallback core'))
  assert.ok(core.length > 200, 'the pure fallback core must exist in the client half')
  // URL shape mirrors the boot patch exactly: '/remote' + the request's FULL
  // pathname (mount prefix included) + search — resolved through the same
  // base the direct fetch used (document.baseURI, which honours <base href>).
  const helpers = new Function('window', 'document', core
    + '\nreturn { remoteFallbackUrl: remoteFallbackUrl, isAuthRejection: isAuthRejection }')
  const atMount = helpers({ location: { href: 'http://dsh.internal/dsh/session' } },
    { baseURI: 'http://dsh.internal/dsh/' })
  assert.equal(atMount.remoteFallbackUrl('dsh-git4idea/api/resolve'),
    '/remote/dsh/dsh-git4idea/api/resolve', 'under a sub-path mount the retry stays inside the mount')
  const atRoot = helpers({ location: { href: 'http://dsh.internal/session/x' } },
    { baseURI: 'http://dsh.internal/' })
  assert.equal(atRoot.remoteFallbackUrl('dsh-git4idea/api/resolve'),
    '/remote/dsh-git4idea/api/resolve', 'at the origin root the retry keeps the plugin path')
  assert.equal(atRoot.remoteFallbackUrl('dsh-git4idea/api/list?q=1'),
    '/remote/dsh-git4idea/api/list?q=1', 'the query string survives the rewrite')
  // Without a document (SSR / exotic hosts) the page URL is the base, and
  // without either the catch branch degrades to a plain prefix.
  const pageBase = helpers({ location: { href: 'http://dsh.internal/dsh/session/' } }, undefined)
  assert.equal(pageBase.remoteFallbackUrl('dsh-git4idea/api/resolve'),
    '/remote/dsh/session/dsh-git4idea/api/resolve', 'the page URL resolves relative paths against its directory')
  const bare = helpers(undefined, undefined)
  assert.equal(bare.remoteFallbackUrl('dsh-git4idea/api/resolve'), '/remote/dsh-git4idea/api/resolve')
  assert.equal(bare.remoteFallbackUrl('/dsh-git4idea/api/resolve'), '/remote/dsh-git4idea/api/resolve',
    'a leading slash is not doubled')
  // Only the auth fence trips the retry; real answers (200, 404, 422…) are
  // never masked by a second request.
  for (const status of [401, 403]) assert.equal(bare.isAuthRejection(status), true)
  for (const status of [200, 400, 404, 422, 500]) assert.equal(bare.isAuthRejection(status), false)
  // The retry is sticky: once the proxy answered, later calls skip the doomed
  // direct round trip; a retry that is ITSELF an auth rejection never flips
  // the switch (a genuine cross-site refusal cannot be masked).
  const request = client.slice(client.indexOf('async function request(method, payload)'), client.indexOf('/* ============================== storage'))
  assert.match(request, /viaRemoteChannel === true/, 'sticky mode short-circuits the direct call')
  assert.match(request, /if \(isAuthRejection\(retried\.status\) !== true\) \{\n\s+viaRemoteChannel = true/, 'only a non-rejection from the proxy flips the sticky switch')
  assert.match(request, /const retried = await fetch\(remoteFallbackUrl\(direct\), init\)/, 'the retry reuses the same init (method, headers, body)')
})

/** One rule out of the client half's injected stylesheet, by exact selector. */
function cssRule(selector) {
  const start = client.indexOf("'" + selector + '{')
  assert.ok(start >= 0, 'stylesheet rule missing: ' + selector)
  const end = client.indexOf("'", start + 1)
  return client.slice(start + 1, end)
}

test('the rc.2 surface contract: theme-owned menu material on its own layer', () => {
  // dsh 0.1.7-rc.2 (docs/web-styling.md "Component rules") made the menu material
  // theme-owned: dropdown/context/selection menus take `--dsw-menu-surface-fill`
  // plus `--dsw-menu-backdrop-filter` (or, without MenuSurface's macOS backing,
  // `--dsw-specific-menu`, whose darwin fill is 94% opaque), and feature/platform
  // CSS must not override either. The old rule painted its own opaque layer fill,
  // borrowed `--dsh-any-blur-card-panels` as the filter and re-added a neutral
  // border under a hand-rolled shadow — all three are now guarded.
  const menu = cssRule('.git4idea-menu')
  assert.match(menu, /border:0/, 'an elevated surface carries the hairline inside its shadow, not a border')
  assert.doesNotMatch(menu, /background:var\(--dsw-alias-bg-layer-/, 'the menu must not override the theme material')
  assert.doesNotMatch(menu, /--dsh-any-/, 'platform CSS must not override the theme material')
  // Filtering stays on an isolated layer: on the card itself it would become the
  // backdrop root and the containing block of every descendant.
  const material = cssRule('.git4idea-menu::before')
  assert.match(material, /z-index:-1/, 'the material must paint on its own layer behind the rows')
  assert.match(material, /border-radius:inherit/)
  assert.match(material, /background:var\(--dsw-specific-menu,/)
  assert.match(material, /backdrop-filter:var\(--dsw-menu-backdrop-filter,/)
  assert.match(material, /pointer-events:none/)
  // Invariant 13 (panel-internal overlays) survives the restructure: the PANEL
  // anchor moved to the new `.git4idea-menu-wrap` (the submenu needs a shared
  // positioning parent), the card itself no longer carries position — but the
  // wrapper is still absolute inside `.git4idea-root`, the scroller is a separate
  // box, and the theme's dark-menu stroke hook rides the card exactly as
  // MenuSurface sets it.
  assert.match(cssRule('.git4idea-menu-wrap'), /position:absolute/)
  assert.match(menu, /isolation:isolate/)
  // border-box so `max-height: calc(100% - 8px)` caps the WHOLE card: content-box
  // sizing let the 8px of padding escape the cap, and a tall context menu in a
  // short bottom workbench (185px) stuck 4px past the panel edge. Measured with a
  // HEAD (v0.7.2) baseline tarball in the same instance: 187px of menu in a 185px
  // panel. The clamp only holds while BOTH declarations are present — border-box
  // alone would still let a 16px menu escape an 8px inset, and the 8px inset alone
  // only balances against `left/top >= 4` in ContextMenu.
  assert.match(menu, /box-sizing:border-box/)
  // m04510 caps the menu at a fixed 320px so a long ref list scrolls instead of
  // growing past the panel edge.
  assert.match(menu, /max-height:min\(320px,calc\(100% - 8px\)\)/)
  assert.match(cssRule('.git4idea-menu-wrap'), /max-width:calc\(100% - 8px\)/)
  assert.match(client, /className: 'git4idea-menu-scroll'/)
  assert.match(client, /'data-menu-material': 'translucent'/)
  // Panel-internal overlays still stay inside .git4idea-root. The notification
  // stack is the one surface outside React (m00761): it owns a plain DOM element
  // on document.body, because a node hosted in a slot painted behind the page
  // chrome and the notice never showed.
  assert.equal((client.match(/ReactDOM/g) || []).length, 0, 'the toast stack no longer needs react-dom')
  assert.match(client, /root\.setAttribute\('data-git4idea-toasts', ''\)/)
  assert.match(client, /document\.body\.appendChild\(root\)/)
})

test('the rc.2 surface contract: elevation instead of border plus shadow', () => {
  // "Never pair a `--dsw-alias-border-*` border with an lv/elevation shadow"
  // (docs/web-styling.md) — the 0.5px hairline is the first elevation layer.
  // Dialogs take the panel radius; the menu keeps the compact tier (outer R12,
  // 4px padding, R8 rows) from docs/ui-radius.md.
  for (const selector of ['.git4idea-menu', '.git4idea-dialog', '.git4idea-toast']) {
    const text = cssRule(selector)
    assert.match(text, /box-shadow:var\(--dsw-elevation-(prominent|panel)/, selector + ' must take a shared elevation')
    assert.doesNotMatch(text, /border:1px solid var\(--dsw-alias-border-/, selector + ' must not pair a neutral border with elevation')
  }
  assert.match(cssRule('.git4idea-menu'), /border-radius:var\(--dsw-radius-md,/)
  assert.match(cssRule('.git4idea-dialog'), /border-radius:var\(--dsw-radius-panel,/)
  // Modal masks keep the translucent dark fill and take their blur from the
  // theme (`--dsw-mask-blur` is `none`, so the declaration is a no-op today).
  assert.match(cssRule('.git4idea-overlay'), /backdrop-filter:var\(--dsw-mask-blur,/)
})

test('the rc.2 surface contract: one focus colour, radius tokens, round capsules', () => {
  // The theme owns `--dsw-focus-ring-color` / `--dsw-focus-ring-width` and blanks
  // the colour under `html[data-input-modality='pointer']` for everything that is
  // not `:read-write` (ui-theme/src/styles/focus.css), so a component may own its
  // offset and width but never its colour. The old rule used `:focus` with its own
  // colour, which painted a ring on pointer clicks too.
  assert.match(client, /\.git4idea-select:focus-visible\{outline:1px solid var\(--dsw-focus-ring-color,/)
  assert.doesNotMatch(client, /\.git4idea-select:focus\{outline:/, 'focus feedback must follow the input modality')
  // Text controls keep their own feedback (the shipped Input.module.css pattern:
  // outline:none plus a focus-within border colour) and use the shared colour.
  assert.match(client, /\.git4idea-input:focus\{border-color:var\(--dsw-alias-state-business-primary,/)
  assert.match(client, /\.git4idea-textarea:focus\{border-color:var\(--dsw-alias-state-business-primary,/)

  const css = client.slice(client.indexOf('const CSS = ['), client.indexOf('].join('))
  // docs/ui-radius.md: consume the named scale instead of local values, except
  // deliberate full-round shapes, which pair `corner-shape: round` in-rule so the
  // superellipse does not deform them.
  const radii = [...css.matchAll(/border-radius:([^;'}]+)/g)].map((match) => match[1].trim())
  assert.ok(radii.length >= 12, 'expected the radius scale to be consumed throughout, saw ' + radii.length)
  for (const value of radii) {
    assert.match(
      value,
      /^(var\(--dsw-radius-|calc\(var\(--dsw-radius-|inherit$|50%$|999px$)/,
      'off-scale radius literal (use a --dsw-radius-* token): ' + value,
    )
  }
  const capsules = [...css.matchAll(/border-radius:999px;([^}]*)/g)]
  assert.ok(capsules.length >= 3, 'expected the pill chips to survive, saw ' + capsules.length)
  for (const capsule of capsules) {
    assert.match(capsule[1], /corner-shape:round/, 'a full-round radius must pair corner-shape: round')
  }
  // Double-era posture: every rc.2 token needs a fallback, because the plugin
  // still installs on hosts that predate the scale (engines.dsh >= 0.1.2-0).
  for (const match of css.matchAll(/var\((--dsw-(?:radius|elevation|focus-ring|menu|mask|specific-menu)[a-z0-9-]*)\s*(,|\))/g)) {
    assert.equal(match[2], ',', 'rc.2 token without a fallback: ' + match[1])
  }
})

test('client half has two doors: the native right sidebar, the conversation view tab', () => {
  // Door 1 — DSH's own right sidebar (ui-sidebar-right) is the only home: the
  // panel registers a tab type plus its pane body, and opens on demand from the
  // composer pill. m02407 #1 removed the once-per-page default seat: the Git tab
  // in the conversation header is the only door, and nothing opens at startup.
  // The seats WAIT for their services (v0.5.3): the old synchronous ctx.get()
  // probe ran before ui-sidebar-right provided the registry on the desktop app
  // and on clean instances, then returned silently — no Git card, no error.
  // ctx.inject() re-registers the moment the services appear.
  assert.match(client, /ctx\.inject\(\['sidebarRightTabs', 'slots'\]/, 'native seats wait for their services')
  assert.match(client, /slots\.inject\('sidebar\.right\.pane\.tab'/)
  assert.match(client, /^ {6}hostNatively\(\)$/m, 'the native seats go up unconditionally')
  assert.doesNotMatch(client, /betterSidebar/, 'no dsh-better-sidebar service is read or registered')
  assert.doesNotMatch(client, /registerTab\(/, 'the panel registers no foreign tab')
  assert.match(client, /sidebarRight\.openTab\(NATIVE_KIND\)/, 'the panel still opens on demand from the composer pill')
  assert.doesNotMatch(client, /defaultSeatOpened/, 'm02407 #1: no seat opens itself at page load')
  assert.match(client, /inject: \[\], apply/)
  // Door 3 — the conversation-area view tab (issue #8), beside 对话/轨迹: the
  // ui-conversation `conversation.view` slot, the same contract dsh-context
  // rides. Always on since m04492: the row Config's `conversationTab` switch
  // went with the settings card, so the tab is a constant rather than a
  // register/unregister pair.
  assert.match(client, /const CONVERSATION_VIEW_ID = 'git4idea'/)
  assert.match(client, /const conversationTabEnabled = \(\) => true/)
  assert.match(client, /slots\.inject\('conversation\.view', \(\) => slots\.register\(/)
  assert.match(client, /name: 'conversation\.view', id: CONVERSATION_VIEW_ID, order: 30, locale: LOCALE_NS/)
  // m04492: the switch is a constant, so nothing subscribes to a config.
  assert.doesNotMatch(client, /subscribeRailConfig/, 'm04492: no row Config subscription is left to drive it')
  // v0.14: TWO native tab types — the main panel and the preview tab. Both are
  // guide-less since m02407 #1: the plugin keeps no entry on the start page, and
  // the preview tab only exists to receive the openTab a diff verb fires.
  const nativeTypes = client.match(/tabs\.register\(\{/g) || []
  assert.equal(nativeTypes.length, 2, 'two native tab types: the main panel and the preview tab')
  assert.match(client, /const NATIVE_PREVIEW_ID = 'dsh-git4idea-preview'/)
  assert.match(client, /keepMounted: true/, 'the preview tab keeps its body across tab switches')
  assert.doesNotMatch(client, /NATIVE_PREVIEW_ID,\n\s*kind: NATIVE_PREVIEW_KIND,\n\s*title: \(\) => t\('preview\.title'\),\n\s*keepMounted: true,\n\s*guide:/,
    'the preview tab carries no guide entry (it is not a start-page destination)')
  assert.doesNotMatch(client, /guide:/, 'no tab type advertises a start-page entry (m02407 #1)')
  const slotSeats = client.match(/slots\.register\(/g) || []
  assert.equal(slotSeats.length, 3, 'three keyed-slot seats: native pane, preview pane, conversation view')
})

test('host half is an ESM cordis plugin with argv-only git calls', () => {
  assert.match(host, /export const name = 'guojinpeng\/dsh-git4idea'/)
  assert.match(host, /export const inject = \['webServer'\]/)
  assert.match(host, /export function apply\(ctx\)/)
  assert.match(host, /ctx\.webServer\.register\(\{ kind: 'prefix', path: ROUTE_PREFIX/)
  assert.match(host, /spawn\(gitBinary\(\), args, \{ cwd/)
  assert.doesNotMatch(host, /(^|[^.\w])exec\(/m, 'no shell exec')
  assert.doesNotMatch(host, /execSync\(|shell:\s*true/, 'no shell exec / shell:true')
  assert.doesNotMatch(host, /from '(?!node:|\.\/)/, 'host half may only import node: builtins and its own modules')
})

test('host half keeps the destructive-confirm guards', () => {
  for (const needle of [
    'push requires confirm: true',
    'hard reset requires confirm: true',
    'force delete requires confirm: true',
    'discarding untracked files requires confirm: true',
    'dropping a stash requires confirm: true',
  ]) {
    assert.ok(host.includes(needle), 'missing guard: ' + needle)
  }
})

test('host half exposes the method table the client calls', () => {
  const methods = ['account', 'summary', 'head', 'stats', 'branches', 'log', 'me', 'merge-point', 'commitDetail', 'diff', 'compare', 'dirTree', 'repos', 'stage', 'unstage', 'discard', 'commit', 'checkout', 'branchCreate', 'branchRename', 'branch-upstream', 'branchDelete', 'merge', 'rebase', 'cherryPick', 'revert', 'reset', 'fetch', 'pull', 'push', 'stashList', 'stashPush', 'stashApply', 'stashDrop', 'tagCreate', 'tagDelete', 'tagDeleteRemote', 'pushTags', 'clone', 'gitLogs', 'consoleLog', 'consoleClear', 'worktreeList', 'worktreeAdd', 'worktreeRemove', 'remoteAdd', 'remoteRemove', 'branchDeleteRemote', 'rebaseAbort', 'stashClear', 'undoList', 'undoApply', 'conflictDetail', 'conflictSave', 'conflictResolve', 'conflictBlame', 'operationFinish', 'version']
  for (const method of methods) {
    if (method === 'merge-point') { assert.match(host, /^  'merge-point': mergePoint,$/m, 'host method missing: merge-point'); continue }
    if (method === 'branch-upstream') { assert.match(host, /^  'branch-upstream': branchUpstream,$/m, 'host method missing: branch-upstream'); continue }
    if (method === 'head') { assert.match(host, /^  head: headState,$/m, 'host method missing: head'); continue }
    assert.match(host, new RegExp('^  ' + method + ',$', 'm'), 'host method missing: ' + method)
  }
  for (const call of client.match(/request\('([a-zA-Z]+)'/g) || []) {
    const method = call.slice(call.indexOf("'") + 1, call.length - 1)
    assert.ok(methods.includes(method), 'client calls an unregistered method: ' + method)
  }
})

test('the Git account entry sits between the repo and branch pills', () => {
  const panel = read('src/client/panel.js')
  assert.ok(panel.indexOf('E(AccountButton') < panel.indexOf("className: 'git4idea-select-wrap'"), 'account pill belongs before the branch pill')
  assert.match(panel, /request\('account', base\)/)
  const account = read('src/client/account.js')
  assert.match(account, /function AccountAuthDialog/)
  assert.match(account, /account.endpointLabel/)
  assert.match(account, /className: 'git4idea-account-field git4idea-account-endpoint'/)
  assert.match(account, /request\('account-web', Object.assign\(\{\}, props.base, \{ endpoint: host \}\)\)/)
  assert.match(account, /request\('account-token', Object.assign\(\{\}, props.base, \{ endpoint: host, token: token.trim\(\) \}\)\)/)
  assert.match(account, /role: 'alert'/)
  // A token must reach git on stdin: argv is written to the console log.
  assert.match(host, /'credential', 'approve'/)
  assert.match(host, /input: 'protocol=' \+ endpoint.protocol \+ '\\nhost=' \+ endpoint.host/)
  assert.match(host, /endpointParts/)
  assert.doesNotMatch(host, /credential', 'approve', '--?password/)
})

test('host half serialises writes and refuses the dangerous cases', () => {
  for (const needle of [
    'const WRITE_METHODS = new Set([',
    'function withRepoLock(key, work) {',
    "const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk'])",
    "refusing to delete the checked-out branch",
    "'deleting \"' + name + '\" requires confirm: true'",
    'function pushUndo(root, entry) {',
    'async function operationOf(root) {',
  ]) {
    assert.ok(host.includes(needle), 'missing safety guard: ' + needle)
  }
  // '.' would wipe every untracked file at once; the panel only ever discards
  // explicit paths, so the root is filtered out before git sees it.
  assert.ok(host.includes("entry !== '.' && entry !== './'"), 'discard must not accept the repository root')
})

test('client half offers an undo toast and a safe confirm', () => {
  for (const needle of [
    'const toastCenter = {',
    "actionLabel: t('toast.undo'),",
    "request('undoApply'",
    'function isProtectedBranch(name) {',
    'requireText: guarded ? dialog.name : undefined,',
  ]) {
    assert.ok(client.includes(needle), 'missing client guard: ' + needle)
  }
  // Destructive dialogs must not open with focus on the red button.
  assert.match(client, /cancelRef\.current\.focus\(\)/, 'confirm dialog must focus cancel')
  // The composer's local delete answers in the frame toast stack and keeps its
  // undo handle; undoing it reloads the branch list the popover shows.
  assert.match(client, /const csDeleteLocal = async/)
  assert.match(client, /const csUndoDelete = async/)
  assert.match(client, /undoId: data\.undo\.id, actionLabel: t\('toast\.undo'\)/)
  assert.match(client, /await loadBranches\(\)/, 'undo reloads the session branch list')
  // A frame-level confirm lives outside every panel root, so it must carry the
  // token scope itself; without it the card had no surface and went transparent.
  assert.match(client, /'\.git4idea-overlay',/, 'the overlay defines the skin tokens')
})

test('a discard is reversible through the same undo stack', () => {
  // Overwriting the working tree is a destructive action like any other: the
  // host snapshots the bytes first, and says so honestly when it cannot.
  for (const needle of [
    'function snapshotForUndo(root, paths) {',
    'function snapshotState(root, files) {',
    "kind: 'discard'",
    'undoBlocked: true',
    'UNDO_MAX_SNAPSHOT_BYTES',
  ]) {
    assert.ok(host.includes(needle), 'missing host guard: ' + needle)
  }
  for (const needle of [
    "t('toast.discarded')",
    'data.undoBlocked === true',
    "'undo.discard'",
    'void discardChanges(item, group)',
  ]) {
    assert.ok(client.includes(needle), 'missing client guard: ' + needle)
  }
})

test('every page gesture answers in the one notification stack (m05310)', () => {
  // One stack for outcomes: a success helper, a failure helper, and a single
  // verb -> text table both the panel and the commit card read.
  for (const needle of [
    'function notifyOk(text) {',
    'function notifyFail(caught) {',
    'function successToastText(t, method, payload) {',
  ]) {
    assert.ok(client.includes(needle), 'missing outcome helper: ' + needle)
  }
  // Every write route the panel can run has a success line; a read route
  // (compare) returns '' and stays quiet.
  const routes = ['stage', 'unstage', 'checkout', 'branchRename', 'branch-upstream', 'branchDelete',
    'branchDeleteRemote', 'commit', 'tagCreate', 'tagDelete', 'tagDeleteRemote', 'pushTags', 'push',
    'pull', 'fetch', 'merge', 'rebase', 'rebaseAbort', 'cherryPick', 'revert', 'reset', 'discard',
    'stashPush', 'stashApply', 'stashClear', 'remoteAdd', 'remoteRemove', 'clone']
  for (const method of routes) {
    assert.ok(client.includes("if (method === '" + method + "')"), 'no success line for the route: ' + method)
  }
  assert.match(client, /if \(options === undefined \|\| options\.quiet !== true\) notifyOk\(runSuccessText\(method, payload\)\)/,
    'the panel reports the successful half of a run')
  // Call sites that raise a richer toast of their own opt out instead of stacking two.
  assert.equal((client.match(/\}, \{ quiet: true \}\)/g) || []).length, 5, 'the five richer-toast call sites opt out')
  // A failed settings write used to vanish; the toggle itself carries success.
  assert.ok(/config-set[\s\S]{0,160}notifyFail\(caught\)/.test(client), 'a failed config-set reports')
  assert.ok(!/config-set[\s\S]{0,160}catch\(\(\) => undefined\)/.test(client), 'and no longer swallows')
  // The commit card and the composer prompt report both halves too.
  assert.ok(/notifyOk\(successToastText\(t, method, payload\)\)/.test(client), 'the commit card reports staging and discarding')
  assert.match(client, /notifyFail\(caught\)\n        \}\)/, 'the composer prompt reports a failed submit')
})

test('the dock actions exist only where the right sidebar can perform them', () => {
  // The official right sidebar is read at RENDER time: ctx.get('sidebarRight')
  // returns undefined while ui-sidebar-right has not mounted yet (measured on
  // 0.1.7-rc.2), and an old host has none at all. Missing service = no buttons,
  // no error.
  const start = client.indexOf('/* ---- dock action core')
  const end = client.indexOf('/* ---- end dock action core')
  assert.ok(start >= 0 && end > start, 'the dock action core must keep its markers')
  const core = new Function(client.slice(start, end)
    + '\nreturn { dockFaceOf: dockFaceOf, dockActionState: dockActionState }')()

  const service = { float: () => {}, dock: () => {}, split: () => {}, toggleFullscreen: () => {} }
  assert.equal(core.dockFaceOf(null), null, 'no ctx means no dock actions')
  assert.equal(core.dockFaceOf({ get: () => undefined }), null, 'a host without sidebarRight degrades silently')
  assert.equal(core.dockFaceOf({ get: () => { throw new Error('late service') } }), null, 'a throwing ctx.get must not escape')
  assert.equal(core.dockFaceOf({ get: () => ({ float: () => {} }) }), null, 'half a service is not a service')
  assert.equal(core.dockFaceOf({ get: () => service }), service)

  const off = core.dockActionState(null, null)
  assert.deepEqual([off.wired, off.float, off.split, off.fullscreen], [false, false, false, false],
    'an unwired panel offers none of the dock actions')
  const docked = core.dockActionState({ service: service, tabId: 'tab3', paneId: 'pane1' }, null)
  assert.deepEqual([docked.wired, docked.float, docked.split, docked.fullscreen, docked.floating], [true, true, true, true, false])
  const floating = core.dockActionState({ service: service, tabId: 'tab3', paneId: 'float4' }, 'float4')
  assert.deepEqual([floating.float, floating.split, floating.floating], [true, false, true],
    'a floating panel can be docked back, but not split again')
  assert.equal(core.dockActionState({ service: service, tabId: '' }, null).wired, false, 'a tab without an id is not floatable')
})

test('the tree toggle is reachable again after it was folded', () => {
  // treeOpen is persisted, so a header button that only rendered while the tree
  // was OPEN left a folded tree with no way back (a workspace could only be
  // repaired by clearing localStorage). The header button is two-way now, and the
  // rail carries the action for the chromes that have no header button.
  const bar = client.slice(client.indexOf("className: 'git4idea-compact-bar'"), client.indexOf("className: 'git4idea-compact-bar'") + 1400)
  assert.match(bar, /'data-action': 'tree'/, 'the compact header keeps a tree control')
  assert.match(bar, /onClick: \(\) => foldTree\(!treeOpen\)/, 'and it toggles BOTH ways')
  assert.match(bar, /'aria-pressed': treeOpen \? 'true' : 'false'/)
  // The toggle is a chevron pair (m01216 #3): ">" while folded, "<" while open,
  // never a branch glyph.
  assert.match(bar, /E\(Icon, \{ name: treeOpen \? 'chevronLeft' : 'chevronRight' \}\)/, 'the icon distinguishes the two states')
  assert.doesNotMatch(client, /treeOpen \? E\('button'/, 'no chrome may render its tree control only while the tree is open')

  const specs = client.slice(client.indexOf('const RAIL_SPECS = ['), client.indexOf('const RAIL_IDS ='))
  // m01216 #5: exactly these seven, in this order — branch-tree work only.
  // v0.3.1 appends the remote refresh and the two fold verbs (#3, #10).
  const ids = [...specs.matchAll(/\{ id: '([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(ids, ['tree', 'newBranch', 'pull', 'delete', 'compare', 'fetch', 'favorite', 'refresh', 'expandAll', 'collapseAll'],
    'the rail carries the seven branch-tree actions, in order, then the v0.3.1 verbs')
  assert.match(client, /const RAIL_VIEW_IDS = \['tree', 'expandAll', 'collapseAll'\]/, 'only the view-arranging rail verbs stay clickable while git runs')
  assert.match(client, /'aria-disabled': action\.disabled === true \? 'true' : 'false'/,
    'a disabled action stays hoverable so its tooltip explains why (m01216 #7)')
  assert.match(client, /className: 'git4idea-rail-sep'/, 'the hairline sits under the tree toggle')
})

test('the dock actions are wired on the native seat only', () => {
  // Only the native right-sidebar seat owns a sidebarRight tab id; the
  // conversation-area seat has none, and floating a foreign tab id is not a
  // thing.
  assert.match(client, /readDockInfo\(props\.useTabInfo, props\.ctx\)/, 'the native seat reads its own tab identity')
  assert.match(client, /E\(NativePanel, Object\.assign\(\{\}, tabProps/, 'the native seat hands the tab props straight to the panel')
  const conversationSeat = client.slice(client.indexOf("className: 'git4idea-conversation-seat'"), client.indexOf("className: 'git4idea-conversation-seat'") + 600)
  assert.doesNotMatch(conversationSeat, /dock:/, 'the conversation-area seat must not wire dock actions')
  assert.match(client, /try \{ info = useTabInfo\(\) \} catch \(error\) \{ void error \}/,
    'the slot reader throws until the tab is committed; a missing answer is a missing button')
  assert.match(client, /node\.closest\('\[data-dockkit-float\]'\)/, 'the float state comes from the float layer marker')
})

test('the shipped dictionaries come from locale/*.json (m04501)', () => {
  // m04501 pulled both dictionaries out of client.js into locale/{zh,en}.json and
  // put ONE tool in charge: src/utils/i18n.js reads the JSON and rewrites the two
  // embedded blocks. The bundle cannot require a JSON file at runtime (see
  // @deepseek-ai/dsh-client-modules: a client bundle resolves only frozen
  // platform modules), so the copy is generated — never hand-edited. Equality is
  // the point: a key that drifted would fall back to English mid-panel.
  const zh = JSON.parse(read('locale/zh.json'))
  const en = JSON.parse(read('locale/en.json'))
  const zhKeys = Object.keys(zh.messages).sort()
  assert.deepEqual(Object.keys(en.messages).sort(), zhKeys, 'en and zh must carry the same key set')
  assert.ok(zhKeys.length >= 140, 'the zh dictionary looks truncated: ' + zhKeys.length)
  for (const [tag, data] of [['zh', zh], ['en', en]]) {
    assert.equal(typeof data.meta, 'object', tag + ' needs a meta block for the Plugins page')
    assert.ok(typeof data.meta.title === 'string' && data.meta.title !== '', tag + '.meta.title must be set')
    assert.ok(typeof data.meta.description === 'string' && data.meta.description !== '', tag + '.meta.description must be set')
    assert.match(client, new RegExp('i18n:generated:' + tag), 'the embedded ' + tag + ' block is marked generated')
    assert.match(client, new RegExp('/i18n:generated:' + tag), 'the embedded ' + tag + ' block is closed')
  }
  // One copy of each dictionary lives in the bundle, and no third language does.
  assert.match(client, /\n    const ZH = \{\n/)
  assert.match(client, /\n    const EN = \{\n/)
  assert.doesNotMatch(client, /\/\* locale: [a-z-]+ \*\//, 'the per-language inline dictionaries are gone')
  assert.match(client, /tag\.split\('-'\)\[0\] === 'zh' \? ZH : EN/, 'only zh resolves to zh; every other tag falls back to en')
  assert.match(client, /localeService\.register\(LOCALE_NS, \{ zh: ZH, en: EN \}\)/, 'both dictionaries publish under the plugin namespace')
  const tool = read('src/utils/i18n.js')
  assert.match(tool, /export function sync\(/, 'the extractor owns the embedded blocks')
  assert.match(tool, /export function translate\(messages, key, params\)/, 'one translator resolves {name} placeholders')
  assert.match(tool, /export const SUPPORTED_LOCALES = \['en', 'zh'\]/, 'the shipped language list lives in one place')
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.scripts['i18n'], 'node src/utils/i18n.js sync')
  assert.equal(pkg.scripts['i18n:check'], 'node src/utils/i18n.js check')
  assert.ok(pkg.files.includes('src'), 'the extractor ships with the bundle (src is the code root)')
})

test('the client half is fragments plus one generated bundle (m05309)', () => {
  // m05309 split the 10k-line src/client.js into ordered fragments so the client
  // code reads by concern. The DSH client loader gives a plugin ONE module factory
  // that resolves only frozen platform modules — fragments cannot import each
  // other — so src/client.js stays the loaded file and the builder concatenates
  // the fragments byte-for-byte. Equality keeps "edited a fragment" and "edited
  // the bundle" from drifting apart.
  const order = [
    'head.js', 'locale.js', 'ui/icons.js', 'core.js', 'diff.js', 'tree.js', 'changes.js',
    'workbench.js', 'account.js', 'panel.js', 'styles.js', 'composer.js', 'dialogs.js', 'preview.js', 'conflict.js',
    'ui/theme.js', 'ui/components.js', 'app.js',
  ]
  const names = []
  const walk = (rel) => {
    for (const entry of readdirSync(join(root, 'src', 'client', rel), { withFileTypes: true })) {
      const next = rel === '' ? entry.name : rel + '/' + entry.name
      if (entry.isDirectory()) walk(next)
      else if (entry.name.endsWith('.js')) names.push(next)
    }
  }
  walk('')
  names.sort()
  assert.deepEqual(names, order.slice().sort(), 'every fragment is listed exactly once')
  const joined = order.map((name) => read('src/client/' + name)).join('')
  assert.equal(joined, client, 'src/client.js must equal the concatenated fragments')
  // Concatenation is a byte copy, not a parse: a stray parenthesis in one
  // fragment would still make the generated bundle fail to load in the Web GUI.
  assert.doesNotThrow(() => new Function(client), 'the generated bundle must parse')
  assert.match(client, /window\.__ModuleLoader__\.load\(\{/, 'the bundle keeps ONE module wrapper')
  assert.equal((joined.match(/window\.__ModuleLoader__\.load\(\{/g) || []).length, 1, 'the wrapper lives in exactly one fragment')
  const tool = read('src/utils/build-client.js')
  assert.match(tool, /export function buildClient\(/, 'one builder owns the bundle')
  // The order lives in FRAGMENT_ORDER, not in the file names, so the list here
  // must match it — a divergence would silently reorder the bundle.
  assert.match(tool, /export const FRAGMENT_ORDER = \[\s*'head\.js'[\s\S]*?'app\.js',\s*\]/, 'the builder pins the fragment order')
  assert.match(tool, /export const FRAGMENT_DIR = join\(ROOT, 'src', 'client'\)/)
  assert.equal(pkg.scripts['build:client'], 'node src/utils/build-client.js')
  assert.equal(pkg.scripts['build:check'], 'node src/utils/build-client.js --check')
  const i18n = read('src/utils/i18n.js')
  assert.match(i18n, /const LOCALE_FRAGMENT = join\(ROOT, 'src', 'client', 'locale\.js'\)/, 'sync writes the locale fragment')
  assert.match(i18n, /buildClient\(\)/, 'sync rebuilds the bundle, so the host never loads a stale copy')
})

test('the conflict card keeps three level columns and drops the marker lines (m01041)', () => {
  // The card used to paint git's <<<<<<< / ======= / >>>>>>> lines as rows, so
  // the columns drifted apart and the user read raw marker text. The three
  // columns now come from one merge model, and changed regions carry a tint
  // instead of a marker line.
  const conflict = read('src/client/conflict.js')
  assert.match(conflict, /function conflictResultBlockLines\(block, index, auto, decisions\)/, 'one row model drives the result column')
  assert.match(conflict, /decision\.ours === 'adopt'/, 'the left block button keeps the left text')
  assert.match(conflict, /decision\.theirs === 'adopt'/, 'the right block button keeps the right text')
  assert.ok(
    conflict.indexOf("decision.ours === 'adopt'") < conflict.indexOf("decision.theirs === 'adopt'"),
    'adopting both sides appends the right text after the left text',
  )
  assert.match(conflict, /function conflictSideRows\(model, side\)/, 'each side pane reads its own file')
  assert.doesNotMatch(conflict, /CONFLICT_(OURS|BASE|MID|THEIRS)_MARK/, 'the card must not render git marker lines')
  // One decision hides both of that side's buttons: the block never wears a
  // button it can no longer use.
  assert.match(conflict, /decision\[side\] !== undefined\) return null/, 'a decided side drops its buttons')
  assert.match(conflict, /conflict\.allApplied/, 'settling every block raises the done toast')
  // The result column is an editor from the start; the old "Edit Text" toggle
  // and its mode are gone.
  assert.match(conflict, /className: 'git4idea-conflict-result'/, 'the result column is a textarea')
  assert.doesNotMatch(conflict, /conflict\.editText|mode === 'text'/, 'no separate text mode is left')
  assert.match(conflict, /const syncScroll = \(source\)/, 'the three panes scroll together')
  assert.match(conflict, /event\.metaKey !== true/, 'the undo shortcut also takes Cmd on macOS')
  // The result column owns the undo stack: a block choice is not a native typing
  // edit, so the browser's own undo cannot replay it. Inside the result textarea
  // the card keeps its shortcuts instead of returning early.
  assert.match(conflict, /const inResult = midRef\.current !== null && event\.target === midRef\.current/, 'the result textarea keeps the card undo')
  assert.match(conflict, /inResult !== true \|\| event\.key === 'Escape'\) return/, 'only the non-result fields opt out of the shortcuts')
  // The result column carries its own line numbers, which follow the shared
  // scroll offset of the textarea.
  assert.match(conflict, /midGutterRef/, 'the result column has a gutter')
  assert.match(conflict, /const gutterRow = \(index\) =>/, 'the gutter numbers the result lines')
  assert.match(conflict, /const syncGutter = \(\) =>/, 'the gutter follows the result scroll')
  // A right click on a line number opens the annotate menu, and the menu blames
  // the column it was opened on.
  assert.match(conflict, /onContextMenu: \(event\) => \{ openMenu\(event, 'ours'\) \}/, 'the left gutter takes the menu')
  assert.match(conflict, /onContextMenu: \(event\) => \{ openMenu\(event, 'theirs'\) \}/, 'the right gutter takes the menu')
  assert.match(conflict, /request\('conflictBlame'/, 'the menu asks the host for the blame')
  assert.match(conflict, /conflict\.annotateHide/, 'an annotated column offers to hide its annotations')
  assert.match(conflict, /git4idea-conflict-blame/, 'the annotations ride a dedicated span')
  // A write that stops on conflicts opens the overview by itself.
  assert.match(client, /result\.conflicted === true\) openConflictOverview\(\)/, 'a conflicted write opens the overview')
  assert.match(read('src/client/styles.js'), /\.git4idea-conflict-row\.is-ours\{background/, 'changed regions carry a tint')
})

test('blame reads as an IDEA annotation: short name, hover detail, mail in the detail head (m01756)', () => {
  // The annotated line shows the short name; the full author, its mail, the
  // commit and the time of day live in the hover detail.
  const core = read('src/client/core.js')
  assert.match(core, /function shortAuthorName\(name\)/, 'one helper shortens an author name')
  assert.match(core, /return at > 0 \? name\.slice\(0, at\) : name/, 'the short name is the part before @')

  const conflict = read('src/client/conflict.js')
  assert.match(conflict, /const blameTip = \(line\) =>/, 'the hover detail is built in one place')
  assert.match(conflict, /conflict\.blameCommit/, 'the detail names the commit')
  assert.match(conflict, /conflict\.blameAuthor/, 'the detail names the author')
  assert.match(conflict, /conflict\.blameDate/, 'the detail names the date')
  // Both the side columns and the result gutter annotate through the helper.
  assert.equal((conflict.match(/'data-tip': blameTip\(line\)/g) || []).length, 2, 'both annotation cells carry the detail')
  assert.equal((conflict.match(/shortAuthorName\(line\.author\)/g) || []).length, 2, 'both annotation cells carry the short name')

  // The commit detail head shows "name <mail>"; a host without a mail keeps the
  // bare name.
  const changes = read('src/client/changes.js')
  assert.match(changes, /detail\.author \+ ' <' \+ detail\.email \+ '>'/, 'the detail head adds the mail')
  assert.equal((changes.match(/const authorText = /g) || []).length, 1, 'one head text serves both detail layouts')
  assert.equal((changes.match(/'data-tip': authorText/g) || []).length, 2, 'both detail heads show and hover the same text')
})

test('hovering the commit list no longer dims the branch lines (m01785)', () => {
  // The lane trace used to fade every other lane under the pointer. That read
  // as a flicker, so the hover lane plumbing is gone end to end: the row does
  // not mark a lane, the list does not publish one, the stylesheet no longer
  // generates the dimming rules and the graph cells do not tag their shapes.
  assert.doesNotMatch(read('src/client/changes.js'), /data-hover-lane|data-lane/, 'the list and the rows keep no hover lane')
  assert.doesNotMatch(read('src/client/core.js'), /data-lane/, 'the graph cells no longer tag a lane')
  const styles = read('src/client/styles.js')
  assert.doesNotMatch(styles, /hover-lane|data-lane/, 'the dimming rules are gone')
})

test('the repo ships one README and no upstream bookkeeping', () => {
  // This fork keeps the code, not the upstream paperwork: CHANGELOG.md,
  // README_EN.md, docs/, scripts/, screenshots.json and .github/ were removed
  // on purpose. A stale copy landing back here would drag the old release
  // machinery (and its fixed ids) along, so the absence is asserted. AGENTS.md
  // is NOT on the list: it is the repository owner's own brief, not upstream.
  assert.ok(exists('README.md'), 'the one README must stay')
  for (const gone of ['CHANGELOG.md', 'README_EN.md', 'docs', 'scripts', 'screenshots.json', '.github']) {
    assert.ok(!exists(gone), gone + ' must not come back')
  }
})

test('markdown stays well-formed: fences paired, files newline-terminated', () => {
  // 2026-09-14: README 的 8 个代码围栏被写成「反引号 + @」,GitHub 上「安装」整段错乱。
  // README 是别人看到的第一屏,在这之前没有任何测试看着它。
  const fence = '`'.repeat(3)
  for (const name of ['README.md']) {
    const lines = read(name).split('\n')
    assert.ok(!lines.some((line) => line.startsWith('`@')), name + ' has a half-typed fence')
    assert.ok(read(name).endsWith('\n'), name + ' must end with a newline')
    const fences = lines.filter((line) => line.startsWith(fence))
    assert.equal(fences.length % 2, 0, name + ' has an unpaired code fence')
    for (const line of fences) {
      assert.match(line, /^`{3,4}[a-zA-Z0-9]*$/, name + ' has a malformed fence: ' + line)
    }
  }
})
test('client half exposes t(key), never the raw dictionary object', () => {
  assert.match(client, /const t = translatorOf\(ctx\)/, 't must be a live lookup function')
  assert.match(client, /function translatorOf\(ctx\) \{/, 'the live lookup itself must exist')
  assert.match(client, /function dictionaryFor\(active\)/, 'locale tags must resolve through dictionaryFor')
  assert.match(client, /locale\.subscribe\(/, 'the panel must repaint on a live language switch')
  assert.doesNotMatch(client, /const t = dictionaryOf\(/, 't must not be the dictionary itself')
  assert.doesNotMatch(client, /const dict = dictionaryOf\(ctx\)/, 'the dictionary must not be captured once at activation')

  const block = (name) => {
    const start = client.indexOf('const ' + name + ' = {')
    assert.ok(start >= 0, name + ' dictionary missing')
    let depth = 0
    for (let index = client.indexOf('{', start); index < client.length; index += 1) {
      if (client[index] === '{') depth += 1
      else if (client[index] === '}') {
        depth -= 1
        if (depth === 0) return client.slice(start, index + 1)
      }
    }
    throw new Error('unterminated ' + name)
  }

  const keys = new Set()
  for (const match of client.matchAll(/\bt\('([^']+)'\)/g)) keys.add(match[1])
  assert.ok(keys.size >= 30, 'expected many looked-up keys, saw ' + keys.size)
  for (const name of ['ZH', 'EN']) {
    const text = block(name)
    for (const key of keys) {
      assert.ok(text.includes("'" + key + "':"), name + ' is missing the key ' + key)
    }
  }
})

/* ---------------------------------------------------------------------------
 * Draggable panes (issue #5).
 *
 * The sizing core sits between two markers as a PURE block (no window, no DOM,
 * no React), so these tests slice it out and drive the real implementation —
 * a re-implemented clamp in the test would only ever agree with itself.
 * ------------------------------------------------------------------------- */

function paneCore() {
  const start = client.indexOf('/* ---- pane sizing core')
  const end = client.indexOf('/* ---- end pane sizing core')
  assert.ok(start >= 0 && end > start, 'the pane sizing core must keep its markers')
  const exported = 'return { PANES_KEY: PANES_KEY, PANE_LIMITS: PANE_LIMITS, PANE_DEFAULTS: PANE_DEFAULTS,'
    + ' PANE_CHROME_KEYS: PANE_CHROME_KEYS, PANE_BUCKETS: PANE_BUCKETS, PANE_GUTTER_PX: PANE_GUTTER_PX,'
    + ' PANE_MAIN_FLOOR_PX: PANE_MAIN_FLOOR_PX,'
    + ' panBucket: panBucket, normalizePanes: normalizePanes, withPaneRatio: withPaneRatio, paneGeometry: paneGeometry }'
  return new Function(client.slice(start, end) + '\n' + exported)()
}

test('pane sizes are stored per surface under one versioned key', () => {
  assert.match(client, /const PANES_KEY = 'dsh-git4idea\.panes\.v1'/)
  assert.match(client, /readStored\(PANES_KEY\)/, 'reads must go through the versioned key')
  assert.match(client, /writeStored\(PANES_KEY, JSON\.stringify\(normalizePanes\(config\)\)\)/,
    'writes must be normalised too')

  const core = paneCore()
  // Six buckets: the bottom workbench and the right sidebar must never share a
  // remembered size, even when they run the same chrome.
  assert.deepEqual(core.PANE_BUCKETS, [
    'columns:wide', 'columns:tall', 'stack:wide', 'stack:tall', 'compact:wide', 'compact:tall',
  ])
  assert.equal(core.panBucket('stack', { width: 500, height: 900 }), 'stack:tall')
  assert.equal(core.panBucket('stack', { width: 900, height: 500 }), 'stack:wide')
  assert.equal(core.panBucket('compact', { width: 300, height: 300 }), 'compact:wide', 'a square panel is not tall')
})

test('normalizePanes drops unknown buckets, unknown keys and out-of-range ratios', () => {
  const core = paneCore()
  assert.deepEqual(core.normalizePanes(null), { treeOpen: true, panes: {} }, 'the tree stays open by default')
  assert.deepEqual(core.normalizePanes('nope'), { treeOpen: true, panes: {} })
  assert.deepEqual(core.normalizePanes({ panes: 7 }), { treeOpen: true, panes: {} })

  const clean = core.normalizePanes({
    treeOpen: false,
    panes: {
      'stack:tall': { tree: 0.3, changes: 'wide', diff: 0, ghost: 0.5 },
      'stack:wide': { tree: 1.2, changes: -0.1, diff: Number.NaN },
      'stack:tallish': { tree: 0.5 },
      bogus: { tree: 0.5 },
    },
  })
  assert.equal(clean.treeOpen, false, 'a folded tree is remembered')
  assert.deepEqual(clean.panes, { 'stack:tall': { tree: 0.3 } },
    'only finite ratios in (0, 1] on known keys survive')

  const one = core.withPaneRatio(clean, 'stack:tall', 'diff', 0.44)
  assert.deepEqual(one.panes['stack:tall'], { tree: 0.3, diff: 0.44 })
  assert.equal(one.treeOpen, false, 'the tree state rides along with the sizes')
  assert.deepEqual(core.withPaneRatio(one, 'stack:tall', 'diff', null).panes['stack:tall'], { tree: 0.3 },
    'a double-click reset removes the override')
  const emptied = core.withPaneRatio(core.withPaneRatio(one, 'stack:tall', 'tree', null), 'stack:tall', 'diff', null)
  assert.equal(emptied.panes['stack:tall'], undefined, 'an emptied bucket is not stored at all')
  assert.deepEqual(clean.panes['stack:tall'], { tree: 0.3 }, 'the update must not mutate its input')
})

test('the pane clamps hold at both ends and never shrink a pane below its own box', () => {
  const core = paneCore()
  const tall = { width: 500, height: 900 }

  // Nothing stored → no inline override at all: the stylesheet defaults render
  // untouched (proportional 1:2:2 columns since m02407 #2, the stacked ratios
  // otherwise).
  const fresh = core.paneGeometry('stack', tall, core.normalizePanes(null))
  assert.deepEqual(fresh.overrides, {})
  assert.equal(fresh.bucket, 'stack:tall')

  // Stored ratios become px, and every one of them obeys its own limits. With
  // 0.9 asked for all three, the two stacked panes stop exactly where the middle
  // pane's hard floor begins: 900 - 16 (gutters) - 120 = 764 for tree + changes.
  const stored = core.normalizePanes({ panes: { 'stack:tall': { tree: 0.9, changes: 0.9, diff: 0.9 } } })
  const geo = core.paneGeometry('stack', tall, stored)
  assert.equal(geo.overrides.changes, 440, 'the changes pane stops where the middle pane begins')
  assert.equal(geo.overrides.tree, 324, 'the tree gives way to the pane it shares the column with')
  assert.equal(geo.overrides.diff, 120, 'the diff can never eat the history list')
  assert.equal(geo.limits.diff.max, 120)
  assert.equal(tall.height - geo.overrides.tree - geo.overrides.changes - 2 * core.PANE_GUTTER_PX, core.PANE_MAIN_FLOOR_PX,
    'the middle pane keeps exactly its hard floor when both stacked panes are maxed')

  // Tiny stored ratios clamp UP to the minimums, never to 0.
  const tiny = core.paneGeometry('stack', tall, core.normalizePanes({ panes: { 'stack:tall': { tree: 0.001, changes: 0.001 } } }))
  assert.equal(tiny.overrides.tree, core.PANE_LIMITS['stack:tree'].min)
  assert.equal(tiny.overrides.changes, core.PANE_LIMITS['stack:changes'].min)

  // A huge container keeps the proportional 1:2:2 defaults (m02407 #2), and the
  // ceiling follows the box a pane already occupies — the same "never shrink an
  // untouched pane" rule as the 674px case below, so 1/5 and 2/5 of 3000 are
  // what the stored 1:1 ratios clamp to.
  const roomy = core.paneGeometry('columns', { width: 3000, height: 400 },
    core.normalizePanes({ panes: { 'columns:wide': { tree: 1, changes: 1 } } }))
  assert.equal(roomy.overrides.tree, Math.round(core.PANE_DEFAULTS['columns:tree'].ratio * 3000))
  assert.equal(roomy.overrides.changes, Math.round(core.PANE_DEFAULTS['columns:changes'].ratio * 3000))
  // ...and a container that cannot hold every default at once hands out what is
  // left, still leaving the middle pane at least its floor — no overflow.
  const fit = core.paneGeometry('columns', { width: 700, height: 400 },
    core.normalizePanes({ panes: { 'columns:wide': { tree: 1, changes: 1 } } }))
  assert.ok(700 - fit.overrides.tree - fit.overrides.changes - 2 * core.PANE_GUTTER_PX >= core.PANE_MAIN_FLOOR_PX,
    'the middle pane keeps at least its floor')

  // The 674px column of the reported bug (issue #5 follow-up): the measured
  // boxes (201 + 291 + 240 + gutters) cannot all hold, and the OLD ceiling (140)
  // came out below the tree's own 201. The ceiling now never goes below the box a
  // pane already occupies, so the first drag to the right can only GROW it.
  const boxes = { tree: 201, changes: 291 }
  const pinned = core.paneGeometry('columns', { width: 674, height: 482 }, core.normalizePanes(null), boxes)
  assert.equal(pinned.bucket, 'columns:wide')
  assert.ok(pinned.limits.tree.max > boxes.tree, 'the tree keeps room to grow (max ' + pinned.limits.tree.max + ' vs ' + boxes.tree + ')')
  assert.ok(pinned.limits.tree.max - boxes.tree >= 20, 'and it is a usable step, not a token pixel')
  assert.ok(pinned.limits.tree.max >= Math.round(core.PANE_DEFAULTS['columns:tree'].ratio * 674),
    'the ceiling is never below the pane\'s proportional default')
  assert.ok(pinned.limits.tree.now === undefined || pinned.limits.tree.now <= pinned.limits.tree.max)
  assert.equal(674 - 2 * core.PANE_GUTTER_PX - pinned.limits.tree.max - boxes.changes, core.PANE_MAIN_FLOOR_PX,
    'the relaxed tier still keeps the middle pane its floor')

  // A folded tree frees its room instead of reserving it, and has no override.
  const folded = core.paneGeometry('stack', tall, core.normalizePanes({ treeOpen: false, panes: { 'stack:tall': { changes: 1 } } }))
  assert.equal(folded.overrides.tree, undefined)
  assert.equal(folded.overrides.changes, core.PANE_LIMITS['stack:changes'].max)
})

test('the pane dividers are draggable, touch-safe and keyboard reachable', () => {
  const gutter = cssRule('.git4idea-gutter')
  assert.match(gutter, /touch-action:none/, 'a touch drag must resize the pane, not scroll the panel')
  assert.match(cssRule('.git4idea-gutter-v'), /width:8px/, 'the hit area is wider than the hairline it paints')
  assert.match(cssRule('.git4idea-gutter-h'), /height:8px/)
  assert.match(cssRule('.git4idea-gutter::after'), /var\(--dsw-alias-hairline,/, 'the hairline keeps the theme token')
  assert.match(client, /setPointerCapture/, 'the drag must survive leaving the hit area')
  assert.match(client, /\.git4idea-pane-dragging,\.git4idea-pane-dragging \*\{user-select:none\}/, 'no text selection while dragging')
  assert.match(client, /onLostPointerCapture/, 'a dropped capture must still finish the gesture')
  // Double-click resets and the arrow keys nudge (Shift = 4x).
  assert.match(client, /onDoubleClick: \(\) => props\.onReset\(\)/)
  assert.match(client, /const step = event\.shiftKey === true \? 32 : 8/)
  assert.match(client, /role: 'separator'/)
})

test('a divider only exists when it can move something', () => {
  // v0.8.0 shipped the history↔diff divider as a dead control: it wrote storage
  // and moved its own aria while the diff pane never got the inline size (the
  // render ignored it). That part stays locked below. The second half used to
  // lock the OPPOSITE of today's behaviour: the columns chrome's key set had no
  // diff pane, so its diff window (fixed max-height:55%) could not be resized
  // at all — user report. Every chrome now hands out a real diff window; the
  // diff keeps measuring HEIGHT even where the chrome runs sideways.
  assert.match(client, /className: 'git4idea-diff-pane', 'data-pane': 'diff', style: paneStyle\('diff'\)/,
    'the diff pane must actually consume the stored size')
  assert.match(client, /if \(limit === undefined \|\| limit\.max <= limit\.min\) return null/,
    'no pane in this chrome, or no travel in either direction, means no divider element')
  assert.match(client, /value: Math\.min\(Math\.max\(Math\.round\(paneLayout\.effective\[key\]/, 'aria-valuenow is clamped into the window it announces')
  const core = paneCore()
  assert.deepEqual(core.PANE_CHROME_KEYS.columns, ['tree', 'changes', 'diff'])
  assert.ok(core.PANE_LIMITS['columns:diff'] !== undefined, 'the columns chrome has a diff window to hand out')
  const columns = core.paneGeometry('columns', { width: 700, height: 400 }, core.normalizePanes(null), { diff: 150 })
  assert.ok(columns.limits.diff !== undefined && columns.limits.diff.max > columns.limits.diff.min,
    'the columns chrome hands out a real diff window')
  const stacked = core.paneGeometry('stack', { width: 700, height: 800 }, core.normalizePanes(null), { diff: 150 })
  assert.ok(stacked.limits.diff !== undefined && stacked.limits.diff.max > stacked.limits.diff.min,
    'while the stacked chrome hands out a real diff window')

  // The columns diff divides the body HEIGHT, not the chrome's own width
  // dimension: 0.5 of a 400px-tall body lands at 200px even in a 1000px-wide
  // panel (and the history list keeps its 120px floor: ceiling 280).
  const wide = core.paneGeometry('columns', { width: 1000, height: 400 },
    core.normalizePanes({ panes: { 'columns:wide': { diff: 0.5 } } }), { diff: 150 })
  assert.equal(wide.overrides.diff, 200, 'a columns diff ratio converts against the body height')
})

test('the settings surface is code defaults only (m04492)', () => {
  // The plugin shipped a settings card (action rail / placement / AI commit)
  // backed by the host row Config, plus a one-shot localStorage migration. The
  // owner asked for none of it: every option now uses its code default, nothing
  // reads a config document, and the rail editor is gone with the gear that
  // opened it. The whole surface is pinned ABSENT so it cannot creep back.
  assert.doesNotMatch(client, /RailSettingsCard|RailSettings\b/, 'the settings card and the rail editor are gone')
  assert.doesNotMatch(client, /configForms/, 'no config-form registration is left')
  assert.doesNotMatch(client, /railFormReady|writeRailFields|writeRailField|migrateRailConfig|subscribeRailConfig/, 'no row-Config writer is left')
  assert.doesNotMatch(client, /slots\.register\(\{ name: 'plugins\.bundle\.config'/, 'the plugin page no longer mounts a settings card')
  assert.doesNotMatch(client, /data-action': 'settings'/, 'the gear is gone from the rail')
  assert.doesNotMatch(host, /railConfigSchema|export const Config/, 'the host declares no row Config')
  assert.doesNotMatch(host, /@deepseek-ai\/schemastery/, 'the host no longer resolves a schema module')
  assert.doesNotMatch(host, /ctx\.configForms/, 'the host does not reach a config service')
  // What remains is the rail's own local order, kept where it always lived.
  assert.match(client, /function readRailConfig\(\)/, 'the panel still reads its local rail order')
  assert.match(client, /function writeRailConfig\(config\)/, 'the panel still writes its local rail order')
  // The three former settings fall back to constants.
  assert.doesNotMatch(client, /readCommitSettings/, 'the AI commit settings shim is gone with the picker')
  assert.match(client, /function conversationImmersiveEnabled\(\) \{\n\s+return true/, 'the immersive default is a constant')
  assert.match(client, /function composerStatusEnabled\(\) \{\n\s+return true/, 'the composer pill default is a constant')
})

test('the ai commit message keeps the model honest and the input bounded', async () => {
  // Issue #6. Four shapes are locked here because each one has produced (or could
  // produce) a "false success" in this repository before:
  //  1. an adapter failure arrives as a terminal `finish`, NOT as a throw — so the
  //     collector must surface the finish and the caller must refuse to treat
  //     "no text" as "the model said nothing";
  //  2. the change set is bounded (per file, total, lock files, binaries) and the
  //     accounting is returned so the UI can say what the model did NOT see;
  //  3. the user's own instructions are DATA in the user message, never the system
  //     prompt, and they are capped;
  //  4. the reply is cleaned of the wrappers models habitually add.
  const aiSource = read('src/server/services/ai.js')
  const start = aiSource.indexOf('const COMMIT_MAX_PROMPT_CHARS')
  assert.ok(start >= 0, 'the ai commit block must keep its bounds')
  const block = aiSource.slice(start).replace(/^export /gm, '')
  const api = new Function(block + '\nreturn { collectCommitStream, commitInputOf, commitMessagesOf, cleanupCommitMessage, COMMIT_MAX_PROMPT_CHARS, COMMIT_TOTAL_BYTES, COMMIT_FILE_BYTES, COMMIT_FILE_LINES, COMMIT_MAX_FILES }')()

  // 1 — the finish is reported, whichever way the adapter failed.
  const ok = await api.collectCommitStream((async function* generate() {
    yield { type: 'text-delta', index: 0, text: 'feat: x' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })())
  assert.equal(ok.text, 'feat: x')
  assert.equal(ok.finish.kind, 'stop')
  const failed = await api.collectCommitStream((async function* generate() {
    yield { type: 'finish', reason: { kind: 'error', failure: { code: 'NO_CREDENTIAL', message: 'no API key' } } }
  })())
  assert.equal(failed.text, '')
  assert.equal(failed.finish.kind, 'error', 'an adapter failure must reach the caller as a finish')
  assert.equal(failed.finish.failure.message, 'no API key')
  const silent = await api.collectCommitStream((async function* generate() { yield { type: 'text-delta', index: 0, text: 'half' } })())
  assert.equal(silent.finish, null, 'a stream without a finish must be distinguishable from a successful one')
  const thought = await api.collectCommitStream((async function* generate() {
    yield { type: 'reasoning-delta', index: 0, text: 'thinking about it' }
    yield { type: 'text-delta', index: 0, text: 'feat: x' }
    yield { type: 'finish', reason: { kind: 'stop' } }
  })())
  assert.equal(thought.sawReasoning, true, 'a reasoning delta is recorded for the max-tokens diagnosis (issue #7)')
  assert.equal(thought.text, 'feat: x', 'reasoning text never lands in the message')

  // 2 — the budget: per-file lines, total bytes, lock files and binaries.
  const long = 'diff --git a/big.txt b/big.txt\n' + Array.from({ length: 200 }, (_, i) => '+line ' + i).join('\n')
  const lock = 'diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml\n+x'
  const binary = 'diff --git a/logo.png b/logo.png\n+binary'
  const bounded = api.commitInputOf(long, lock + '\n' + binary)
  assert.equal(bounded.files.length, 1, 'lock files and binaries are dropped')
  assert.equal(bounded.files[0].path, 'big.txt')
  assert.ok(bounded.files[0].body.split('\n').length <= api.COMMIT_FILE_LINES + 1, 'a file is capped by lines')
  assert.equal(bounded.dropped, 2)
  assert.equal(bounded.truncated, true)
  const many = Array.from({ length: api.COMMIT_MAX_FILES + 5 }, (_, i) => 'diff --git a/f' + i + '.txt b/f' + i + '.txt\n+x').join('\n')
  const capped = api.commitInputOf(many, '')
  assert.equal(capped.files.length, api.COMMIT_MAX_FILES, 'the file count is capped')
  assert.equal(capped.dropped, 5, 'what was left out is counted, so the UI can say so')
  /* A file the total budget drops was never sent, so it must not be reported as
     "truncated": truncated means the model saw a shortened version of it. */
  const wide = api.commitInputOf('diff --git a/a.txt b/a.txt\n+' + 'x'.repeat(api.COMMIT_FILE_BYTES * 2), '')
  assert.equal(wide.truncated, true, 'a file that IS sent is reported as truncated')
  const manyBig = Array.from({ length: Math.ceil(api.COMMIT_TOTAL_BYTES / api.COMMIT_FILE_BYTES) + 1 },
    (_, i) => 'diff --git a/f' + i + '.txt b/f' + i + '.txt\n+' + 'y'.repeat(api.COMMIT_FILE_BYTES * 2)).join('\n')
  const droppedAfterTrim = api.commitInputOf(manyBig, '')
  assert.equal(droppedAfterTrim.dropped, 1, 'the file past the total budget is dropped')
  assert.ok(droppedAfterTrim.bytes <= api.COMMIT_TOTAL_BYTES)
  assert.equal(droppedAfterTrim.truncated, true, 'the files that WERE sent were trimmed')
  assert.ok(capped.bytes <= api.COMMIT_TOTAL_BYTES)

  // 3 — the user's words steer style; they never replace the rules.
  const spoken = api.commitMessagesOf({ files: [{ path: 'a.txt', body: 'diff --git a/a.txt b/a.txt' }] }, 'Use Conventional Commits')
  assert.match(spoken.system, /commit messages/)
  assert.match(spoken.system, /ONLY/)
  assert.ok(!spoken.system.includes('Conventional Commits'), 'a user instruction must not land in the system prompt')
  assert.ok(spoken.user.includes('Use Conventional Commits'), 'the instruction is appended to the user message')
  assert.ok(spoken.user.indexOf('Use Conventional Commits') > spoken.user.indexOf('diff --git'), 'it comes after the change set')
  assert.equal(api.commitMessagesOf({ files: [] }, '   ').user.includes('Additional requirements'), false, 'a blank prompt adds nothing')

  // 4 — the wrapper a model likes to add is removed, the text itself is kept.
  assert.equal(api.cleanupCommitMessage('```\nfeat: x\n```'), 'feat: x')
  assert.equal(api.cleanupCommitMessage('"feat: y"'), 'feat: y')
  assert.equal(api.cleanupCommitMessage('feat: z\n\nbody'), 'feat: z\n\nbody')

  // 5 — the route refuses instead of reporting an empty success, and the model
  // call asks for what a commit message needs.
  assert.match(block, /if \(finish === null \|\| finish === undefined\)/, 'a stream with no finish is refused')
  assert.match(block, /finish\.kind === 'error'/, 'an error finish is a failure')
  assert.match(block, /finish\.kind !== 'stop'/, 'any non-stop finish is surfaced')
  assert.match(block, /'llm-no-finish'|llm-no-finish/, 'the no-finish failure has its own code')
  assert.match(block, /if \(commitBusy\) throw new PanelError\('busy'/, 'one generation at a time')
  assert.match(block, /commitServices === null/, 'a host without llm/sessions is refused, not hung')
  assert.match(block, /reasoningEffort/, 'the reasoning setting reaches GenerateOptions')
  assert.match(host, /ctx\.inject\(\['llm', 'sessions'\]/, 'llm is injected, never exported as a hard dependency')
  assert.doesNotMatch(host, /export const inject = \[[^\]]*'llm'/, 'a host without llm must still load the plugin')
  /* Issue #7: the hardcoded maxTokens 512 plus "an unset effort resolves to
     reasoning ON at high" died inside the reasoning phase on every model —
     with thinking enabled the output cap budgets reasoning AND message
     together, so 512 was spent before one word of the message existed. */
  assert.doesNotMatch(block, /maxTokens: [0-9]/, 'no hardcoded output cap: the selected model\'s own configured cap is used')
  assert.match(block, /quietOffEffortOf/, 'an unset effort asks for off instead of the adapter default')
  assert.match(block, /row\.id === 'off'/, 'the off id is read from the route\'s efforts table, never assumed')
  assert.match(block, /effectiveReasoning === '' \? null : effectiveReasoning/, 'the response reports the effort actually sent')
  assert.match(block, /sawReasoning === true/, 'a budget burned by reasoning is named as such')
  assert.match(block, /spent the whole output budget/, 'the max-tokens diagnosis says what to do about it')
  // m04492 removed the settings card, and its model catalog went with it: with
  // no stored model the message follows the session route.
  assert.doesNotMatch(host, /'commit-models': commitModels/, 'the settings-card catalog route went with the card')
  assert.doesNotMatch(host, /'commit-efforts': commitEfforts/, 'the settings-card efforts route went with the card')
  assert.doesNotMatch(client, /'settings\.commit\./, 'no settings-card model keys are left')
  assert.match(host, /fallbackRouteOf/, 'with no stored model the message follows the session route')
})

test('the overwrite-draft confirmation carries both button labels in every dictionary', () => {
  // DEF-1 (P2): the AI overwrite dialog shipped without okLabel/cancelLabel, so
  // both buttons rendered empty while the other seven dialogs had text.
  const start = client.indexOf('const aiConfirmDialog =')
  const end = client.indexOf('const composer = props.compact')
  assert.ok(start > 0 && end > start, 'the confirm dialog must stay where the smoke test can see it')
  const dialog = client.slice(start, end)
  assert.match(dialog, /okLabel: t\('confirm\.ok'\)/, 'the confirm button needs a label')
  assert.match(dialog, /cancelLabel: t\('confirm\.cancel'\)/, 'the cancel button needs a label')
  for (const key of ['confirm.ok', 'confirm.cancel']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 2, key + ' must exist in both shipped dictionaries (saw ' + occurrences + ')')
  }
})

test('every overlay is clamped to the panel it lives in', () => {
  // Found while making the panel draggable (issue #5): the dock can now be dragged
  // narrower than the overlays' own minimum, and a fixed min-width BEATS max-width
  // in CSS — so the context menu came out wider than the panel and hung past its
  // right edge. Invariant 13 is about the panel's box, not just its origin.
  assert.match(cssRule('.git4idea-menu'), /box-sizing:border-box/)
  assert.match(cssRule('.git4idea-menu'), /min-width:200px/, 'the menu keeps a readable floor; the panel cap lives on .git4idea-menu-wrap')
  assert.match(cssRule('.git4idea-menu-wrap'), /max-width:calc\(100% - 8px\)/, 'the panel cap moved to the wrapper')
  assert.match(cssRule('.git4idea-dialog'), /box-sizing:border-box/, 'a content-box dialog adds its padding on top of the clamp')
  assert.match(cssRule('.git4idea-dialog'), /min-width:min\(240px,100%\)/)
  assert.match(cssRule('.git4idea-dialog'), /max-width:min\(420px,94%\)/)
  assert.match(cssRule('.git4idea-dialog-wide'), /min-width:min\(360px,92%\)/)
  assert.match(cssRule('.git4idea-toasts'), /max-width:min\(380px,92%\)/)
  // m02407 #3: a toast folds to two lines, expands whole on hover (or a click),
  // and scrolls instead of growing past the viewport.
  assert.match(cssRule('.git4idea-toast-text'), /-webkit-line-clamp:2/)
  assert.match(cssRule('.git4idea-toast:hover .git4idea-toast-text,.git4idea-toast-open .git4idea-toast-text'),
    /-webkit-line-clamp:unset;max-height:min\(40vh,240px\);overflow:auto/)
  // Under the compact threshold the panel marks itself, and the nowrap labels that
  // would otherwise be clipped start wrapping inside the clamped box.
  assert.match(client, /compact \? ' git4idea-root-narrow' : ''/)
  assert.match(client, /\.git4idea-root-narrow \.git4idea-menu-item\{white-space:normal\}/)
  assert.match(client, /\.git4idea-root-narrow \.git4idea-toast-text\{white-space:normal\}/)
})

test('every pane name a divider announces exists in every dictionary', () => {  const mapped = client.match(/const PANE_NAME_KEYS = \{([^}]*)\}/)
  assert.ok(mapped !== null, 'the pane name map must stay greppable')
  const keys = [...mapped[1].matchAll(/'([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(keys, ['toolbar.tree', 'changes.title', 'pane.diff'])
  const zh = client.slice(client.indexOf('const ZH = {'), client.indexOf('const EN = {'))
  const en = client.slice(client.indexOf('const EN = {'), client.indexOf('const LOCALES = {'))
  for (const key of keys) {
    assert.ok(zh.includes("'" + key + "':"), 'ZH is missing ' + key)
    assert.ok(en.includes("'" + key + "':"), 'EN is missing ' + key)
  }
  // The template that wraps the name is looked up through t(), so the shared
  // dictionary test already covers all 21 languages for it.
  assert.match(client, /fill\(props\.t\('pane\.resize'\), \{ name: props\.t\(props\.nameKey\) \}\)/)
})

test('the conversation seat bails out of the shell keystroke cascade (v0.13.1 perf)', () => {
  // The conversation shell re-renders on EVERY composer keystroke, and the
  // view area re-renders with it. v0.13.0 dragged the whole Git panel tree
  // through a synchronous render per keypress while the Git view was active
  // (typing lag). The seat component must be memoized, and the comparator may
  // only honour the props it actually consumes — sessionId plus the two stable
  // bindings; the shell's per-render props (inspectCall, viewRequest, …) are
  // deliberately ignored so they can never re-open the cascade.
  assert.match(client, /const ConversationPanel = memo\(function ConversationPanel\(props\)/,
    'the conversation seat is wrapped in React.memo')
  assert.match(client, /\}, \(prev, next\) => prev\.sessionId === next\.sessionId && prev\.t === next\.t && prev\.ctx === next\.ctx\)/,
    'the comparator bails on identical session + bindings')
})

test('the first-paint cache seeds session switches inside one workspace (v0.13.1 perf)', () => {
  // Session-scoped seats remount per session switch; without a cache the whole
  // discovery + first-page chain re-ran and the chrome re-grew piece by piece.
  // The cache block is pure, so drive it directly: a fresh write reads back,
  // an expired entry reads as a miss, and eviction keeps the maps bounded.
  const core = client.slice(
    client.indexOf('/* ============================== first-paint cache'),
    client.indexOf('/* ============================== storage'))
  assert.ok(core.length > 300, 'the first-paint cache block must exist')
  /* The block carries its own PAINT_TTL_MS const, so only Date is injected
     (a frozen clock: every entry below reads as fresh, and the expiry branch
     is proven by the block's own Date.now() arithmetic instead). */
  const helpers = new Function('Date', core
    + '\nreturn { readPaintRepos, writePaintRepos, readPaintPage, writePaintPage, rememberPaintRoot, readPaintRoot }')(
    { now: () => 1_000 })
  helpers.writePaintRepos('/w', { repos: [], isRepo: true, cwd: '/w' })
  assert.deepEqual(helpers.readPaintRepos('/w'), { repos: [], isRepo: true, cwd: '/w' }, 'a fresh repos entry reads back')
  helpers.writePaintPage('/r', { summary: { head: 'x' }, branches: [], commits: [1], hasMore: false })
  assert.equal(helpers.readPaintPage('/r').summary.head, 'x', 'a fresh page entry reads back')
  assert.equal(helpers.readPaintPage('/missing'), undefined, 'an unknown root is a miss')
  helpers.rememberPaintRoot('/w', '/r')
  assert.equal(helpers.readPaintRoot('/w'), '/r', 'the last looked-at root survives the switch')
  // The seeding effect only fills COLD state (null summary / empty commits) and
  // never rolls live state back to the stale snapshot.
  const panel = client.slice(client.indexOf('const cachedPage = readPaintPage(repoRoot)'), client.indexOf('void refresh()'))
  assert.match(panel, /if \(summary === null && cachedPage\.summary !== undefined\) setSummary\(/, 'summary only seeds when cold and present')
  assert.match(panel, /if \(branches === null && cachedPage\.branches !== undefined\) setBranches\(/, 'branches only seed when cold and present')
  assert.match(panel, /if \(commits\.length === 0 && Array\.isArray\(cachedPage\.commits\)\) \{ setCommits\(/, 'commits only seed when cold and present')
  // The write side records exactly the FIRST page, from refresh() itself — a
  // paged fetch (skip > 0) must never poison the seed with a concatenated list.
  const refreshFn = client.slice(client.indexOf('const refresh = useCallback'), client.indexOf('], [guard, loadSummary, loadBranches, loadCommits, repoRoot])'))
  assert.match(refreshFn, /loadCommits\(0\)/, 'the cache write rides the first-page refresh')
  assert.match(refreshFn, /writePaintPage\(repoRoot,/, 'refresh writes the cache')
})

test('block separators paint on border-l2, not the hairline token (v0.13.1 style)', () => {
  // The pane/block separators used the faintest token; users could not see the
  // block structure. These eleven are the BLOCK borders; dialog innards and
  // menu separators deliberately keep the hairline.
  for (const selector of ['.git4idea-topbar', '.git4idea-rail', '.git4idea-rail-row', '.git4idea-pane-tree', '.git4idea-pane-tree-stack',
    '.git4idea-pane-changes', '.git4idea-pane-changes-stack', '.git4idea-compact-tree', '.git4idea-filters', '.git4idea-commit-box', '.git4idea-diff-pane']) {
    const rule = cssRule(selector)
    assert.match(rule, /var\(--dsw-alias-border-l2\)/, selector + ' must draw its block border on border-l2')
  }
  for (const selector of ['.git4idea-settings-list', '.git4idea-menu-sep']) {
    const rule = cssRule(selector)
    assert.doesNotMatch(rule, /border-l2/, selector + ' stays on the hairline (not a block)')
  }
})

test('the AI commit message carries the picked repository (multi-repo workspace)', () => {
  // A workspace may hold several sibling repositories, so the session cwd need
  // not be one. Every other request carries `base` ({ cwd, repoRoot }); the AI
  // message built its payload from `cwd` alone, and the host — which resolves the
  // root from `cwd` whenever `repoRoot` is missing — answered not-a-repo.
  const aiRun = client.slice(client.indexOf('const aiRun = async () =>'), client.indexOf('setAiUndo('))
  assert.ok(aiRun.length > 200, 'the AI run block must exist')
  assert.match(aiRun, /request\('commit-message', Object\.assign\(/, 'one payload builder, like every other call')
  assert.match(aiRun, /props\.base/, 'the picked repository (base) is part of that payload')
  // A prop that is never handed down reads as undefined, so the component that
  // sends the request must actually receive the repo identity.
  const pane = client.slice(client.indexOf('E(ChangesPanel, {'), client.indexOf('onCommit:'))
  assert.match(pane, /base: base,/, 'Panel hands the repo identity down to ChangesPanel')
})

test('the commit box is the IDEA layout and the language picker replaces the quota hint (m01807)', () => {
  const objectAt = (marker, name) => {
    const start = client.indexOf(marker)
    let depth = 0
    for (let index = client.indexOf('{', start); index < client.length; index += 1) {
      if (client[index] === '{') depth += 1
      else if (client[index] === '}') {
        depth -= 1
        if (depth === 0) return new Function(client.slice(start, index + 1) + '\nreturn ' + name)()
      }
    }
    throw new Error(marker + ' has no closing brace')
  }
  const dicts = { zh: objectAt('const ZH = {', 'ZH'), en: objectAt('const EN = {', 'EN') }
  // 1. The message box is a fixed third of the left column, not a growing
  //    textarea: two thirds of the column stay with the change list.
  assert.match(cssRule('.git4idea-commit-layer-left .git4idea-commit-box'), /flex:0 0 33%/, 'the message box keeps one third')
  assert.match(cssRule('.git4idea-commit-layer-left .git4idea-textarea'), /flex:1 1 auto/, 'the textarea fills that third')
  assert.match(cssRule('.git4idea-commit-layer-left .git4idea-textarea'), /overflow-y:auto/, 'a long message scrolls inside the box')
  assert.doesNotMatch(client, /messageRef/, 'the auto-grow effect is gone with the growing textarea')
  // 2. Both commit buttons sit at the left edge.
  assert.match(cssRule('.git4idea-commit-actions'), /justify-content:flex-start/, 'the commit buttons start at the left edge')
  // 3. The shortcut hint is gone from the placeholder in every dictionary.
  assert.equal(dicts.zh['changes.commitPlaceholder'], '提交信息', 'the Chinese placeholder carries no shortcut hint')
  assert.equal(dicts.en['changes.commitPlaceholder'], 'Commit message', 'the English placeholder carries no shortcut hint')
  // 4. The quota hint became a language picker: two options, default read from
  //    the display locale, and the AI call carries the choice.
  assert.doesNotMatch(client, /changes\.aiQuota/, 'the quota hint is deleted')
  assert.match(client, /function defaultCommitLanguage\(\)/, 'the default follows the display locale')
  assert.match(client, /let seenLocaleTag = 'en'/, 'the translator records the live tag')
  assert.match(client, /seenLocaleTag = tag/, 'every translate call refreshes the tag')
  assert.match(client, /E\('option', \{ value: 'zh' \}, t\('changes\.langZh'\)\)/, 'the picker offers Chinese')
  assert.match(client, /E\('option', \{ value: 'en' \}, t\('changes\.langEn'\)\)/, 'the picker offers English')
  assert.equal((client.match(/\blangSelect\b/g) || []).length, 3, 'one picker, drawn in both the compact and the full commit row')
  for (const key of ['changes.language', 'changes.langZh', 'changes.langEn']) {
    assert.ok(key in dicts.zh, key + ' exists in zh')
    assert.ok(key in dicts.en, key + ' exists in en')
  }
  // 5. The one-sided diff crash: a run of additions or deletions only left the
  //    deferred highlight empty, and both row renderers read spans.* anyway.
  assert.match(client, /const spans = props\.spans === undefined \|\| props\.spans === null \? \{\} : props\.spans/,
    'the split and unified rows default to no spans')
})

test('a diff body line that looks like a file header is replayed, not dropped', () => {
  const start = client.indexOf('function patchToHunk(patch)')
  assert.ok(start >= 0, 'patchToHunk must exist')
  const end = client.indexOf('\n    function diffLines(patch)', start)
  assert.ok(end > start, 'patchToHunk must be followed by diffLines')
  const built = new Function(client.slice(start, end) + '; return patchToHunk')()
  const patch = [
    'diff --git a/notes.md b/notes.md',
    '--- a/notes.md',
    '+++ b/notes.md',
    '@@ -1,3 +1,3 @@',
    ' keep',
    '--- removed heading',
    '+++ added heading',
    ' tail',
  ].join('\n')
  const hunk = built(patch)
  assert.equal(hunk.path, 'notes.md', 'the file header still names the file')
  assert.deepEqual(hunk.oldText.split('\n'), ['keep', '-- removed heading', 'tail'])
  assert.deepEqual(hunk.newText.split('\n'), ['keep', '++ added heading', 'tail'])
})

test('split + wrap rows share one source, and the preview carries a render boundary (issue #16)', () => {
  // The wrapped branch iterated hunkRows (per line: N dels + M adds + context)
  // but indexed into splitRows' output (paired runs: max(dels, adds) per run).
  // Any hunk where a del/add pair compresses - e.g. one deletion followed by
  // one addition - left paired[at] undefined past the run, SplitLine read
  // row.left on it, and the throw unmounted the whole preview tab (nothing
  // above the panel catches). v0.19.8: the wrapped branch iterates the SAME
  // list it indexes, chosen by split; and a class-based RenderBoundary keeps
  // a future throw to one explanatory line instead of a blank pane.
  assert.ok(client.includes('split === true && wrap !== true'), 'the split/wrap branch must exist')
  // m05306: every hunk builds one row list at the section level, chosen by
  // split, and both the unified and the split renderer consume that list.
  assert.match(client, /rows: split === true \? splitRows\(hunk\) : hunkRows\(hunk\)/,
    'a hunk derives its row list from the same switch it renders with')
  const tail = client.slice(client.indexOf('rows: split === true ? splitRows(hunk) : hunkRows(hunk)'), client.indexOf('E(UnifiedLine, { key: at, row: row'))
  assert.ok(tail.length > 0, 'the derived-sections block must sit before the unified row render')
  assert.match(tail, /rowWindow\(sections, shownRows\)\.map\(/, 'the mapped list comes from the window')
  assert.match(tail, /section\.rows\.map\(\(row, at\) => split === true/, 'each section maps its own rows')
  assert.doesNotMatch(client, /paired\[at\]/, 'no row list is indexed by a foreign index')
  // m05306: a huge diff paints a first window and grows on scroll instead of
  // blocking the main thread with the full row set.
  assert.match(client, /const LINEDIFF_CHUNK_ROWS = 200/, 'the window step is 200 rows (m01807)')
  assert.match(client, /const LINEDIFF_HIGHLIGHT_MAX = 1500/, 'very large diffs skip the colour pass')
  assert.match(client, /function rowWindow\(sections, limit\)/, 'one windowing helper feeds both views')
  assert.match(client, /onNeedMore: growRows/, 'the split columns ask for more rows')
  assert.match(client, /node\.scrollTop \+ node\.clientHeight >= node\.scrollHeight - LINEDIFF_CHUNK_ROWS \* 2/,
    'the scroll trigger grows the window near the bottom')

  // The pairing claim behind the fix, proven on the real functions: one del +
  // one add compresses to a single split row while hunkRows keeps two lines.
  // Each function is lifted on its own (module-level, four-space indent) so
  // the slice cannot drag in neighbours that need host-side globals.
  const liftFn = (name) => {
    const start = client.indexOf('function ' + name + '(hunk)')
    assert.ok(start >= 0, name + ' must exist at module level')
    const end = client.indexOf('\n    function ', start + 10)
    assert.ok(end > start, name + ' must be followed by a sibling function')
    return client.slice(start, end)
  }
  const rowsFns = liftFn('hunkRows') + '\n' + liftFn('splitRows')
  const built = new Function(rowsFns + '; return { hunkRows, splitRows }')()
  const perLine = built.hunkRows({ oldStart: 1, newStart: 1, lines: ['-a', '+b'] })
  const paired = built.splitRows({ oldStart: 1, newStart: 1, lines: ['-a', '+b'] })
  assert.equal(perLine.length, 2, 'per-line counting keeps both rows')
  assert.equal(paired.length, 1, 'pairing compresses the run - the old index-overflow trigger')
  assert.ok('left' in paired[0] && 'right' in paired[0], 'each paired row already carries { left, right } for SplitLine')

  // The boundary: module-level class, silent diagnostics, one-line fallback,
  // wrapped around exactly the preview body that renders LineDiff.
  assert.match(client, /class RenderBoundary extends React\.Component/, 'the boundary is a real error boundary (classes only)')
  const boundary = client.slice(client.indexOf('class RenderBoundary extends React.Component'), client.indexOf('function LineDiff(props)'))
  assert.match(boundary, /getDerivedStateFromError/, 'it flips to the fallback on a child throw')
  assert.match(boundary, /componentDidCatch\(error\) \{\s*try \{ console\.error/, 'diagnostics are logged and can never rethrow')
  assert.match(client, /E\(RenderBoundary, \{ message: t\('preview\.boundary'\) \}, E\(LineDiff, \{/,
    'the preview body renders LineDiff inside the boundary with a localized fallback')
  assert.match(cssRule('.git4idea-preview-boundary'), /var\(--dsw-alias-label-secondary\)/, 'the fallback line stays quiet, not alarm-red')

  // m05305: a big diff felt stuck while scrolling. The card now paints plain
  // rows first and the Shiki pass lands one task later, and the full-viewport
  // backdrop blur (a re-sample per scroll frame) is gone from the scrim.
  assert.doesNotMatch(client, /cut\.maps/, 'no hunk is highlighted inside render')
  assert.match(client, /setHighlight\(\{ cut: cut, maps: cut\.hunks\.map/, 'the highlight pass is deferred one task')
  assert.match(client, /const maps = highlight !== null && highlight\.cut === cut \? highlight\.maps : \[\]/,
    'rows read the deferred maps, and default to none')
  assert.match(client, /const set = highlights\[section\.position\]/, 'the split columns tolerate a hunk with no maps yet')
  assert.doesNotMatch(cssRule('.git4idea-commit-overlay'), /backdrop-filter/, 'the scrim does not blur the whole viewport')
})

test('the remote branch tree folds by path like the local one (v0.19.9)', () => {
  // The strip is module-level and pure: a single remote name strips its
  // "<remote>/" prefix so the tree groups feature/…, fix/… directly; mixed
  // remotes, a bare name beside prefixed ones, or an empty list keep full
  // names (grouping under one folder named after the remote is noise).
  const start = client.indexOf('function remoteTreeStripOf(')
  assert.ok(start >= 0, 'remoteTreeStripOf must exist at module level')
  const end = client.indexOf('\n    function ', start + 10)
  assert.ok(end > start, 'remoteTreeStripOf must be followed by a sibling function')
  const strip = new Function(client.slice(start, end) + '; return remoteTreeStripOf')()
  assert.equal(strip(['origin/feature/a', 'origin/feature/b', 'origin/main', 'origin/fix/c']), 'origin/')
  assert.equal(strip(['origin/a', 'upstream/b']), '', 'mixed remotes keep full names')
  assert.equal(strip(['origin/main', 'main']), '', 'a bare name beside prefixed ones keeps full names')
  assert.equal(strip([]), '')
  // Wiring: the remote section joins the grouped renderer under its own fold
  // namespace (its folder state stays independent of the local one), and the
  // visible-leaves mirror walks the SAME tree so Shift-ranges and Ctrl+A
  // follow the rendered order exactly.
  assert.match(client, /section\('remote', t\('branches\.remote'\), remotes, \(entry\) => entry, true, 'remote', remoteNameOf\)/,
    'the remote section renders through the grouped tree under the remote namespace')
  assert.match(client, /flatLeaves\(forestOf\(remotes, remoteNameOf\), 'remote', 0, visibleLeaves\)/,
    'the selection mirror walks the same namespaced tree')
  assert.match(client, /const forestOf = \(entries, nameOf\) =>/, 'forestOf accepts a name override')
  assert.match(client, /rowsOf\(forestOf\(entries\.map\(\(entry\) => decorate\(entry\)\), nameOf\), ns \|\| '', 0\)/,
    'the grouped renderer threads ns and nameOf through')
  // The remote HEAD symbolic ref arrives from git as a BARE "<remote>" name
  // (%(refname:short) of refs/remotes/<remote>/HEAD collapses that way); the
  // host drops it before it ever becomes a row — otherwise it pollutes the
  // tree AND defeats the single-remote prefix strip above.
  assert.match(host, /\/\^refs\\\/remotes\\\/\[\^\/\]\+\\\/HEAD\$\/\.test\(parts\[0\]\) === false\) remote\.push\(entry\)/,
    'the host filters <remote>/HEAD before listing remote branches')
})

test('the changes tree condenses single-dir chains at every level with relative labels (issue #18)', () => {
  // buildDirForest always had a compress() pass, but it only ever ran on the
  // TOP-level roots: the recursion below level one handed back raw
  // single-child chains, so a deep package path repeated its full prefix on
  // every row (the reporter's walk-manager-modules/.../controller stack).
  const start = client.indexOf('function buildDirForest(')
  assert.ok(start >= 0, 'buildDirForest must exist at module level')
  const end = client.indexOf('\n    /* ==============================', start + 10)
  assert.ok(end > start, 'buildDirForest must precede the commit-graph section')
  // dirName is a module-level sibling helper the forest builder leans on.
  const helper = client.slice(client.indexOf('function dirName('), client.indexOf('\n    }', client.indexOf('function dirName(')) + 6)
  const build = new Function(helper + '\n' + client.slice(start, end) + '; return buildDirForest')()
  const item = (path) => ({ path: path })
  // JetBrains shape: chains of single-child, file-less directories merge into
  // one node (path = the whole chain); any branch point stays its own level.
  const forest = build([
    item('walk-main/java/cn/com/pxwk/base/controller/Todo.java'),
    item('walk-main/java/cn/com/pxwk/base/domain/vo/A.java'),
    item('walk-main/java/cn/com/pxwk/base/domain/vo/B.java'),
    item('walk-main/java/cn/com/pxwk/base/enums/E.java'),
    item('walk-main/resources/mapper/base/M.xml'),
  ], 'untracked')
  assert.equal(forest.roots.length, 1, 'the top chain stops at the java/resources branch')
  assert.equal(forest.roots[0].path.join('/'), 'walk-main')
  const kids = forest.sortedChildren(forest.roots[0])
  assert.deepEqual(kids.map((n) => n.path.join('/')).sort(), ['walk-main/java/cn/com/pxwk/base', 'walk-main/resources/mapper/base'].sort(), 'chains below the branch condense into one node each')
  assert.equal(forest.countOf(kids.map((n) => n.path.join('/').endsWith('mapper/base') ? n : n) && kids[1] !== undefined ? kids[0] : kids[0]), 4, 'the count walks the condensed subtree (1+2+1)')
  const base = kids.map((n) => n.path.join('/')).indexOf('walk-main/java/cn/com/pxwk/base')
  const baseKids = forest.sortedChildren(kids[base])
  assert.deepEqual(baseKids.map((n) => n.path.join('/')).sort(), ['walk-main/java/cn/com/pxwk/base/controller', 'walk-main/java/cn/com/pxwk/base/domain/vo', 'walk-main/java/cn/com/pxwk/base/enums'].sort(), 'grandchildren compress their own chains (domain/vo merges)')
  // The renderer prints the chain RELATIVE to the parent (fold ids stay the
  // full path, so expanded/collapsed state survives the relabeling).
  assert.match(client, /renderFolder = \(node, depth, parentLen\) =>/, 'renderFolder takes the parent chain length')
  assert.match(client, /node\.path\.slice\(typeof parentLen === 'number' \? parentLen : 0\)\.join\('\/'\)/, 'the folder label is the chain below the parent')
  assert.match(client, /renderFolder\(child, depth \+ 1, node\.path\.length\)/, 'the recursion threads the parent chain length')
  // Fold-all walks exactly the nodes the renderer shows.
  const ids = []
  const walk = (nodes) => { for (const n of nodes) { ids.push('untracked|' + n.path.join('/')); walk(forest.sortedChildren(n)) } }
  walk(forest.roots)
  assert.deepEqual(forest.ids, ids, 'collect() enumerates the same compressed tree the renderer shows')
})

test('the composer dock pill keeps only the branch, left of the session statistics', () => {
  // The pill registers into the host composer's dock list — the row that also
  // holds the session statistics (ui-chat registers 'activity' at order 0 and
  // 'usage' at order 1) — so a negative order paints it first.
  assert.match(client, /pillSlots\.inject\('conversation\.composer\.dock'/, 'the pill rides the composer dock')
  assert.match(client, /name: 'conversation\.composer\.dock', id: 'dsh-git4idea:status', order: -10/, 'the entry sorts ahead of both stats pills')
  assert.doesNotMatch(client, /conversation\.input\.left/, 'the old input-row seat is gone')
  // One pill, one label: the branch (or the detached marker) and nothing else.
  // Two pill bodies, one visible at a time: the branch, and the operation
  // state that replaces it while a merge/rebase/cherry-pick/revert is open.
  assert.equal((client.match(/className: 'git4idea-cs-pill'/g) || []).length, 2, 'one pill per state remains')
  assert.match(client, /E\(Icon, \{ name: 'branch', size: 14 \}\)/, 'the branch icon leads the pill')
  assert.match(client, /E\(ComposerMarqueeName, \{ text: detached === true \? t\('composer\.detached'\) : branchName \}\)/, 'the pill label is the branch, or the detached marker')
  assert.doesNotMatch(client, /git4idea-cs-badge/, 'the change/pull/push counters are gone')
  assert.doesNotMatch(client, /composerFileSplitOf|composerStatsLinesOf|composerFingerprintOf/, 'the counter helpers went with the badges')
  assert.doesNotMatch(client, /statsStampRef|statsAtRef|COMPOSER_STATS_MS/, 'the lazy line-churn machinery is gone')
  assert.doesNotMatch(client, /'composer\.(repoHint|changesHint|fileHint|linesHint|aheadHint|behindHint)'/, 'no locale key outlives its label')
  // The ambient poll is branch-only: no numstat pass from the composer.
  assert.match(client, /request\('summary', \{ cwd: cwd, repoRoot: repoRoot, stats: false \}\)/, 'the poll asks for the branch summary only')
  // The pill borrows the dock pills' box and tone so the row reads as one set.
  assert.match(cssRule('.git4idea-cs-root'), /--dsh-content-font-size-secondary/, 'the pill follows the dock font step')
  assert.match(cssRule('.git4idea-cs-pill'), /padding:1px 8px/, 'the pill uses the dock pill padding')
  assert.match(cssRule('.git4idea-cs-pill'), /var\(--dsw-alias-label-tertiary\)/, 'the pill sits at the stats tone')
  assert.match(client, /\.git4idea-cs-pill\[aria-expanded=true\]/, 'the open menu keeps the pill lit')
})

test('naming a branch is a centered card that creates and checks it out (m02016, m03873)', () => {
  // The popover no longer swaps its tree for a dialog (m03873 #2): the prompt
  // is a frame-level card in the middle of the window, so the chooser can close
  // while the name is still being typed.
  assert.doesNotMatch(client, /git4idea-cs-newline/, 'the inline new-branch row is gone')
  assert.doesNotMatch(client, /git4idea-cs-dialog/, 'the popover no longer hosts the dialog')
  assert.match(client, /const promptDialog = \{/, 'the prompt has its own store')
  assert.match(client, /function CenteredPrompt\(props\) \{/, 'the card is a component')
  assert.match(client, /className: 'git4idea-commit-overlay git4idea-prompt-overlay'/, 'the card centers over the frame')
  assert.match(client, /E\(PromptDialogHost, null\)/, 'the frame host renders the card')
  assert.match(cssRule('.git4idea-prompt-overlay'), /z-index:81/, 'the prompt stacks above the commit and push cards')
  // Create and switch are ONE git command, the same verb the panel dialog runs.
  assert.match(client, /const openBranchPrompt = \(options\) => \{/, 'one helper raises every name prompt')
  assert.match(client, /await request\('checkout', payload\)/, 'the confirm runs checkout')
  assert.match(client, /branch: name, create: true, confirm: true/, 'the checkout creates the branch')
  assert.match(client, /startPoint: entry\.name/, 'the branch forks from the selected ref')
  assert.match(client, /if \(kind === 'remote'\) payload\.track = true/, 'a remote start point binds its upstream, a local one does not')
  // Cancel and Escape both drop the draft; the confirm starts disabled.
  assert.match(client, /event\.key === 'Escape'\) \{ event\.preventDefault\(\); if \(busy !== true\) props\.onCancel\(\) \}/, 'Escape cancels')
  assert.match(client, /const ready = value\.trim\(\) !== '' && busy === false/, 'an empty name cannot be submitted')
  assert.match(client, /if \(overlaySeatReady !== true\) \{ openPanelSeat\(\); return \}/, 'a host without the overlay falls back to the panel')
})

test('the popover floats the IDEA row verbs and fetch keeps it open (m02697)', () => {
  // A merge commit carries no patch of its own; without -m --first-parent the
  // change list had 33 files while the diff pane said there was nothing to show.
  assert.match(host, /'show', '--no-color', '--no-ext-diff', '-U3', '--format=', '-m', '--first-parent'/, 'a merge commit diffs against its first parent')
  // The verb list is a root-level floating layer, not a row inserted in the tree.
  assert.match(cssRule('.git4idea-cs-flyout'), /position:absolute/, 'the row menu floats')
  // The composer seat's layer tokens are translucent: a flyout that only reads
  // them lets the branch rows show through its labels (m03354). It must pin
  // the same opaque statics the chooser uses, in both themes.
  assert.match(cssRule('.git4idea-cs-flyout'), /--dsw-alias-bg-layer-2:var\(--dsw-static-neutral-bluish-00/, 'the light flyout is opaque')
  assert.match(cssRule('body[data-ds-dark-theme] .git4idea-cs-flyout'), /--dsw-alias-bg-layer-2:var\(--dsw-static-neutral-bluish-850/, 'the dark flyout is opaque')
  assert.match(cssRule('.git4idea-cs-flyout'), /overflow:hidden/, 'labels clip at the card edge')
  assert.match(cssRule('.git4idea-cs-flyout'), /width:max-content/, 'the card follows the longest label (m03424)')
  assert.doesNotMatch(cssRule('.git4idea-cs-flyout'), /max-width:320px/, 'a long ref must widen the card, never truncate')
  assert.match(cssRule('.git4idea-cs-sub-item'), /height:24px/, 'one 24px row per verb')
  assert.match(cssRule('.git4idea-cs-sub-item'), /flex:none/, 'rows never shrink into each other')
  assert.match(cssRule('.git4idea-cs-sub-label'), /white-space:nowrap/, 'the label never wraps inside a row')
  assert.doesNotMatch(cssRule('.git4idea-cs-sub-label'), /text-overflow:ellipsis/, 'no ellipsis: the box grows instead')
  assert.match(client, /className: 'git4idea-cs-sub-label'/, 'the labels use the nowrap span')
  // The placement flip needs the real width: measuring the longest label keeps
  // a wide card from being pushed off the right edge by the old 240px guess.
  assert.match(client, /const labelWidthOf = \(text\) => \{/)
  assert.match(client, /const flyoutWidth = Math\.max\(240, Math\.ceil\(widestLabel\) \+ 44\)/)
  assert.match(client, /menu === 'branch' \? csFlyout\(\) : null/, 'the flyout is a sibling of the popover')
  assert.doesNotMatch(client, /rows\.push\(csSubmenu/, 'nothing is inserted under the row any more')
  // The four IDEA verbs: checkout, new branch from this ref, merge INTO the
  // checked out branch, delete. Compare/seat shortcuts are gone.
  assert.match(client, /id: 'checkout', icon: 'checkout'/, 'checkout stays first')
  assert.match(client, /id: 'newBranch', icon: 'branchCreate'/, 'new branch from this ref')
  assert.match(client, /id: 'merge', icon: 'compare'/, 'merge is offered')
  assert.match(client, /fill\(t\('action\.mergeInto'\), \{ from: entry\.name, to: branchName === null \? '' : branchName \}\)/, 'merge names both refs')
  assert.match(client, /void csCall\('merge', \{ branch: entry\.name \}\)/, 'merge runs the selected ref into the current branch')
  assert.doesNotMatch(client, /setCsMenu\(null\); openPanelSeat\(\)/, 'the popover compare row is gone; the panel menu keeps its own')
  assert.equal((client.match(/'action\.mergeInto':/g) || []).length, 2, 'the merge label exists in both dictionaries')
  // Every row advertises the menu with a tail chevron; the flyout tracks the row.
  assert.match(client, /className: 'git4idea-cs-item-tail'/, 'rows carry a tail slot')
  assert.match(client, /onClick: \(event\) => \{ openCsMenu\(entry, kind, event\) \}/, 'the row passes its rect to the menu')
  assert.match(client, /setCsMenu\(\{ entry: entry, kind: kind, x: x, y: y \}\)/, 'the menu stores root-relative offsets')
  // Fetch must refresh the list in place, not dismiss the chooser.
  assert.match(client, /await csCall\('fetch', \{ prune: true \}, \{ keepOpen: true \}\)/, 'fetch keeps the popover open')
  assert.match(client, /await loadBranches\(\)/, 'fetch reloads the refs it just refreshed')
})

test('both branch menus count pending changes on their commit verb (m02223)', () => {
  // The verb looked identical with 0 or 33 dirty files. It now carries the
  // same count as the top bar, in the session popover and the panel chooser.
  assert.match(client, /const pending = summary === null \|\| summary\.changes === undefined \? 0/)
  assert.equal((client.match(/'git4idea-cs-action-count'/g) || []).length, 2, 'both commit verbs show the count')
  assert.match(client, /pending > 0 \? E\('span', \{ className: 'git4idea-cs-action-count' \}/, 'the popover reads the summary')
  assert.match(client, /props\.dirty > 0 \? E\('span', \{ className: 'git4idea-cs-action-count' \}/, 'the panel chooser reads the row count')
  assert.match(client, /dirty: dirty,/, 'the panel passes its count to the chooser')
  assert.match(cssRule('.git4idea-cs-action-count'), /margin-left:0/, 'the count follows the verb instead of sitting at the row end')
})

test('a local branch row also updates, pushes and renames that branch (m03873)', () => {
  // Update/push/rename act on the SELECTED ref, while the chooser's own
  // commit and push stay about the checked-out branch.
  assert.match(client, /id: 'update', icon: 'pull', label: t\('action\.updateBranch'\)/, 'the row offers update')
  assert.match(client, /id: 'push', icon: 'push', label: t\('action\.push'\)/, 'the row offers push')
  assert.match(client, /id: 'rename', icon: 'file', label: t\('action\.rename'\)/, 'the row offers rename')
  assert.equal((client.match(/^ +local \? \{$/gm) || []).length, 3, 'all three are local-row verbs only')
  assert.match(client, /\.filter\(\(item\) => item !== null\)/, 'remote rows drop the holes instead of rendering them')
  // Update fast-forwards the chosen ref: quickly when it is checked out,
  // in place by refspec when it is not.
  assert.match(client, /await csCall\('pull', \{ mode: 'ff-only' \}, \{ toast: toastText \}\)\n/, 'the checked-out branch is pulled ff-only')
  assert.match(client, /branch: remoteBranch \+ ':' \+ entry\.name/, 'another branch is fast-forwarded in place')
  // Push opens the SAME card for the selected branch (m00005): the preview
  // decides the destination, so a stale upstream name cannot leak through.
  assert.match(client, /const pushBranch = \(entry\) => \{\n        if \(repoRoot === null \|\| csBusy !== ''\) return\n        openPushDialog\(\{ branch: entry\.name \}\)/, 'a row push opens the card for its branch')
  assert.doesNotMatch(client, /remote: remote, branch: refspec, confirm: true/, 'the row no longer pushes straight from the menu')
  // Rename moves the ref and refreshes the pill when it was the checked-out one.
  assert.match(client, /await request\('branchRename', \{/, 'rename calls the branchRename route')
  assert.match(client, /if \(entry\.head === true\) notifyBranchSwitched\(sessionId, repoRoot\)/, 'renaming HEAD refreshes the composer pill')
  // The flyout's flip estimate follows the verb count now that local rows have seven.
  assert.match(client, /const items = csMenuItems\(\{ entry: entry, kind: kind \}\)/, 'the caller measures the same list it renders')
  assert.match(client, /const flyoutHeight = 8 \+ items\.length \* 26/, 'the height follows the verb count')
  // A verb that closes the chooser still reports: its error bar would be gone.
  assert.match(client, /typeof options\.toast === 'string'/, 'csCall can raise a toast')
  assert.match(client, /notifyOk\(toastText !== '' \? toastText : csSuccessText\(action, payload\)\)/, 'a completed verb reports success (m05310)')
  assert.match(client, /notifyFail\(caught\)/, 'a failed verb always reports, whether the chooser stays open or not (m05310)')
  assert.doesNotMatch(client, /branchPushed/, 'the card reports the push, not a row toast')
  assert.doesNotMatch(client, /newBranchOpen/, 'the old inline dialog state is gone')
  assert.equal((client.match(/'action\.updateBranch':/g) || []).length, 2, 'the update label exists in both dictionaries')
  assert.equal((client.match(/'toast\.branchUpdated':/g) || []).length, 2, 'the update toast exists in both dictionaries')
  assert.equal((client.match(/'push\.newBranch':/g) || []).length, 2, 'the new-branch badge exists in both dictionaries')
})

test('an outside checkout renames the composer pill without waiting for the summary poll (m02856)', () => {
  // The summary poll is 30s because it scans status; the pill instead probes
  // branch + HEAD with two git calls and reloads the summary only on a move.
  assert.match(host, /'symbolic-ref', '--short', '-q', 'HEAD'/, 'the probe asks for the branch name')
  assert.match(host, /'rev-parse', '-q', '--verify', 'HEAD'/, 'and the HEAD hash')
  assert.match(host, /head: headState/, 'the cheap probe is a route')
  assert.match(client, /const COMPOSER_HEAD_POLL_MS = 2500/, 'the probe runs well inside a human click')
  assert.match(client, /request\('head', \{ cwd: cwd, repoRoot: repoRoot \}\)/, 'the pill polls the cheap route')
  assert.match(client, /const sig = String\(state\.head\) \+ '\|' \+ String\(state\.branch\)/, 'head and branch form the signature')
  assert.match(client, /const shown = String\(current\.head === undefined \? '' : current\.head\)/, 'it compares against the summary on screen')
  assert.match(client, /if \(sig === shown\) return/, 'an unchanged signature costs no request')
  assert.match(client, /document\.addEventListener\('visibilitychange', wake\)/, 'returning to the tab probes at once')
  assert.match(client, /if \(menu === 'branch'\) void loadBranches\(\)/, 'an open chooser reloads its HEAD marker')
})

test('the composer commit verb raises the dialog on the conversation page (m02090)', () => {
  // 提交 used to open the right-sidebar seat and then need a SECOND click on
  // that tab's own 提交 button. The verb now raises a card straight over the
  // conversation through the host's frame-wide overlay slot.
  assert.match(client, /const commitDialog = \{/, 'the module store carries the open request between roots')
  assert.match(client, /inject\('shell\.overlay'/, 'the card rides the frame-wide overlay slot')
  assert.match(client, /name: 'shell\.overlay', id: 'dsh-git4idea:commit'/, 'the overlay seat is this plugin\'s')
  // The composer is inside a dock container with contain:layout, so the card
  // must be fixed AND mounted outside that container.
  assert.match(client, /\.git4idea-commit-overlay\{position:fixed;inset:0;z-index:80/, 'the overlay is viewport-fixed')
  assert.match(client, /'data-tip': t\('changes\.commit'\), onClick: openCommitDialog/, 'the popover commit verb raises the dialog directly')
  assert.doesNotMatch(client, /'data-tip': t\('changes\.commit'\), onClick: openPanelSeat/, 'no seat detour is left on the commit verb')
  // One dialog, its own routes: it must not depend on a mounted Git tab.
  assert.match(client, /await request\('commit', Object\.assign\(\{\}, base, \{/, 'the card runs the commit route itself')
  assert.match(client, /void call\('discard', \{ paths: \[item\.path\], confirm: true, untracked: group === 'untracked' \}\)/, 'discard keeps the panel confirmation copy and confirm flag')
  assert.match(client, /E\(ChangesPanel, \{[\s\S]{0,500}?base: base,/, 'the card reuses the panel change list')
  // Cancel paths: Escape, the close button, the scrim, and Close after commit.
  assert.match(client, /if \(event\.key !== 'Escape'\) return/, 'Escape closes the card first')
  assert.match(client, /commitDialog\.set\(null\)/, 'closing drops the request')
  // A host without the slot keeps one working path: the old seat.
  assert.match(client, /if \(repoRoot === null\) \{ openPanelSeat\(\); return \}/, 'a repo-less session still opens the seat')
  assert.match(client, /if \(overlaySeatReady === true\) \{/, 'the seat is only a fallback when no overlay host registered')
  assert.match(client, /overlaySeatReady = true/, 'registration flips readiness synchronously')
  assert.doesNotMatch(client, /commitDialog\.hosted === true/, 'readiness no longer waits for a mount effect')
})

test('long branch names cap at 220px and scroll only on hover, seamlessly (v0.19.13)', () => {
  // Past the cap the label switches to a duplicated-chunk structure measured
  // after paint, and ONLY :hover starts the marquee — short names keep the
  // plain ellipsis and never animate.
  assert.match(client, /max-width:220px/, 'the label cap matches the dock row')
  // Two labels use it: the branch pill and the operation pill that replaces it
  // while a merge/rebase is open.
  assert.equal((client.match(/ComposerMarqueeName, \{ text:/g) || []).length, 2, 'both pill texts use the marquee name')
  assert.match(client, /function ComposerMarqueeName\(/, 'the marquee name component exists')
  // Overflow detection happens on the real DOM after paint (scrollWidth vs
  // clientWidth); a replaced/unmounted node never re-measures.
  assert.match(client, /box\.scrollWidth > box\.clientWidth \+ 1/, 'overflow is measured against the real box')
  assert.match(client, /if \(boxRef\.current !== box\) return/, 'a replaced node never re-measures')
  assert.match(client, /fonts\.ready/, 'webfont landing re-measures once')
  // The animation lives ONLY in the :hover rule (non-hovering labels are
  // static); duration follows the text width via the CSS custom property.
  assert.match(client, /\.git4idea-cs-mrun:hover \.git4idea-cs-run\{animation:git4idea-cs-marquee var\(--git4idea-cs-marquee-dur,10s\) linear infinite\}/, 'hover alone starts the scroll')
  assert.equal((client.match(/animation:git4idea-cs-marquee/g) || []).length, 1, 'no non-hover animation rule exists')
  assert.match(client, /@keyframes git4idea-cs-marquee\{from\{transform:translateX\(0\)\}to\{transform:translateX\(-50%\)\}\}/, 'the loop translates half the duplicated run (seamless)')
  assert.match(client, /const MARQUEE_PX_PER_S = 28/, 'the scroll speed is a named constant')
  assert.match(client, /box\.scrollWidth \/ 2 : box\.scrollWidth/, 'duration divides the doubled run back to one chunk')
  // CSS: the running label clips (no stale ellipsis) with a right-fade mask
  // hinting at more text; chunks stay on one line with a seam gap.
  assert.match(cssRule('.git4idea-cs-mrun'), /mask-image:linear-gradient/, 'the running label fades at its right edge')
  assert.match(cssRule('.git4idea-cs-mrun .git4idea-cs-chunk'), /padding-right:28px/, 'the seam gap equals the mask fade')
  assert.match(cssRule('.git4idea-cs-mrun .git4idea-cs-run'), /will-change:transform/, 'the scroll rides the compositor')
})


test('the AI commit message rides the session model route (v0.22.1, item 1)', () => {
  // Host: a blank session (no model route yet) no longer fails the panel
  // button — the first served provider/model becomes the route, the response
  // names it, and a served-empty catalog still refuses with a next step.
  assert.match(host, /async function fallbackRouteOf\(/, 'the served fallback exists')
  assert.match(host, /const fallback = await fallbackRouteOf\(\)/, 'no-route falls back before failing')
  assert.match(host, /source: 'fallback'/, 'the fallback route names itself')
  assert.match(host, /'no-models'/, 'an empty catalog refuses with a next step')
  assert.doesNotMatch(host, /this session has no model route yet/, 'the old no-route text is gone')
  // Client: the plugin draws no model selector of its own (m05301). The
  // composer's official selector is the only place a model is chosen, so the
  // AI-write button sends no model, effort or prompt and the host route follows
  // the SESSION. Every piece of the old picker is gone: the component, its
  // model-directories inject, its CSS and its dictionary keys.
  assert.doesNotMatch(client, /ModelRoutePicker/, 'the hand-drawn picker is deleted')
  assert.doesNotMatch(client, /modelDirectoriesRef/, 'the model-directories inject is deleted')
  assert.doesNotMatch(client, /git4idea-mrp/, 'the picker CSS is deleted')
  assert.doesNotMatch(client, /modelRoute\./, 'the picker dictionary keys are deleted')
  assert.doesNotMatch(client, /readCommitSettings/, 'the empty settings shim is deleted')
  assert.match(client, /props\.request\('commit-message', Object\.assign\(\s*\{\},\s*props\.base === undefined \? \{ cwd: props\.cwd \} : props\.base,\s*\{ sessionId: props\.sessionId, language: commitLang \},/, 'the message rides the session route only; the language is the only extra')
  assert.doesNotMatch(client, /model: settings\.model/, 'no model travels from the panel')
  assert.doesNotMatch(client, /'commit-models'/, 'the dead catalog fetch is deleted')
  assert.doesNotMatch(client, /'commit-efforts'/, 'the dead efforts fetch is deleted')
})


test('upstream management: bind, drop and create-tracking from menus (v0.20.0, issue #18)', () => {
  // Host: set/unset go through branch --set-upstream-to / --unset-upstream on
  // a validated ref; creating from a remote ref with track:true rides
  // checkout -b --track so binding happens in the same breath.
  assert.match(host, /git\(root, \['branch', '--set-upstream-to=' \+ upstream, branch\]\)/, 'the set verb uses branch --set-upstream-to')
  assert.match(host, /git\(root, \['branch', '--unset-upstream', branch\]\)/, 'the unset verb uses branch --unset-upstream')
  assert.match(host, /payload\.track === true && start !== undefined\) args\.push\('--track'\)/, 'checkout -b gains --track for remote starts')
  // The write is serialised like every other mutating method.
  assert.match(host, /'stage', 'unstage', 'discard', 'commit', 'checkout', 'branchCreate', 'branchRename', 'branch-upstream',/, 'branch-upstream is a declared write method')
  // Branch-row menu: local rows bind/drop, remote rows create a local branch.
  assert.match(client, /id: 'setUpstream'/, 'branch rows can set an upstream')
  assert.match(client, /id: 'unsetUpstream'/, 'branch rows can drop an upstream')
  // v0.3.1 (#2): one branch dialog serves both starts — a remote row passes
  // track:true into it instead of opening a second create-tracking dialog.
  assert.match(client, /kind: 'newBranch', from: entry\.name, track: true/, 'remote rows create a tracking branch')
  assert.doesNotMatch(client, /createTracking/, 'the separate create-tracking dialog is deleted')
  // The submenu is built at click time (branches.remote), never at render
  // time — the useCallback deps must not grow a later-defined binding.
  assert.match(client, /run: \(event\) => openMenuAt\(event, withoutIcons\(branches\.remote\.map/, 'the remote picker is built inside run() at click time')
  assert.match(client, /active: entry\.upstream === remoteEntry\.name/, 'the current upstream is marked active in the submenu')
  // More menu carries the same verbs for the CURRENT branch.
  assert.match(client, /id: 'br-upstream'/, 'the more menu can set the current branch upstream')
  assert.match(client, /id: 'br-unset-upstream'/, 'the more menu can drop the current branch upstream')
  assert.match(client, /disabled: headBranch === '' \|\| remoteBranches\.length === 0 \|\| blocked/, 'set-head verb is gated on a branch and remotes existing')
  assert.match(client, /disabled: headBranch === '' \|\| tracked !== true \|\| blocked/, 'unset-head verb only makes sense when tracking')
  // The dialog names the local branch it will create from the remote one, and
  // the checkout gains --track from the row's flag.
  assert.match(client, /fill\(t\('prompt\.newBranchFrom'\), \{ branch: branchFrom \}\)/, 'the dialog states the start point')
  assert.match(client, /startPoint: state\.from, track: state\.track === true \}\); return \}/, 'the dialog creates with --track when asked')
  // The tree shows the binding as a muted glyph; the name lives in its tooltip
  // (the old inline text capped at 180px and starved the label).
  assert.match(client, /className: 'git4idea-row-upstream'/, 'local rows show the upstream binding')
  assert.match(client, /'data-tip': entry\.name \+ ' → ' \+ entry\.upstream/, 'the upstream name lives in the hover tooltip')
  assert.doesNotMatch(cssRule('.git4idea-row-upstream'), /max-width/, 'the binding glyph never claims label width')
  // Dictionary: both dictionaries carry the four upstream keys (the key-set
  // equality test pins parity).
  for (const key of ['action.setUpstream', 'action.unsetUpstream', 'more.setUpstreamHead', 'more.unsetUpstreamHead']) {
    assert.equal((client.match(new RegExp("'" + key.replace(/\./g, '\\.') + "':", 'g')) || []).length, 2, 'both dictionaries carry ' + key)
  }
})

test('the push dialog previews its commits and the file card floats (m02986)', () => {
  // Host: one read-only route. It reuses the log record shape and caps the
  // list like every other history route; nothing here writes a ref.
  assert.match(host, /const PUSH_PREVIEW_LIMIT = 300/)
  assert.match(host, /async function pushPreview\(payload\)/)
  assert.match(host, /'push-preview': pushPreview,/, 'the route is registered under the API prefix')
  const writeSet = host.slice(host.indexOf('const WRITE_METHODS'), host.indexOf('])', host.indexOf('const WRITE_METHODS')))
  assert.doesNotMatch(writeSet, /push-preview/, 'push-preview stays read-only')
  assert.match(host, /runGit\(root, \['ls-remote', '--heads', remote\], \{ timeoutMs: PUSH_REMOTE_TIMEOUT_MS \}\)/,
    'the remote branch state comes from ls-remote, not the stale local cache')
  assert.match(host, /const range = base === '' \? \[branch, '--not', '--remotes'\] : \[branch, '--not', base\]/,
    'the range ends at the remote tip the push would replace')
  assert.match(host, /const upstreamGone = configuredBranch !== '' && configuredExists === false \? remote \+ '\/' \+ configuredBranch : null/,
    'a configured destination that vanished on the remote is reported as gone')
  assert.match(host, /setUpstream/, 'the client asks the push route to set an upstream')

  // File card: same frame-wide seat and card shell as the commit dialog.
  assert.match(client, /const fileDialog = \{/)
  assert.match(client, /'data-git4idea-file-dialog': ''/)
  assert.match(client, /className: 'git4idea-file-card'/)
  assert.match(client, /E\(DiffPreview, \{\n          seed: entry,/, 'the card reuses the one diff renderer')
  assert.match(client, /onClose: \(\) => \{ fileDialog\.set\(null\) \}/, 'the card has its own close')
  assert.match(client, /if \(event\.key === 'Escape'\) fileDialog\.set\(null\)/)

  // previewDiff prefers the card; the sidebar stays as the fallback for a host
  // that registers no shell.overlay.
  const funnel = client.slice(client.indexOf('const previewDiff ='), client.indexOf('const openPushDialog = useCallback'))
  assert.ok(funnel.length > 400, 'the funnel must be found whole')
  assert.match(funnel, /if \(fileDialog\.hosted === true\) \{[^}]*fileDialog\.set\(dialogSeed\)[^}]*return true/,
    'a hosted card wins over the sidebar tab')
  assert.match(funnel, /previewStore\.set\(dialogSeed\)/, 'the sidebar leg still exists')

  // Push dialog content: commits on the left, the selected commit's files on
  // the right, and a double click hands one file to the file card.
  assert.match(client, /const pushDialog = \{/)
  assert.match(client, /'data-git4idea-push-dialog': ''/)
  assert.match(client, /request\('push-preview', payload\)/, 'the card asks the host for a preview of the chosen mapping')
  assert.match(client, /const next = pushPreviewOf\(await request\('push-preview', payload\)\)/, 'the payload is normalised before it reaches the card (m04102)')
  assert.match(client, /setSelected\(\(previous\) => \(previous !== null && next\.commits\.some/, 'a still-listed commit stays selected when the destination changes')
  assert.match(client, /request\('commitDetail', Object\.assign\(\{\}, base, \{ hash: selected \}\)\)/)
  assert.match(client, /const openFile = \(file\) => \{/)
  assert.match(client, /const commit = data === null \? null : \(data\.commits\.find\(\(item\) => item\.hash === selected\) \|\| null\)/,
    'a hash that left the list degrades to "pick a commit" instead of throwing (m05303)')
  assert.match(client, /fileDialog\.set\(\{\n          hash: commit\.hash,/, 'a file double click floats the diff card')
  // The push dialog renders the SAME file list as the commit detail pane
  // (CommitFileList, m02986 follow-up): the old flat row dropped the capped
  // path class, so a long path starved the name and clipped the stat.
  assert.match(client, /function CommitFileList\(props\)/, 'one renderer serves both lists')
  assert.equal((client.match(/E\(CommitFileList, \{/g) || []).length, 2, 'commit detail and push dialog both mount it')
  assert.match(client, /onOpen: openFile,/, 'a file double click floats the diff card')
  assert.match(client, /const canPush = data !== null && data\.detached === false && data\.remotes\.length > 0\n\s+&& destinationKnown === true && \(data\.commits\.length > 0 \|\| data\.remoteExists === false\) && busy === false/,
    'a new remote branch is pushable even with an empty list')
  assert.match(client, /confirm: true,\n            remote: remote,\n            localBranch: data\.branch,\n            remoteBranch: destination,\n            setUpstream: true,/,
    'both ends are explicit; a bare push would follow the stale merge name (m00005)')
  assert.match(client, /if \(force === true\) payload\.force = true/, 'a forced push reuses the selected destination')
  assert.match(client, /const destinationKnown = data !== null && checking === false && remote === data\.remote && destination === data\.remoteBranch/,
    'a destination still being checked cannot push')
  assert.match(client, /data\.remoteExists === true \? t\('push\.existingBranch'\) : t\('push\.newBranch'\)/, 'the card marks an existing branch and a new one')
  assert.match(client, /const pushing = useRef\(false\)/, 'the in-flight guard is synchronous (m05311)')
  assert.match(client, /if \(pushing\.current === true \|\| data === null \|\| destinationKnown !== true\) return/, 'a second click cannot start a second push')

  // Four push verbs all raise the same card; only the panel fallback survives.
  assert.equal((client.match(/run: \(\) => openPushDialog\(\)/g) || []).length, 3, 'palette and both menus share one verb')
  assert.match(client, /if \(remoteReady !== true \|\| blocked === true\) return\n            openPushDialog\(\)/, 'the toolbar button runs the same verb')
  assert.match(client, /const openPushDialog = useCallback\(\(seed\) => \{/, 'the panel keeps one helper that accepts a seed')
  assert.match(client, /pushDialog\.set\(Object\.assign\(\{ cwd: cwd, repoRoot: repoRoot, sessionId: scopeObject\.sessionId \}, seed \|\| \{\}\)\)/,
    'the panel raises the same frame push card as the composer pill (m04920)')
  assert.match(client, /run: \(\) => openPushDialog\(\{ branch: entry\.name \}\)/, 'a branch row opens the card on that branch')
  assert.match(client, /openPushDialog\(\{ force: true \}\)/, 'a forced push opens the card with the force badge')
  assert.match(client, /run: pickRemote\(\(name\) => openPushDialog\(\{ remote: name \}\)\)/, 'push-to preselects the chosen remote')
  assert.doesNotMatch(client, /const \[pushOpen, setPushOpen\] = useState\(null\)/, 'the panel keeps no second push surface')
  assert.doesNotMatch(client, /git4idea-commit-overlay-inline/, 'the in-panel overlay variant is gone')
  assert.doesNotMatch(client, /setDialog\(\{ kind: 'push' \}\)/, 'no native confirm path is left for push')

  // Commit + push is two steps now: commit, close, then push. Both dialogs and
  // the composer pill follow the same order.
  const panelCommit = client.slice(client.indexOf("const result = await run('commit'"), client.indexOf("const result = await run('commit'") + 900)
  assert.match(panelCommit, /run\('commit', \{ message: message, amend: amend, paths: paths \}, \{ quiet: true \}\)/, 'the commit run no longer pushes and leaves the toast to the card (m05310)')
  assert.ok(panelCommit.indexOf("run('commit'") < panelCommit.indexOf('if (push === true) openPushDialog()'),
    'the commit runs before the push dialog opens')
  assert.match(panelCommit, /(?:toastCenter\.push|pushToast)\(\{ text: t\('toast.committed'\)/, 'the commit result lands in the notifications')
  assert.match(client, /if \(push === true\) pushDialog\.set\(\{ cwd: entry\.cwd, repoRoot: entry\.repoRoot, sessionId: entry\.sessionId \}\)/)

  // Notifications are frame-wide now (the cards live outside the panel).
  assert.match(client, /id: 'dsh-git4idea:file'/)
  assert.doesNotMatch(client, /id: 'dsh-git4idea:push'/, 'the separate push seat is gone')
  assert.match(client, /function GitDialogHost\(/, 'one host carries the commit and push cards')
  assert.match(client, /data-git4idea-toasts/, 'the stack is a plain body element, not a slot seat')
  assert.match(client, /'\.git4idea-toasts\{position:fixed;right:12px;bottom:12px;/, 'the stack leaves the panel for the viewport corner')
  assert.match(client, /'\.git4idea-commit-overlay\{position:fixed;inset:0;z-index:80/, 'the push card is viewport-anchored like the commit card')

  // Eight keys × 21 gates; the key-set test pins exact parity.
  for (const key of ['push.title', 'push.none', 'push.detached', 'push.noRemote', 'push.truncated', 'push.hint', 'push.localBranch', 'push.remoteBranch', 'push.newBranch', 'push.existingBranch', 'push.remoteUnknown', 'toast.committed', 'toast.pushed']) {
    const occurrences = client.split("'" + key + "'").length - 1
    assert.ok(occurrences >= 2, key + ' must ship in both shipped dictionaries (saw ' + occurrences + ')')
  }
})
