import { eq } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { auditLog, customers } from '@/server/db/schema'
import { createCustomer, getCustomer, importVipList, searchCustomers } from '@/server/services/customers'
import { getOrderDetail, saveOrder } from '@/server/services/orders'
import { makeStaff, resetDb } from '../support/db'
import { catalog, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

describe('VIP list import (spec §9)', () => {
  it('previews without saving, then adds new VIPs and upgrades existing ones by number', async () => {
    const owner = await makeStaff('owner')
    const existing = await createCustomer(owner.actor, { name: 'نورة المحفوظة', phone: '0501112233', altPhone: '0509998877' })
    const list = [
      'سارة أحمد, 0551234567',
      'Reem\t+966 56 000 1111',
      'هند ٠٥٤٧٧٧٨٨٨٨', // Arabic digits, no separator
      'نورة باسم آخر, 0509998877', // matches the SECOND number of an existing customer
      'مكررة, 0551234567',
      'رقم خطأ, 12345',
      '0533334444', // no name and not an existing customer
      '',
    ].join('\n')

    const preview = await importVipList(owner.actor, list, false)
    expect(preview.applied).toBe(false)
    expect(preview.created.map((c) => c.phone).sort()).toEqual(['+966547778888', '+966551234567', '+966560001111'])
    expect(preview.upgraded).toEqual([{ name: 'نورة المحفوظة', phone: '+966501112233' }])
    expect(preview.duplicates).toBe(1)
    expect(preview.invalid).toEqual([
      { line: 6, reason: 'phone_invalid' },
      { line: 7, reason: 'name_missing' },
    ])
    expect(await getDb().select().from(customers)).toHaveLength(1) // nothing saved

    const done = await importVipList(owner.actor, list, true)
    expect(done.applied).toBe(true)
    const all = await getDb().select().from(customers)
    expect(all).toHaveLength(4)
    expect(all.every((c) => c.isVip)).toBe(true)
    const [kept] = await getDb().select().from(customers).where(eq(customers.id, existing.id))
    expect(kept!.name).toBe('نورة المحفوظة') // existing name is not overwritten
    expect(all.find((c) => c.phoneE164 === '+966547778888')!.name).toBe('هند')
    expect((await getDb().select().from(auditLog)).filter((a) => a.reason === 'VIP list import')).toHaveLength(4)

    // Running the same list again changes nothing.
    const again = await importVipList(owner.actor, list, true)
    expect(again.created).toHaveLength(0)
    expect(again.upgraded).toHaveLength(0)
    expect(again.alreadyVip).toBe(4)
  })

  it('imported VIPs get 25% off the offer/base price on a new booking', async () => {
    const owner = await makeStaff('owner')
    const mod = await makeStaff('moderator')
    const s1 = await makeStaff('specialist')
    const cat = await catalog()
    await importVipList(owner.actor, 'سارة, 0551234567', true)
    const [c] = await getDb().select().from(customers)
    const swedish = await cat.svc('massage_swedish')
    const res = await saveOrder(mod.actor, null, { customerId: c!.id, addressId: null, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', '20:00', [s1.employee.id])] }, { confirm: false })
    const [line] = (await getOrderDetail(mod.actor, res.id)).lines
    const start = line!.offerPriceHalalas ?? line!.basePriceHalalas
    expect(line!.vipDiscountHalalas).toBe(Math.round(start * 0.25))
    expect(line!.finalPriceHalalas).toBe(start - line!.vipDiscountHalalas)
  })

  it('only management and the moderator (VIP permission) can import', async () => {
    const spec = await makeStaff('specialist')
    const driver = await makeStaff('driver')
    await expect(importVipList(spec.actor, 'x, 0551234567', false)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(importVipList(driver.actor, 'x, 0551234567', false)).rejects.toBeInstanceOf(ForbiddenError)
    const mod = await makeStaff('moderator')
    expect((await importVipList(mod.actor, 'x, 0551234567', false)).created).toHaveLength(1)
  })
})

describe('find any customer by phone and see her order history', () => {
  it('Alaa, Doha and Mohammed find her with any phone format and see every order', async () => {
    const owner = await makeStaff('owner')
    const admin = await makeStaff('admin_manager')
    const mod = await makeStaff('moderator')
    const s1 = await makeStaff('specialist')
    const cat = await catalog()
    const c = await createCustomer(owner.actor, { name: 'عميلة البحث', phone: '0551234567', altPhone: '0561112222' })
    const swedish = await cat.svc('massage_swedish')
    for (const time of ['20:00', '22:00']) {
      await saveOrder(mod.actor, null, { customerId: c.id, addressId: null, lines: [{ kind: 'service', serviceId: swedish.id, beneficiaryIndex: 1, visitIndex: 0 }], visits: [visit('2026-10-01', time, [s1.employee.id])] }, { confirm: false })
    }

    for (const actor of [owner.actor, admin.actor, mod.actor]) {
      for (const q of ['0551234567', '+966 55 123 4567', '966551234567', '551234567', '٠٥٥١٢٣٤٥٦٧', '4567', '0561112222']) {
        const found = await searchCustomers(actor, q)
        expect(found.map((f) => f.id), `query ${q}`).toContain(c.id)
      }
      const detail = await getCustomer(actor, c.id)
      expect(detail.orders).toHaveLength(2)
    }
    await expect(searchCustomers(s1.actor, '0551234567')).rejects.toBeInstanceOf(ForbiddenError)
    await expect(getCustomer(s1.actor, c.id)).rejects.toBeInstanceOf(ForbiddenError)
  })
})

describe('search by district and Arabic-insensitive names', () => {
  it('finds customers by any of their districts and ignores hamza/ta marbuta differences', async () => {
    const owner = await makeStaff('owner')
    const { addAddress } = await import('@/server/services/customers')
    const c = await createCustomer(owner.actor, { name: 'أمَل فاطمة', phone: '0551112222' })
    await addAddress(owner.actor, c.id, { district: 'الروضة' })
    await addAddress(owner.actor, c.id, { district: 'النعيم' })
    await createCustomer(owner.actor, { name: 'نورة', phone: '0553334444' })
    for (const q of ['امل', 'فاطمه', 'النعيم', 'روضه', '2222']) {
      const r = await searchCustomers(owner.actor, q)
      expect(r.map((x) => x.id), q).toEqual([c.id])
    }
    const [row] = await searchCustomers(owner.actor, 'امل')
    expect(row!.districts).toContain('الروضة')
    expect(await searchCustomers(owner.actor, 'امل', 30, { page: 2 })).toHaveLength(0)
  })
})
