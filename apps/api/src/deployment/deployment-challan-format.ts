export interface DeliveryAddress {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  pincode?: string;
}

/** Single-line address for the delivery challan; skips any part that is blank. */
export function formatChallanAddress(address: DeliveryAddress): string {
  return [address.line1, address.line2, address.city, address.state, address.pincode]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(', ');
}

/** "Delivered to" line; contact name is optional on backfilled orders. */
export function formatChallanContact(contactName: string, contactPhone: string): string {
  return [contactName.trim(), contactPhone.trim()].filter(Boolean).join(' · ');
}
