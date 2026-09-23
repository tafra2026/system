'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { inputClass } from '@/components/form-styles'
import { useI18n } from '@/components/i18n-provider'
import { useOnline } from '@/components/online-status'
import { Alert, Badge, buttonStyles } from '@/components/ui'
import { DomainError } from '@/domain/errors'
import { parseSarInput, toSarString } from '@/domain/money'
import { suggestedVisitMinutes } from '@/domain/order'
import { DELIVERY_FEE_MAX, priceLine, type LinePricing } from '@/domain/pricing'
import { translateError } from '@/i18n'
import type { MessageKey } from '@/i18n/types'
import { formatMoney } from '@/i18n/format'
import { AddAddressForm } from '../../customers/customer-forms'
import { customerAddressesAction, lookupPhoneAction, quickCreateCustomerAction, type AddressLite, type CustomerLite } from '../../customers/actions'
import { saveOrderAction } from '../actions'

// ─────────────────────────────── Types shared with the server page ───────────────────────────────

export interface WizardService {
  id: string
  categoryCode: string
  nameAr: string
  nameEn: string
  basePriceHalalas: number
  offerPriceHalalas: number
  durationMinutes: number
}
export interface WizardPackage {
  id: string
  nameAr: string
  nameEn: string
  basePriceHalalas: number
  offerPriceHalalas: number
  personsCount: number
  visitsCount: number
  visitDurationMinutes: number
  specialistsPerVisit: number
  components: { nameAr: string; nameEn: string; quantity: number }[]
}
export interface WizardContext {
  categories: { code: string; nameAr: string; nameEn: string }[]
  services: WizardService[]
  packages: WizardPackage[]
  specialists: { id: string; name: string; off?: { weekly: number[]; dates: string[] } }[]
  moderators: { id: string; name: string }[]
  vipOnPackages: boolean
  permissions: { adjust: boolean; free: boolean; custom: boolean }
  defaultModeratorId: string | null
}

type Manual = { manualPrice: string; manualReason: string }
type ServiceLine = { key: string; kind: 'service'; serviceId: string; beneficiaryIndex: number; visitIndex: number; specialistId: string | null } & Manual
type PackageLine = { key: string; kind: 'package'; packageId: string; visitIndexes: number[] } & Manual
type CustomLine = { key: string; kind: 'custom'; name: string; price: string; durationMinutes: number; notes: string; vipEligible: boolean; beneficiaryIndex: number; visitIndex: number; specialistId: string | null } & Manual
type Line = ServiceLine | PackageLine | CustomLine
interface VisitState {
  date: string
  time: string
  duration: string
  specialistIds: string[]
}

export interface WizardInitial {
  orderId: string | null
  reference: string | null
  customer: CustomerLite | null
  addresses: AddressLite[]
  input: {
    addressId: string | null
    personsCount: number
    moderatorEmployeeId: string | null
    deliveryFeeHalalas: number
    notes: string | null
    lines: (
      | { kind: 'service'; serviceId: string; beneficiaryIndex: number; visitIndex: number; specialistId?: string | null; manualFinalPrice?: number | null; manualReason?: string | null }
      | { kind: 'package'; packageId: string; visitIndexes: number[]; manualFinalPrice?: number | null; manualReason?: string | null }
      | { kind: 'custom'; name: string; priceHalalas: number; durationMinutes: number; notes?: string | null; vipEligible?: boolean; beneficiaryIndex: number; visitIndex: number; specialistId?: string | null; manualFinalPrice?: number | null; manualReason?: string | null }
    )[]
    visits: { date?: string | null; time?: string | null; durationMinutes?: number | null; specialistIds?: string[] }[]
  } | null
}

