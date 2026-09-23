/** Thrown when there is no valid session. Maps to HTTP 401. */
export class UnauthenticatedError extends Error {
  readonly code = 'unauthenticated'
  constructor() {
    super('unauthenticated')
    this.name = 'UnauthenticatedError'
  }
}

/** Thrown when the signed-in user lacks a permission. Maps to HTTP 403. */
export class ForbiddenError extends Error {
  readonly code = 'forbidden'
  constructor(readonly permission?: string) {
    super('forbidden')
    this.name = 'ForbiddenError'
  }
}
