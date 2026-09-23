'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { deleteSession, SESSION_COOKIE } from '@/server/auth/sessions'

export async function logoutAction(): Promise<void> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (token) await deleteSession(token)
  store.delete(SESSION_COOKIE)
  redirect('/login')
}
