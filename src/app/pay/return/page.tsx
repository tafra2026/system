import type { Metadata } from 'next'
import { BrandLogo } from '@/components/brand-logo'
import { syncTabbyPayment, syncTamaraOrder } from '@/server/services/payment-links'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Pamper Me', robots: { index: false } }

/**
 * Where the customer lands after the provider's checkout. It shows no order data and the
 * browser's parameters prove nothing: for Tabby/Tamara the id is only used to ask the provider's
 * API directly (server-to-server), exactly like a notification would. Paymob is confirmed by its
 * signed notification only. The customer's language is unknown here, so both languages are shown.
 */
export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams
  try {
    if (q.provider === 'tabby' && q.payment_id) await syncTabbyPayment(q.payment_id)
    if (q.provider === 'tamara' && q.orderId) await syncTamaraOrder(q.orderId)
  } catch {
    // The notification or the worker's re-check will record it.
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="rounded-2xl bg-brand px-6 py-4">
        <BrandLogo label="Pamper Me" height={40} />
      </div>
      <section lang="ar" dir="rtl" className="flex flex-col gap-2">
        <h1 className="text-xl font-bold text-ink">شكرًا لكِ 🌸</h1>
        <p className="text-sm text-muted">إذا اكتمل الدفع سيصلنا تأكيده من بوابة الدفع مباشرة، وسيتواصل معك فريق Pamper Me عند الحاجة.</p>
      </section>
      <section lang="en" dir="ltr" className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">Thank you 🌸</h2>
        <p className="text-sm text-muted">If the payment was completed, the payment provider confirms it to us directly. The Pamper Me team will contact you if needed.</p>
      </section>
    </main>
  )
}
