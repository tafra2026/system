import { type NextRequest } from 'next/server'
import { assertSameOrigin, json, withActor } from '@/server/http'
import { sendTestPush } from '@/server/push'

/** Sends a test notification to the caller's own devices only. */
export const POST = withActor(async (req: NextRequest, actor) => {
  assertSameOrigin(req)
  return json(await sendTestPush(actor))
})
