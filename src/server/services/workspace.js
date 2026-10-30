/**
 * dsh-git4idea — services / workspace (host half, plain JavaScript).
 */

import { existsSync, readdirSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { runGit, git } from './../core/git.js'
import { cwdOf, requireRef } from './../core/payload.js'
import { repoRootOf, currentBranchOf, upstreamOf, aheadBehindOf, parsePorcelain, classify, ignoredEntriesOf, numstatOf, decorate, parseLog, LOG_FORMAT, stashCountOf, worktreesOf, operationOf, operationSourceOf } from './../core/repo.js'
import { branches } from './history.js'

export function repoNameFromUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') return ''
  const tail = url.trim().replace(/\/+$/, '').replace(/\.git$/i, '')
  const segments = tail.split(/[\\/:]/).filter((segment) => segment !== '')
  return segments.length > 0 ? segments[segments.length - 1] : ''
}
/* origin first, then the first configured remote, then '' — the client
   falls back to the folder basename when this is empty. Both reads are
   local config reads, never network. */

export async function originNameOf(root) {
  try {
    const origin = await git(root, ['remote', 'get-url', 'origin'])
    const name = repoNameFromUrl(origin)
    if (name !== '') return name
  } catch (error) { void error }
  try {
    const remotesOut = await runGit(root, ['remote'])
    if (remotesOut.code !== 0) return ''
    const first = remotesOut.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')[0]
    if (first === undefined) return ''
    const urlOut = await runGit(root, ['remote', 'get-url', first])
    return urlOut.code === 0 ? repoNameFromUrl(urlOut.stdout.trim()) : ''
  } catch (error) { void error; return '' }
}


export async function summary(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  /* Two-phase changes (issue #11): with `stats: false` the two `diff
     --numstat` passes — the most expensive step once a tree holds thousands
     of changes — are skipped, `statsDeferred: true` announces that the +/-
     numbers arrive through the `stats` method instead. The rows themselves
     are complete without them; nothing is truncated. */
  const deferStats = payload.stats === false
  /* The branch chain (branch → upstream → ahead/behind) is sequential by
     necessity; everything else is independent and runs concurrently, so a
     large `status` scan no longer serialises behind five cheap calls
     (issue #11: the sum of ~ten sequential commands became the max of two
     chains). */
  const [branchInfo, statusOut, unstagedStat, stagedStat, ignored, stashCount, worktrees, operation, head, originName] = await Promise.all([
    (async () => {
      const branch = await currentBranchOf(root)
      const detached = branch === 'HEAD'
      const upstream = detached ? null : await upstreamOf(root, branch)
      const tracking = upstream === null ? { ahead: 0, behind: 0 } : await aheadBehindOf(root, upstream, branch)
      return { branch, detached, upstream, tracking }
    })(),
    git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    deferStats ? Promise.resolve(new Map()) : numstatOf(root, []),
    deferStats ? Promise.resolve(new Map()) : numstatOf(root, ['--cached']),
    payload.ignored === true ? ignoredEntriesOf(root) : { entries: [], truncated: false },
    stashCountOf(root),
    worktreesOf(root),
    operationOf(root),
    /* HEAD hash (v0.18.7): lets the client's poll notice OUTSIDE commits and
       checkouts — the panel's own actions already refresh everything, but
       nothing else watches the repo. Empty string on an unborn branch. */
    git(root, ['rev-parse', 'HEAD']).then((out) => out.trim()).catch(() => ''),
    originNameOf(root),
  ])
  /* Only a merge names the ref it brings in; the conflict card labels the two
     sides with it. Other operations have no counterpart ref to show. */
  const operationSource = await operationSourceOf(root, operation)
  const groups = classify(parsePorcelain(statusOut))
  return {
    repoRoot: root,
    cwd,
    branch: branchInfo.branch,
    detached: branchInfo.detached,
    upstream: branchInfo.upstream,
    ahead: branchInfo.tracking.ahead,
    behind: branchInfo.tracking.behind,
    head: head,
    /* The repository's own name (v0.19.1): the origin URL's leaf, so a
       renamed clone still shows the real repo name, not the folder's. */
    origin: originName,
    changes: {
      staged: decorate(groups.staged, stagedStat),
      unstaged: decorate(groups.unstaged, unstagedStat),
      untracked: decorate(groups.untracked, new Map()),
      conflicted: decorate(groups.conflicted, new Map()),
      ignored: ignored.entries,
      ignoredTruncated: ignored.truncated,
    },
    statsDeferred: deferStats === true,
    stashCount: stashCount,
    worktrees: worktrees,
    operation: operation,
    operationSource: operationSource,
  }
}

