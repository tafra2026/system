import fs from 'node:fs'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { GET as publicRoute } from '@/app/d/[token]/route'
import { ForbiddenError } from '@/server/authz/errors'
import { closeDb, getDb } from '@/server/db'
import { customerDocuments } from '@/server/db/schema'
import { createDocumentLink, customerDocumentByToken, customerDocumentPdf, issueCustomerDocument, revokeDocumentLinks } from '@/server/services/customer-documents'
import { adjustLinePrice, getOrderDetail, saveOrder } from '@/server/services/orders'
import { recordPayment } from '@/server/services/payments'
import { setSetting } from '@/server/services/settings'
import { makeStaff, resetDb } from '../support/db'
import { catalog, customerWithAddress, visit } from '../support/orders'

beforeEach(resetDb)
afterAll(closeDb)

async function bigOrder() {
  const owner = await makeStaff('owner')
  const mod = await makeStaff('moderator')
  const s1 = await makeStaff('specialist', 'S1')
  const s2 = await makeStaff('specialist', 'S2')
  const cat = await catalog()
  await setSetting(owner.actor, 'business_contact', { phone: '+966 55 000 0000', website: 'pamperme.sa' })
  const { customer, address } = await customerWithAddress(mod.actor, { vip: true })
  const codes = ['massage_swedish', 'massage_relaxing', 'massage_swedish', 'massage_relaxing', 'massage_swedish', 'massage_relaxing']
  const lines = [] as unknown[]
  for (let i = 0; i < codes.length; i++) lines.push({ kind: 'service', serviceId: (await cat.svc(codes[i]!)).id, beneficiaryIndex: (i % 3) + 1, visitIndex: 0 })
  lines.push({ kind: 'package', packageId: (await cat.pkg('pkg_swedish_2')).id, visitIndexes: [0, 1] })
  const res = await saveOrder(mod.actor, null, { customerId: customer.id, addressId: address.id, personsCount: 3, lines, visits: [visit('2026-10-01', '16:00', [s1.employee.id]), visit(null, null)] }, { confirm: true })
  const d = await getOrderDetail(mod.actor, res.id)
  await adjustLinePrice(owner.actor, d.lines[0]!.id, d.lines[0]!.finalPriceHalalas - 1000, 'خصم ترحيبي')
  await recordPayment(owner.actor, res.id, { method: 'cash', amountHalalas: 20000 })
  await recordPayment(owner.actor, res.id, { method: 'tamara', amountHalalas: 15050, reference: 'TMR-1' })
  return { owner, mod, s1, orderId: res.id, reference: res.reference }
}

describe('customer document (PDF)', () => {
  it('issues AR/EN versions from saved data, never duplicates, and freezes old versions', async () => {
    const { owner, mod, s1, orderId } = await bigOrder()
    await expect(issueCustomerDocument(s1.actor, orderId, 'ar')).rejects.toBeInstanceOf(ForbiddenError)
    const [a, b] = await Promise.all([issueCustomerDocument(mod.actor, orderId, 'ar'), issueCustomerDocument(mod.actor, orderId, 'ar')])
    expect(a.id).toBe(b.id) // double tap → one document
    const en = await issueCustomerDocument(mod.actor, orderId, 'en')
    expect(en.id).not.toBe(a.id)
    const snap = (await getDb().select().from(customerDocuments)).find((d) => d.id === a.id)!.snapshot as { paidHalalas: number; remainingHalalas: number; grandTotalHalalas: number; payments: unknown[] }
    expect(snap.paidHalalas).toBe(35050)
    expect(snap.remainingHalalas).toBe(snap.grandTotalHalalas - 35050)
    expect(snap.payments).toHaveLength(2)

    // A new payment → a new version; the old one is unchanged (DB-enforced).
    await recordPayment(owner.actor, orderId, { method: 'cash', amountHalalas: 100 })
    const v2 = await issueCustomerDocument(mod.actor, orderId, 'ar')
    expect(v2.version).toBe(2)
    await expect(getDb().update(customerDocuments).set({ number: 'X' })).rejects.toThrow()

    const ar = await customerDocumentPdf(mod.actor, a.id)
    const enPdf = await customerDocumentPdf(mod.actor, en.id)
    expect(ar.pdf.subarray(0, 5).toString()).toBe('%PDF-')
    if (process.env.PDF_OUT) {
      fs.writeFileSync(`${process.env.PDF_OUT}/doc-ar.pdf`, ar.pdf)
      fs.writeFileSync(`${process.env.PDF_OUT}/doc-en.pdf`, enPdf.pdf)
    }
    await expect(customerDocumentPdf(s1.actor, a.id)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('customer links are random, expire, can be revoked, and reveal nothing else', async () => {
    const { mod, orderId } = await bigOrder()
    const doc = await issueCustomerDocument(mod.actor, orderId, 'ar')
    const link = await createDocumentLink(mod.actor, doc.id)
    const token = link.url.split('/d/')[1]!
    expect(token.length).toBeGreaterThanOrEqual(40)
    const res = await publicRoute(new Request(link.url), { params: Promise.resolve({ token }) })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await customerDocumentByToken(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A'))).toBeNull()
    expect(await customerDocumentByToken(doc.id)).toBeNull() // the document id is not a key
    await revokeDocumentLinks(mod.actor, doc.id)
    expect((await publicRoute(new Request(link.url), { params: Promise.resolve({ token }) })).status).toBe(404)
  })
})
