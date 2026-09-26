import type { Metadata } from 'next'
import { BrandLogo } from '@/components/brand-logo'

export const metadata: Metadata = { title: 'Pamper Me', robots: { index: false } }

/**
 * Where the customer lands after the provider's checkout. It shows no order data and does
 * NOT confirm the payment: only the provider's verified notification to our server does.
 * The customer's language is unknown here, so both languages are shown.
 */
export default function PaymentReturnPage() {
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
