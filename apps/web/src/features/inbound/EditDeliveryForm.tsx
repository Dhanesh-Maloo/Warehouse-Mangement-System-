import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/client';

export interface EditableDelivery {
  id: string;
  purchaseOrderRef: string | null;
  expectedArrivalDate: string;
  notes: string | null;
  ivalueTicketNumber: string | null;
  clientTicketNumber: string | null;
  items: { id: string; category: string; model: string; manufacturer: string; quantity: number }[];
  grns: { deviceCount: number }[];
}

interface ItemDraft {
  id?: string;
  category: string;
  model: string;
  manufacturer: string;
  quantity: number;
}

const INPUT =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]';

export function EditDeliveryForm({
  delivery,
  onClose,
}: {
  delivery: EditableDelivery;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [poRef, setPoRef] = useState(delivery.purchaseOrderRef ?? '');
  const [arrivalDate, setArrivalDate] = useState(delivery.expectedArrivalDate.slice(0, 10));
  const [ivalueTicket, setIvalueTicket] = useState(delivery.ivalueTicketNumber ?? '');
  const [clientTicket, setClientTicket] = useState(delivery.clientTicketNumber ?? '');
  const [notes, setNotes] = useState(delivery.notes ?? '');
  const [items, setItems] = useState<ItemDraft[]>(
    delivery.items.map((i) => ({
      id: i.id,
      category: i.category,
      model: i.model,
      manufacturer: i.manufacturer,
      quantity: i.quantity,
    })),
  );

  const totalReceived = delivery.grns.reduce((s, g) => s + g.deviceCount, 0);
  const totalQty = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/inbound/deliveries/${delivery.id}`, {
        purchaseOrderRef: poRef,
        expectedArrivalDate: arrivalDate,
        ivalueTicketNumber: ivalueTicket,
        clientTicketNumber: clientTicket,
        notes,
        items: items.map((i) => ({ ...i, quantity: Number(i.quantity) })),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['delivery', delivery.id] });
      void qc.invalidateQueries({ queryKey: ['inbound-deliveries'] });
      onClose();
    },
  });

  function setItem(idx: number, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
      className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5"
    >
      <h2 className="text-base font-semibold text-gray-900">Edit delivery</h2>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <label className="block text-sm font-medium text-gray-700">
          PO reference
          <input
            className={`${INPUT} mt-1`}
            value={poRef}
            onChange={(e) => setPoRef(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Expected arrival date
          <input
            type="date"
            required
            className={`${INPUT} mt-1`}
            value={arrivalDate}
            onChange={(e) => setArrivalDate(e.target.value)}
          />
        </label>
        <div />
        <label className="block text-sm font-medium text-gray-700">
          IValue ticket number
          <input
            className={`${INPUT} mt-1`}
            value={ivalueTicket}
            onChange={(e) => setIvalueTicket(e.target.value)}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Client ticket number
          <input
            className={`${INPUT} mt-1`}
            value={clientTicket}
            onChange={(e) => setClientTicket(e.target.value)}
          />
        </label>
      </div>

      <label className="block text-sm font-medium text-gray-700">
        Notes
        <textarea
          rows={2}
          className={`${INPUT} mt-1`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-700">
            Expected items{' '}
            <span className="font-normal text-gray-500">
              ({totalQty} expected, {totalReceived} already received)
            </span>
          </h3>
          <button
            type="button"
            onClick={() =>
              setItems((p) => [
                ...p,
                { category: 'laptop', model: '', manufacturer: '', quantity: 1 },
              ])
            }
            className="inline-flex items-center gap-1 text-xs font-medium text-[#E86F2C]"
          >
            <Plus size={14} /> Add item
          </button>
        </div>
        {items.map((it, idx) => (
          <div key={it.id ?? `new-${idx}`} className="grid grid-cols-12 gap-2 items-center">
            <select
              className={`${INPUT} col-span-2`}
              value={it.category}
              onChange={(e) => setItem(idx, { category: e.target.value })}
            >
              <option value="laptop">Laptop</option>
              <option value="monitor">Monitor</option>
              <option value="peripheral">Peripheral</option>
            </select>
            <input
              required
              placeholder="Model"
              className={`${INPUT} col-span-4`}
              value={it.model}
              onChange={(e) => setItem(idx, { model: e.target.value })}
            />
            <input
              required
              placeholder="Manufacturer"
              className={`${INPUT} col-span-3`}
              value={it.manufacturer}
              onChange={(e) => setItem(idx, { manufacturer: e.target.value })}
            />
            <input
              type="number"
              min={1}
              required
              className={`${INPUT} col-span-2`}
              value={it.quantity}
              onChange={(e) => setItem(idx, { quantity: Number(e.target.value) })}
            />
            <button
              type="button"
              disabled={items.length === 1}
              onClick={() => setItems((p) => p.filter((_, i) => i !== idx))}
              className="col-span-1 text-gray-400 hover:text-red-500 disabled:opacity-30"
              aria-label="Remove item"
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>

      {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={save.isPending}
          className="bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" onClick={onClose} className="text-sm text-gray-600 px-4 py-2">
          Cancel
        </button>
      </div>
    </form>
  );
}
