/**
 * dsh-git4idea — services / conflicts (host half, plain JavaScript).
 *
 * Merge conflicts stop git in the middle of an operation. This module reads
 * the three index stages of one path, writes the edited file back, settles a
 * path by keeping one stage, and finishes or aborts the operation that
 * stopped. Saving never stages the file: the user decides when it is resolved.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { badRequest, PanelError } from './../core/errors.js'
import { runGit, git } from './../core/git.js'
import { cwdOf, requireRelativePath } from './../core/payload.js'
import { repoRootOf, relInside, operationOf, hashOf } from './../core/repo.js'


/* The request body is capped at 1 MiB, and one detail answer carries up to four
   versions of the file — 256 KiB each keeps a round trip well inside that. */
const MAX_EDIT_BYTES = 256 * 1024
const NUL = String.fromCharCode(0)
const LF = String.fromCharCode(10)
const CRLF = String.fromCharCode(13) + LF
const TAB = String.fromCharCode(9)


/* ============================== helpers ============================== */

/** The repo-relative POSIX path and the absolute path of one payload path. */
function targetOf(root, payload) {
  const given = requireRelativePath(payload.path)
  const absolute = path.isAbsolute(given) ? path.resolve(given) : path.join(root, given)
  const rel = relInside(root, absolute)
  if (rel === null) throw badRequest('path must stay inside the repository')
  return { rel: rel, absolute: absolute }
}


/** The unmerged stages of one path: {1: {mode, sha}|null, 2: ..., 3: ...}. */
async function stagesOf(root, rel) {
  const result = await runGit(root, ['ls-files', '-u', '-z', '--', rel])
  if (result.code !== 0) {
    const detail = result.stderr.trim()
    throw new PanelError('git-failed', detail === '' ? 'git ls-files -u failed' : detail, 409)
  }
  const stages = { 1: null, 2: null, 3: null }
  for (const record of result.stdout.split(NUL)) {
    if (record === '') continue
    const tab = record.indexOf(TAB)
    if (tab < 0) continue
    const parts = record.slice(0, tab).split(' ')
    const file = record.slice(tab + 1)
    if (file !== rel || parts.length !== 3) continue
    const stage = parts[2]
    if (stage === '1' || stage === '2' || stage === '3') stages[stage] = { mode: parts[0], sha: parts[1] }
  }
  return stages
}


/** A stage blob as bytes; null when the stage does not exist. */
async function blobOf(root, stage, rel) {
  const result = await runGit(root, ['show', ':' + stage + ':' + rel])
  if (result.code !== 0) return null
  return result.stdoutBuffer
}


function isBinary(buffer) {
  return buffer !== null && buffer.indexOf(0) !== -1
}


/** The dominant line ending of the working copy: the editor sends LF back. */
function eolOf(buffer) {
  let crlf = 0
  let lf = 0
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] !== 0x0a) continue
    if (index > 0 && buffer[index - 1] === 0x0d) crlf += 1
    else lf += 1
  }
  return crlf > lf ? 'crlf' : 'lf'
}


function clip(buffer) {
  return buffer.subarray(0, MAX_EDIT_BYTES).toString('utf8')
}


/** True when a line starts with a conflict marker (diff3 adds |||||||). */
function hasMarkers(text) {
  for (const line of text.split(LF)) {
    const head = line.slice(0, 7)
    if (head !== '<'.repeat(7) && head !== '='.repeat(7) && head !== '>'.repeat(7) && head !== '|'.repeat(7)) continue
    const next = line.charAt(7)
    if (next === '' || next === ' ' || next === TAB) return true
  }
  return false
}


/* ============================== methods ============================== */

/**
 * Everything the conflict editor needs for one path: which stages exist, the
 * working text, and the three versions for the comparison pane.
 */
export async function conflictDetail(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const target = targetOf(root, payload)
  const stages = await stagesOf(root, target.rel)
  const unmerged = stages[1] !== null || stages[2] !== null || stages[3] !== null
  if (!unmerged) throw new PanelError('conflict-not-unmerged', 'this path has no merge conflict', 409)
  const exists = fs.existsSync(target.absolute)
  let workingBuffer = null
  if (exists) {
    /* A directory, a symlink or a submodule has no text to edit: report the
       path without pretending it is a file. */
    const stat = fs.lstatSync(target.absolute)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      return {
        path: target.rel, exists: exists, unmerged: true, binary: true, eol: 'lf',
        size: 0, truncated: false, editable: false, hasMarkers: false, sha1: null,
        stages: { base: stages[1] !== null, ours: stages[2] !== null, theirs: stages[3] !== null },
        working: null, base: null, ours: null, theirs: null,
      }
    }
    workingBuffer = fs.readFileSync(target.absolute)
  }
  const baseBuffer = stages[1] === null ? null : await blobOf(root, 1, target.rel)
  const oursBuffer = stages[2] === null ? null : await blobOf(root, 2, target.rel)
  const theirsBuffer = stages[3] === null ? null : await blobOf(root, 3, target.rel)
  const binary = isBinary(workingBuffer) || isBinary(baseBuffer) || isBinary(oursBuffer) || isBinary(theirsBuffer)
  const size = workingBuffer === null ? 0 : workingBuffer.length
  const truncated = size > MAX_EDIT_BYTES
  const editable = exists && binary === false && truncated === false
  const working = workingBuffer === null || binary ? null : clip(workingBuffer)
  return {
    path: target.rel,
    exists: exists,
    unmerged: true,
    binary: binary,
    eol: workingBuffer === null ? 'lf' : eolOf(workingBuffer),
    size: size,
    truncated: truncated,
    editable: editable,
    hasMarkers: working !== null && hasMarkers(working),
    sha1: workingBuffer === null ? null : hashOf(workingBuffer),
    stages: { base: stages[1] !== null, ours: stages[2] !== null, theirs: stages[3] !== null },
    working: working,
    base: baseBuffer === null || binary ? null : clip(baseBuffer),
    ours: oursBuffer === null || binary ? null : clip(oursBuffer),
    theirs: theirsBuffer === null || binary ? null : clip(theirsBuffer),
  }
}


