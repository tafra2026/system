import 'server-only'
import { NextResponse, type NextRequest } from 'next/server'
import type { Actor } from './authz/actor'
import { ForbiddenError, UnauthenticatedError } from './authz/errors'
import { actorFromSessionToken, SESSION_COOKIE } from './auth/sessions'
import { NotFoundError, ValidationError } from './services/errors'
import { DomainError } from '@/domain/errors'

const NO_STORE = { 'Cache-Control': 'private, no-store' }

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

/** Map a thrown error to a JSON response without leaking internals. */
export function errorResponse(err: unknown) {
  if (err instanceof UnauthenticatedError) return json({ error: 'unauthenticated' }, 401)
  if (err instanceof ForbiddenError) return json({ error: 'forbidden' }, 403)
  if (err instanceof NotFoundError) return json({ error: 'not_found' }, 404)
  if (err instanceof ValidationError) return json({ error: err.code, fields: err.fieldErrors }, 422)
  if (err instanceof DomainError) return json({ error: err.code, params: err.params }, 422)
  console.error('API error:', err instanceof Error ? err.name : 'unknown')
  return json({ error: 'generic' }, 500)
}

/**
 * Wrap a route handler: resolves the session from the request cookie, requires sign-in,
 * and converts errors. Authorization itself happens in the service called by `handler`.
 */
export function withActor<C>(handler: (req: NextRequest, actor: Actor, ctx: C) => Promise<Response>) {
  return async (req: NextRequest, ctx: C): Promise<Response> => {
    try {
      const actor = await actorFromSessionToken(req.cookies.get(SESSION_COOKIE)?.value)
      if (!actor) throw new UnauthenticatedError()
      return await handler(req, actor, ctx)
    } catch (err) {
      return errorResponse(err)
    }
  }
}

/** Reject cross-site state-changing requests (server actions have their own origin check). */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (origin && origin !== req.nextUrl.origin) throw new ForbiddenError()
}
