import 'server-only'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n'
import type { Actor } from '../authz/actor'
import { can } from '../authz/actor'
import type { Permission } from '../authz/permissions'
import { actorFromSessionToken, SESSION_COOKIE } from './sessions'

/** Cookie remembering the language for signed-out pages only; accounts store their own. */
export const LOCALE_COOKIE = 'pm_locale'

export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const store = await cookies()
  return actorFromSessionToken(store.get(SESSION_COOKIE)?.value)
})

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value
}

/** For pages: redirect to sign-in when there is no valid session. */
export async function requireActor(): Promise<Actor> {
  const actor = await getCurrentActor()
  if (!actor) redirect('/login')
  return actor
}

/**
 * For pages: checks the permission on the server. Pages render <Forbidden /> when
 * `allowed` is false; the services they call enforce the same permission again.
 */
export async function pagePermission(permission: Permission): Promise<{ actor: Actor; allowed: boolean }> {
  const actor = await requireActor()
  return { actor, allowed: can(actor, permission) }
}

export const getRequestLocale = cache(async (): Promise<Locale> => {
  const actor = await getCurrentActor()
  if (actor) return actor.locale
  const cookie = (await cookies()).get(LOCALE_COOKIE)?.value
  return isLocale(cookie) ? cookie : DEFAULT_LOCALE
})

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires,
  }
}
