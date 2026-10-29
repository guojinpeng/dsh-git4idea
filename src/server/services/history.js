/**
 * dsh-git4idea — services / history (host half, plain JavaScript).
 */

import path from 'node:path'
import { PanelError, badRequest } from './../core/errors.js'
import { MAX_DIFF_CHARS, RECORD_SEP, FIELD_SEP, runGit, git } from './../core/git.js'
import { requireRef, cwdOf, requireRelativePath, clampInt } from './../core/payload.js'
import { repoRootOf, currentBranchOf, aheadBehindOf, parseLog, parseNumstat, LOG_FORMAT, sameDirectory, worktreesOf } from './../core/repo.js'


export async function branches(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const branch = await currentBranchOf(root)
  const format = ['%(refname)', '%(refname:short)', '%(objectname)', '%(objectname:short)', '%(HEAD)', '%(upstream:short)', '%(committerdate:iso-strict)', '%(contents:subject)', '%(symref)'].join(FIELD_SEP)
  const out = await git(root, ['for-each-ref', '--format=' + format + RECORD_SEP, 'refs/heads', 'refs/remotes', 'refs/tags'])
  const local = []
  const remote = []
  const tags = []
  const worktrees = await worktreesOf(root)
  const busy = new Map()
  for (const tree of worktrees) {
    if (tree.branch === null || tree.branch === '') continue
    // `git worktree list` includes the checkout this repository lives in, so
    // without this the CURRENT branch was flagged as occupied by its own working
    // tree (reported on v0.3.11: main showed the marker while checked out here).
    // Only a SECOND working tree holding a branch blocks checking it out here.
    if (sameDirectory(tree.path, root)) continue
    busy.set(tree.branch, tree.path)
  }
  for (const record of out.split(RECORD_SEP)) {
    const trimmed = record.replace(/^\n+/, '')
    if (trimmed.trim() === '') continue
    const parts = trimmed.split(FIELD_SEP)
    if (parts.length < 9) continue
    const entry = {
      name: parts[1],
      hash: parts[2],
      shortHash: parts[3],
      head: parts[4] === '*',
      upstream: parts[5] === '' ? null : parts[5],
      date: parts[6],
      subject: parts[7],
      worktree: busy.get(parts[1]) === undefined ? null : busy.get(parts[1]),
      ahead: 0,
      behind: 0,
    }
    if (parts[0].startsWith('refs/heads/')) local.push(entry)
    else if (parts[0].startsWith('refs/remotes/')) {
      /* "<remote>/HEAD" is the symbolic pointer at a remote's default branch —
         its %(refname:short) collapses to the BARE remote name, so it is not a
         branch anyone can check out. It never becomes a row (the stray
         "<remote>" entry used to pollute the remote tree and, grouped, it also
         defeated the tree's single-remote prefix strip). */
      if (/^refs\/remotes\/[^/]+\/HEAD$/.test(parts[0]) === false) remote.push(entry)
    }
    else if (parts[0].startsWith('refs/tags/')) tags.push({ name: entry.name, hash: entry.hash, shortHash: entry.shortHash, date: entry.date, subject: entry.subject })
  }
  /* Read-only, so one process per branch can run together: a repository with
     dozens of branches otherwise pays dozens of sequential git starts. */
  await Promise.all(local.map(async (entry) => {
    if (entry.upstream === null) return
    const tracking = await aheadBehindOf(root, entry.upstream, entry.name)
    entry.ahead = tracking.ahead
    entry.behind = tracking.behind
  }))
  local.sort((a, b) => (a.head === b.head ? a.name.localeCompare(b.name) : a.head ? -1 : 1))
  remote.sort((a, b) => a.name.localeCompare(b.name))
  tags.sort((a, b) => a.name.localeCompare(b.name))
  const remotesOut = await runGit(root, ['remote'])
  const remotes = remotesOut.code === 0 ? remotesOut.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '') : []
  return { repoRoot: root, branch, local, remote, tags, remotes }
}


