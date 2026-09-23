import { describe, expect, it } from 'vitest'
import { orderTotals, priceLine, validateDeliveryFee } from '@/domain/pricing'
import { sar } from '@/domain/money'

const catalog = { basePrice: sar(250), offerPrice: sar(196), vipEligible: true }

describe('pricing (spec §9)', () => {
  it('defaults to the offer price', () => {
    expect(priceLine({ ...catalog, vipCustomer: false }).finalPrice).toBe(sar(196))
  })

  it('acceptance #4: offer 196 with VIP discount becomes 147', () => {
    const p = priceLine({ ...catalog, vipCustomer: true })
    expect(p.vipDiscount).toBe(sar(49))
    expect(p.finalPrice).toBe(sar(147))
  })

  it('VIP discount is computed from the offer, not the base price', () => {
    const p = priceLine({ basePrice: sar(700), offerPrice: sar(496), vipCustomer: true, vipEligible: true })
    expect(p.finalPrice).toBe(sar(372))
  })

  it('never applies the VIP discount twice when the order is re-priced', () => {
    const first = priceLine({ ...catalog, vipCustomer: true })
    const again = priceLine({ ...catalog, vipCustomer: true, manualFinalPrice: null })
    expect(again.finalPrice).toBe(first.finalPrice)
  })

  it('acceptance #5: final price cannot exceed the base price', () => {
    expect(() =>
      priceLine({ ...catalog, vipCustomer: false, manualFinalPrice: sar(251), manualReason: 'x' }),
    ).toThrow('final_exceeds_base')
    expect(
      priceLine({ ...catalog, vipCustomer: false, manualFinalPrice: sar(250), manualReason: 'x' }).finalPrice,
    ).toBe(sar(250))
  })

  it('rejects negative values and offers above base', () => {
    expect(() => priceLine({ ...catalog, vipCustomer: false, manualFinalPrice: -1, manualReason: 'x' })).toThrow(
      'money_negative',
    )
    expect(() => priceLine({ basePrice: 100, offerPrice: 200, vipCustomer: false, vipEligible: true })).toThrow(
      'offer_exceeds_base',
    )
  })

  it('manual adjustment after VIP requires a reason and is recorded', () => {
    expect(() => priceLine({ ...catalog, vipCustomer: true, manualFinalPrice: sar(130) })).toThrow(
      'manual_price_reason_required',
    )
    const p = priceLine({ ...catalog, vipCustomer: true, manualFinalPrice: sar(130), manualReason: 'loyalty' })
    expect(p.manualAdjustment).toBe(sar(-17))
    expect(p.manualReason).toBe('loyalty')
  })

  it('free service only as an explicit, reasoned adjustment', () => {
    expect(() => priceLine({ ...catalog, vipCustomer: false, manualFinalPrice: 0 })).toThrow()
    const p = priceLine({ ...catalog, vipCustomer: false, manualFinalPrice: 0, manualReason: 'compensation' })
    expect(p.isFree).toBe(true)
  })

  it('custom service without offer: explicit price, VIP only when explicitly eligible', () => {
    const silent = priceLine({ basePrice: sar(180), offerPrice: null, vipCustomer: true, vipEligible: false })
    expect(silent.finalPrice).toBe(sar(180))
    const shown = priceLine({ basePrice: sar(180), offerPrice: null, vipCustomer: true, vipEligible: true })
    expect(shown.vipDiscount).toBe(sar(45))
  })

  it('acceptance #6: delivery fee of 31 SAR is rejected; 0 and 30 accepted', () => {
    expect(() => validateDeliveryFee(sar(31))).toThrow('delivery_fee_out_of_range')
    expect(() => validateDeliveryFee(-1)).toThrow()
    expect(validateDeliveryFee(0)).toBe(0)
    expect(validateDeliveryFee(sar(30))).toBe(3000)
  })

  it('delivery is excluded from the services total', () => {
    expect(orderTotals([sar(196), sar(147)], sar(30))).toEqual({
      servicesTotal: sar(343),
      deliveryFee: sar(30),
      grandTotal: sar(373),
    })
  })
})