/* A two-command probe for the composer pill's fast poll (m02856): branch and
   HEAD hash only. `summary` is the authoritative shape but pays for a full
   status scan; this one must stay cheap enough to run every couple of seconds
   while the session is on screen. Read-only: deliberately not in
   WRITE_METHODS. */

export async function headState(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const [branchOut, headOut] = await Promise.all([
    runGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']),
    runGit(root, ['rev-parse', '-q', '--verify', 'HEAD']),
  ])
  /* Detached HEAD and an unborn branch both leave symbolic-ref empty; the
     summary reports them as 'HEAD' too, so the pill's comparison keeps
     working across a checkout to a detached commit. */
  const branch = branchOut.code === 0 && branchOut.stdout.trim() !== '' ? branchOut.stdout.trim() : 'HEAD'
  const head = headOut.code === 0 ? headOut.stdout.trim() : ''
  return { repoRoot: root, branch: branch, detached: branch === 'HEAD', head: head }
}

/* The second phase of the two-phase changes (issue #11): the two numstat
   passes, concurrent, packed as [path, additions, deletions, binary] rows so
   they survive JSON. Paths are post-rename paths — exactly what `summary`
   decorates its entries with. Read-only: deliberately not in WRITE_METHODS. */
/* The push dialog's list (m02986): which commits this branch would send and
   where they go. With an upstream the range is upstream..HEAD - exactly what
   `git push` updates. Without one it is every commit the configured remotes do
   not carry yet (HEAD --not --remotes): what the first `push -u` would publish.
   Read-only: one config read and one log. */

export const PUSH_PREVIEW_LIMIT = 300
export const PUSH_REMOTE_TIMEOUT_MS = 10 * 1000

async function configOf(root, key) {
  const out = await runGit(root, ['config', '--get', key])
  return out.code === 0 ? out.stdout.trim() : ''
}

/* The remote's heads as the SERVER sees them. A local refs/remotes entry is a
   cache of the last fetch: it survives a branch deleted on the remote, so it
   cannot answer "does this branch exist there". A failed lookup is reported
   instead of guessed - the card then labels the state as unknown. */
async function remoteHeadsOf(root, remote) {
  const heads = new Map()
  if (remote === null) return { ok: false, heads }
  let out
  try {
    out = await runGit(root, ['ls-remote', '--heads', remote], { timeoutMs: PUSH_REMOTE_TIMEOUT_MS })
  } catch (error) { void error; return { ok: false, heads } }
  if (out.code !== 0) return { ok: false, heads }
  for (const line of out.stdout.split('\n')) {
    const match = /^([0-9a-f]{40,64})\s+refs\/heads\/(.+)$/.exec(line.trim())
    if (match !== null) heads.set(match[2], match[1])
  }
  return { ok: true, heads }
}

async function localRemoteBranchesOf(root, remote) {
  const out = await runGit(root, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/' + remote])
  if (out.code !== 0) return []
  const prefix = remote + '/'
  return out.stdout.split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line !== remote)
    .map((line) => (line.startsWith(prefix) ? line.slice(prefix.length) : line))
    .filter((line) => line !== 'HEAD')
    .sort()
}

async function localRemoteBranchExists(root, remote, name) {
  const out = await runGit(root, ['rev-parse', '--verify', '--quiet', 'refs/remotes/' + remote + '/' + name])
  return out.code === 0
}

/* The push card maps a LOCAL branch onto a REMOTE branch (m00005). The old
   preview assumed branch.<name>.merge still named a live remote branch; after
   `git branch -m A B` plus deleting remote A it still says A, so pressing push
   re-created A. The configured destination is offered only while it exists on
   the remote; a gone destination falls back to the local name. */
