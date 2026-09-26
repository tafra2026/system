'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { formString, type ActionState } from '@/server/actions'
import { LOCALE_COOKIE, sessionCookieOptions } from '@/server/auth/current'
import { SESSION_COOKIE } from '@/server/auth/sessions'
import { clearFailures, clientKey, isThrottled, recordFailure } from '@/server/auth/throttle'
import { login } from '@/server/services/auth'

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const key = clientKey(await headers())
  if (isThrottled(key)) return { ok: false, error: 'too_many_attempts', at: Date.now() }
  const result = await login(formString(form, 'username'), formString(form, 'password'))
  if (!result.ok) {
    recordFailure(key)
    return { ok: false, error: result.code, at: Date.now() }
  }
  clearFailures(key)
  const store = await cookies()
  store.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt))
  store.delete(LOCALE_COOKIE)
  redirect(result.mustChangePassword ? '/change-password' : '/')
}
