import type { z } from 'zod'
import { ValidationError } from './errors'

/** Convert a Zod error to field error codes (i18n keys under errors.*). */
export function zodToValidation(error: z.ZodError): ValidationError {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.') || 'form'
    const custom = issue.code === 'custom' ? (issue.message as string) : null
    fields[key] ??= custom ?? (issue.code === 'too_small' && (issue as { minimum?: unknown }).minimum === 1 ? 'required' : 'invalid')
  }
  return new ValidationError('validation_failed', fields)
}

export function parseWith<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input)
  if (!r.success) throw zodToValidation(r.error)
  return r.data
}

/** Postgres unique/exclusion violation codes. */
export function pgErrorCode(err: unknown): string | undefined {
  let e: unknown = err
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    e = (e as { cause?: unknown }).cause
  }
  return undefined
}
