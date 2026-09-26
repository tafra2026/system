import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderCustomerDocument, type CustomerDocSnapshot } from '@/server/pdf/customer-document'

const long = (locale: 'ar' | 'en'): CustomerDocSnapshot => ({
  number: 'PMD-2609-0042',
  version: 2,
  issuedAt: '2026-09-26T18:00:00Z',
  locale,
  orderReference: 'PM-2609-0001',
  orderStatus: 'confirmed',
  customerName: 'نورة عبدالرحمن آل سعود — اسم طويل جدًا لاختبار التفاف النص داخل الخانة',
  visits: [
    { sequence: 1, startsAt: '2026-10-01T13:00:00Z', status: 'completed' },
    { sequence: 2, startsAt: null, status: 'cancelled' },
  ],
  lines: Array.from({ length: 40 }, (_, i) => ({
    name: i % 3 === 0 ? 'الكلاسيك (مناكير و بديكير) مع عناية إضافية بالأظافر والجلد' : i % 3 === 1 ? 'Swedish massage 60 min' : 'باقة الاسترخاء الكاملة',
    kind: (i % 3 === 2 ? 'package' : 'service') as 'package' | 'service',
    beneficiary: (i % 4) + 1,
    baseHalalas: 25000,
    offerHalalas: 19600,
    vipDiscountHalalas: 4900,
    adjustmentHalalas: i === 0 ? -1000 : 0,
    finalHalalas: i === 0 ? 13700 : 14700,
    sessions: i % 3 === 2 ? { total: 2, used: 1, cancelled: 1 } : null,
  })),
  servicesTotalHalalas: 587000,
  deliveryFeeHalalas: 3000,
  grandTotalHalalas: 590000,
  payments: [
    { method: 'cash', amountHalalas: 20000, receivedAt: '2026-09-26T10:00:00Z' },
    { method: 'tamara', amountHalalas: 15050, receivedAt: '2026-09-26T11:00:00Z' },
    { method: 'paymob', amountHalalas: 100000, receivedAt: '2026-09-27T11:00:00Z' },
  ],
  paidHalalas: 135050,
  remainingHalalas: 454950,
  paymentStatus: 'partial',
  contact: { phone: '+966 55 000 0000', website: 'pamperme.sa' },
})

describe('customer document PDF rendering', () => {
  it.each(['ar', 'en'] as const)('renders a long %s document over several pages', async (locale) => {
    const pdf = await renderCustomerDocument(long(locale))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length
    expect(pages).toBeGreaterThan(1)
    if (process.env.PDF_OUT) fs.writeFileSync(`${process.env.PDF_OUT}/long-${locale}.pdf`, pdf)
  })
})
