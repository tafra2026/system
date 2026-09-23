import { Forbidden } from '@/components/forbidden'
import { createTranslator } from '@/i18n'
import { pagePermission } from '@/server/auth/current'
import { getCustomer } from '@/server/services/customers'
import { BookingWizard, type WizardInitial } from '../wizard/booking-wizard'
import { loadWizardContext } from '../wizard/load'

export default async function NewOrderPage({ searchParams }: { searchParams: Promise<{ customer?: string }> }) {
  const { actor, allowed } = await pagePermission('orders.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  const ctx = await loadWizardContext(actor)
  const customerId = (await searchParams).customer
  let initial: WizardInitial = { orderId: null, reference: null, customer: null, addresses: [], input: null }
  if (customerId) {
    try {
      const d = await getCustomer(actor, customerId)
      initial = {
        ...initial,
        customer: { id: d.customer.id, name: d.customer.name, phoneE164: d.customer.phoneE164, isVip: d.customer.isVip },
        addresses: d.addresses.map((a) => ({ id: a.id, label: a.label, district: a.district, addressLine: a.addressLine, latitude: a.latitude, longitude: a.longitude })),
      }
    } catch {
      // Unknown customer id: start from the customer step.
    }
  }
  return <BookingWizard ctx={ctx} initial={initial} />
}
