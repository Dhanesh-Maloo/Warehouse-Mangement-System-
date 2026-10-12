export interface DeploymentOrder {
  id: string;
  asset: { id: string; serialNumber: string; model: string };
  endUser: { name: string } | null;
  deliveryAddress: {
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  };
  courierZone: 'intra_state' | 'inter_state' | 'rural';
  status: 'pending' | 'in_transit' | 'delivered' | 'cancelled';
  bundleType: 'standard' | 'full_prep';
  requiresLabeling: boolean;
  requiresRepacking: boolean;
  contactName: string;
  contactPhone: string;
  trackingNumber?: string;
  ivalueTicketNumber?: string;
  clientTicketNumber?: string;
  notes?: string;
  requestedAt: string;
}

export const STATUS_COLORS: Record<DeploymentOrder['status'], string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_transit: 'bg-amber-100 text-amber-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

export const STATUS_LABELS: Record<DeploymentOrder['status'], string> = {
  pending: 'Pending',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

export const ZONE_LABELS: Record<DeploymentOrder['courierZone'], string> = {
  intra_state: 'City',
  inter_state: 'Interstate',
  rural: 'Rural',
};

/** Full delivery address as one multi-line string, used for the list tooltip and the detail panel. */
export function formatDeliveryAddress(address: DeploymentOrder['deliveryAddress']): string {
  return [
    address.line1,
    address.line2,
    `${address.city}, ${address.state} ${address.pincode}`.trim(),
  ]
    .filter(Boolean)
    .join('\n');
}
