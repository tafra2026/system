import { customerDocumentByToken } from '@/server/services/customer-documents'

/**
 * Customer download link (sent by staff over WhatsApp). The token is random and stored hashed;
 * unknown, expired and revoked links all answer 404. Not indexed, not cached.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const doc = await customerDocumentByToken((await ctx.params).token)
  if (!doc) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
  return new Response(new Uint8Array(doc.pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${doc.number}.pdf"`,
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
