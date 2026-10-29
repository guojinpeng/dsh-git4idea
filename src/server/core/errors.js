/**
 * dsh-git4idea — core / errors (host half, plain JavaScript).
 */


/* ============================== errors ============================== */

export class PanelError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}


export function badRequest(message) {
  return new PanelError('bad-request', message, 400)
}


export function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
