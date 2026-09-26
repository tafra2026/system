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

/**
 * Reject cross-site state-changing requests (server actions have their own origin check).
 * Behind a hosting proxy the server may see itself as http://localhost:PORT, so the browser's
 * Origin is compared with the public host (X-Forwarded-Host / Host) and APP_BASE_URL.
 * Without an Origin header, the browser's Sec-Fetch-Site must not say "cross-site".
 */
export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  if (!origin) {
    if (req.headers.get('sec-fetch-site') === 'cross-site') throw new ForbiddenError()
    return
  }
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw new ForbiddenError()
  }
  const allowed = new Set<string>([req.nextUrl.host])
  const forwarded = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim()
  const host = req.headers.get('host')
  if (forwarded) allowed.add(forwarded)
  if (host) allowed.add(host)
  const base = process.env.APP_BASE_URL
  if (base) {
    try {
      allowed.add(new URL(base).host)
    } catch {
      // ignore a malformed APP_BASE_URL
    }
  }
  if (!allowed.has(originHost)) throw new ForbiddenError()
}
