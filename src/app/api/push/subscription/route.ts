import { type NextRequest } from 'next/server'
import { assertSameOrigin, json, withActor } from '@/server/http'
import { removePushSubscription, savePushSubscription } from '@/server/push'

/** Register this browser for push notifications (the signed-in user's own device). */
export const POST = withActor(async (req: NextRequest, actor) => {
  assertSameOrigin(req)
  await savePushSubscription(actor, await req.json().catch(() => null))
  return json({ ok: true })
})

/** Stop push notifications on this browser. */
export const DELETE = withActor(async (req: NextRequest, actor) => {
  assertSameOrigin(req)
  const body = (await req.json().catch(() => null)) as { endpoint?: unknown } | null
  await removePushSubscription(actor, body?.endpoint)
  return json({ ok: true })
})
