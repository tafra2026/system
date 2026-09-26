import path from 'node:path'
import PDFDocument from 'pdfkit'
import { createTranslator, type Locale } from '@/i18n'
import { formatDate, formatDateTime, formatMoney } from '@/i18n/format'
import { ltr, visualRuns } from './bidi-text'

/** Everything the document shows, frozen at issue time (see customer_documents). */
export interface CustomerDocSnapshot {
  number: string
  version: number
  issuedAt: string
  locale: Locale
  orderReference: string
  orderStatus: string
  customerName: string
  visits: { sequence: number; startsAt: string | null; status: string }[]
  lines: {
    name: string
    kind: 'service' | 'package' | 'custom'
    beneficiary: number | null
    baseHalalas: number
    offerHalalas: number | null
    vipDiscountHalalas: number
    adjustmentHalalas: number
    finalHalalas: number
    sessions: { total: number; used: number; cancelled: number } | null
  }[]
  servicesTotalHalalas: number
  deliveryFeeHalalas: number
  grandTotalHalalas: number
  payments: { method: string; amountHalalas: number; receivedAt: string }[]
  paidHalalas: number
  remainingHalalas: number
  paymentStatus: 'paid' | 'partial' | 'unpaid'
  contact: { phone?: string; email?: string; address?: string; website?: string } | null
}

const FONT_DIR = path.join(process.cwd(), 'src/server/pdf/fonts')
const LOGO = path.join(process.cwd(), 'public/brand/logo.png')
const BRAND = '#AA8077'
const BRAND_DEEP = '#7E574F'
const INK = '#2B211E'
const MUTED = '#6B5E59'
const LINE = '#E8DDD6'
const CREAM = '#FEF3E8'

const PAGE = { width: 595.28, height: 841.89, margin: 40 }
const CONTENT_W = PAGE.width - PAGE.margin * 2

type Doc = PDFKit.PDFDocument

/**
 * Customer invoice / service statement as a PDF (A4). Arabic is shaped by the embedded
 * IBM Plex Sans Arabic font and ordered with the Unicode bidi algorithm (bidi-text.ts), so
 * mixed Arabic, English and numbers read correctly. Not a tax invoice (no VAT, no tax QR).
 */
export function renderCustomerDocument(snap: CustomerDocSnapshot): Promise<Buffer> {
  const rtl = snap.locale === 'ar'
  const t = createTranslator(snap.locale)
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, bufferPages: true, info: { Title: `${t('document.title')} ${snap.number}`, Author: 'Pamper Me Home Service' } })
  doc.registerFont('regular', path.join(FONT_DIR, 'IBMPlexSansArabic-Regular.ttf'))
  doc.registerFont('bold', path.join(FONT_DIR, 'IBMPlexSansArabic-Bold.ttf'))
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const money = (h: number) => formatMoney(h, snap.locale)
  let y = drawHeader(doc, snap, t, rtl)

  // Customer & order block.
  y = keyValues(doc, y, rtl, [
    [t('document.customer'), snap.customerName],
    [t('document.order'), ltr(snap.orderReference)],
    [t('document.issuedAt'), formatDateTime(new Date(snap.issuedAt), snap.locale)],
    ...(snap.version > 1 ? [[t('document.version'), String(snap.version)] as [string, string]] : []),
  ])

  // Visits (service dates).
  if (snap.visits.length) {
    y = sectionTitle(doc, y + 8, t('document.visits'), rtl)
    for (const v of snap.visits) {
      y = ensureSpace(doc, y, 20)
      const when = v.startsAt ? formatDateTime(new Date(v.startsAt), snap.locale) : t('document.notScheduled')
      y = row(doc, y, rtl, [
        { text: t('document.visitN', { n: v.sequence }), w: 0.3 },
        { text: when, w: 0.45 },
        { text: t(`visitStatus.${v.status as 'scheduled'}`), w: 0.25, color: v.status === 'cancelled' ? '#A3322A' : MUTED },
      ])
    }
  }

  // Items.
  y = sectionTitle(doc, y + 10, t('document.items'), rtl)
  const cols = [
    { key: 'name', w: 0.43 },
    { key: 'base', w: 0.19 },
    { key: 'discount', w: 0.19 },
    { key: 'final', w: 0.19 },
  ] as const
  y = row(doc, y, rtl, [
    { text: t('document.item'), w: cols[0].w, bold: true, color: MUTED },
    { text: t('document.price'), w: cols[1].w, bold: true, color: MUTED, align: 'num' },
    { text: t('document.discount'), w: cols[2].w, bold: true, color: MUTED, align: 'num' },
    { text: t('document.amount'), w: cols[3].w, bold: true, color: MUTED, align: 'num' },
  ])
  for (const l of snap.lines) {
    const discount = l.baseHalalas - l.finalHalalas
    const extra: string[] = []
    if (l.beneficiary != null && l.beneficiary > 1) extra.push(t('document.beneficiary', { n: l.beneficiary }))
    if (l.sessions) extra.push(t('document.sessions', { used: l.sessions.used, total: l.sessions.total }) + (l.sessions.cancelled ? ` · ${t('document.sessionsCancelled', { n: l.sessions.cancelled })}` : ''))
    const name = extra.length ? `${l.name}\n${extra.join(' · ')}` : l.name
    const before = y
    y = ensureSpace(doc, y, 34)
    if (y < before) y = sectionTitle(doc, y, `${t('document.items')} (${t('document.continued')})`, rtl)
    y = row(doc, y, rtl, [
      { text: name, w: cols[0].w },
      { text: money(l.baseHalalas), w: cols[1].w, align: 'num', color: MUTED },
      { text: discount > 0 ? `− ${money(discount)}` : '—', w: cols[2].w, align: 'num', color: MUTED },
      { text: money(l.finalHalalas), w: cols[3].w, align: 'num', bold: true },
    ])
  }

  // Totals.
  y = ensureSpace(doc, y + 6, 110)
  y = totals(doc, y, rtl, [
    [t('document.servicesTotal'), money(snap.servicesTotalHalalas), false],
    ...(snap.deliveryFeeHalalas ? [[t('document.delivery'), money(snap.deliveryFeeHalalas), false] as [string, string, boolean]] : []),
    [t('document.total'), money(snap.grandTotalHalalas), true],
    [t('document.paid'), money(snap.paidHalalas), false],
    [t('document.remaining'), money(snap.remainingHalalas), true],
  ])
  y = ensureSpace(doc, y + 4, 24)
  const statusText = t(`document.paymentStatus.${snap.paymentStatus}`)
  y = pill(doc, y, rtl, statusText, snap.paymentStatus === 'paid' ? '#2E7D4F' : snap.paymentStatus === 'partial' ? '#9A6B12' : '#A3322A')

  // Payments.
  if (snap.payments.length) {
    y = sectionTitle(doc, y + 10, t('document.payments'), rtl)
    for (const p of snap.payments) {
      const before = y
      y = ensureSpace(doc, y, 20)
      if (y < before) y = sectionTitle(doc, y, `${t('document.payments')} (${t('document.continued')})`, rtl)
      y = row(doc, y, rtl, [
        { text: t(`payments.methods.${p.method as 'cash'}`), w: 0.35 },
        { text: formatDate(new Date(p.receivedAt), snap.locale), w: 0.4, color: MUTED },
        { text: money(p.amountHalalas), w: 0.25, align: 'num', bold: true },
      ])
    }
  }

  drawFooters(doc, snap, t, rtl)
  doc.end()
  return done
}

