'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { formString, runAction, type ActionState } from '@/server/actions'
import { addAddress, archiveAddress, createCustomer, findCustomerByPhone, setCustomerVip, updateAddress, updateCustomer } from '@/server/services/customers'

function customerFields(form: FormData) {
  return {
    name: formString(form, 'name'),
    phone: formString(form, 'phone'),
    altPhone: formString(form, 'altPhone'),
    messageLocale: formString(form, 'messageLocale') || 'ar',
    notes: formString(form, 'notes'),
  }
}

function addressFields(form: FormData) {
  return {
    label: formString(form, 'label'),
    district: formString(form, 'district'),
    addressLine: formString(form, 'addressLine'),
    buildingDetails: formString(form, 'buildingDetails'),
    accessInstructions: formString(form, 'accessInstructions'),
    location: formString(form, 'location'),
  }
}

export interface CustomerLite {
  id: string
  name: string
  phoneE164: string
  isVip: boolean
}

/** Phone-first lookup used by the booking wizard and the customer search. */
export async function lookupPhoneAction(phone: string): Promise<ActionState<CustomerLite | null>> {
  return runAction(async (actor) => {
    const c = await findCustomerByPhone(actor, phone)
    return c ? { id: c.id, name: c.name, phoneE164: c.phoneE164, isVip: c.isVip } : null
  })
}

export async function createCustomerAction(_prev: ActionState<{ id: string }>, form: FormData): Promise<ActionState<{ id: string }>> {
  const result = await runAction(async (actor) => {
    const c = await createCustomer(actor, { ...customerFields(form), isVip: form.get('isVip') === 'on' })
    return { id: c.id }
  })
  if (result.ok && result.data && form.get('redirect') !== 'none') redirect(`/customers/${result.data.id}`)
  return result
}

/** Used inside the booking wizard: returns the new customer instead of navigating. */
export async function quickCreateCustomerAction(input: { name: string; phone: string; messageLocale: string }): Promise<ActionState<CustomerLite>> {
  return runAction(async (actor) => {
    const c = await createCustomer(actor, input)
    return { id: c.id, name: c.name, phoneE164: c.phoneE164, isVip: c.isVip }
  })
}

export async function updateCustomerAction(id: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await updateCustomer(actor, id, customerFields(form))
    return undefined
  })
  if (result.ok) revalidatePath(`/customers/${id}`)
  return result
}

export async function setVipAction(id: string, isVip: boolean, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await setCustomerVip(actor, id, isVip, formString(form, 'reason').trim() || null)
    return undefined
  })
  if (result.ok) revalidatePath(`/customers/${id}`)
  return result
}

export interface AddressLite {
  id: string
  label: string | null
  district: string
  addressLine: string | null
  latitude: number | null
  longitude: number | null
}

export async function addAddressAction(customerId: string, _prev: ActionState<AddressLite>, form: FormData): Promise<ActionState<AddressLite>> {
  const result = await runAction(async (actor) => {
    const a = await addAddress(actor, customerId, addressFields(form))
    return { id: a.id, label: a.label, district: a.district, addressLine: a.addressLine, latitude: a.latitude, longitude: a.longitude }
  })
  if (result.ok) revalidatePath(`/customers/${customerId}`)
  return result
}

export async function updateAddressAction(customerId: string, addressId: string, _prev: ActionState, form: FormData): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await updateAddress(actor, addressId, addressFields(form))
    return undefined
  })
  if (result.ok) revalidatePath(`/customers/${customerId}`)
  return result
}

export async function archiveAddressAction(customerId: string, addressId: string): Promise<ActionState> {
  const result = await runAction(async (actor) => {
    await archiveAddress(actor, addressId)
    return undefined
  })
  if (result.ok) revalidatePath(`/customers/${customerId}`)
  return result
}

export async function customerAddressesAction(customerId: string): Promise<ActionState<{ customer: CustomerLite; addresses: AddressLite[] }>> {
  return runAction(async (actor) => {
    const { getCustomer } = await import('@/server/services/customers')
    const d = await getCustomer(actor, customerId)
    return {
      customer: { id: d.customer.id, name: d.customer.name, phoneE164: d.customer.phoneE164, isVip: d.customer.isVip },
      addresses: d.addresses.map((a) => ({ id: a.id, label: a.label, district: a.district, addressLine: a.addressLine, latitude: a.latitude, longitude: a.longitude })),
    }
  })
}
