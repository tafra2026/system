import { and, eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { z } from 'zod'
import { authorize, can, type Actor } from '../authz/actor'
import { ForbiddenError } from '../authz/errors'
import { writeAudit } from '../audit'
import { getDb } from '../db'
import { customerAddresses, files, orders, tripLegs, visits, visitSpecialists } from '../db/schema'
import { NotFoundError, ValidationError } from './errors'

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Store the photo of the building from outside for an address. The image is re-encoded
 * (auto-rotated, max 1600px, JPEG) which also removes all metadata such as GPS tags.
 */
export async function setAddressPhoto(actor: Actor, addressId: string, input: { bytes: Buffer; mimeType: string }) {
  authorize(actor, 'customers.manage')
  if (!z.uuid().safeParse(addressId).success) throw new NotFoundError()
  if (!ALLOWED.has(input.mimeType)) throw new ValidationError('validation_failed', { photo: 'photo_type' })
  if (input.bytes.length === 0 || input.bytes.length > MAX_UPLOAD_BYTES) throw new ValidationError('validation_failed', { photo: 'photo_too_large' })
  let out: { data: Buffer; info: { width: number; height: number } }
  try {
    out = await sharp(input.bytes, { failOn: 'error' })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
  } catch {
    throw new ValidationError('validation_failed', { photo: 'photo_unreadable' })
  }
  return getDb().transaction(async (tx) => {
    const [addr] = await tx.select().from(customerAddresses).where(eq(customerAddresses.id, addressId)).for('update')
    if (!addr) throw new NotFoundError()
    const [f] = await tx
      .insert(files)
      .values({ kind: 'address_photo', mimeType: 'image/jpeg', sizeBytes: out.data.length, width: out.info.width, height: out.info.height, data: out.data, createdByUserId: actor.userId })
      .returning({ id: files.id })
    await tx.update(customerAddresses).set({ photoFileId: f!.id, updatedAt: new Date() }).where(eq(customerAddresses.id, addressId))
    if (addr.photoFileId) await tx.delete(files).where(eq(files.id, addr.photoFileId))
    await writeAudit(tx, { actorUserId: actor.userId, action: 'customer.address_photo', entityType: 'customer', entityId: addr.customerId, after: { addressId, replaced: Boolean(addr.photoFileId) } })
    return { fileId: f!.id }
  })
}

export async function removeAddressPhoto(actor: Actor, addressId: string) {
  authorize(actor, 'customers.manage')
  await getDb().transaction(async (tx) => {
    const [addr] = await tx.select().from(customerAddresses).where(eq(customerAddresses.id, addressId)).for('update')
    if (!addr?.photoFileId) return
    await tx.update(customerAddresses).set({ photoFileId: null, updatedAt: new Date() }).where(eq(customerAddresses.id, addressId))
    await tx.delete(files).where(eq(files.id, addr.photoFileId))
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
  const addrs = await db.select({ id: customerAddresses.id }).from(customerAddresses).where(eq(customerAddresses.photoFileId, fileId))
  if (!addrs.length) throw new ForbiddenError('schedule.read.own')
  const vs = await db
    .select({ id: visits.id })
    .from(visits)
    .innerJoin(orders, eq(orders.id, visits.orderId))
    .where(and(inArray(orders.addressId, addrs.map((a) => a.id)), inArray(orders.status, ['confirmed', 'completed', 'pending_review']), inArray(visits.status, ['scheduled', 'completed'])))
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
