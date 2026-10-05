import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { BrandLogo } from '@/components/brand-logo'
import { paymentLinkTarget } from '@/server/services/payment-links'

export const metadata: Metadata = { title: 'Pamper Me', robots: { index: false } }
export const dynamic = 'force-dynamic'

/**
 * Short, branded payment link sent to customers (pamperme-ksa.com/p/PL-…). An open link goes
 * straight to the gateway's own payment page; otherwise a short bilingual note is shown.
 * Nothing about the order or the customer is shown here.
 */
export default async function ShortPayLink({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params
  const target = await paymentLinkTarget(ref)
  if (target.kind === 'open') redirect(target.url)
  const text =
    target.kind === 'paid'
      ? { ar: 'تم الدفع، شكرًا لكِ 🌸', en: 'Paid — thank you 🌸' }
      : { ar: 'هذا الرابط لم يعد صالحًا. تواصلي مع فريق Pamper Me لرابط جديد.', en: 'This link is no longer valid. Please contact the Pamper Me team for a new one.' }
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="rounded-2xl bg-brand px-6 py-4">
        <BrandLogo label="Pamper Me" height={40} />
      </div>
      <p lang="ar" dir="rtl" className="text-lg font-semibold text-ink">
        {text.ar}
      </p>
      <p lang="en" dir="ltr" className="text-sm text-muted">
        {text.en}
      </p>
    </main>
  )
}