// ─────────────────────────────── drawing helpers ───────────────────────────────

/** Draw one line of mixed-direction text inside [x, x+width]. */
function drawLine(doc: Doc, text: string, x: number, y: number, width: number, opts: { rtl: boolean; align: 'start' | 'end' | 'center'; size: number; bold?: boolean; color?: string }) {
  doc.font(opts.bold ? 'bold' : 'regular').fontSize(opts.size).fillColor(opts.color ?? INK)
  const runs = visualRuns(clean(text), opts.rtl)
  const widths = runs.map((r) => doc.widthOfString(r.text, { features: r.rtl ? ['rtla'] : [] }))
  const total = widths.reduce((a, b) => a + b, 0)
  const alignRight = (opts.align === 'start' && opts.rtl) || (opts.align === 'end' && !opts.rtl)
  let cx = opts.align === 'center' ? x + (width - total) / 2 : alignRight ? x + width - total : x
  runs.forEach((r, i) => {
    doc.text(r.text, cx, y, { lineBreak: false, features: r.rtl ? ['rtla'] : [] })
    cx += widths[i]!
  })
}

/** Characters the embedded font does not have (e.g. emoji) are dropped instead of printing boxes. */
function clean(text: string): string {
  return text.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').trim()
}

/** Word-wrap in logical order, then draw each line with bidi. Returns the height used. */
function drawWrapped(doc: Doc, text: string, x: number, y: number, width: number, opts: { rtl: boolean; align: 'start' | 'end'; size: number; bold?: boolean; color?: string }): number {
  doc.font(opts.bold ? 'bold' : 'regular').fontSize(opts.size)
  const lineHeight = opts.size * 1.45
  let lines = 0
  for (const para of clean(text).split('\n')) {
    let current = ''
    const flush = () => {
      drawLine(doc, current, x, y + lines * lineHeight, width, opts)
      lines++
      current = ''
    }
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word
      if (current && doc.widthOfString(candidate) > width) flush()
      current = current ? `${current} ${word}` : word
    }
    if (current) flush()
    if (!para.trim()) lines++
  }
  return Math.max(lines, 1) * lineHeight
}

type Cell = { text: string; w: number; bold?: boolean; color?: string; align?: 'num' }

