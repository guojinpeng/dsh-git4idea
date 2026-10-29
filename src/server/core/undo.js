/**
 * dsh-git4idea — core / undo (host half, plain JavaScript).
 */

import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { logError } from './home.js'
import { hashOf, relInside } from './repo.js'

export const UNDO_LIMIT = 20

export const UNDO_TTL_MS = 30 * 60 * 1000

export const undoStacks = new Map()

export let undoSeq = 0


/** Branches whose deletion is never a routine action. */
export const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk'])


export function undoEntriesOf(root) {
  const stored = undoStacks.get(root) === undefined ? [] : undoStacks.get(root)
  const alive = stored.filter((entry) => Date.now() - entry.at < UNDO_TTL_MS)
  if (alive.length !== stored.length) undoStacks.set(root, alive)
  return alive
}


export function pushUndo(root, entry) {
  const list = undoEntriesOf(root)
  undoSeq += 1
  const record = Object.assign({ id: 'u' + undoSeq.toString(36) + Date.now().toString(36), at: Date.now() }, entry)
  list.push(record)
  while (list.length > UNDO_LIMIT) list.shift()
  undoStacks.set(root, list)
  return { id: record.id, kind: record.kind, label: record.label }
}

/* Undoing a discard means writing the old bytes back, so the host has to keep
   them: a checkout/clean is the one moment they still exist. Snapshots stay
   deliberately conservative — regular files only, capped in count and in total
   size — and anything that cannot be reproduced faithfully (a symlink, a
   special file, a huge tree) yields NO undo handle at all rather than a promise
   the host cannot keep. */

export const UNDO_MAX_FILES = 400

export const UNDO_MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024


/**
 * Read every regular file the given paths cover (each path may be a file or a
 * directory). Returns null when the snapshot would not be faithful, which makes
 * the caller skip the undo handle instead of offering one it cannot honour.
 */
export function snapshotForUndo(root, paths) {
  const files = []
  let bytes = 0
  const collect = (target) => {
    const rel = relInside(root, target)
    if (rel === null) return true
    let stat
    try {
      stat = lstatSync(target)
    } catch (error) {
      // Already gone ('D' in the working tree) is itself a state worth undoing
      // to, so record the absence. Any other failure is not ours to guess at.
      if (error.code === 'ENOENT') { files.push({ rel: rel, data: null }); return true }
      logError('undo:lstat', error)
      return false
    }
    if (stat.isSymbolicLink()) return false
    if (stat.isDirectory()) {
      if (path.basename(target) === '.git') return true
      let names
      try { names = readdirSync(target) } catch (error) { logError('undo:readdir', error); return false }
      for (const name of names) if (!collect(path.join(target, name))) return false
      return true
    }
    if (!stat.isFile()) return false
    if (files.length >= UNDO_MAX_FILES) return false
    let data
    try { data = readFileSync(target) } catch { return false }
    bytes += data.length
    if (bytes > UNDO_MAX_SNAPSHOT_BYTES) return false
    files.push({ rel: rel, data: data })
    return true
  }
  for (const entry of paths) if (!collect(path.resolve(root, entry))) return null
  return files
}


/**
 * The shape the snapshot targets have right now: a content hash, or null when
 * the path is absent. The undo compares against this before writing anything,
 * so content typed after the discard is never silently overwritten.
 */
export function snapshotState(root, files) {
  return files.map((file) => {
    try {
      return { rel: file.rel, hash: hashOf(readFileSync(path.join(root, file.rel))) }
    } catch {
      return { rel: file.rel, hash: null }
    }
  })
}