export async function log(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const limit = clampInt(payload.limit, 1, 500, 100)
  const skip = clampInt(payload.skip, 0, 1_000_000, 0)
  const args = ['log', '--max-count=' + (limit + 1), '--skip=' + skip, '--date-order', '--pretty=format:' + LOG_FORMAT]
  if (typeof payload.rev === 'string' && payload.rev.trim() !== '') args.push(requireRef(payload.rev, 'rev'))
  if (typeof payload.path === 'string' && payload.path.trim() !== '') args.push('--', payload.path)
  const out = await git(root, args)
  const all = parseLog(out)
  const hasMore = all.length > limit
  return { repoRoot: root, commits: hasMore ? all.slice(0, limit) : all, hasMore, skip, limit }
}
/* The merge that carried `from` INTO `to`, newest first — the anchor the
   branch tree's double-click-to-browse lands on (IDEA-style: double-click
   branch 2, then branch 1, and 1's list opens scrolled to the merge commit
   where 2 was merged in, so "2 has been merged here" is visible at a
   glance even though 1 kept moving. No merge relationship -> null, and the
   caller just opens the list at the top. Pure rev arithmetic, no network. */
/* Who am I here: git config resolves user.name/email through its usual
   cascade (repo-local overrides global), so the answer is per repository.
   The client caches it per repo root for the whole panel lifetime — a git
   identity rarely changes mid-session — and pins it to the top of the
   author filter (v0.19.3), even when this branch has no commits by me:
   picking it and seeing an empty list IS the answer ("I never committed
   here"). Empty strings mean no identity is configured. */

export async function me(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const name = await runGit(root, ['config', 'user.name'])
  const email = await runGit(root, ['config', 'user.email'])
  return {
    repoRoot: root,
    name: name.code === 0 ? name.stdout.trim() : '',
    email: email.code === 0 ? email.stdout.trim() : '',
  }
}


export async function mergePoint(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const from = requireRef(payload.from, 'from')
  const to = requireRef(payload.to, 'to')
  const out = await git(root, ['rev-list', '--merges', '--ancestry-path', '--max-count=1', from + '..' + to])
  const hash = out.trim().split('\n')[0] || ''
  return { repoRoot: root, hash: hash === '' ? null : hash }
}


