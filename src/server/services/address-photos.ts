import { and, eq, inArray, or } from 'drizzle-orm'
import { z } from 'zod'
import { authorize, can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { writeAudit } from '../audit'
import { getDb, type Executor } from '../db'
import { customerAddresses, files, orders, tripLegs, visits, visitSpecialists } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Store the photo of the building from outside for an address. The image is re-encoded
 * (auto-rotated, max 1600px, JPEG) which also removes all metadata such as GPS tags.
 */
/** HEIC/HEIF (iPhone "High Efficiency") cannot be decoded by the server's image library. */
function isHeic(bytes: Buffer): boolean {
  if (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp') return false
  return /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(bytes.toString('ascii', 8, 12))
}

const MAX_INPUT_PIXELS = 60_000_000 // ~ 7700×7700; bigger inputs are refused before decoding

async function processPhoto(bytes: Buffer) {
  if (isHeic(bytes)) throw new ValidationError('validation_failed', { photo: 'photo_heic' })
  // Loaded on first use: libvips needs glibc >= 2.28, so on an older host only photo upload is
  // affected instead of every page that imports this module.
  const sharp = (await import('sharp')).default
  try {
    // Real content check: the image must decode; the client-declared type is not trusted.
    const base = () => sharp(bytes, { failOn: 'error', limitInputPixels: MAX_INPUT_PIXELS }).rotate()
    const full = await base().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    const thumb = await base().resize({ width: 480, height: 480, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 72, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    return { full, thumb }
  } catch {
    throw new ValidationError('validation_failed', { photo: 'photo_unreadable' })
  }
}

/** Delete a file only if no address or order still points at it (orders keep their snapshot). */
async function deleteIfUnused(tx: Executor, fileId: string | null) {
  if (!fileId) return
  const [a] = await tx.select({ id: customerAddresses.id }).from(customerAddresses).where(or(eq(customerAddresses.photoFileId, fileId), eq(customerAddresses.photoThumbFileId, fileId))).limit(1)
  const [o] = await tx.select({ id: orders.id }).from(orders).where(or(eq(orders.buildingPhotoFileId, fileId), eq(orders.buildingPhotoThumbFileId, fileId))).limit(1)
  if (!a && !o) await tx.delete(files).where(eq(files.id, fileId))
}

/** Orders that are not finished yet follow the address photo; finished ones keep theirs. */
const FOLLOWING_STATUSES = ['draft', 'confirmed', 'pending_review'] as const

/**
 * Store the photo of the building from outside for an address. The image is re-encoded
 * (auto-rotated, max 1600px, JPEG, plus a 480px thumbnail) which also removes all metadata
 * such as GPS tags. Stored in the database (durable, included in backups), never in a public
 * folder. Orders at this address that are not finished yet are updated too.
 */
export async function setAddressPhoto(actor: Actor, addressId: string, input: { bytes: Buffer; mimeType: string }) {
  authorize(actor, 'customers.manage')
  if (!z.uuid().safeParse(addressId).success) throw new NotFoundError()
  if (input.bytes.length === 0 || input.bytes.length > MAX_UPLOAD_BYTES) throw new ValidationError('validation_failed', { photo: 'photo_too_large' })
  if (!ALLOWED.has(input.mimeType) && !isHeic(input.bytes)) throw new ValidationError('validation_failed', { photo: 'photo_type' })
  const { full, thumb } = await processPhoto(input.bytes)
  return getDb().transaction(async (tx) => {
    const [addr] = await tx.select().from(customerAddresses).where(eq(customerAddresses.id, addressId)).for('update')
    if (!addr) throw new NotFoundError()
    const [f] = await tx
      .insert(files)
      .values({ kind: 'address_photo', mimeType: 'image/jpeg', sizeBytes: full.data.length, width: full.info.width, height: full.info.height, data: full.data, createdByUserId: actor.userId })
      .returning({ id: files.id })
    const [th] = await tx
      .insert(files)
      .values({ kind: 'address_photo_thumb', mimeType: 'image/jpeg', sizeBytes: thumb.data.length, width: thumb.info.width, height: thumb.info.height, data: thumb.data, createdByUserId: actor.userId })
      .returning({ id: files.id })
    await tx.update(customerAddresses).set({ photoFileId: f!.id, photoThumbFileId: th!.id, updatedAt: new Date() }).where(eq(customerAddresses.id, addressId))
    await tx
      .update(orders)
      .set({ buildingPhotoFileId: f!.id, buildingPhotoThumbFileId: th!.id, updatedAt: new Date() })
      .where(and(eq(orders.addressId, addressId), inArray(orders.status, [...FOLLOWING_STATUSES])))
    await deleteIfUnused(tx, addr.photoFileId)
    await deleteIfUnused(tx, addr.photoThumbFileId)
    await writeAudit(tx, { actorUserId: actor.userId, action: 'customer.address_photo', entityType: 'customer', entityId: addr.customerId, after: { addressId, replaced: Boolean(addr.photoFileId) } })
    return { fileId: f!.id, thumbFileId: th!.id }
  })
}

export async function removeAddressPhoto(actor: Actor, addressId: string) {
  authorize(actor, 'customers.manage')
  await getDb().transaction(async (tx) => {
    const [addr] = await tx.select().from(customerAddresses).where(eq(customerAddresses.id, addressId)).for('update')
    if (!addr?.photoFileId) return
    await tx.update(customerAddresses).set({ photoFileId: null, photoThumbFileId: null, updatedAt: new Date() }).where(eq(customerAddresses.id, addressId))
    await tx
      .update(orders)
      .set({ buildingPhotoFileId: null, buildingPhotoThumbFileId: null, updatedAt: new Date() })
      .where(and(eq(orders.addressId, addressId), inArray(orders.status, [...FOLLOWING_STATUSES])))
    await deleteIfUnused(tx, addr.photoFileId)
    await deleteIfUnused(tx, addr.photoThumbFileId)
    await writeAudit(tx, { actorUserId: actor.userId, action: 'customer.address_photo_removed', entityType: 'customer', entityId: addr.customerId, after: { addressId } })
  })
}

/**
 * Who may see a photo: operations staff; otherwise only a specialist or driver working on a
 * confirmed visit at that address.
 */
export async function getVisibleFile(actor: Actor, fileId: string) {
  if (!z.uuid().safeParse(fileId).success) throw new NotFoundError()
  const db = getDb()
  const [f] = await db.select().from(files).where(eq(files.id, fileId))
  if (!f) throw new NotFoundError()
  if (can(actor, 'customers.manage') || can(actor, 'orders.read.all')) return f
  if (!can(actor, 'schedule.read.own')) throw new ForbiddenError('schedule.read.own')
  // Orders showing this photo: by their own snapshot, or through their address.
  const addrs = await db
    .select({ id: customerAddresses.id })
    .from(customerAddresses)
    .where(or(eq(customerAddresses.photoFileId, fileId), eq(customerAddresses.photoThumbFileId, fileId)))
  const byOrder = await db.select({ id: orders.id }).from(orders).where(or(eq(orders.buildingPhotoFileId, fileId), eq(orders.buildingPhotoThumbFileId, fileId)))
  const orderFilter = or(
    byOrder.length ? inArray(orders.id, byOrder.map((o) => o.id)) : undefined,
    addrs.length ? inArray(orders.addressId, addrs.map((a) => a.id)) : undefined,
  )
  if (!byOrder.length && !addrs.length) throw new ForbiddenError('schedule.read.own')
  const vs = await db
    .select({ id: visits.id })
    .from(visits)
    .innerJoin(orders, eq(orders.id, visits.orderId))
    .where(and(orderFilter, inArray(orders.status, ['confirmed', 'completed', 'pending_review']), inArray(visits.status, ['scheduled', 'completed'])))
  if (!vs.length) throw new ForbiddenError('schedule.read.own')
  const ids = vs.map((v) => v.id)
  const [asSpecialist] = await db.select({ id: visitSpecialists.id }).from(visitSpecialists).where(and(inArray(visitSpecialists.visitId, ids), eq(visitSpecialists.employeeId, actor.employeeId))).limit(1)
  const [asDriver] = await db.select({ id: tripLegs.id }).from(tripLegs).where(and(inArray(tripLegs.visitId, ids), eq(tripLegs.driverEmployeeId, actor.employeeId))).limit(1)
  if (!asSpecialist && !asDriver) throw new ForbiddenError('schedule.read.own')
  return f
}

export function photoUrl(fileId: string | null | undefined): string | null {
  return fileId ? `/api/files/${fileId}` : null
}
