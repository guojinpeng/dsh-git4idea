/**
 * dsh-git4idea — core / payload (host half, plain JavaScript).
 */

import path from 'node:path'
import { badRequest } from './errors.js'


/* ============================== payload helpers ============================== */

export function requireAbsolute(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(label + ' is required')
  if (!path.isAbsolute(value)) throw badRequest(label + ' must be an absolute path')
  return path.resolve(value)
}


/** A ref/branch/tag name: no whitespace, no leading dash, no control characters. */
export function requireRef(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(label + ' is required')
  const name = value.trim()
  if (name.startsWith('-')) throw badRequest(label + ' must not start with "-"')
  if (/[\u0000-\u001f\u007f\s]/.test(name)) throw badRequest(label + ' contains invalid characters')
  return name
}


export function optionalRevs(value, label) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw badRequest(label + ' must be an array')
  return value.map((entry) => requireRef(entry, label + ' entry'))
}


export function requireMessage(value) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest('message is required')
  return value
}


export function cwdOf(payload) {
  return requireAbsolute(payload === undefined ? undefined : payload.cwd, 'cwd')
}


export function requireRelativePath(value) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest('path is required')
  const trimmed = value.trim()
  if (path.isAbsolute(trimmed)) return trimmed
  if (trimmed.split('/').includes('..')) throw badRequest('path must stay inside the repository')
  return trimmed
}

export function requireUrl(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(label + ' is required')
  const text = value.trim()
  if (text.startsWith('-') === true || /[\s\u0000-\u001f]/.test(text) === true || text.length > 2048) {
    throw badRequest(label + ' is not a valid repository URL')
  }
  return text
}


export function optionalPaths(payload, label) {
  if (payload === undefined || payload[label] === undefined || payload[label] === null) return []
  if (!Array.isArray(payload[label])) throw badRequest(label + ' must be an array')
  if (payload[label].length > 5000) throw badRequest(label + ' has too many entries')
  return payload[label].map((entry) => requireRelativePath(entry))
}


export function clampInt(value, min, max, fallback) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/* ============================== ai commit message ============================== */
/* Issue #6: write the commit message with the session's own model route. The
   settings arrive WITH the request (the browser reads them from the same row
   Config document it renders), so a setting change takes effect on the next
   click without the host caching anything. */