/** Operational date of a local date/time: times up to 03:00 belong to the previous day. */
function operationalDateOfLocal(date: string, time: string): string {
  if (time && time <= '03:00') {
    const d = new Date(`${date}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }
  return date
}

function isOff(s: { off?: { weekly: number[]; dates: string[] } }, date: string, time: string): boolean {
  if (!s.off || !date) return false
  const op = operationalDateOfLocal(date, time)
  return s.off.dates.includes(op) || s.off.weekly.includes(new Date(`${op}T12:00:00Z`).getUTCDay())
}

const STEPS = ['stepCustomer', 'stepLocation', 'stepServices', 'stepSchedule', 'stepPricing', 'stepReview'] as const
let keySeq = 0
const newKey = () => `l${++keySeq}`

function initialLines(init: WizardInitial['input']): Line[] {
  if (!init) return []
  return init.lines.map((l) => {
    const manual = { manualPrice: l.manualFinalPrice != null ? toSarString(l.manualFinalPrice) : '', manualReason: l.manualReason ?? '' }
    if (l.kind === 'service') return { key: newKey(), kind: 'service', serviceId: l.serviceId, beneficiaryIndex: l.beneficiaryIndex, visitIndex: l.visitIndex, specialistId: l.specialistId ?? null, ...manual }
    if (l.kind === 'package') return { key: newKey(), kind: 'package', packageId: l.packageId, visitIndexes: l.visitIndexes, ...manual }
    return {
      key: newKey(),
      kind: 'custom',
      name: l.name,
      price: toSarString(l.priceHalalas),
      durationMinutes: l.durationMinutes,
      notes: l.notes ?? '',
      vipEligible: l.vipEligible ?? false,
      beneficiaryIndex: l.beneficiaryIndex,
      visitIndex: l.visitIndex,
      specialistId: l.specialistId ?? null,
      ...manual,
    }
  })
}

// ─────────────────────────────── Component ───────────────────────────────

export function BookingWizard({ ctx, initial }: { ctx: WizardContext; initial: WizardInitial }) {
  const { t, locale } = useI18n()
  const router = useRouter()
  const online = useOnline()
  const [pending, startTransition] = useTransition()
  const nameOf = (x: { nameAr: string; nameEn: string }) => (locale === 'en' ? x.nameEn : x.nameAr)

  const [step, setStep] = useState(initial.customer ? (initial.input?.addressId ? 2 : 1) : 0)
  const [orderId, setOrderId] = useState(initial.orderId)
  const [reference, setReference] = useState(initial.reference)
  const [customer, setCustomer] = useState<CustomerLite | null>(initial.customer)
  const [addresses, setAddresses] = useState<AddressLite[]>(initial.addresses)
  const [addressId, setAddressId] = useState<string | null>(initial.input?.addressId ?? initial.addresses[0]?.id ?? null)
  const [persons, setPersons] = useState(initial.input?.personsCount ?? 1)
  const [lines, setLines] = useState<Line[]>(() => initialLines(initial.input))
  const [visitsState, setVisits] = useState<VisitState[]>(() =>
    initial.input?.visits.length
      ? initial.input.visits.map((v) => ({ date: v.date ?? '', time: v.time ?? '', duration: v.durationMinutes ? String(v.durationMinutes) : '', specialistIds: v.specialistIds ?? [] }))
      : [{ date: '', time: '', duration: '', specialistIds: [] }],
  )
  const [deliveryFee, setDeliveryFee] = useState(initial.input ? toSarString(initial.input.deliveryFeeHalalas) : '0')
  const [moderatorId, setModeratorId] = useState<string | null>(initial.input?.moderatorEmployeeId ?? ctx.defaultModeratorId)
  const [notes, setNotes] = useState(initial.input?.notes ?? '')
  const [errors, setErrors] = useState<{ message: string; fields: string[] } | null>(null)
  const activeStepRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    activeStepRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [step])
  const [savedNote, setSavedNote] = useState<string | null>(null)

  const serviceById = (id: string) => ctx.services.find((s) => s.id === id)
  const packageById = (id: string) => ctx.packages.find((p) => p.id === id)
  const specialistName = (id: string) => ctx.specialists.find((s) => s.id === id)?.name ?? ''

  // ── Pricing preview (the server recomputes authoritatively) ──
  const pricing = useMemo(() => {
    return lines.map((l): { pricing: LinePricing | null; error: string | null } => {
      const manualFinalPrice = l.manualPrice.trim() ? parseSarInput(l.manualPrice) : null
      if (l.manualPrice.trim() && manualFinalPrice == null) return { pricing: null, error: 'amount_invalid' }
      const common = { vipCustomer: customer?.isVip ?? false, manualFinalPrice, manualReason: l.manualReason }
      try {
        if (l.kind === 'service') {
          const s = serviceById(l.serviceId)
          if (!s) return { pricing: null, error: 'invalid' }
          return { pricing: priceLine({ basePrice: s.basePriceHalalas, offerPrice: s.offerPriceHalalas, vipEligible: true, ...common }), error: null }
        }
        if (l.kind === 'package') {
          const p = packageById(l.packageId)
          if (!p) return { pricing: null, error: 'invalid' }
          return { pricing: priceLine({ basePrice: p.basePriceHalalas, offerPrice: p.offerPriceHalalas, vipEligible: ctx.vipOnPackages, ...common }), error: null }
        }
        const price = parseSarInput(l.price)
        if (price == null) return { pricing: null, error: 'amount_invalid' }
        return { pricing: priceLine({ basePrice: price, offerPrice: null, vipEligible: l.vipEligible, ...common }), error: null }
      } catch (err) {
        return { pricing: null, error: err instanceof DomainError ? err.code : 'invalid' }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, customer])
  const servicesTotal = pricing.reduce((a, p) => a + (p.pricing?.finalPrice ?? 0), 0)
  const feeHalalas = parseSarInput(deliveryFee)
  const feeValid = feeHalalas != null && feeHalalas <= DELIVERY_FEE_MAX

  // ── Visits bookkeeping ──
  const ensureVisits = (count: number) => setVisits((vs) => (vs.length >= count ? vs : [...vs, ...Array.from({ length: count - vs.length }, () => ({ date: '', time: '', duration: '', specialistIds: [] }))]))
  const visitTasks = (i: number) =>
    lines.flatMap((l) => {
      if (l.kind === 'service' && l.visitIndex === i) return [{ specialistId: l.specialistId, taskMinutes: serviceById(l.serviceId)?.durationMinutes ?? 0 }]
      if (l.kind === 'custom' && l.visitIndex === i) return [{ specialistId: l.specialistId, taskMinutes: l.durationMinutes }]
      return []
    })
  const visitPackages = (i: number) => lines.flatMap((l) => (l.kind === 'package' && l.visitIndexes.includes(i) ? [{ line: l, pkg: packageById(l.packageId)!, session: l.visitIndexes.indexOf(i) + 1 }] : []))
  const suggestion = (i: number) => suggestedVisitMinutes(visitTasks(i), visitPackages(i).map((p) => p.pkg.visitDurationMinutes))

  const updateLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? ({ ...l, ...patch } as Line) : l)))
  const removeLine = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key))
  const removeVisit = (i: number) => {
    if (visitsState.length <= 1) return
    setVisits((vs) => vs.filter((_, j) => j !== i))
    setLines((ls) =>
      ls.map((l) => {
        if (l.kind === 'package') return { ...l, visitIndexes: l.visitIndexes.map((v) => (v > i ? v - 1 : v === i ? 0 : v)) }
        return { ...l, visitIndex: l.visitIndex > i ? l.visitIndex - 1 : l.visitIndex === i ? 0 : l.visitIndex }
      }),
    )
  }

  // ── Payload ──
  const buildInput = () => ({
    customerId: customer?.id,
    addressId,
    personsCount: persons,
    moderatorEmployeeId: moderatorId,
    deliveryFeeHalalas: feeHalalas ?? -1,
    notes,
    lines: lines.map((l) => {
      const manualFinalPrice = l.manualPrice.trim() ? (parseSarInput(l.manualPrice) ?? -1) : null
      const manual = { manualFinalPrice, manualReason: l.manualReason || null }
      if (l.kind === 'service') return { kind: 'service', serviceId: l.serviceId, beneficiaryIndex: l.beneficiaryIndex, visitIndex: l.visitIndex, specialistId: l.specialistId, ...manual }
      if (l.kind === 'package') return { kind: 'package', packageId: l.packageId, visitIndexes: l.visitIndexes, ...manual }
      return { kind: 'custom', name: l.name, priceHalalas: parseSarInput(l.price) ?? -1, durationMinutes: l.durationMinutes, notes: l.notes || null, vipEligible: l.vipEligible, beneficiaryIndex: l.beneficiaryIndex, visitIndex: l.visitIndex, specialistId: l.specialistId, ...manual }
    }),
    visits: visitsState.map((v) => ({ date: v.date || null, time: v.time || null, durationMinutes: v.duration ? Number(v.duration) : null, specialistIds: v.specialistIds })),
  })

  const describeField = (field: string): string => {
    const [kind, idx] = field.split('.')
    if (kind === 'lines' && idx != null) {
      const l = lines[Number(idx)]
      if (!l) return ''
      const n = l.kind === 'service' ? nameOf(serviceById(l.serviceId)!) : l.kind === 'package' ? nameOf(packageById(l.packageId)!) : l.name
      return `${n}: `
    }
    if (kind === 'visits' && idx != null) return `${t('orders.visit', { n: Number(idx) + 1 })}: `
    const labels: Record<string, MessageKey> = { addressId: 'wizard.stepLocation', deliveryFeeHalalas: 'orders.deliveryFee', personsCount: 'wizard.persons', customerId: 'wizard.stepCustomer', moderatorEmployeeId: 'wizard.moderator' }
    return labels[field] ? `${t(labels[field])}: ` : ''
  }

  const submit = (confirm: boolean) => {
    if (!customer) return
    setErrors(null)
    setSavedNote(null)
    startTransition(async () => {
      const res = await saveOrderAction(orderId, buildInput(), confirm)
      if (!res.ok || !res.data) {
        const fields = Object.entries(res.fieldErrors ?? {}).map(([f, code]) => `${describeField(f)}${translateError(t, code, { max: DELIVERY_FEE_MAX / 100 })}`)
        setErrors({ message: translateError(t, res.error, res.errorParams), fields })
        return
      }
      if (confirm) {
        router.push(`/orders/${res.data.id}`)
        return
      }
      setOrderId(res.data.id)
      setReference(res.data.reference)
      setSavedNote(t('wizard.draftSaved'))
      window.history.replaceState(null, '', `/orders/${res.data.id}/edit`)
    })
  }

  // ─────────────────────────────── Steps ───────────────────────────────

  const canGo = (i: number) => i === 0 || !!customer

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">{reference ? t('wizard.editTitle', { reference }) : t('wizard.title')}</h1>
      </div>

      <nav aria-label={t('wizard.title')}>
        <ol className="flex gap-1 overflow-x-auto pb-1">
          {STEPS.map((s, i) => (
            <li key={s} className="shrink-0">
              <button
                type="button"
                ref={step === i ? activeStepRef : undefined}
                disabled={!canGo(i)}
                onClick={() => setStep(i)}
                aria-current={step === i ? 'step' : undefined}
                className={`min-h-10 rounded-full px-3 text-xs font-semibold ${step === i ? 'bg-brand-deep text-white' : 'border border-line bg-surface text-ink disabled:opacity-50'}`}
              >
                <span className="ltr-data">{i + 1}</span> · {t(`wizard.${s}`)}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {errors && (
        <Alert tone="error">
          <p className="font-semibold">{errors.message}</p>
          {errors.fields.length > 0 && (
            <ul className="mt-1 list-disc ps-5">
              {errors.fields.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {savedNote && <Alert tone="success">{savedNote}</Alert>}

      <section className="rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
        {step === 0 && (
          <CustomerStep
            customer={customer}
            onSelect={async (c) => {
              const res = await customerAddressesAction(c.id)
              if (res.ok && res.data) {
                setCustomer(res.data.customer)
                setAddresses(res.data.addresses)
                setAddressId(res.data.addresses[0]?.id ?? null)
                setStep(1)
              }
            }}
          />
        )}

        {step === 1 && customer && (
          <div className="flex flex-col gap-4">
            <h2 className="text-base font-semibold text-ink">{t('wizard.chooseAddress')}</h2>
            {addresses.length === 0 && <p className="text-sm text-muted">{t('customers.noAddresses')}</p>}
            <div className="flex flex-col gap-2">
              {addresses.map((a) => (
                <label key={a.id} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 ${addressId === a.id ? 'border-brand-deep bg-brand-soft' : 'border-line'}`}>
                  <input type="radio" name="address" checked={addressId === a.id} onChange={() => setAddressId(a.id)} className="h-5 w-5 accent-[var(--color-brand-deep)]" />
                  <span className="text-sm text-ink" dir="auto">
                    {a.label ? <strong>{a.label} — </strong> : null}
                    {a.district}
                    {a.addressLine ? `، ${a.addressLine}` : ''}
                  </span>
                  {a.latitude == null && <span className="text-xs text-muted">({t('customers.noLocation')})</span>}
                </label>
              ))}
            </div>
            <details className="rounded-xl border border-dashed border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand-deep">{t('customers.addAddress')}</summary>
              <div className="mt-3">
                <AddAddressForm
                  customerId={customer.id}
                  onAdded={(a) => {
                    setAddresses((as) => [...as, a])
                    setAddressId(a.id)
                  }}
                />
              </div>
            </details>
          </div>
        )}

        {step === 2 && (
          <ServicesStep
            ctx={ctx}
            persons={persons}
            setPersons={setPersons}
            lines={lines}
            visitCount={visitsState.length}
            nameOf={nameOf}
            onAdd={(l) => {
              if (l.kind === 'package') ensureVisits(Math.max(...l.visitIndexes) + 1)
              if (l.kind === 'package') {
                const p = packageById(l.packageId)
                if (p && p.personsCount > persons) setPersons(p.personsCount)
              }
              setLines((ls) => [...ls, l])
            }}
            onUpdate={updateLine}
            onRemove={removeLine}
            onAddVisit={() => ensureVisits(visitsState.length + 1)}
          />
        )}

        {step === 3 && (
          <div className="flex flex-col gap-5">
            <p className="text-xs text-muted">{t('wizard.visitTimeHint')}</p>
            {visitsState.map((v, i) => {
              const pkgs = visitPackages(i)
              const needs = Math.max(0, ...pkgs.map((p) => p.pkg.specialistsPerVisit))
              const assignable = lines.filter((l): l is ServiceLine | CustomLine => l.kind !== 'package' && l.visitIndex === i)
              const laterSession = pkgs.length > 0 && pkgs.every((p) => p.session > 1) && assignable.length === 0
              return (
                <fieldset key={i} className="rounded-xl border border-line p-3">
                  <legend className="px-1 text-sm font-semibold text-ink">
                    {t('orders.visit', { n: i + 1 })}
                    {pkgs.map((p) => (
                      <span key={p.line.key} className="ms-2 text-xs font-normal text-muted">
                        {nameOf(p.pkg)} — {t('orders.session', { n: p.session })}
                      </span>
                    ))}
                  </legend>
                  {laterSession && <p className="mb-2 text-xs text-muted">{t('wizard.laterSessionHint')}</p>}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                      {t('wizard.visitDate')}
                      <input type="date" className={inputClass} dir="ltr" value={v.date} onChange={(e) => setVisits((vs) => vs.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                      {t('wizard.visitTime')}
                      <input type="time" className={inputClass} dir="ltr" value={v.time} onChange={(e) => setVisits((vs) => vs.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                      {t('wizard.visitDuration')}
                      <input
                        type="number"
                        min={5}
                        max={720}
                        className={inputClass}
                        dir="ltr"
                        placeholder={String(suggestion(i))}
                        value={v.duration}
                        onChange={(e) => setVisits((vs) => vs.map((x, j) => (j === i ? { ...x, duration: e.target.value } : x)))}
                      />
                      <span className="text-xs font-normal text-muted">{t('wizard.visitDurationHint', { minutes: suggestion(i) })}</span>
                    </label>
                  </div>
                  <div className="mt-3">
                    <p className="text-sm font-medium text-ink">{t('wizard.chooseSpecialists')}</p>
                    {needs > 0 && <p className="text-xs text-muted">{t('wizard.packageNeeds', { n: needs })}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ctx.specialists.map((s) => {
                        const checked = v.specialistIds.includes(s.id)
                        const off = isOff(s, v.date, v.time)
                        return (
                          <label key={s.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${checked ? 'border-brand-deep bg-brand-soft text-brand-deep' : 'border-line text-ink'} ${off && !checked ? 'opacity-50' : ''}`}>
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-[var(--color-brand-deep)]"
                              checked={checked}
                              disabled={off && !checked}
                              onChange={() =>
                                setVisits((vs) => vs.map((x, j) => (j === i ? { ...x, specialistIds: checked ? x.specialistIds.filter((id) => id !== s.id) : [...x.specialistIds, s.id] } : x)))
                              }
                            />
                            <span dir="auto">{s.name}</span>
                            {off && <Badge tone="warning">{t('timeoff.offBadge')}</Badge>}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                  {assignable.length > 0 && v.specialistIds.length > 1 && (
                    <div className="mt-3 flex flex-col gap-2">
                      {assignable.map((l) => (
                        <label key={l.key} className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink">
                          <span dir="auto">
                            {l.kind === 'service' ? nameOf(serviceById(l.serviceId)!) : l.name} · {t('orders.beneficiary', { n: l.beneficiaryIndex })}
                          </span>
                          <select className={`${inputClass} max-w-56`} value={l.specialistId ?? ''} onChange={(e) => updateLine(l.key, { specialistId: e.target.value || null })} aria-label={t('wizard.assignTo')}>
                            <option value="">{t('wizard.unassigned')}</option>
                            {v.specialistIds.map((id) => (
                              <option key={id} value={id}>
                                {specialistName(id)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                  {visitsState.length > 1 && (
                    <button type="button" className={`${buttonStyles.ghost} mt-2`} onClick={() => removeVisit(i)}>
                      {t('wizard.removeVisit')}
                    </button>
                  )}
                </fieldset>
              )
            })}
          </div>
        )}

        {step === 4 && (
          <div className="flex flex-col gap-4">
            {customer?.isVip && <Alert tone="info">{t('wizard.vipApplied')}</Alert>}
            {lines.length === 0 && <p className="text-sm text-muted">{t('wizard.noLines')}</p>}
            {lines.map((l, i) => {
              const p = pricing[i]!
              const label = l.kind === 'service' ? nameOf(serviceById(l.serviceId)!) : l.kind === 'package' ? nameOf(packageById(l.packageId)!) : l.name
              return (
                <div key={l.key} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-semibold text-ink" dir="auto">
                      {label}
                    </p>
                    <p className="text-lg font-bold text-brand-deep">{p.pricing ? formatMoney(p.pricing.finalPrice, locale) : '—'}</p>
                  </div>
                  {p.pricing && (
                    <p className="mt-1 text-xs text-muted">
                      {t('orders.basePrice')} {formatMoney(p.pricing.basePrice, locale)}
                      {p.pricing.offerPrice != null && ` · ${t('orders.offerPrice')} ${formatMoney(p.pricing.offerPrice, locale)}`}
                      {p.pricing.vipDiscount > 0 && ` · ${t('orders.vipDiscount')} −${formatMoney(p.pricing.vipDiscount, locale)}`}
                      {p.pricing.manualAdjustment !== 0 && ` · ${t('orders.manualAdjustment')} ${p.pricing.manualAdjustment > 0 ? '+' : '−'}${formatMoney(Math.abs(p.pricing.manualAdjustment), locale)}`}
                    </p>
                  )}
                  {p.error && <p className="mt-1 text-xs font-medium text-danger">{translateError(t, p.error)}</p>}
                  {ctx.permissions.adjust && (
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink">
                        {t('wizard.manualPrice')}
                        <input className={inputClass} inputMode="decimal" dir="ltr" value={l.manualPrice} onChange={(e) => updateLine(l.key, { manualPrice: e.target.value })} />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-medium text-ink">
                        {t('wizard.manualReason')}
                        <input className={inputClass} dir="auto" value={l.manualReason} onChange={(e) => updateLine(l.key, { manualReason: e.target.value })} />
                      </label>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                {t('wizard.deliveryFee')}
                <input className={inputClass} inputMode="decimal" dir="ltr" value={deliveryFee} onChange={(e) => setDeliveryFee(e.target.value)} aria-invalid={!feeValid || undefined} />
                {!feeValid && <span className="text-xs text-danger">{translateError(t, 'delivery_fee_out_of_range', { max: DELIVERY_FEE_MAX / 100 })}</span>}
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-ink">
                {t('wizard.moderator')}
                <select className={inputClass} value={moderatorId ?? ''} onChange={(e) => setModeratorId(e.target.value || null)}>
                  <option value="">{t('orders.noModerator')}</option>
                  {ctx.moderators.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              {t('wizard.notes')}
              <textarea className={`${inputClass} min-h-20 py-2`} dir="auto" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </label>
            <Totals services={servicesTotal} fee={feeValid ? feeHalalas! : 0} />
            <p className="text-xs text-muted">{t('wizard.previewNote')}</p>
          </div>
        )}

        {step === 5 && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              <span className="text-muted">{t('wizard.reviewCustomer')}: </span>
              <strong dir="auto">{customer?.name}</strong> <span className="ltr-data text-muted">{customer?.phoneE164}</span> {customer?.isVip && <Badge tone="brand">{t('customers.vip')}</Badge>}
            </p>
            <p>
              <span className="text-muted">{t('wizard.reviewAddress')}: </span>
              <span dir="auto">{addresses.find((a) => a.id === addressId)?.district ?? '—'}</span>
            </p>
            <p>
              <span className="text-muted">{t('orders.persons')}: </span>
              <span className="ltr-data">{persons}</span>
            </p>
            <ul className="divide-y divide-line rounded-xl border border-line">
              {lines.map((l, i) => (
                <li key={l.key} className="flex flex-wrap justify-between gap-2 px-3 py-2">
                  <span dir="auto">
                    {l.kind === 'service' ? nameOf(serviceById(l.serviceId)!) : l.kind === 'package' ? nameOf(packageById(l.packageId)!) : l.name}
                    {l.kind !== 'package' && <span className="text-xs text-muted"> · {t('orders.beneficiary', { n: l.beneficiaryIndex })}</span>}
                  </span>
                  <span className="font-semibold">{pricing[i]!.pricing ? formatMoney(pricing[i]!.pricing!.finalPrice, locale) : '—'}</span>
                </li>
              ))}
            </ul>
            <ul className="flex flex-col gap-1">
              {visitsState.map((v, i) => (
                <li key={i}>
                  <span className="text-muted">{t('orders.visit', { n: i + 1 })}: </span>
                  <span className="ltr-data">{v.date && v.time ? `${v.date} ${v.time}` : t('orders.notScheduled')}</span>
                  {v.specialistIds.length > 0 && <span> · {v.specialistIds.map(specialistName).join('، ')}</span>}
                </li>
              ))}
            </ul>
            <Totals services={servicesTotal} fee={feeValid ? feeHalalas! : 0} />
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {step > 0 && (
            <button type="button" className={buttonStyles.secondary} onClick={() => setStep(step - 1)}>
              {t('wizard.previous')}
            </button>
          )}
          {step < STEPS.length - 1 && (
            <button type="button" className={buttonStyles.primary} disabled={!customer} onClick={() => setStep(step + 1)}>
              {t('wizard.next')}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {customer && (
            <button type="button" className={buttonStyles.secondary} disabled={pending || !online} onClick={() => submit(false)}>
              {t('wizard.saveDraft')}
            </button>
          )}
          {step === STEPS.length - 1 && (
            <button type="button" className={buttonStyles.primary} disabled={pending || !online} onClick={() => submit(true)}>
              {pending ? t('wizard.confirming') : t('wizard.confirm')}
            </button>
          )}
        </div>
      </div>
      {!online && <p className="text-xs text-warning">{t('wizard.offlineBlocked')}</p>}
    </div>
  )
}

function Totals({ services, fee }: { services: number; fee: number }) {
  const { t, locale } = useI18n()
  return (
    <dl className="grid grid-cols-2 gap-2 rounded-xl bg-brand-soft/60 p-3 text-sm sm:grid-cols-5">
      <div>
        <dt className="text-xs text-muted">{t('orders.servicesTotal')}</dt>
        <dd className="font-semibold text-ink">{formatMoney(services, locale)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">{t('orders.deliveryFee')}</dt>
        <dd className="font-semibold text-ink">{formatMoney(fee, locale)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">{t('orders.grandTotal')}</dt>
        <dd className="text-base font-bold text-brand-deep">{formatMoney(services + fee, locale)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">{t('orders.paid')}</dt>
        <dd className="font-semibold text-ink">{formatMoney(0, locale)}</dd>
      </div>
      <div>
        <dt className="text-xs text-muted">{t('orders.remaining')}</dt>
        <dd className="font-semibold text-ink">{formatMoney(services + fee, locale)}</dd>
      </div>
    </dl>
  )
}

// ─────────────────────────────── Customer step ───────────────────────────────

function CustomerStep({ customer, onSelect }: { customer: CustomerLite | null; onSelect: (c: CustomerLite) => Promise<void> }) {
  const { t } = useI18n()
  const [phone, setPhone] = useState('')
  const [found, setFound] = useState<CustomerLite | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [messageLocale, setMessageLocale] = useState('ar')
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="flex flex-col gap-4">
      {customer && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-deep bg-brand-soft px-3 py-2">
          <span className="text-sm text-ink">
            {t('wizard.selected')}: <strong dir="auto">{customer.name}</strong> <span className="ltr-data text-muted">{customer.phoneE164}</span>
          </span>
        </div>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          start(async () => {
            const res = await lookupPhoneAction(phone)
            if (!res.ok) return setError(translateError(t, res.error))
            setFound(res.data ?? null)
          })
        }}
      >
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium text-ink">
          {t('wizard.findCustomer')}
          <input className={inputClass} type="tel" inputMode="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xxxxxxxx" required />
        </label>
        <button type="submit" className={buttonStyles.secondary} disabled={pending}>
          {t('customers.search')}
        </button>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
      {found && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line px-3 py-2">
          <span className="text-sm text-ink">
            <strong dir="auto">{found.name}</strong> <span className="ltr-data text-muted">{found.phoneE164}</span> {found.isVip && <Badge tone="brand">{t('customers.vip')}</Badge>}
          </span>
          <button type="button" className={buttonStyles.primary} onClick={() => start(() => onSelect(found))}>
            {t('wizard.select')}
          </button>
        </div>
      )}
      {found === null && (
        <form
          className="flex flex-col gap-3 rounded-xl border border-dashed border-line p-3"
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            start(async () => {
              const res = await quickCreateCustomerAction({ name, phone, messageLocale })
              if (!res.ok || !res.data) {
                const code = Object.values(res.fieldErrors ?? {})[0] ?? res.error
                return setError(translateError(t, code))
              }
              await onSelect(res.data)
            })
          }}
        >
          <p className="text-sm font-semibold text-ink">{t('wizard.createCustomer')}</p>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t('customers.name')}
            <input className={inputClass} dir="auto" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t('customers.messageLocale')}
            <select className={inputClass} value={messageLocale} onChange={(e) => setMessageLocale(e.target.value)}>
              <option value="ar" lang="ar">العربية</option>
              <option value="en" lang="en">English</option>
            </select>
          </label>
          <button type="submit" className={buttonStyles.primary} disabled={pending}>
            {t('common.save')}
          </button>
        </form>
      )}
    </div>
  )
}

// ─────────────────────────────── Services step ───────────────────────────────

function ServicesStep({
  ctx,
  persons,
  setPersons,
  lines,
  visitCount,
  nameOf,
  onAdd,
  onUpdate,
  onRemove,
  onAddVisit,
}: {
  ctx: WizardContext
  persons: number
  setPersons: (n: number) => void
  lines: Line[]
  visitCount: number
  nameOf: (x: { nameAr: string; nameEn: string }) => string
  onAdd: (l: Line) => void
  onUpdate: (key: string, patch: Partial<Line>) => void
  onRemove: (key: string) => void
  onAddVisit: () => void
}) {
  const { t, locale } = useI18n()
  const [serviceId, setServiceId] = useState('')
  const [packageId, setPackageId] = useState('')
  const [custom, setCustom] = useState({ name: '', price: '', duration: '30', notes: '', vip: false })
  const beneficiaries = Array.from({ length: persons }, (_, i) => i + 1)
  const visitsIdx = Array.from({ length: visitCount }, (_, i) => i)

  const beneficiarySelect = (value: number, onChange: (n: number) => void) => (
    <select className={`${inputClass} max-w-44`} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={t('wizard.forBeneficiary')}>
      {beneficiaries.map((b) => (
        <option key={b} value={b}>
          {t('orders.beneficiary', { n: b })}
        </option>
      ))}
    </select>
  )
  const visitSelect = (value: number, onChange: (n: number) => void, label: string) => (
    <select className={`${inputClass} max-w-40`} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {visitsIdx.map((v) => (
        <option key={v} value={v}>
          {t('orders.visit', { n: v + 1 })}
        </option>
      ))}
    </select>
  )

  return (
    <div className="flex flex-col gap-5">
      <label className="flex max-w-xs flex-col gap-1 text-sm font-medium text-ink">
        {t('wizard.persons')}
        <input type="number" min={1} max={20} className={inputClass} dir="ltr" value={persons} onChange={(e) => setPersons(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
        <span className="text-xs font-normal text-muted">{t('wizard.personsHint')}</span>
      </label>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t('wizard.addService')}
            <select className={inputClass} value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">—</option>
              {ctx.categories.map((c) => (
                <optgroup key={c.code} label={nameOf(c)}>
                  {ctx.services
                    .filter((s) => s.categoryCode === c.code)
                    .map((s) => (
                      <option key={s.id} value={s.id}>
                        {nameOf(s)} — {formatMoney(s.offerPriceHalalas, locale)} · {t('orders.minutes', { n: s.durationMinutes })}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={!serviceId}
            onClick={() => {
              onAdd({ key: newKey(), kind: 'service', serviceId, beneficiaryIndex: 1, visitIndex: 0, specialistId: null, manualPrice: '', manualReason: '' })
              setServiceId('')
            }}
          >
            {t('wizard.add')}
          </button>
        </div>
        <div className="flex flex-col gap-2 rounded-xl border border-line p-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-ink">
            {t('wizard.addPackage')}
            <select className={inputClass} value={packageId} onChange={(e) => setPackageId(e.target.value)}>
              <option value="">—</option>
              {ctx.packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {nameOf(p)} — {formatMoney(p.offerPriceHalalas, locale)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={buttonStyles.secondary}
            disabled={!packageId}
            onClick={() => {
              const p = ctx.packages.find((x) => x.id === packageId)!
              onAdd({ key: newKey(), kind: 'package', packageId, visitIndexes: Array.from({ length: p.visitsCount }, (_, i) => i), manualPrice: '', manualReason: '' })
              setPackageId('')
            }}
          >
            {t('wizard.add')}
          </button>
        </div>
      </div>

      {ctx.permissions.custom && (
        <details className="rounded-xl border border-dashed border-line p-3">
          <summary className="cursor-pointer text-sm font-semibold text-brand-deep">{t('wizard.addCustom')}</summary>
          <p className="mt-1 text-xs text-muted">{t('wizard.customHint')}</p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-ink sm:col-span-3">
              {t('wizard.customName')}
              <input className={inputClass} dir="auto" value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} maxLength={200} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              {t('wizard.customPrice')}
              <input className={inputClass} inputMode="decimal" dir="ltr" value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              {t('wizard.customDuration')}
              <input type="number" min={5} max={600} className={inputClass} dir="ltr" value={custom.duration} onChange={(e) => setCustom({ ...custom, duration: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-ink">
              {t('wizard.customNotes')}
              <input className={inputClass} dir="auto" value={custom.notes} onChange={(e) => setCustom({ ...custom, notes: e.target.value })} />
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink sm:col-span-3">
              <input type="checkbox" className="h-5 w-5 accent-[var(--color-brand-deep)]" checked={custom.vip} onChange={(e) => setCustom({ ...custom, vip: e.target.checked })} />
              {t('wizard.customVip')}
            </label>
          </div>
          <button
            type="button"
            className={`${buttonStyles.secondary} mt-3`}
            disabled={!custom.name.trim() || parseSarInput(custom.price) == null || !(Number(custom.duration) >= 5)}
            onClick={() => {
              onAdd({ key: newKey(), kind: 'custom', name: custom.name.trim(), price: custom.price, durationMinutes: Number(custom.duration), notes: custom.notes, vipEligible: custom.vip, beneficiaryIndex: 1, visitIndex: 0, specialistId: null, manualPrice: '', manualReason: '' })
              setCustom({ name: '', price: '', duration: '30', notes: '', vip: false })
            }}
          >
            {t('wizard.add')}
          </button>
        </details>
      )}

      {lines.length === 0 ? (
        <p className="text-sm text-muted">{t('wizard.noLines')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => {
            if (l.kind === 'package') {
              const p = ctx.packages.find((x) => x.id === l.packageId)!
              return (
                <li key={l.key} className="rounded-xl border border-line p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold text-ink">{nameOf(p)}</p>
                    <button type="button" className={buttonStyles.ghost} onClick={() => onRemove(l.key)}>
                      {t('wizard.remove')}
                    </button>
                  </div>
                  <p className="text-xs text-muted">{t('wizard.packageInfo', { persons: p.personsCount, visits: p.visitsCount, minutes: p.visitDurationMinutes, specialists: p.specialistsPerVisit })}</p>
                  <p className="text-xs text-muted">{p.components.map((c) => `${c.quantity > 1 ? `${c.quantity}× ` : ''}${nameOf(c)}`).join(' + ')}</p>
                  {p.visitsCount > 1 && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span>{t('wizard.packageSessionsVisits')}:</span>
                      {l.visitIndexes.map((vi, s) => (
                        <span key={s} className="flex items-center gap-1">
                          {t('orders.session', { n: s + 1 })}
                          {visitSelect(vi, (n) => onUpdate(l.key, { visitIndexes: l.visitIndexes.map((x, j) => (j === s ? n : x)) } as Partial<Line>), t('orders.session', { n: s + 1 }))}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              )
            }
            const label = l.kind === 'service' ? nameOf(ctx.services.find((s) => s.id === l.serviceId)!) : l.name
            return (
              <li key={l.key} className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3">
                <p className="min-w-40 flex-1 font-semibold text-ink" dir="auto">
                  {label}
                  {l.kind === 'custom' && <span className="ms-2 text-xs font-normal text-muted">({t('orders.customLine')})</span>}
                </p>
                {beneficiarySelect(l.beneficiaryIndex, (n) => onUpdate(l.key, { beneficiaryIndex: n } as Partial<Line>))}
                {visitCount > 1 && visitSelect(l.visitIndex, (n) => onUpdate(l.key, { visitIndex: n } as Partial<Line>), t('wizard.inVisit'))}
                <button type="button" className={buttonStyles.ghost} onClick={() => onRemove(l.key)}>
                  {t('wizard.remove')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <div>
        <button type="button" className={buttonStyles.ghost} onClick={onAddVisit}>
          {t('wizard.addVisit')}
        </button>
      </div>
    </div>
  )
}