export async function pushPreview(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const requested = typeof payload.branch === 'string' && payload.branch.trim() !== ''
    ? requireRef(payload.branch.trim(), 'branch')
    : ''
  const branch = requested !== '' ? requested : await currentBranchOf(root)
  const detached = branch === 'HEAD' || branch === ''
  const remotesOut = await runGit(root, ['remote'])
  const remotes = remotesOut.code === 0
    ? remotesOut.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '')
    : []
  let configuredRemote = ''
  let configuredMerge = ''
  if (detached === false) {
    const [remoteOut, mergeOut] = await Promise.all([
      configOf(root, 'branch.' + branch + '.remote'),
      configOf(root, 'branch.' + branch + '.merge'),
    ])
    if (remoteOut !== '' && remoteOut !== '.') configuredRemote = remoteOut
    if (mergeOut.startsWith('refs/heads/')) configuredMerge = mergeOut.slice('refs/heads/'.length)
  }
  const wantedRemote = typeof payload.remote === 'string' && payload.remote.trim() !== ''
    ? requireRef(payload.remote.trim(), 'remote')
    : ''
  let remote = wantedRemote
  if (remote === '') remote = configuredRemote !== '' ? configuredRemote : (remotes.length > 0 ? remotes[0] : null)
  const configuredBranch = configuredRemote !== '' && configuredRemote === remote ? configuredMerge : ''
  const requestedDest = typeof payload.remoteBranch === 'string' && payload.remoteBranch.trim() !== ''
    ? requireRef(payload.remoteBranch.trim(), 'remoteBranch').replace(/^refs\/heads\//, '')
    : ''
  const remoteInfo = detached ? { ok: false, heads: new Map() } : await remoteHeadsOf(root, remote)
  const remoteBranches = remoteInfo.ok
    ? [...remoteInfo.heads.keys()].sort()
    : (remote === null ? [] : await localRemoteBranchesOf(root, remote))
  const remoteChecked = remoteInfo.ok
  const existsOnRemote = async (name) => (remoteInfo.ok ? remoteInfo.heads.has(name) : await localRemoteBranchExists(root, remote, name))
  const configuredExists = configuredBranch === '' ? false : await existsOnRemote(configuredBranch)
  const upstream = configuredExists ? remote + '/' + configuredBranch : null
  const upstreamGone = configuredBranch !== '' && configuredExists === false ? remote + '/' + configuredBranch : null
  let remoteBranch = requestedDest
  if (remoteBranch === '') remoteBranch = configuredExists ? configuredBranch : branch
  const remoteExists = detached ? false : await existsOnRemote(remoteBranch)
  let commits = []
  let truncated = false
  if (detached === false) {
    let base = ''
    if (remoteExists === true) {
      if (remoteInfo.ok) base = remoteInfo.heads.get(remoteBranch) || ''
      else {
        const localRef = 'refs/remotes/' + remote + '/' + remoteBranch
        const check = await runGit(root, ['rev-parse', '--verify', '--quiet', localRef])
        if (check.code === 0) base = localRef
      }
    }
    const range = base === '' ? [branch, '--not', '--remotes'] : [branch, '--not', base]
    let out = await runGit(root, ['log', '--max-count=' + (PUSH_PREVIEW_LIMIT + 1), '--date-order', '--pretty=format:' + LOG_FORMAT, ...range])
    /* A fresh remote tip may not be in the object database until the next
       fetch; the refs/remotes fallback keeps the preview usable. */
    if (out.code !== 0 && base !== '') {
      out = await runGit(root, ['log', '--max-count=' + (PUSH_PREVIEW_LIMIT + 1), '--date-order', '--pretty=format:' + LOG_FORMAT, branch, '--not', '--remotes'])
    }
    if (out.code === 0) {
      const all = parseLog(out.stdout)
      truncated = all.length > PUSH_PREVIEW_LIMIT
      commits = truncated ? all.slice(0, PUSH_PREVIEW_LIMIT) : all
    }
  }
  const target = remote === null ? branch : remote + '/' + remoteBranch
  return {
    repoRoot: root, branch, detached, upstream, upstreamGone, remote, remoteBranch, remoteBranches,
    remoteChecked, remoteExists, target, remotes, commits, truncated, count: commits.length,
  }
}


export async function stats(payload) {
  const root = await repoRootOf(cwdOf(payload), payload)
  const [unstaged, staged] = await Promise.all([
    numstatOf(root, []),
    numstatOf(root, ['--cached']),
  ])
  const pack = (map) => {
    const rows = []
    for (const [path, stat] of map) rows.push([path, stat.additions, stat.deletions, stat.binary === true])
    return rows
  }
  return { unstaged: pack(unstaged), staged: pack(staged) }
}


/** Directories never descended into while looking for repositories. */
export const REPO_SCAN_SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'venv', '.venv', '__pycache__', 'coverage', 'tmp', 'temp'])

/* `git submodule status --recursive` already reports every nesting level of a
   repository in ONE call (paths arrive fully qualified), so the submodule walk
   costs exactly one `status` per checkout; the lists stay bounded so a
   pathological tree cannot flood the picker. */

export const SUBMODULE_LIST_LIMIT = 400

export const REPO_LIST_LIMIT = 60


/** Slash-normalized path, for comparing paths that came from different
 *  producers (git prints forward slashes; `path.join` prints backslashes on
 *  Windows). Case-insensitive on Windows so the same checkout reached two ways
 *  collapses to one row. */
