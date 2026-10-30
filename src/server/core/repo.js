/**
 * dsh-git4idea — core / repo (host half, plain JavaScript).
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { PanelError } from './errors.js'
import { RECORD_SEP, FIELD_SEP, runGit, git } from './git.js'
import { requireAbsolute } from './payload.js'


/* ============================== git reads ============================== */

export async function repoRootOf(cwd, payload) {
  /* Normalize the separator: `rev-parse --show-toplevel` spells drive paths
     with forward slashes on Windows while path.join produces backslashes, so
     the untracked-diff fence (root + path.sep prefix check) rejected every
     in-repo path there. macOS/Linux are byte-identical no-ops. */
  if (payload !== undefined && payload.repoRoot !== undefined) return path.normalize(requireAbsolute(payload.repoRoot, 'repoRoot'))
  const result = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (result.code !== 0) {
    // A workspace that is not a repository is a normal state, not a failure:
    // the client answers it with a repo picker instead of an error banner.
    throw new PanelError('not-a-repo', 'not a git repository: ' + cwd, 409)
  }
  const top = result.stdout.trim()
  return path.normalize(top === '' ? cwd : top)
}


export async function currentBranchOf(root) {
  const name = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
  return name
}


export async function upstreamOf(root, branch) {
  const result = await runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', branch + '@{u}'])
  if (result.code !== 0) return null
  const name = result.stdout.trim()
  return name === '' ? null : name
}


export async function aheadBehindOf(root, upstream, branch) {
  if (upstream === null) return { ahead: 0, behind: 0 }
  const result = await runGit(root, ['rev-list', '--left-right', '--count', upstream + '...' + branch])
  if (result.code !== 0) return { ahead: 0, behind: 0 }
  const parts = result.stdout.trim().split(/\s+/)
  const behind = Number.parseInt(parts[0], 10)
  const ahead = Number.parseInt(parts[1], 10)
  return { ahead: Number.isFinite(ahead) ? ahead : 0, behind: Number.isFinite(behind) ? behind : 0 }
}


/** Parse `git status --porcelain=v1 -z` (NUL separated, rename pairs follow). */
export function parsePorcelain(stdout) {
  const records = stdout.split('\u0000')
  const entries = []
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record.length < 4) continue
    const x = record[0]
    const y = record[1]
    const filePath = record.slice(3)
    let origPath
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      const next = records[index + 1]
      if (next !== undefined && next !== '') {
        origPath = next
        index += 1
      }
    }
    entries.push({ x, y, path: filePath, origPath })
  }
  return entries
}


export function classify(entries) {
  const staged = []
  const unstaged = []
  const untracked = []
  const conflicted = []
  for (const entry of entries) {
    const pair = entry.x + entry.y
    if (pair === '??') { untracked.push(entry); continue }
    if (pair === '!!') continue
    if (pair === 'DD' || pair === 'AU' || pair === 'UD' || pair === 'UA' || pair === 'DU' || pair === 'AA' || pair === 'UU') {
      conflicted.push(entry)
      continue
    }
    if (entry.x !== ' ' && entry.x !== '?') staged.push(entry)
    if (entry.y !== ' ' && entry.y !== '?') unstaged.push(entry)
  }
  return { staged, unstaged, untracked, conflicted }
}


/** An ignored tree can be enormous, and this list is informational only. */
export const MAX_IGNORED_ENTRIES = 500


/**
 * Ignored paths, asked for on their own. `git status -uall --ignored` expands
 * every file inside an ignored directory — node_modules alone would flood the
 * panel — while `ls-files --directory` reports the directory as a single entry.
 */
export async function ignoredEntriesOf(root) {
  const result = await runGit(root, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'])
  if (result.code !== 0) return { entries: [], truncated: false }
  const paths = result.stdout.split('\u0000').filter((entry) => entry !== '')
  const kept = paths.slice(0, MAX_IGNORED_ENTRIES)
  return {
    entries: kept.map((filePath) => ({ index: '!', worktree: '!', path: filePath })),
    truncated: paths.length > kept.length,
  }
}


/**
 * `git diff/show --numstat -z` -> file records. A rename record is
 * `add\tdel\t\0old-path\0new-path\0`: the empty path is followed by the two
 * names, and the new one is what `git status` reports, so it is the key that
 * matches the change list.
 */
export function parseNumstat(stdout) {
  const files = []
  const records = stdout.split('\u0000')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === '') continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    let filePath = record.slice(secondTab + 1)
    let origPath
    if (filePath === '') {
      origPath = records[index + 1]
      filePath = records[index + 2]
      index += 2
    }
    const addRaw = record.slice(0, firstTab)
    const delRaw = record.slice(firstTab + 1, secondTab)
    const binary = addRaw === '-' || delRaw === '-'
    files.push({
      path: filePath === undefined ? '' : filePath,
      origPath: origPath === undefined || origPath === '' ? undefined : origPath,
      additions: binary ? 0 : Number.parseInt(addRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(delRaw, 10) || 0,
      binary,
    })
  }
  return files
}


/** `git diff --numstat -z` -> Map(path -> { additions, deletions, binary }). */
export async function numstatOf(root, args) {
  const result = await runGit(root, ['diff', '--numstat', '-z', ...args])
  const map = new Map()
  if (result.code !== 0) return map
  for (const file of parseNumstat(result.stdout)) {
    map.set(file.path, { additions: file.additions, deletions: file.deletions, binary: file.binary })
  }
  return map
}