export async function commitDetail(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const hash = requireRef(payload.hash, 'hash')
  const metaFormat = ['%H', '%h', '%P', '%an', '%ae', '%aI', '%s', '%b', '%D'].join(FIELD_SEP)
  const metaOut = await git(root, ['show', '-s', '--format=' + metaFormat, hash])
  const parts = metaOut.trim().split(FIELD_SEP)
  const parents = parts[2] === undefined || parts[2].trim() === '' ? [] : parts[2].trim().split(' ')
  /* Branches that CONTAIN the commit — IDEA's "in N branches" line. The two
     queries are independent, so they run together. for-each-ref sorts by
     refname, which already puts local heads before remote ones. */
  const [numstatOut, branchOut] = await Promise.all([
    git(root, ['show', '--numstat', '-z', '--format=', '-m', '--first-parent', hash]),
    runGit(root, ['for-each-ref', '--contains', hash, '--format=%(refname)', 'refs/heads', 'refs/remotes']),
  ])
  const files = parseNumstat(numstatOut)
  const branches = (branchOut.code === 0 ? branchOut.stdout.split('\n') : [])
    .map((name) => name.trim())
    .filter((name) => name.startsWith('refs/heads/') || name.startsWith('refs/remotes/'))
    /* origin/HEAD is a symbolic pointer at the remote's default branch, not a
       branch of its own: it would duplicate that branch in the list. */
    .filter((name) => name.endsWith('/HEAD') === false)
    .map((name) => name.replace(/^refs\/heads\//, '').replace(/^refs\/remotes\//, ''))
  return {
    hash: parts[0],
    shortHash: parts[1],
    parents,
    author: parts[3],
    email: parts[4],
    date: parts[5],
    subject: parts[6],
    body: parts[7] === undefined ? '' : parts[7],
    refs: parts[8] === undefined || parts[8].trim() === '' ? [] : parts[8].split(',').map((ref) => ref.trim()).filter((ref) => ref !== ''),
    branches,
    files,
  }
}


export async function diff(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  /* Untracked files have no index entry, so plain `git diff [--cached] -- path`
     is legitimately empty for them — the panel's change list still shows the
     file and the preview must not go blank. `--no-index /dev/null <file>`
     produces the honest "new file" patch; its exit code is 1 when differences
     exist, which is data, not failure (only >1 rejects). */
  if (payload.untracked === true) {
    const rel = requireRelativePath(payload.path)
    const absolute = path.isAbsolute(rel) ? rel : path.join(root, rel)
    /* --no-index reads the file for real, so unlike the plain `git diff --`
       form an absolute path must NOT be allowed to escape the repository. */
    if (absolute !== root && !absolute.startsWith(root + path.sep)) throw badRequest('path must stay inside the repository')
    /* git quotes and C-escapes backslash paths inside the diff header (and
       git ≥2.55 spells the a/ side with the real path instead of /dev/null);
       passing forward slashes keeps the header unquoted, so the rewrite below
       can match it verbatim. POSIX is a no-op. */
    const headerPath = absolute.split(path.sep).join('/')
    const result = await runGit(root, ['diff', '--no-color', '--no-ext-diff', '-U3', '--no-index', '--', '/dev/null', headerPath])
    if (result.code !== 0 && result.code !== 1) {
      const detail = result.stderr.trim() === '' ? result.stdout.trim() : result.stderr.trim()
      throw new PanelError('git-failed', 'git diff --no-index failed: ' + (detail === '' ? 'exit ' + result.code : detail), 409)
    }
    /* --no-index spells the b/ side with the absolute path we passed; rewrite
       the header lines back to the repository-relative spelling so the preview
       reads like every other patch (body lines are left untouched). */
    let out = result.stdout
    if (out.indexOf(headerPath) >= 0 && out.indexOf('\n') !== -1) {
      out = out.split('\n').map((line) => {
        if (line.startsWith('diff --git ') && line.indexOf(headerPath) >= 0) return 'diff --git a/' + rel + ' b/' + rel
        /* git ≥2.55 quotes the header and spells the a/ side with the real
           path instead of /dev/null, so match on the path, not the prefix. */
        if (line.startsWith('+++ ') && line.indexOf(headerPath) >= 0) return '+++ b/' + rel
        return line
      }).join('\n')
    }
    const truncated = out.length > MAX_DIFF_CHARS
    return { patch: truncated ? out.slice(0, MAX_DIFF_CHARS) : out, truncated }
  }
  const args = ['diff', '--no-color', '--no-ext-diff', '-U3']
  if (payload.staged === true) args.push('--cached')
  if (typeof payload.hash === 'string' && payload.hash.trim() !== '') {
    args.length = 0
    /* A merge commit has no patch of its own: plain `git show` prints the
       message and stops, so the panel's change list (which reads
       `show --numstat -m --first-parent`) had files to list while the diff pane
       said "no textual differences". -m --first-parent makes a merge diff
       against the branch it was merged INTO, the same side the file list and
       the IDE show (m02697 #1). */
    args.push('show', '--no-color', '--no-ext-diff', '-U3', '--format=', '-m', '--first-parent', requireRef(payload.hash, 'hash'))
  }
  if (typeof payload.path === 'string' && payload.path.trim() !== '') args.push('--', requireRelativePath(payload.path))
  const out = await git(root, args)
  const truncated = out.length > MAX_DIFF_CHARS
  return { patch: truncated ? out.slice(0, MAX_DIFF_CHARS) : out, truncated }
}


export async function compare(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const base = requireRef(payload.base, 'base')
  const head = requireRef(payload.head, 'head')
  const stat = await git(root, ['diff', '--numstat', '-z', base + '...' + head])
  const files = parseNumstat(stat)
  const logOut = await git(root, ['log', '--max-count=100', '--date-order', '--pretty=format:' + LOG_FORMAT, base + '..' + head])
  return { base, head, files, commits: parseLog(logOut) }
}
