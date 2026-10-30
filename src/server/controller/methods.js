/**
 * dsh-git4idea — controller / methods (host half, plain JavaScript).
 */

import { summary, headState, pushPreview, stats, repos, version } from './../services/workspace.js'
import { branches, log, me, mergePoint, commitDetail, diff, compare, dirTree } from './../services/history.js'
import { stage, unstage, discard, commit, checkout } from './../services/changes.js'
import { branchCreate, branchUpstream, branchRename, branchDelete, merge, rebase, rebaseAbort, remoteAdd, remoteRemove, branchDeleteRemote, tagDeleteRemote, pushTags, stashClear, cherryPick, revert, reset } from './../services/branch-ops.js'
import { fetch, pull, push, clone } from './../services/sync.js'
import { stashList, stashPush, stashApply, stashDrop, tagCreate, tagDelete } from './../services/stash.js'
import { undoList, undoApply } from './../services/undo-ops.js'
import { commitMessage } from './../services/ai.js'
import { gitLogs, clientError, configGet, configSet, consoleLog, consoleClear } from './../services/diagnostics.js'
import { worktreeList, worktreeAdd, worktreeRemove } from './../services/worktrees.js'
import { conflictDetail, conflictSave, conflictResolve, conflictBlame, operationFinish } from './../services/conflicts.js'


export const METHODS = {
  version,
  'client-error': clientError,
  'config-get': configGet,
  'config-set': configSet,
  'commit-message': commitMessage,
  repos,
  summary,
  head: headState,
  'push-preview': pushPreview,
  stats,
  branches,
  log,
  dirTree,
  me,
  'merge-point': mergePoint,
  commitDetail,
  diff,
  compare,
  stage,
  unstage,
  discard,
  commit,
  checkout,
  branchCreate,
  branchRename,
  'branch-upstream': branchUpstream,
  branchDelete,
  merge,
  rebase,
  cherryPick,
  revert,
  reset,
  fetch,
  pull,
  push,
  stashList,
  stashPush,
  stashApply,
  stashDrop,
  tagCreate,
  tagDelete,
  tagDeleteRemote,
  pushTags,
  clone,
  gitLogs,
  consoleLog,
  consoleClear,
  worktreeList,
  worktreeAdd,
  worktreeRemove,
  remoteAdd,
  remoteRemove,
  branchDeleteRemote,
  rebaseAbort,
  stashClear,
  undoList,
  undoApply,
  conflictDetail,
  conflictSave,
  conflictResolve,
  conflictBlame,
  operationFinish,
}
