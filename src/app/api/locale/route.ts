import { type NextRequest } from 'next/server'
import { isLocale } from '@/i18n'
import { LOCALE_COOKIE } from '@/server/auth/current'
import { assertSameOrigin, errorResponse, json } from '@/server/http'

/** Signed-out language preference. Signed-in users change their language in "My account". */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req)
    const body = (await req.json().catch(() => null)) as { locale?: unknown } | null
    if (!isLocale(body?.locale)) return json({ error: 'invalid' }, 422)
    const res = json({ ok: true })
    res.cookies.set(LOCALE_COOKIE, body.locale, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 365 })
    return res
  } catch (err) {
    return errorResponse(err)
  }
}