export function pathIdentity(value) {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  /* realpath collapses producer spellings of one checkout: git's
   * --show-toplevel resolves symlinks (/private/var on macOS) while a
   * directory walk keeps the spelling it was handed (/var), and without this
   * the same submodule arrived as two rows. An unresolvable path falls back
   * to the slash-normalized form. */
  try {
    return realpathSync(key).replace(/\\/g, '/').replace(/\/+$/, '')
  } catch {
    return key
  }
}


/** One repository row shipped to the client (`kind` drives the picker badge). */
export function repoRow(root, submodulePath, kind) {
  return {
    path: root.replace(/\\/g, '/'),
    /** Full checkout name; a submodule carries its repo-relative path so two
     *  same-named checkouts stay apart in a long list. */
    name: submodulePath === undefined ? path.basename(root) : submodulePath,
    label: submodulePath === undefined ? path.basename(root) : submodulePath.split('/').pop(),
    branch: null,
    /** The checkout's own repository name, cut from its origin URL (v0.19.2):
     *  the picker shows this first and falls back to the directory name, with
     *  the directory name as the small sub line whenever the two differ — so
     *  two clones of one repository stay tellable apart. Filled in by the
     *  scan below (an origin-less checkout keeps the empty string). */
    origin: '',
    kind,
    ...(submodulePath === undefined ? {} : { submodulePath }),
  }
}


/**
 * Every checkout registered as a submodule under `root`, at any depth.
 *
 * Git itself is the source of truth: `git submodule status --recursive` lists
 * the registered paths (relative to the parent repository) even for submodules
 * that were never initialised, and `--recursive` walks EVERY nesting level in
 * that one call — deeper entries arrive as fully qualified paths
 * ("outer/inner"), so one `status` per checkout is the whole discovery. (An
 * earlier revision also re-ran `status` inside every confirmed submodule; those
 * calls could only re-list checkouts the recursive pass had already reported,
 * which multiplied the process count on a workspace full of checkouts without
 * producing a single new row.) A path that is present on disk and passes
 * `rev-parse --show-toplevel` is a real, independent working tree — the parent
 * only ever sees it as one gitlink line, so this is what makes it selectable
 * as a repository of its own (the SourceTree behavior).
 *
 * The working-tree checks all run at once, because a repository with a dozen
 * submodules otherwise costs a dozen sequential processes on every scan.
 */
export async function collectSubmoduleRepos(root) {
  const found = []
  const listing = await runGit(root, ['submodule', 'status', '--recursive'])
  if (listing.code !== 0) return found
  const candidates = []
  for (const raw of listing.stdout.split('\n')) {
    if (candidates.length >= SUBMODULE_LIST_LIMIT) break
    const line = raw.replace(/\r$/, '')
    if (line.trim() === '') continue
    /* `<state><sha> <path> (<describe>)`: the state prefix is ' ', '+', '-' or 'U'. */
    const match = /^[\s+\-U]([0-9a-f]{4,64})\s+(.+?)(?:\s+\(.*\))?$/.exec(line)
    const rel = (match === null ? line.trim().replace(/^[\s+\-U]\S*\s+/, '') : match[2]).trim().replace(/\\/g, '/')
    if (rel === '') continue
    const absolute = path.resolve(root, rel)
    /* An uninitialised submodule has no `.git` yet: git still registers it, but
       there is no working tree to bind the panel to. */
    if (!existsSync(path.join(absolute, '.git'))) continue
    candidates.push({ absolute, rel })
  }
  const tops = await Promise.all(candidates.map((entry) => runGit(entry.absolute, ['rev-parse', '--show-toplevel'])))
  for (let index = 0; index < candidates.length; index += 1) {
    const top = tops[index]
    if (top.code !== 0) continue
    const reported = top.stdout.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    found.push({ root: reported === '' ? candidates[index].absolute : reported, rel: candidates[index].rel })
  }
  return found
}

/* The whole discovery pass is cached in-process per cwd: one scan walks the
   tree and spawns a git process per checkout, while the client re-POSTs `repos`
   on every panel mount — a warm answer is what keeps switching back to the Git
   page instant on a workspace full of checkouts. Entries are { at, rows };
   REPOS_CACHE_TTL_MS is a module-level `let` so tests can pin it to 0 and
   observe the always-rescan path.

   The cache is deliberately NOT invalidated when a write method succeeds:
   `repos` is a read-only discovery of which checkouts EXIST, and no write
   method changes that set — a commit or a new branch does not conjure a
   repository. A clone landing inside the 15s window simply stays invisible
   until the next scan; that is an accepted trade, the client's background
   refresh is the safety net. */

