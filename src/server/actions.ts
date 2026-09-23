import 'server-only'
import { DomainError } from '@/domain/errors'
import type { Actor } from './authz/actor'
import { ForbiddenError, UnauthenticatedError } from './authz/errors'
import { getCurrentActor } from './auth/current'
import { NotFoundError, ValidationError } from './services/errors'

/** Serializable result every server action returns to its form. */
export interface ActionState<T = undefined> {
  ok: boolean
  error?: string
  errorParams?: Record<string, string | number>
  fieldErrors?: Record<string, string>
  data?: T
  /** Changes on every submission so the UI can re-announce identical results. */
  at?: number
}

export const initialActionState: ActionState<never> = { ok: false }

/**
 * Run a server action body with the current actor. Server actions are reachable by direct
 * POST, so the session is always resolved here and permissions are enforced in services.
 */
export async function runAction<T>(fn: (actor: Actor) => Promise<T>): Promise<ActionState<T>> {
  try {
    const actor = await getCurrentActor()
    if (!actor) throw new UnauthenticatedError()
    return { ok: true, data: await fn(actor), at: Date.now() }
  } catch (err) {
    return toActionError(err)
  }
}

export function toActionError(err: unknown): ActionState<never> {
  const at = Date.now()
  if (err instanceof UnauthenticatedError) return { ok: false, error: 'unauthenticated', at }
  if (err instanceof ForbiddenError) return { ok: false, error: 'forbidden', at }
  if (err instanceof NotFoundError) return { ok: false, error: 'not_found', at }
  if (err instanceof ValidationError) return { ok: false, error: err.code, fieldErrors: err.fieldErrors, at }
  if (err instanceof DomainError) return { ok: false, error: err.code, errorParams: err.params, at }
  // Re-throw Next.js control-flow errors (redirect/notFound).
  if (err && typeof err === 'object' && 'digest' in err) throw err
  console.error('Action error:', err instanceof Error ? err.name : 'unknown')
  return { ok: false, error: 'generic', at }
}

export function formString(form: FormData, name: string): string {
  const v = form.get(name)
  return typeof v === 'string' ? v : ''
}
