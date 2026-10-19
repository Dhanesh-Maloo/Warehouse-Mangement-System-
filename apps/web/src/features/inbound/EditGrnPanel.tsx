import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

export interface EditableDevice {
  id: string;
  serialNumber: string;
  model: string;
  manufacturer: string;
  referenceName: string | null;
  description: string | null;
  vendorName: string | null;
  assetCondition: string | null;
}

export interface EditableGrn {
  id: string;
  grnNumber: string | null;
  receivedAt: string;
  courierRef: string | null;
  assets: { assetId: string; asset: EditableDevice }[];
}

const INPUT =
  'w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]';

const istDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function DeviceRow({
  grnId,
  device,
  deliveryId,
}: {
  grnId: string;
  device: EditableDevice;
  deliveryId: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    serialNumber: device.serialNumber,
    model: device.model,
    manufacturer: device.manufacturer,
    referenceName: device.referenceName ?? '',
    description: device.description ?? '',
    vendorName: device.vendorName ?? '',
    assetCondition: device.assetCondition ?? '',
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/inbound/grns/${grnId}/devices/${device.id}`, {
        ...form,
        assetCondition: form.assetCondition || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['delivery', deliveryId] });
      setEditing(false);
    },
  });

  if (!editing) {
    return (
      <tr className="border-b border-gray-50">
        <td className="px-3 py-2 font-mono">{device.serialNumber}</td>
        <td className="px-3 py-2">
          {device.manufacturer} {device.model}
        </td>
        <td className="px-3 py-2">{device.referenceName ?? '-'}</td>
        <td className="px-3 py-2 max-w-[200px] truncate" title={device.description ?? undefined}>
          {device.description ?? '-'}
        </td>
        <td className="px-3 py-2">{device.vendorName ?? '-'}</td>
        <td className="px-3 py-2 capitalize">{device.assetCondition?.replace('_', ' ') ?? '-'}</td>
        <td className="px-3 py-2 text-right">
          <button
            onClick={() => setEditing(true)}
            className="text-xs font-medium text-[#E86F2C] hover:underline"
          >
            Edit
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-gray-50 bg-orange-50/40 align-top">
      <td className="px-3 py-2">
        <input
          className={INPUT}
          value={form.serialNumber}
          onChange={(e) => setForm({ ...form, serialNumber: e.target.value })}
        />
      </td>
      <td className="px-3 py-2 space-y-1">
        <input
          className={INPUT}
          placeholder="Manufacturer"
          value={form.manufacturer}
          onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
        />
        <input
          className={INPUT}
          placeholder="Model"
          value={form.model}
          onChange={(e) => setForm({ ...form, model: e.target.value })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={INPUT}
          value={form.referenceName}
          onChange={(e) => setForm({ ...form, referenceName: e.target.value })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={INPUT}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
      </td>
      <td className="px-3 py-2">
        <input
          className={INPUT}
          value={form.vendorName}
          onChange={(e) => setForm({ ...form, vendorName: e.target.value })}
        />
      </td>
      <td className="px-3 py-2">
        <select
          className={INPUT}
          value={form.assetCondition}
          onChange={(e) => setForm({ ...form, assetCondition: e.target.value })}
        >
          <option value="">-</option>
          <option value="new">New</option>
          <option value="used">Used</option>
          <option value="dead">Dead</option>
          <option value="not_working">Not working</option>
        </select>
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="text-xs font-semibold text-white bg-[#E86F2C] px-2.5 py-1 rounded-lg mr-2 disabled:opacity-60"
        >
          Save
        </button>
        <button onClick={() => setEditing(false)} className="text-xs text-gray-600">
          Cancel
        </button>
        {save.error && <p className="text-xs text-red-600 mt-1">{(save.error as Error).message}</p>}
      </td>
    </tr>
  );
}

export function EditGrnPanel({
  grn,
  deliveryId,
  onClose,
}: {
  grn: EditableGrn;
  deliveryId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [receivedDate, setReceivedDate] = useState(istDate(grn.receivedAt));
  const [courierRef, setCourierRef] = useState(grn.courierRef ?? '');
  const today = istDate(new Date().toISOString());
  const dateChanged = receivedDate !== istDate(grn.receivedAt);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/inbound/grns/${grn.id}`, {
        ...(dateChanged ? { receivedAt: receivedDate } : {}),
        courierRef,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['delivery', deliveryId] });
      onClose();
    },
  });

  return (
    <div className="px-5 py-4 bg-gray-50 border-b border-gray-100 space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm font-medium text-gray-700">
          Received date
          <input
            type="date"
            max={today}
            value={receivedDate}
            onChange={(e) => setReceivedDate(e.target.value)}
            className={`${INPUT} mt-1 w-44`}
          />
        </label>
        <label className="text-sm font-medium text-gray-700">
          Courier ref
          <input
            value={courierRef}
            onChange={(e) => setCourierRef(e.target.value)}
            className={`${INPUT} mt-1 w-56`}
          />
        </label>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
        >
          {save.isPending ? 'Saving…' : 'Save receipt'}
        </button>
        <button onClick={onClose} className="text-sm text-gray-600 px-2 py-2">
          Close
        </button>
      </div>
      {dateChanged && (
        <p className="text-xs text-amber-700">
          Changing the received date reverses the original ingest/inspection charges and re-posts
          them on the new date at the rate effective then. The original entries stay in the ledger.
        </p>
      )}
      {save.error && <p className="text-sm text-red-600">{(save.error as Error).message}</p>}

      <div className="overflow-x-auto bg-white rounded-lg border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
              <th className="text-left px-3 py-2">Serial</th>
              <th className="text-left px-3 py-2">Device</th>
              <th className="text-left px-3 py-2">Reference</th>
              <th className="text-left px-3 py-2">Description</th>
              <th className="text-left px-3 py-2">Vendor</th>
              <th className="text-left px-3 py-2">Condition</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {grn.assets.map(({ asset }) => (
              <DeviceRow key={asset.id} grnId={grn.id} deliveryId={deliveryId} device={asset} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
