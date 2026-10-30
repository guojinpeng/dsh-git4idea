/**
 * dsh-git4idea — core / locks (host half, plain JavaScript).
 */


/* ============================== safety ============================== */

/**
 * Write operations on one repository run one at a time. The client greys its
 * actions out while a request is in flight, but a stale tab, a second window or
 * a double click could still start two writers, and git dislikes concurrent
 * index writers — so the host serialises writes per repository.
 */
export const repoQueues = new Map()


export function withRepoLock(key, work) {
  const previous = repoQueues.get(key) === undefined ? Promise.resolve() : repoQueues.get(key)
  const next = previous.then(work, work)
  const settled = next.then(() => undefined, () => undefined)
  repoQueues.set(key, settled)
  settled.then(() => { if (repoQueues.get(key) === settled) repoQueues.delete(key) })
  return next
}


export const WRITE_METHODS = new Set([
  'stage', 'unstage', 'discard', 'commit', 'checkout', 'branchCreate', 'branchRename', 'branch-upstream',
  'branchDelete', 'merge', 'rebase', 'cherryPick', 'revert', 'reset', 'fetch', 'pull',
  'push', 'stashPush', 'stashApply', 'stashDrop', 'stashClear', 'tagCreate', 'tagDelete', 'tagDeleteRemote', 'pushTags', 'clone', 'remoteAdd', 'remoteRemove', 'branchDeleteRemote', 'undoApply',
  'worktreeAdd', 'worktreeRemove',
  'rebaseAbort', 'conflictSave', 'conflictResolve', 'operationFinish',
])


export function lockKeyOf(payload) {
  if (typeof payload.repoRoot === 'string' && payload.repoRoot !== '') return payload.repoRoot
  if (typeof payload.cwd === 'string' && payload.cwd !== '') return payload.cwd
  return 'global'
}

/* Deleting is a real delete — but the host remembers how to bring it back for a
   while, so the panel can offer an undo. Entries are per repository, newest
   last, capped and time-limited. */
