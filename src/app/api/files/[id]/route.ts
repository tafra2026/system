import { NextResponse } from 'next/server'
import { withActor } from '@/server/http'
import { getVisibleFile } from '@/server/services/address-photos'

/** Private image download: permission-checked, never cached publicly. */
export const GET = withActor<{ params: Promise<{ id: string }> }>(async (_req, actor, ctx) => {
  const f = await getVisibleFile(actor, (await ctx.params).id)
  return new NextResponse(new Uint8Array(f.data), {
    headers: { 'Content-Type': f.mimeType, 'Content-Length': String(f.sizeBytes), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
  })
})
