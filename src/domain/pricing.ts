import { DomainError } from './errors'
import { assertNonNegative, percentOf, sum, type Halalas } from './money'

/** VIP customers get 25% off the OFFER price (not the base price). */
export const VIP_DISCOUNT_BP = 2500
/** Delivery fee is set per order by the moderator, 0–30 SAR. */
export const DELIVERY_FEE_MAX: Halalas = 3000

export interface LinePricingInput {
  /** Base (list) price snapshot at booking time. Upper bound for the final price. */
  basePrice: Halalas
  /** Offer price snapshot; null for a custom service without a known offer (base is the start price). */
  offerPrice: Halalas | null
  /** Customer is VIP at booking time. */
  vipCustomer: boolean
  /**
   * Whether the VIP discount applies to this line. Catalog services: true. Packages: the
   * visible setting (default true). Custom services: only when explicitly ticked.
   */
  vipEligible: boolean
  vipDiscountBp?: number
  /** Manual final price chosen by staff (after the VIP step). null = no manual adjustment. */
  manualFinalPrice?: Halalas | null
  manualReason?: string | null
}

export interface LinePricing {
  basePrice: Halalas
  offerPrice: Halalas | null
  /** Price the discounts start from: offer, or base when there is no offer. */
  startPrice: Halalas
  vipDiscount: Halalas
  priceAfterVip: Halalas
  /** final - priceAfterVip (negative = extra discount, positive = increase up to base). */
  manualAdjustment: Halalas
  manualReason: string | null
  finalPrice: Halalas
  isFree: boolean
}

/**
 * Price one order line. Order: offer → VIP discount → manual final adjustment.
 * The VIP discount is always recomputed from the snapshots, never from a previous final
 * price, so re-opening or editing an order can never apply it twice.
 */
export function priceLine(input: LinePricingInput): LinePricing {
  const base = assertNonNegative(input.basePrice, 'basePrice')
  const offer = input.offerPrice == null ? null : assertNonNegative(input.offerPrice, 'offerPrice')
  if (offer != null && offer > base) throw new DomainError('offer_exceeds_base')

  const startPrice = offer ?? base
  const vipDiscount =
    input.vipCustomer && input.vipEligible ? percentOf(startPrice, input.vipDiscountBp ?? VIP_DISCOUNT_BP) : 0
  const priceAfterVip = startPrice - vipDiscount

  let finalPrice = priceAfterVip
  let manualReason: string | null = null
  if (input.manualFinalPrice != null) {
    const manual = input.manualFinalPrice
    if (!Number.isSafeInteger(manual)) throw new DomainError('money_not_integer', { field: 'finalPrice' })
    if (manual < 0) throw new DomainError('money_negative', { field: 'finalPrice' })
    if (manual > base) throw new DomainError('final_exceeds_base')
    const reason = input.manualReason?.trim() ?? ''
    if (manual !== priceAfterVip && reason.length === 0) throw new DomainError('manual_price_reason_required')
    finalPrice = manual
    manualReason = reason.length > 0 ? reason : null
  }
  if (finalPrice === 0 && startPrice > 0 && manualReason == null) {
    throw new DomainError('free_service_reason_required')
  }

  return {
    basePrice: base,
    offerPrice: offer,
    startPrice,
    vipDiscount,
    priceAfterVip,
    manualAdjustment: finalPrice - priceAfterVip,
    manualReason,
    finalPrice,
    isFree: finalPrice === 0 && startPrice > 0,
  }
}

export function validateDeliveryFee(fee: Halalas): Halalas {
  if (!Number.isSafeInteger(fee)) throw new DomainError('money_not_integer', { field: 'deliveryFee' })
  if (fee < 0 || fee > DELIVERY_FEE_MAX) throw new DomainError('delivery_fee_out_of_range', { max: DELIVERY_FEE_MAX / 100 })
  return fee
}

export interface OrderTotals {
  /** Sum of final line prices — the basis for moderator commission. Excludes delivery. */
  servicesTotal: Halalas
  deliveryFee: Halalas
  grandTotal: Halalas
}

export function orderTotals(lineFinalPrices: readonly Halalas[], deliveryFee: Halalas): OrderTotals {
  const servicesTotal = sum(lineFinalPrices.map((p) => assertNonNegative(p)))
  const fee = validateDeliveryFee(deliveryFee)
  return { servicesTotal, deliveryFee: fee, grandTotal: servicesTotal + fee }
}