export function decorate(entries, numstat) {
  return entries.map((entry) => {
    const stat = numstat.get(entry.path)
    return {
      path: entry.path,
      origPath: entry.origPath,
      index: entry.x,
      worktree: entry.y,
      additions: stat === undefined ? 0 : stat.additions,
      deletions: stat === undefined ? 0 : stat.deletions,
      binary: stat === undefined ? false : stat.binary,
    }
  })
}


/** Parse the FIELD_SEP/RECORD_SEP pretty format used by `log`/`show`. */
export function parseLog(stdout) {
  const commits = []
  for (const record of stdout.split(RECORD_SEP)) {
    const trimmed = record.replace(/^\n+/, '')
    if (trimmed.trim() === '') continue
    const parts = trimmed.split(FIELD_SEP)
    if (parts.length < 8) continue
    commits.push({
      hash: parts[0],
      shortHash: parts[1],
      parents: parts[2].trim() === '' ? [] : parts[2].trim().split(' '),
      author: parts[3],
      email: parts[4],
      date: parts[5],
      subject: parts[6],
      refs: parts[7].trim() === '' ? [] : parts[7].split(',').map((ref) => ref.trim()).filter((ref) => ref !== ''),
    })
  }
  return commits
}


export const LOG_FORMAT = '%H' + FIELD_SEP + '%h' + FIELD_SEP + '%P' + FIELD_SEP + '%an' + FIELD_SEP + '%ae' + FIELD_SEP + '%aI' + FIELD_SEP + '%s' + FIELD_SEP + '%D' + RECORD_SEP


/* `git stash list` prints one line per entry and exits 0 even with an empty
   stash. The reflog form (`rev-list --walk-reflogs --count refs/stash`) exits
   128 with "ambiguous argument 'refs/stash'" on a repository that never
   stashed — a fatal line per poll in the console for no useful data. */
export async function stashCountOf(root) {
  const result = await runGit(root, ['stash', 'list'])
  if (result.code !== 0) return 0
  return result.stdout.split('\n').filter((line) => line.trim() !== '').length
}


/** Same directory, tolerating a trailing slash and macOS /var vs /private/var. */
export function sameDirectory(left, right) {
  const one = path.resolve(String(left))
  const two = path.resolve(String(right))
  if (one === two) return true
  try { return realpathSync(one) === realpathSync(two) } catch { return false }
}


export async function worktreesOf(root) {
  const result = await runGit(root, ['worktree', 'list', '--porcelain'])
  if (result.code !== 0) return []
  const trees = []
  let current = null
  for (const line of result.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current !== null) trees.push(current)
      current = { path: line.slice('worktree '.length), branch: null, head: null, detached: false, bare: false, locked: false, lockReason: '' }
      continue
    }
    if (current === null) continue
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).replace('refs/heads/', '')
    else if (line === 'detached') current.detached = true
    else if (line === 'bare') current.bare = true
    else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true
      current.lockReason = line.slice('locked '.length).trim()
    }
  }
  if (current !== null) trees.push(current)
  return trees
}


export function hashOf(data) {
  return createHash('sha1').update(data).digest('hex')
}


/** Repo-relative POSIX path of a target, or null when it escapes the repo. */
export function relInside(root, target) {
  const rel = path.relative(root, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join('/')
}


/** The ref a merge brings in, from the message git prepared for its commit.
 *  merge/rebase/cherry-pick/revert leave MERGE_MSG behind; only a branch merge
 *  names a ref, and that is all the conflict card needs to label the sides. */
export async function operationSourceOf(root, operation) {
  if (operation !== 'merge') return null
  const result = await runGit(root, ['rev-parse', '--absolute-git-dir'])
  if (result.code !== 0) return null
  const gitDir = result.stdout.trim()
  if (gitDir === '') return null
  let text = ''
  try { text = readFileSync(path.join(gitDir, 'MERGE_MSG'), 'utf8') } catch (error) { void error; return null }
  const first = text.split('\n')[0].trim()
  const branch = /^Merge (?:remote-tracking )?branch '([^']+)'/.exec(first)
  if (branch !== null) return branch[1]
  const tag = /^Merge tag '([^']+)'/.exec(first)
  if (tag !== null) return tag[1]
  const commit = /^Merge commit '([0-9a-f]{7,40})'/.exec(first)
  return commit === null ? null : commit[1].slice(0, 8)
}


/** .git markers that mean a multi-step operation is still in progress. */
export async function operationOf(root) {
  const result = await runGit(root, ['rev-parse', '--absolute-git-dir'])
  if (result.code !== 0) return null
  const gitDir = result.stdout.trim()
  if (gitDir === '') return null
  const markers = [
    ['merge', 'MERGE_HEAD'],
    ['rebase', 'rebase-merge'],
    ['rebase', 'rebase-apply'],
    ['cherry-pick', 'CHERRY_PICK_HEAD'],
    ['revert', 'REVERT_HEAD'],
    ['bisect', 'BISECT_LOG'],
  ]
  for (const marker of markers) {
    if (existsSync(path.join(gitDir, marker[1]))) return marker[0]
  }
  return null
}

/* ============================== methods ============================== */

/* The repository's own name, cut from its origin URL — a cloned folder that
   was renamed on disk still reports the name the remote gave it (the leaf of
   the URL, minus a trailing .git). scp-style (user@host:path), URL-style and
   plain local paths all cut on the last slash or colon. */
