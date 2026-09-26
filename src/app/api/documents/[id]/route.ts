import { withActor } from '@/server/http'
import { customerDocumentPdf } from '@/server/services/customer-documents'

type Ctx = { params: Promise<{ id: string }> }

/** Staff download of an issued customer document (permission-checked; never cached publicly). */
export const GET = withActor<Ctx>(async (req, actor, ctx) => {
  const { number, pdf } = await customerDocumentPdf(actor, (await ctx.params).id)
  const download = req.nextUrl.searchParams.get('download') === '1'
  return new Response(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${number}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
})