export const repoScanCache = new Map()

export let REPOS_CACHE_TTL_MS = 15000


export async function scanRepos(cwd) {
  const cached = repoScanCache.get(cwd)
  /* Hand back fresh row objects: the cache is shared by every caller, and a
     consumer that decorates or reorders what it received must not write
     through into the next request's answer. */
  if (cached !== undefined && Date.now() - cached.at < REPOS_CACHE_TTL_MS) {
    return { cached: true, rows: cached.rows.map((row) => ({ ...row })) }
  }
  const list = []
  const self = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  const isRepo = self.code === 0
  if (isRepo) {
    const top = self.stdout.trim()
    list.push(repoRow(top === '' ? cwd : top, undefined, 'workspace'))
  }
  for (const dir of findNestedRepos(cwd, 2)) list.push(repoRow(dir, undefined, 'nested'))
  /* Submodules of EVERY discovered checkout, not only a workspace that is one:
     a container workspace (a folder holding several checkouts — the usual
     shape of a multi-repo project) reaches its repositories through the rows
     above, and each of those may carry submodules of its own. Without this
     pass the picker lists `eis` but none of the eight checkouts under it.
     These rows are built LAST and the map below lets them win: the directory
     scan can reach the same checkout through a plain path (a submodule whose
     parent directory is not itself a repository), and the submodule row is the
     better one — its name carries the repo-relative path. */
  const roots = list.map((row) => row.path)
  const submoduleLists = await Promise.all(roots.map((root) => collectSubmoduleRepos(root)))
  for (const entries of submoduleLists) {
    for (const entry of entries) list.push(repoRow(entry.root, entry.rel, 'nested'))
  }
  const byIdentity = new Map()
  for (const row of list) byIdentity.set(pathIdentity(row.path), row)
  const rows = [...byIdentity.values()]
  rows.sort((a, b) => (a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === 'workspace' ? -1 : 1))
  const capped = rows.slice(0, REPO_LIST_LIMIT).map((row) => ({ ...row }))
  const branches = await Promise.all(capped.map((row) => branchOrNull(row.path)))
  for (let index = 0; index < capped.length; index += 1) capped[index].branch = branches[index]
  /* Origin names ride the same one-call-per-row pass as the branches: a local
     `git remote get-url` read, cheap, and the 15s cache means repeated picker
     opens pay for it once. */
  const origins = await Promise.all(capped.map((row) => originNameOf(row.path)))
  for (let index = 0; index < capped.length; index += 1) capped[index].origin = origins[index]
  repoScanCache.set(cwd, { at: Date.now(), rows: capped })
  return { cached: false, rows: capped.map((row) => ({ ...row })) }
}


/** Depth-capped search for repositories nested in a workspace. */
export function findNestedRepos(root, maxDepth) {
  const found = []
  const walk = (dir, depth) => {
    if (found.length >= 40 || depth > maxDepth) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || REPO_SCAN_SKIP.has(entry.name)) continue
      const child = path.join(dir, entry.name)
      if (existsSync(path.join(child, '.git'))) { found.push(child); continue }
      if (depth < maxDepth) walk(child, depth + 1)
    }
  }
  walk(root, 1)
  return found
}


export async function branchOrNull(root) {
  const result = await runGit(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  if (result.code !== 0) return null
  const name = result.stdout.trim()
  return name === '' ? null : name
}


/**
 * Repositories this panel may bind to: the session workspace itself when it is
 * one, repositories nested inside it (a sandbox holding many checkouts), and
 * the submodules of every checkout discovered that way — git records each
 * submodule as its own working tree with its own HEAD, index and branches, so
 * it is a repository the panel can bind to like any other. The client turns
 * this into the repo picker, and picking a row is all it takes: every later
 * call carries that path as `repoRoot`, which is the working directory the git
 * commands run in.
 */
export async function repos(payload) {
  const cwd = cwdOf(payload)
  const { cached, rows } = await scanRepos(cwd)
  /* `cached: true` rides a cache hit only; the client ignores it today, it just
     makes the answer say where it came from. */
  return { cwd, isRepo: rows.some((row) => row.kind === 'workspace'), repos: rows, ...(cached ? { cached: true } : {}) }
}


export async function version() {
  const result = await runGit(process.cwd(), ['--version'])
  const raw = result.code === 0 ? result.stdout.trim() : ''
  const match = /git version (\S+)/.exec(raw)
  return { git: match === null ? raw : match[1], available: result.code === 0 }
}
