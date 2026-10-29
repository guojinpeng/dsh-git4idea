/**
 * dsh-git4idea — services / undo-ops (host half, plain JavaScript).
 */

import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PanelError } from './../core/errors.js'
import { runGit, git } from './../core/git.js'
import { requireRef, cwdOf } from './../core/payload.js'
import { repoRootOf } from './../core/repo.js'
import { undoStacks, undoEntriesOf, snapshotState } from './../core/undo.js'


/** What this repository can still undo right now (newest last). */
export async function undoList(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const items = undoEntriesOf(root).map((entry) => ({ id: entry.id, kind: entry.kind, label: entry.label, at: entry.at }))
  return { items }
}


/**
 * Undo one remembered action. Nothing here is a 'soft delete': the branch (or
 * stash entry) really was gone, and the undo recreates it from the object id
 * recorded before the deletion; a discard really overwrote the working tree,
 * and the undo writes the snapshotted bytes back. It is one-shot and fails
 * loudly when the world moved on — the name is taken again, or the discarded
 * files were edited since.
 */
export async function undoApply(payload) {
  const cwd = cwdOf(payload)
  const root = await repoRootOf(cwd, payload)
  const id = requireRef(payload.id, 'id')
  const list = undoEntriesOf(root)
  const index = list.findIndex((entry) => entry.id === id)
  if (index < 0) throw new PanelError('undo-gone', 'this action can no longer be undone', 409)
  const entry = list[index]
  if (entry.kind === 'branch-delete') {
    /* Batch handles carry `branches: [{name, hash}]`; older single-branch
       handles only have `name`/`hash` — normalise both to one list. */
    const restores = Array.isArray(entry.branches) ? entry.branches : [{ name: entry.name, hash: entry.hash }]
    for (const item of restores) {
      const exists = await runGit(root, ['show-ref', '--verify', '--quiet', 'refs/heads/' + item.name])
      if (exists.code === 0) throw new PanelError('undo-conflict', 'branch "' + item.name + '" already exists again', 409)
      await git(root, ['branch', item.name, item.hash])
    }
  } else if (entry.kind === 'stash-drop') {
    await git(root, ['stash', 'store', '-m', 'dsh-git4idea: restored ' + entry.label, entry.hash])
  } else if (entry.kind === 'discard') {
    // Refuse to trample anything typed since the discard: every target must
    // still look exactly the way the discard left it.
    const now = snapshotState(root, entry.files)
    for (let position = 0; position < now.length; position += 1) {
      if (now[position].hash !== entry.after[position].hash) {
        throw new PanelError('undo-conflict', 'these files changed after the discard', 409)
      }
    }
    for (const file of entry.files) {
      const target = path.join(root, file.rel)
      if (file.data === null) {
        // The file was absent before the discard: absent is what we restore.
        try { unlinkSync(target) } catch { /* already gone */ }
        continue
      }
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, file.data)
    }
  } else {
    throw new PanelError('undo-unsupported', 'this action cannot be undone', 500)
  }
  list.splice(index, 1)
  undoStacks.set(root, list)
  return { kind: entry.kind, label: entry.label }
}
