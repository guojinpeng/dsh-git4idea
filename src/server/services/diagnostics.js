/**
 * dsh-git4idea — services / diagnostics (host half, plain JavaScript).
 */

import { PLUGIN_LOG_FILE, logError, PLUGIN_SETTINGS_FILE, readPluginSettings, writePluginSettings, isSettingsKey } from './../core/home.js'
import { PanelError } from './../core/errors.js'
import { GIT_LOG_MAX_ENTRIES, gitLog } from './../core/git.js'
import { log } from './history.js'


/* The tail of the git run ring buffer (see runGit). Read-only, global. */
export async function gitLogs() {
  return { entries: gitLog.slice(-GIT_LOG_MAX_ENTRIES) }
}

export async function clientError(payload) {
  const scope = typeof payload.scope === 'string' ? payload.scope.slice(0, 64) : 'unknown'
  const message = typeof payload.message === 'string' ? payload.message.slice(0, 4000) : 'client error'
  const stack = typeof payload.stack === 'string' ? '\n' + payload.stack.slice(0, 12000) : ''
  logError('client:' + scope, message + stack)
  return { logged: true, log: PLUGIN_LOG_FILE }
}

/* First paint needs the settings synchronously, so the panel reads them in one
   call before it mounts. A missing file is an empty object, never an error. */

export async function configGet() {
  return { state: readPluginSettings(), file: PLUGIN_SETTINGS_FILE }
}

/* One key per call: the panel writes a setting the moment the user changes it,
   and a whole-file write would let two tabs drop each other's values. A null
   value removes the key. */

export async function configSet(payload) {
  if (isSettingsKey(payload.key) !== true) throw new PanelError('bad-key', 'invalid settings key', 400)
  const state = readPluginSettings()
  if (payload.value === null || payload.value === undefined) delete state[payload.key]
  else if (typeof payload.value === 'string') state[payload.key] = payload.value
  else throw new PanelError('bad-value', 'invalid settings value', 400)
  writePluginSettings(state)
  return { saved: true, file: PLUGIN_SETTINGS_FILE }
}
