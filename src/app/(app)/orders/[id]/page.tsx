import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Forbidden } from '@/components/forbidden'
import { orderStatusTone, visitStatusTone } from '@/components/status-tones'
import { Badge, Card, PageHeader } from '@/components/ui'
import { createTranslator } from '@/i18n'
import { describeAppointment, formatDateTime, formatMoney } from '@/i18n/format'
import { toSarString } from '@/domain/money'
import { mapsLink } from '@/domain/order'
import { riyadhParts } from '@/domain/operational-day'
import { can } from '@/server/authz/actor'
import { pagePermission } from '@/server/auth/current'
import { NotFoundError } from '@/server/services/errors'
import { getOrderDetail, listBookableSpecialists, listModerators } from '@/server/services/orders'
import { AddressPhotoUpload } from '@/components/address-photo-upload'
import { PaymentsCard } from '@/components/payments-card'
import { OrderMessagesCard } from '@/components/order-messages-card'
import { orderBalance } from '@/server/services/commissions'
import { getDb } from '@/server/db'
import { BuildingPhoto } from '@/components/building-photo'
import { AdjustPriceForm, AssignItemForm, CompleteVisitButton, DeliveryFeeForm, ModeratorForm, NotesForm, PendingReviewForm, RescheduleForm } from './order-forms'