/** A table row; columns flow right-to-left in Arabic. Numbers align to the inner edge. */
function row(doc: Doc, y: number, rtl: boolean, cells: Cell[]): number {
  const pad = 6
  let offset = 0
  let height = 0
  for (const c of cells) {
    const w = c.w * CONTENT_W
    const x = rtl ? PAGE.margin + CONTENT_W - offset - w : PAGE.margin + offset
    const size = c.bold ? 10.5 : 10
    const h = drawWrapped(doc, c.text, x + pad, y + 5, w - pad * 2, { rtl, align: c.align === 'num' ? 'end' : 'start', size, bold: c.bold, color: c.color })
    height = Math.max(height, h)
    offset += w
  }
  const bottom = y + height + 8
  doc.moveTo(PAGE.margin, bottom).lineTo(PAGE.margin + CONTENT_W, bottom).lineWidth(0.6).strokeColor(LINE).stroke()
  return bottom
}

function keyValues(doc: Doc, y: number, rtl: boolean, pairs: [string, string][]): number {
  for (const [k, v] of pairs) {
    y = row(doc, y, rtl, [
      { text: k, w: 0.3, color: MUTED },
      { text: v, w: 0.7, bold: true },
    ])
  }
  return y
}

function sectionTitle(doc: Doc, y: number, text: string, rtl: boolean): number {
  y = ensureSpace(doc, y, 60)
  drawLine(doc, text, PAGE.margin, y, CONTENT_W, { rtl, align: 'start', size: 13, bold: true, color: BRAND_DEEP })
  return y + 24
}

function totals(doc: Doc, y: number, rtl: boolean, items: [string, string, boolean][]): number {
  const boxW = CONTENT_W * 0.5
  const x = rtl ? PAGE.margin : PAGE.margin + CONTENT_W - boxW
  const h = items.length * 22 + 12
  doc.roundedRect(x, y, boxW, h, 8).fillColor(CREAM).fill()
  let cy = y + 8
  for (const [label, value, strong] of items) {
    const half = boxW / 2 - 12
    const labelX = rtl ? x + boxW / 2 : x + 12
    const valueX = rtl ? x + 12 : x + boxW / 2
    drawLine(doc, label, labelX, cy, half, { rtl, align: 'start', size: strong ? 11.5 : 10.5, bold: strong, color: strong ? INK : MUTED })
    drawLine(doc, value, valueX, cy, half, { rtl, align: 'end', size: strong ? 11.5 : 10.5, bold: strong })
    cy += 22
  }
  return y + h
}

function pill(doc: Doc, y: number, rtl: boolean, text: string, color: string): number {
  doc.font('bold').fontSize(10.5)
  const w = doc.widthOfString(text, { features: rtl ? ['rtla'] : [] }) + 24
  const x = rtl ? PAGE.margin : PAGE.margin + CONTENT_W - w
  doc.roundedRect(x, y + 4, w, 20, 10).fillColor(color).fill()
  drawLine(doc, text, x, y + 7, w, { rtl, align: 'center', size: 10.5, bold: true, color: '#FFFFFF' })
  return y + 28
}

function ensureSpace(doc: Doc, y: number, needed: number): number {
  if (y + needed <= PAGE.height - PAGE.margin - 28) return y
  doc.addPage()
  return PAGE.margin
}

function drawHeader(doc: Doc, snap: CustomerDocSnapshot, t: ReturnType<typeof createTranslator>, rtl: boolean): number {
  doc.rect(0, 0, PAGE.width, 96).fillColor(BRAND).fill()
  const logoW = 170
  try {
    doc.image(LOGO, rtl ? PAGE.width - PAGE.margin - logoW : PAGE.margin, 26, { width: logoW })
  } catch {
    // Missing logo must not block the document.
  }
  const blockX = rtl ? PAGE.margin : PAGE.width - PAGE.margin - 240
  drawLine(doc, t('document.title'), blockX, 26, 240, { rtl, align: 'end', size: 17, bold: true, color: '#FFFFFF' })
  drawLine(doc, `${t('document.number')} ${ltr(snap.number)}`, blockX, 52, 240, { rtl, align: 'end', size: 10.5, color: CREAM })
  return 116
}

function drawFooters(doc: Doc, snap: CustomerDocSnapshot, t: ReturnType<typeof createTranslator>, rtl: boolean) {
  const range = doc.bufferedPageRange()
  const contact = [snap.contact?.phone && ltr(snap.contact.phone), snap.contact?.email && ltr(snap.contact.email), snap.contact?.website && ltr(snap.contact.website), snap.contact?.address]
    .filter(Boolean)
    .join('  ·  ')
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i)
    const y = PAGE.height - PAGE.margin - 18
    doc.moveTo(PAGE.margin, y - 6).lineTo(PAGE.margin + CONTENT_W, y - 6).lineWidth(0.6).strokeColor(LINE).stroke()
    const left = `${t('document.notTax')}${contact ? `  ·  ${contact}` : ''}`
    drawLine(doc, left, PAGE.margin, y, CONTENT_W - 60, { rtl, align: 'start', size: 8.5, color: MUTED })
    drawLine(doc, `${i + 1} / ${range.count}`, rtl ? PAGE.margin : PAGE.margin + CONTENT_W - 60, y, 60, { rtl: false, align: rtl ? 'start' : 'end', size: 8.5, color: MUTED })
  }
}
