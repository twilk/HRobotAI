'use server'
import { setFacilityHours, setFacilityAddress, type WeeklyHours } from '@/lib/facilities'

interface AddressInput {
  street?: string
  city?: string
  /** Maps to Address.postalCode */
  zip?: string
  phone?: string
}

export async function updateFacilityHours(
  id: string,
  hours: WeeklyHours,
): Promise<{ success: boolean; error?: string }> {
  const updated = setFacilityHours(id, hours)
  if (!updated) {
    return { success: false, error: `Facility '${id}' not found` }
  }
  return { success: true }
}

export async function updateFacilityAddress(
  id: string,
  address: AddressInput,
): Promise<{ success: boolean; error?: string }> {
  const patch: { street?: string; postalCode?: string; city?: string } = {}
  if (address.street !== undefined) patch.street = address.street
  if (address.zip !== undefined) patch.postalCode = address.zip
  if (address.city !== undefined) patch.city = address.city
  // phone is not part of Address — intentionally ignored in this reference implementation

  const updated = setFacilityAddress(id, patch)
  if (!updated) {
    return { success: false, error: `Facility '${id}' not found` }
  }
  return { success: true }
}
