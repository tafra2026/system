import sharp from 'sharp'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { POST as uploadRoute } from '@/app/api/addresses/[id]/photo/route'
import { GET as fileRoute } from '@/app/api/files/[id]/route'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb } from '@/server/db'
import { getVisibleFile, setAddressPhoto } from '@/server/services/address-photos'
import { getOrderDetail, mySchedule, saveOrder } from '@/server/services/orders'
import { setSetting } from '@/server/services/settings'
import { myTrips, saveLeg } from '@/server/services/trips'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

const photo = () =>
  sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#aa8077' } })
    .jpeg()
    .withExifMerge({ IFD0: { Make: 'Phone' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '21/1 35/1 0/1' } })
    .toBuffer()

async function setup() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist', 'S1')
  const s2 = await makeStaff('specialist', 'S2')
  const driver = await makeStaff('driver', 'D1')
  const otherDriver = await makeStaff('driver', 'D2')
  const { svc } = await catalog()
  await setSetting(owner.actor, 'start_point', { label: 'سكن', latitude: 21.59, longitude: 39.14 })
  const { customer, address } = await customerWithAddress(mod.actor)
  const swedish = await svc('massage_swedish')
  const r = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [s1.employee.id])] }, { confirm: true })
  const d = await getOrderDetail(mod.actor, r.id)
  await saveLeg(mod.actor, d.visits[0]!.id, { kind: 'dropoff', driverId: driver.employee.id, mode: 'manual', travelMinutes: 20, bufferMinutes: 15 })
  return { owner, mod, s1, s2, driver, otherDriver, address, d }
}

describe('building photo of the customer address', () => {
  it('is resized and stripped of GPS/EXIF data; shown to the driver and the visit’s specialist only', async () => {
    const { mod, s1, s2, driver, otherDriver, address, d } = await setup()
    const { fileId } = await setAddressPhoto(mod.actor, address.id, { bytes: await photo(), mimeType: 'image/jpeg' })
    const f = await getVisibleFile(mod.actor, fileId)
    const meta = await sharp(f.data).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBe(1600)
    expect(meta.exif).toBeUndefined()

    expect((await getVisibleFile(s1.actor, fileId)).id).toBe(fileId)
    expect((await getVisibleFile(driver.actor, fileId)).id).toBe(fileId)
    await expect(getVisibleFile(s2.actor, fileId)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(getVisibleFile(otherDriver.actor, fileId)).rejects.toBeInstanceOf(ForbiddenError)

    expect((await mySchedule(s1.actor, '2026-10-01', '2026-10-01'))[0]!.buildingPhotoUrl).toBe(`/api/files/${fileId}`)
    expect((await myTrips(driver.actor, '2026-10-01', '2026-10-01'))[0]!.destination?.photoUrl).toBe(`/api/files/${fileId}`)
    expect((await getOrderDetail(mod.actor, d.order.id)).buildingPhotoUrl).toBe(`/api/files/${fileId}`)
  })

  it('only customer managers upload; wrong types are refused; the HTTP routes check permission and origin', async () => {
    const { mod, s1, s2, address } = await setup()
    await expect(setAddressPhoto(s1.actor, address.id, { bytes: await photo(), mimeType: 'image/jpeg' })).rejects.toBeInstanceOf(ForbiddenError)
    await expect(setAddressPhoto(mod.actor, address.id, { bytes: Buffer.from('%PDF-1.4'), mimeType: 'application/pdf' })).rejects.toMatchObject({ fieldErrors: { photo: 'photo_type' } })

    const body = new FormData()
    body.append('photo', new File([new Uint8Array(await photo())], 'b.jpg', { type: 'image/jpeg' }))
    const ctx = { params: Promise.resolve({ id: address.id }) }
    const cross = await uploadRoute(new NextRequest('http://localhost/api/addresses/x/photo', { method: 'POST', body, headers: { cookie: `pm_session=${mod.token}`, origin: 'https://evil.example' } }), ctx)
    expect(cross.status).toBe(403)
    const body2 = new FormData()
    body2.append('photo', new File([new Uint8Array(await photo())], 'b.jpg', { type: 'image/jpeg' }))
    const ok = await uploadRoute(new NextRequest('http://localhost/api/addresses/x/photo', { method: 'POST', body: body2, headers: { cookie: `pm_session=${mod.token}`, origin: 'http://localhost' } }), ctx)
    expect(ok.status).toBe(200)
    const { fileId } = (await ok.json()) as { fileId: string }
    const get = await fileRoute(new NextRequest(`http://localhost/api/files/${fileId}`, { headers: { cookie: `pm_session=${s2.token}` } }), { params: Promise.resolve({ id: fileId }) })
    expect(get.status).toBe(403)
    const mine = await fileRoute(new NextRequest(`http://localhost/api/files/${fileId}`, { headers: { cookie: `pm_session=${s1.token}` } }), { params: Promise.resolve({ id: fileId }) })
    expect(mine.status).toBe(200)
    expect(mine.headers.get('cache-control')).toContain('no-store')
    expect(mine.headers.get('content-type')).toBe('image/jpeg')
  })
})
