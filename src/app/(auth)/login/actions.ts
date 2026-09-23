'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { formString, type ActionState } from '@/server/actions'
import { LOCALE_COOKIE, sessionCookieOptions } from '@/server/auth/current'
import { SESSION_COOKIE } from '@/server/auth/sessions'
import { login } from '@/server/services/auth'

export async function loginAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await login(formString(form, 'username'), formString(form, 'password'))
  if (!result.ok) return { ok: false, error: result.code, at: Date.now() }
  const store = await cookies()
  store.set(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt))
  store.delete(LOCALE_COOKIE)
  redirect(result.mustChangePassword ? '/change-password' : '/')
}