/**
 * Write the edited working copy back. The file must still be unmerged and must
 * still hold the bytes the editor started from (expectSha1), or a rebase in
 * another window is overwritten blind.
 */
export async function conflictSave(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const target = targetOf(root, payload)
  if (typeof payload.text !== 'string') throw badRequest('text is required')
  if (Buffer.byteLength(payload.text, 'utf8') > MAX_EDIT_BYTES) throw badRequest('text is too large to edit here')
  const stages = await stagesOf(root, target.rel)
  if (stages[1] === null && stages[2] === null && stages[3] === null) {
    throw new PanelError('conflict-not-unmerged', 'this path has no merge conflict', 409)
  }
  if (!fs.existsSync(target.absolute)) throw new PanelError('conflict-deleted', 'the working file no longer exists', 409)
  const current = fs.readFileSync(target.absolute)
  if (typeof payload.expectSha1 === 'string' && payload.expectSha1 !== '' && hashOf(current) !== payload.expectSha1) {
    throw new PanelError('conflict-stale', 'the file changed on disk since it was opened', 409)
  }
  /* HTML normalises a textarea's value to LF; the file on disk may be CRLF
     (core.autocrlf=true is the Windows default) and must stay that way. */
  const eol = eolOf(current)
  const lf = payload.text.split(CRLF).join(LF)
  const next = eol === 'crlf' ? lf.split(LF).join(CRLF) : lf
  fs.writeFileSync(target.absolute, next, 'utf8')
  return { saved: true, eol: eol, hasMarkers: hasMarkers(lf), sha1: hashOf(Buffer.from(next, 'utf8')) }
}


/**
 * Settle one path: keep the working copy (git add), or take one stage. When a
 * side deleted the file, taking that side removes it (`git rm`), which is how
 * modify/delete conflicts are settled.
 */
export async function conflictResolve(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const target = targetOf(root, payload)
  const side = payload.side === 'ours' || payload.side === 'theirs' ? payload.side : 'worktree'
  const stages = await stagesOf(root, target.rel)
  if (side === 'worktree') {
    await git(root, ['add', '-A', '--', target.rel])
    return { resolved: true, removed: fs.existsSync(target.absolute) === false, side: side }
  }
  const stage = side === 'ours' ? 2 : 3
  if (stages[stage] !== null) {
    await git(root, ['checkout', '--' + side, '--', target.rel])
    await git(root, ['add', '-A', '--', target.rel])
    return { resolved: true, removed: false, side: side }
  }
  /* The chosen side has no stage: that side deletes the file. */
  if (fs.existsSync(target.absolute)) await git(root, ['rm', '-f', '--', target.rel])
  else await git(root, ['add', '-A', '--', target.rel])
  return { resolved: true, removed: true, side: side }
}


/* The commit whose version the "theirs" pane holds: a merge records
   MERGE_HEAD, a rebase or cherry-pick its own head, a revert REVERT_HEAD. */
const THEIRS_REFS = ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']


/**
 * One pane annotated with git blame: the commit that last touched each line of
 * the file version that pane shows. The side panes blame their own stage's
 * commit; the result pane has no commit, so its text is blamed against HEAD and
 * lines that HEAD does not hold come back as uncommitted.
 */
