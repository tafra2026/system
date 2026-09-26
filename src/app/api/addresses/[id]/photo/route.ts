import { assertSameOrigin, json, withActor } from '@/server/http'
import { MAX_UPLOAD_BYTES, photoUrl, removeAddressPhoto, setAddressPhoto } from '@/server/services/address-photos'
import { ValidationError } from '@/server/services/errors'

type Ctx = { params: Promise<{ id: string }> }

/** Upload the building photo of an address (multipart field "photo"). */
export const POST = withActor<Ctx>(async (req, actor, ctx) => {
  assertSameOrigin(req)
  const length = Number(req.headers.get('content-length') ?? 0)
  if (length > MAX_UPLOAD_BYTES + 100_000) throw new ValidationError('validation_failed', { photo: 'photo_too_large' })
  const form = await req.formData()
  const file = form.get('photo')
  if (!(file instanceof File)) throw new ValidationError('validation_failed', { photo: 'required' })
  const { fileId, thumbFileId } = await setAddressPhoto(actor, (await ctx.params).id, { bytes: Buffer.from(await file.arrayBuffer()), mimeType: file.type })
  return json({ fileId, url: photoUrl(fileId), thumbUrl: photoUrl(thumbFileId) })
})

export const DELETE = withActor<Ctx>(async (req, actor, ctx) => {
  assertSameOrigin(req)
  await removeAddressPhoto(actor, (await ctx.params).id)
  return json({ ok: true })
})
