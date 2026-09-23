import { notFound, redirect } from 'next/navigation'
import { Forbidden } from '@/components/forbidden'
import { createTranslator } from '@/i18n'
import { pagePermission } from '@/server/auth/current'
import { getCustomer } from '@/server/services/customers'
import { NotFoundError, ValidationError } from '@/server/services/errors'
import { getDraftInput } from '@/server/services/orders'
import { BookingWizard } from '../../wizard/booking-wizard'
import { loadWizardContext } from '../../wizard/load'

export default async function EditDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { actor, allowed } = await pagePermission('orders.manage')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  let draft: Awaited<ReturnType<typeof getDraftInput>>
  try {
    draft = await getDraftInput(actor, id)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    if (err instanceof ValidationError) redirect(`/orders/${id}`)
    throw err
  }
  const [ctx, c] = await Promise.all([loadWizardContext(actor), getCustomer(actor, draft.input.customerId)])
  return (
    <BookingWizard
      ctx={ctx}
      initial={{
        orderId: id,
        reference: draft.reference,
        customer: { id: c.customer.id, name: c.customer.name, phoneE164: c.customer.phoneE164, isVip: c.customer.isVip },
        addresses: c.addresses.map((a) => ({ id: a.id, label: a.label, district: a.district, addressLine: a.addressLine, latitude: a.latitude, longitude: a.longitude, photoFileId: a.photoFileId })),
        input: {
          addressId: draft.input.addressId ?? null,
          personsCount: draft.input.personsCount ?? 1,
          moderatorEmployeeId: draft.input.moderatorEmployeeId ?? null,
          deliveryFeeHalalas: draft.input.deliveryFeeHalalas ?? 0,
          notes: draft.input.notes ?? null,
          lines: draft.input.lines as never,
          visits: draft.input.visits,
        },
      }}
    />
  )
}