interface AddressSnapshot {
  label: string | null
  district: string
  addressLine: string | null
  buildingDetails: string | null
  accessInstructions: string | null
  latitude: number | null
  longitude: number | null
}

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { actor, allowed } = await pagePermission('orders.read.all')
  const t = createTranslator(actor.locale)
  if (!allowed) return <Forbidden message={t('errors.forbidden')} />
  let d: Awaited<ReturnType<typeof getOrderDetail>>
  try {
    d = await getOrderDetail(actor, id)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }
  const { order, customer } = d
  const canManage = can(actor, 'orders.manage')
  if (order.status === 'draft' && canManage) redirect(`/orders/${id}/edit`)
  const canSchedule = can(actor, 'schedule.manage')
  const canAdjust = can(actor, 'pricing.adjust') && order.status !== 'completed'
  const specialists = canSchedule ? await listBookableSpecialists(actor) : []
  const moderators = canManage ? await listModerators(actor) : []
  const address = order.addressSnapshot as AddressSnapshot | null
  const balance = await orderBalance(getDb(), order.id)
  const name = (x: { nameAr: string; nameEn: string }) => (actor.locale === 'en' ? x.nameEn : x.nameAr)
  const localParts = (dt: Date) => {
    const p = riyadhParts(dt)
    return { date: p.date, time: `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` }
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href="/orders" className="text-sm font-medium text-brand-deep hover:underline">
        {t('common.back')}
      </Link>
      <PageHeader title={t('orders.detailTitle', { reference: order.reference })} subtitle={order.confirmedAt ? `${t('orders.confirmedAt')}: ${formatDateTime(order.confirmedAt, actor.locale)}` : undefined} actions={<Badge tone={orderStatusTone[order.status]}>{t(`orderStatus.${order.status}`)}</Badge>} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title={t('orders.customer')} className="lg:col-span-1">
          <p className="font-semibold text-ink" dir="auto">
            <Link href={`/customers/${customer.id}`} className="hover:underline">
              {customer.name}
            </Link>
          </p>
          <p className="ltr-data text-sm text-muted">{customer.phoneE164}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {order.vipAtBooking && <Badge tone="brand">{t('orders.vipAtBooking')}</Badge>}
            <Badge>
              {t('orders.persons')}: <span className="ltr-data ms-1">{order.personsCount}</span>
            </Badge>
          </div>
          {address && (
            <div className="mt-3 text-sm text-ink" dir="auto">
              <p className="text-xs font-medium text-muted">{t('orders.address')}</p>
              <p>
                {address.label ? `${address.label} — ` : ''}
                {address.district}
                {address.addressLine ? `، ${address.addressLine}` : ''}
              </p>
              {address.buildingDetails && <p className="text-muted">{address.buildingDetails}</p>}
              {address.accessInstructions && <p className="text-muted">{address.accessInstructions}</p>}
              {address.latitude != null && address.longitude != null && (
                <a href={mapsLink(address.latitude, address.longitude)} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-deep underline">
                  {t('customers.openMap')}
                </a>
              )}
            </div>
          )}
          {order.addressId && can(actor, 'customers.manage') ? (
            <div className="mt-3">
              <AddressPhotoUpload addressId={order.addressId} photoUrl={d.buildingPhotoUrl} />
            </div>
          ) : (
            d.buildingPhotoUrl && <BuildingPhoto url={d.buildingPhotoUrl} compact />
          )}
        </Card>

        <Card title={t('orders.pricing')} className="lg:col-span-2">
          <ul className="divide-y divide-line">
            {d.lines.map((l) => (
              <li key={l.id} className="py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold text-ink" dir="auto">
                    {name(l)}
                    {l.kind === 'custom' && <span className="ms-2 text-xs font-normal text-muted">({t('orders.customLine')})</span>}
                    {l.beneficiaryIndex != null && <span className="ms-2 text-xs font-normal text-muted">{t('orders.beneficiary', { n: l.beneficiaryIndex })}</span>}
                  </p>
                  <p className="font-bold text-brand-deep">{l.finalPriceHalalas === 0 ? t('orders.free') : formatMoney(l.finalPriceHalalas, actor.locale)}</p>
                </div>
                <p className="text-xs text-muted">
                  {t('orders.basePrice')} {formatMoney(l.basePriceHalalas, actor.locale)}
                  {l.offerPriceHalalas != null && ` · ${t('orders.offerPrice')} ${formatMoney(l.offerPriceHalalas, actor.locale)}`}
                  {l.vipDiscountHalalas > 0 && ` · ${t('orders.vipDiscount')} −${formatMoney(l.vipDiscountHalalas, actor.locale)}`}
                  {l.finalPriceHalalas !== l.priceAfterVipHalalas && ` · ${t('orders.manualAdjustment')} ${formatMoney(l.finalPriceHalalas - l.priceAfterVipHalalas, actor.locale)}`}
                </p>
                {l.manualReason && (
                  <p className="text-xs text-muted" dir="auto">
                    {t('common.reason')}: {l.manualReason}
                  </p>
                )}
                {l.balance && (
                  <p className="mt-1 text-xs font-medium text-ink">
                    {t('orders.sessions')}: {t('orders.sessionsBalance', { total: l.balance.total, used: l.balance.used, scheduled: l.balance.scheduled, remaining: l.balance.remaining })}
                  </p>
                )}
                {canAdjust && <AdjustPriceForm orderId={order.id} lineId={l.id} current={l.manualFinalPriceHalalas != null ? toSarString(l.manualFinalPriceHalalas) : ''} />}
              </li>
            ))}
          </ul>
          <dl className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-brand-soft/60 p-3 text-sm sm:grid-cols-5">
            {[
              [t('orders.servicesTotal'), order.servicesTotalHalalas],
              [t('orders.deliveryFee'), order.deliveryFeeHalalas],
              [t('orders.grandTotal'), order.grandTotalHalalas],
              [t('orders.paid'), balance.confirmed],
              [t('orders.remaining'), balance.remaining],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="font-semibold text-ink">{formatMoney(value as number, actor.locale)}</dd>
              </div>
            ))}
          </dl>
          {canManage && order.status !== 'completed' && (
            <div className="mt-3">
              <DeliveryFeeForm orderId={order.id} current={toSarString(order.deliveryFeeHalalas)} />
            </div>
          )}
        </Card>
      </div>

      <PaymentsCard actor={actor} orderId={order.id} path={`/orders/${order.id}`} />
      <OrderMessagesCard actor={actor} orderId={order.id} />

      <Card title={t('orders.visits')}>
        <div className="flex flex-col gap-3">
          {d.visits.map((v) => {
            const appt = v.startsAt ? describeAppointment(v.startsAt, actor.locale) : null
            const sessionOf = d.lines.flatMap((l) => l.sessions.filter((s) => s.visitId === v.id).map((s) => ({ line: l, n: s.sessionNumber })))
            return (
              <div key={v.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-ink">
                    {t('orders.visit', { n: v.sequence })}
                    {sessionOf.map((s) => (
                      <span key={s.line.id} className="ms-2 text-xs font-normal text-muted">
                        {name(s.line)} — {t('orders.session', { n: s.n })}
                      </span>
                    ))}
                  </p>
                  <Badge tone={visitStatusTone[v.status]}>{t(`visitStatus.${v.status}`)}</Badge>
                </div>
                <p className="mt-1 text-sm text-ink">
                  {appt ? (
                    <>
                      {appt.date} · <bdi>{appt.time}</bdi> · {t('orders.minutes', { n: v.durationMinutes })}
                      {appt.afterMidnight && <span className="block text-xs text-warning">{t('datetime.afterMidnight', { date: appt.operationalDateLabel })}</span>}
                    </>
                  ) : (
                    <span className="text-muted">{t('orders.notScheduled')}</span>
                  )}
                </p>
                {v.specialists.length > 0 && (
                  <p className="text-sm text-muted">
                    {t('orders.specialists')}: {v.specialists.map((s) => s.name).join('، ')}
                  </p>
                )}
                {v.pendingReason && (
                  <p className="text-sm text-warning" dir="auto">
                    {t('orders.pendingReason')}: {v.pendingReason}
                  </p>
                )}
                <ul className="mt-2 flex flex-col gap-1 text-sm">
                  {v.items.map((it) => (
                    <li key={it.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-cream/70 px-2 py-1">
                      <span dir="auto">
                        {name(it)}
                        {it.beneficiaryIndex != null && d.order.personsCount > 1 && <span className="text-xs text-muted"> · {t('orders.beneficiary', { n: it.beneficiaryIndex })}</span>}
                        <span className="text-xs text-muted"> · {t('orders.minutes', { n: it.taskDurationMinutes })}</span>
                      </span>
                      {canSchedule && v.status !== 'completed' && v.specialists.length > 0 ? (
                        <AssignItemForm orderId={order.id} itemId={it.id} current={it.specialistEmployeeId} specialists={v.specialists} />
                      ) : (
                        <span className="text-xs text-muted">{it.specialistName ?? t('orders.unassigned')}</span>
                      )}
                    </li>
                  ))}
                </ul>
                {canSchedule && v.status !== 'completed' && (
                  <div className="mt-3 flex flex-wrap items-start gap-2">
                    <RescheduleForm
                      orderId={order.id}
                      visitId={v.id}
                      label={v.startsAt ? t('orders.reschedule') : t('orders.schedule')}
                      specialists={specialists}
                      defaults={{ ...(v.startsAt ? localParts(v.startsAt) : { date: '', time: '' }), durationMinutes: v.durationMinutes, specialistIds: v.specialists.map((s) => s.id) }}
                    />
                    {v.status === 'scheduled' && <CompleteVisitButton path={`/orders/${order.id}`} visitId={v.id} />}
                    {v.status !== 'pending_review' && <PendingReviewForm orderId={order.id} visitId={v.id} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={t('orders.moderator')}>
          <p className="mb-2 text-sm text-ink">{d.moderatorName ?? t('orders.noModerator')}</p>
          {d.moderatorHistory.length > 0 && (
            <details className="mb-3 text-xs text-muted">
              <summary className="cursor-pointer">{t('orders.moderatorHistory')}</summary>
              <ul className="mt-1 flex flex-col gap-1">
                {d.moderatorHistory.map((h, i) => (
                  <li key={i}>
                    {formatDateTime(h.changedAt, actor.locale)}: {h.fromName ?? '—'} {actor.locale === 'ar' ? '←' : '→'} {h.toName ?? '—'}
                    {h.reason ? ` (${h.reason})` : ''}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {canManage && <ModeratorForm orderId={order.id} current={order.moderatorEmployeeId} moderators={moderators} />}
        </Card>
        <Card title={t('orders.notes')}>{canManage ? <NotesForm orderId={order.id} current={order.notes} /> : <p className="text-sm text-ink">{order.notes ?? t('common.none')}</p>}</Card>
      </div>
    </div>
  )
}