export async function conflictBlame(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const target = targetOf(root, payload)
  const side = payload.side === 'ours' || payload.side === 'theirs' ? payload.side : 'result'
  let rev = 'HEAD'
  if (side === 'theirs') {
    for (const ref of THEIRS_REFS) {
      const found = await runGit(root, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'])
      if (found.code === 0) { rev = ref; break }
    }
  }
  const args = ['blame', '--line-porcelain', '--no-progress']
  let temp = null
  if (side === 'result') {
    if (typeof payload.text !== 'string') throw badRequest('text is required')
    if (Buffer.byteLength(payload.text, 'utf8') > MAX_EDIT_BYTES) throw badRequest('text is too large to annotate here')
    temp = path.join(os.tmpdir(), 'dsh-git4idea-blame-' + String(process.pid) + '-' + String(Date.now()) + '.txt')
    fs.writeFileSync(temp, payload.text.split(CRLF).join(LF), 'utf8')
    args.push('--contents', temp)
  }
  args.push(rev, '--', target.rel)
  let result
  try {
    result = await runGit(root, args)
  } finally {
    if (temp !== null) { try { fs.unlinkSync(temp) } catch (error) { void error } }
  }
  if (result.code !== 0) {
    const detail = result.stderr.trim()
    throw new PanelError('git-failed', detail === '' ? 'git blame failed' : detail, 409)
  }
  const [user, mail] = await Promise.all([
    runGit(root, ['config', 'user.name']),
    runGit(root, ['config', 'user.email']),
  ])
  const userName = user.code === 0 ? user.stdout.trim() : ''
  const userMail = mail.code === 0 ? mail.stdout.trim() : ''
  const lines = []
  let current = null
  for (const raw of result.stdout.split(LF)) {
    if (raw.charCodeAt(0) === 9) {
      if (current !== null) {
        const uncommitted = current.sha === '0'.repeat(40)
        lines.push({
          sha: uncommitted === true ? null : current.sha,
          short: uncommitted === true ? null : current.sha.slice(0, 8),
          author: uncommitted === true && userName !== '' ? userName : current.author,
          email: uncommitted === true && userMail !== '' ? userMail : current.email,
          date: blameDate(current.time, current.tz),
          stamp: blameStamp(current.time, current.tz),
          subject: uncommitted === true ? '' : current.subject,
          uncommitted: uncommitted,
        })
        current = null
      }
      continue
    }
    if (raw === '') continue
    if (/^[0-9a-f]{40} [0-9]+ [0-9]+/.test(raw)) {
      current = { sha: raw.slice(0, 40), author: '', email: '', time: 0, tz: '+0000', subject: '' }
      continue
    }
    if (current === null) continue
    if (raw.startsWith('author ')) current.author = raw.slice(7)
    else if (raw.startsWith('author-mail ')) current.email = raw.slice(12).trim().replace(/^</, '').replace(/>$/, '')
    else if (raw.startsWith('summary ')) current.subject = raw.slice(8)
    else if (raw.startsWith('author-time ')) current.time = Number(raw.slice(12))
    else if (raw.startsWith('author-tz ')) current.tz = raw.slice(10)
  }
  return { side: side, rev: rev, lines: lines }
}


/** The commit date of a blame record, in the author's own offset. */
function blameDate(time, tz) {
  const at = blameClock(time, tz)
  return at.getUTCFullYear() + '/' + String(at.getUTCMonth() + 1) + '/' + String(at.getUTCDate())
}


/** The same instant with its time of day, for the hover detail. */
function blameStamp(time, tz) {
  const at = blameClock(time, tz)
  const pad = (value) => (value < 10 ? '0' : '') + String(value)
  return blameDate(time, tz) + ' ' + pad(at.getUTCHours()) + ':' + pad(at.getUTCMinutes())
}


function blameClock(time, tz) {
  const sign = tz.charAt(0) === '-' ? -1 : 1
  const hours = Number(tz.slice(1, 3))
  const minutes = Number(tz.slice(3, 5))
  const offset = Number.isFinite(hours) && Number.isFinite(minutes) ? sign * (hours * 3600 + minutes * 60) : 0
  return new Date((time + offset) * 1000)
}


const OPERATION_ACTIONS = {
  merge: ['continue', 'abort'],
  rebase: ['continue', 'abort', 'skip'],
  'cherry-pick': ['continue', 'abort', 'skip'],
  revert: ['continue', 'abort', 'skip'],
}


/**
 * Finish the operation that stopped on a conflict. The client names the
 * operation it saw; the host re-reads the markers and refuses when they no
 * longer agree (another window already aborted, for instance).
 */
export async function operationFinish(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const allowed = OPERATION_ACTIONS[payload.operation]
  if (allowed === undefined) throw badRequest('operation must be merge, rebase, cherry-pick or revert')
  const action = payload.action
  if (allowed.includes(action) !== true) {
    throw badRequest('action must be one of ' + allowed.join(', ') + ' for ' + payload.operation)
  }
  const current = await operationOf(root)
  if (current !== payload.operation) {
    throw new PanelError('operation-mismatch', current === null ? 'no operation is in progress' : 'the operation in progress is ' + current, 409)
  }
  if (action === 'continue') {
    const unmerged = await runGit(root, ['ls-files', '-u', '-z'])
    if (unmerged.code !== 0) throw new PanelError('git-failed', 'git ls-files -u failed', 409)
    if (unmerged.stdout !== '') throw new PanelError('conflict-unresolved', 'resolve every conflict first', 409)
  }
  const result = await runGit(root, [payload.operation, '--' + action])
  const output = (result.stdout + LF + result.stderr).trim()
  if (result.code !== 0) {
    throw new PanelError('git-failed', output === '' ? payload.operation + ' --' + action + ' failed' : output, 409)
  }
  return { done: true, operation: payload.operation, action: action, output: output }
}
