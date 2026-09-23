/**
 * A user-correctable problem. `code` and each field value are i18n keys under `errors.*`.
 */
export class ValidationError extends Error {
  constructor(
    readonly code: string,
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(code)
    this.name = 'ValidationError'
  }
}

/** Requested record does not exist (or is not visible to this actor). */
export class NotFoundError extends Error {
  readonly code = 'not_found'
  constructor() {
    super('not_found')
    this.name = 'NotFoundError'
  }
}
