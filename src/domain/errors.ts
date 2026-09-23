/**
 * Domain errors carry a stable `code` that maps to an i18n key under `errors.*`,
 * so the UI can show the message in the user's language.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    public readonly params: Record<string, string | number> = {},
  ) {
    super(code)
    this.name = 'DomainError'
  }
}
