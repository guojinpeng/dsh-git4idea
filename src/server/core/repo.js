/**
 * dsh-git4idea — core / repo (host half, plain JavaScript).
 */

import { createHash } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
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


/** `git diff --numstat -z` -> Map(path -> { additions, deletions, binary }). */
export async function numstatOf(root, args) {
  const result = await runGit(root, ['diff', '--numstat', '-z', ...args])
  const map = new Map()
  if (result.code !== 0) return map
  const records = result.stdout.split('\u0000')
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === '') continue
    const firstTab = record.indexOf('\t')
    const secondTab = record.indexOf('\t', firstTab + 1)
    if (firstTab < 0 || secondTab < 0) continue
    const addRaw = record.slice(0, firstTab)
    const delRaw = record.slice(firstTab + 1, secondTab)
    let filePath = record.slice(secondTab + 1)
    if (filePath === '') {
      filePath = records[index + 1] === undefined ? '' : records[index + 1]
      index += 1
      const renamed = records[index + 1]
      if (renamed !== undefined && renamed !== '') index += 1
    }
    const binary = addRaw === '-' || delRaw === '-'
    map.set(filePath, {
      additions: binary ? 0 : Number.parseInt(addRaw, 10) || 0,
      deletions: binary ? 0 : Number.parseInt(delRaw, 10) || 0,
      binary,
    })
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


export async function stashCountOf(root) {
  const result = await runGit(root, ['rev-list', '--walk-reflogs', '--count', 'refs/stash'])
  if (result.code !== 0) return 0
  const count = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(count) ? count : 0
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
      current = { path: line.slice('worktree '.length), branch: null, head: null, detached: false, bare: false }
      continue
    }
    if (current === null) continue
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length).replace('refs/heads/', '')
    else if (line === 'detached') current.detached = true
    else if (line === 'bare') current.bare = true
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
