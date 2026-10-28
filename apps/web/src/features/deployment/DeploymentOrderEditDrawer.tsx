import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../../api/client';
import { formatPaise, rupeesToPaise } from '../../lib/money';
import { usePincodeState } from '../logistics/usePincodeState';
import type { DeploymentOrder } from './deployment-order';

interface EndUser {
  id: string;
  name: string;
  clientId: string;
}

interface EditDrawerProps {
  order: DeploymentOrder;
  onClose: () => void;
}

const INPUT =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-gray-600 mb-1">{children}</label>;
}

/**
 * Edit everything that can still be corrected on a deployment order, including the transport
 * charge (the courier bill often arrives long after the order). Assets and bundle options are
 * fixed because they decide the charges already posted.
 */
export function DeploymentOrderEditDrawer({ order, onClose }: EditDrawerProps) {
  const qc = useQueryClient();
  const address = order.deliveryAddress;
  const initialTransportPaise = Number(order.transportChargePaise);

  const [form, setForm] = useState({
    addrLine1: address.line1,
    addrLine2: address.line2 ?? '',
    addrCity: address.city,
    addrState: address.state,
    addrPincode: address.pincode,
    contactName: order.contactName ?? '',
    contactPhone: order.contactPhone ?? '',
    ivalueTicketNumber: order.ivalueTicketNumber ?? '',
    clientTicketNumber: order.clientTicketNumber ?? '',
    trackingNumber: order.trackingNumber ?? '',
    courierName: order.courierName ?? '',
    notes: order.notes ?? '',
    transportCharge: initialTransportPaise > 0 ? String(initialTransportPaise / 100) : '',
  });
  const [endUserInput, setEndUserInput] = useState(order.endUser?.name ?? '');
  const [error, setError] = useState('');

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((p) => ({ ...p, [key]: value }));
  }

  // Fill the state from a changed pincode only; never overwrite the saved state on open.
  usePincodeState(form.addrPincode, (state) => {
    if (form.addrPincode !== address.pincode) set('addrState', state);
  });

  const { data: endUsers = [] } = useQuery({
    queryKey: ['end-users', order.clientId],
    queryFn: () => api.get<EndUser[]>(`/end-users?clientId=${order.clientId}`),
  });

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, unknown>) => api.patch(`/deployment/${order.id}`, payload),
    onSuccess: () => {
      for (const key of [
        'deployment-orders',
        'billing-ledger',
        'charge-billing',
        'end-users',
        'assets',
        'inventory-summary',
      ]) {
        void qc.invalidateQueries({ queryKey: [key] });
      }
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!form.contactName.trim() || !form.contactPhone.trim()) {
      setError('Contact name and phone are required.');
      return;
    }
    if (!form.addrLine1.trim() || !form.addrCity.trim() || !form.addrState.trim()) {
      setError('Address line 1, city and state are required.');
      return;
    }
    if (!/^\d{6}$/.test(form.addrPincode.trim())) {
      setError('PIN code must be 6 digits.');
      return;
    }
    const transportParsed = rupeesToPaise(form.transportCharge);
    if (transportParsed === null) {
      setError('Enter a valid transport charge (0 or more).');
      return;
    }
    // An emptied box means no charge.
    const transportPaise = transportParsed ?? 0;

    // Typed end user: use the match, create it if new, or clear it when the box is empty.
    let endUserId: string | null = null;
    const typedName = endUserInput.trim();
    if (typedName) {
      const match = endUsers.find((eu) => eu.name.toLowerCase() === typedName.toLowerCase());
      if (match) {
        endUserId = match.id;
      } else {
        try {
          const created = await api.post<EndUser>('/end-users', {
            name: typedName,
            clientId: order.clientId,
          });
          void qc.invalidateQueries({ queryKey: ['end-users'] });
          endUserId = created.id;
        } catch {
          setError(`Could not create end user "${typedName}".`);
          return;
        }
      }
    }

    // Send only what changed so the audit trail stays meaningful.
    const payload: Record<string, unknown> = {};
    if (endUserId !== (order.endUserId ?? null)) payload.endUserId = endUserId;
    const addressChanged =
      form.addrLine1.trim() !== address.line1 ||
      form.addrLine2.trim() !== (address.line2 ?? '') ||
      form.addrCity.trim() !== address.city ||
      form.addrState.trim() !== address.state ||
      form.addrPincode.trim() !== address.pincode;
    if (addressChanged) {
      payload.deliveryAddress = {
        line1: form.addrLine1.trim(),
        line2: form.addrLine2.trim() || undefined,
        city: form.addrCity.trim(),
        state: form.addrState.trim(),
        pincode: form.addrPincode.trim(),
      };
    }
    const text: [keyof typeof form, string | null | undefined][] = [
      ['contactName', order.contactName],
      ['contactPhone', order.contactPhone],
      ['ivalueTicketNumber', order.ivalueTicketNumber],
      ['clientTicketNumber', order.clientTicketNumber],
      ['trackingNumber', order.trackingNumber],
      ['courierName', order.courierName],
      ['notes', order.notes],
    ];
    for (const [key, original] of text) {
      if (form[key].trim() !== (original ?? '')) payload[key] = form[key].trim();
    }
    if (transportPaise !== initialTransportPaise) payload.transportChargePaise = transportPaise;

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }
    saveMutation.mutate(payload);
  }

  const cancelled = order.status === 'cancelled';

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-label="Edit deployment order"
    >
      <button
        type="button"
        aria-label="Close edit"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 cursor-default"
      />
      <aside className="relative w-full max-w-lg bg-white h-full shadow-xl flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Edit deployment order</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {order.items.length > 1 ? `${order.items.length} assets` : order.asset.serialNumber}.
              Assets and bundle options can&apos;t be changed.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={(e) => void handleSave(e)} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {/* Transport — first because it is the field that usually arrives late */}
            <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-2">
              <Label>Transport charge (₹)</Label>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form.transportCharge}
                onChange={(e) => set('transportCharge', e.target.value)}
                disabled={cancelled}
                placeholder="0.00"
                className={INPUT}
              />
              <p className="text-xs text-gray-600">
                {cancelled
                  ? 'Cancelled orders cannot be billed for transport.'
                  : initialTransportPaise > 0
                    ? `Currently ${formatPaise(initialTransportPaise)}. Enter the final amount; only the difference is added to billing.`
                    : 'Not entered yet. Once saved, it appears in Billing as a pending charge.'}
              </p>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Recipient</h3>
              <div>
                <Label>End user</Label>
                <input
                  type="text"
                  list="edit-end-users"
                  value={endUserInput}
                  onChange={(e) => setEndUserInput(e.target.value)}
                  placeholder="Pick one, or type a new name to create it"
                  className={INPUT}
                />
                <datalist id="edit-end-users">
                  {endUsers.map((eu) => (
                    <option key={eu.id} value={eu.name} />
                  ))}
                </datalist>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Contact name</Label>
                  <input
                    required
                    value={form.contactName}
                    onChange={(e) => set('contactName', e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <Label>Contact phone</Label>
                  <input
                    required
                    type="tel"
                    value={form.contactPhone}
                    onChange={(e) => set('contactPhone', e.target.value)}
                    className={INPUT}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Delivery address</h3>
              <div>
                <Label>Address line 1</Label>
                <input
                  required
                  value={form.addrLine1}
                  onChange={(e) => set('addrLine1', e.target.value)}
                  className={INPUT}
                />
              </div>
              <div>
                <Label>Address line 2</Label>
                <input
                  value={form.addrLine2}
                  onChange={(e) => set('addrLine2', e.target.value)}
                  className={INPUT}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label>PIN code</Label>
                  <input
                    required
                    inputMode="numeric"
                    maxLength={6}
                    value={form.addrPincode}
                    onChange={(e) => set('addrPincode', e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <Label>City</Label>
                  <input
                    required
                    value={form.addrCity}
                    onChange={(e) => set('addrCity', e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <Label>State</Label>
                  <input
                    required
                    value={form.addrState}
                    onChange={(e) => set('addrState', e.target.value)}
                    className={INPUT}
                  />
                </div>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Shipment &amp; tickets</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label>Tracking number</Label>
                  <input
                    value={form.trackingNumber}
                    onChange={(e) => set('trackingNumber', e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <Label>Courier name</Label>
                  <input
                    value={form.courierName}
                    onChange={(e) => set('courierName', e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <Label>IValue ticket / invoice #</Label>
                  <input
                    value={form.ivalueTicketNumber}
                    onChange={(e) => set('ivalueTicketNumber', e.target.value)}
                    className={INPUT}
                  />
                </div>
                <div>
                  <Label>Client ticket #</Label>
                  <input
                    value={form.clientTicketNumber}
                    onChange={(e) => set('clientTicketNumber', e.target.value)}
                    className={INPUT}
                  />
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => set('notes', e.target.value)}
                  className={INPUT}
                />
              </div>
            </section>
          </div>

          <div className="border-t border-gray-100 px-6 py-4 space-y-2">
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
              >
                {saveMutation.isPending ? 'Saving…' : 'Save changes'}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      </aside>
    </div>
  );
}
