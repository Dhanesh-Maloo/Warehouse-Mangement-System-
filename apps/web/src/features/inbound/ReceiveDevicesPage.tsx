import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ArrowLeft, Scan, Trash2, CheckCircle, AlertCircle } from 'lucide-react';

interface Location {
  id: string;
  name: string;
  zoneCode: string;
  binCode: string;
}

interface DeliveryItem {
  category: string;
  model: string;
  manufacturer: string;
  quantity: number;
}

interface Delivery {
  id: string;
  purchaseOrderRef: string;
  items: DeliveryItem[];
}

interface DeviceRow {
  key: string;
  serialNumber: string;
  model: string;
  manufacturer: string;
  category: 'laptop' | 'monitor' | 'peripheral';
  assetTag: string;
  referenceName: string;
  vendorName: string;
  requiresInspection: boolean;
}

const CATEGORIES = ['laptop', 'monitor', 'peripheral'] as const;

function guessFromItems(items: DeliveryItem[]): Partial<DeviceRow> {
  if (items.length === 1) {
    return {
      category: items[0].category as DeviceRow['category'],
      model: items[0].model,
      manufacturer: items[0].manufacturer,
    };
  }
  return {};
}

export function ReceiveDevicesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [scanValue, setScanValue] = useState('');
  const [locationId, setLocationId] = useState('');
  const [courierRef, setCourierRef] = useState('');
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [submitError, setSubmitError] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  const { data: delivery } = useQuery({
    queryKey: ['delivery', id],
    queryFn: () => api.get<Delivery>(`/inbound/deliveries/${id ?? ''}`),
    enabled: !!id,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
  });

  // Auto-select first location
  useEffect(() => {
    if (locations.length > 0 && !locationId) {
      setLocationId(locations[0].id);
    }
  }, [locations, locationId]);

  // Keep scan input focused
  function refocusScan() {
    setTimeout(() => scanRef.current?.focus(), 50);
  }

  function handleScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const serial = scanValue.trim().toUpperCase();
    if (!serial) return;

    if (devices.some((d) => d.serialNumber === serial)) {
      // Flash warning — don't add duplicate
      setScanValue('');
      refocusScan();
      return;
    }

    const prefill = delivery ? guessFromItems(delivery.items) : {};

    setDevices((prev) => [
      ...prev,
      {
        key: `${serial}-${Date.now()}`,
        serialNumber: serial,
        model: prefill.model ?? '',
        manufacturer: prefill.manufacturer ?? '',
        category: prefill.category ?? 'laptop',
        assetTag: '',
        referenceName: '',
        vendorName: '',
        requiresInspection: false,
      },
    ]);
    setScanValue('');
    refocusScan();
  }

  function updateDevice(key: string, field: keyof DeviceRow, value: string | boolean) {
    setDevices((prev) => prev.map((d) => (d.key === key ? { ...d, [field]: value } : d)));
  }

  function removeDevice(key: string) {
    setDevices((prev) => prev.filter((d) => d.key !== key));
    refocusScan();
  }

  const submitMutation = useMutation({
    mutationFn: () =>
      api.post('/inbound/receive', {
        expectedDeliveryId: id,
        receivingLocationId: locationId,
        courierRef: courierRef.trim() || undefined,
        devices: devices.map(
          ({
            serialNumber,
            model,
            manufacturer,
            category,
            assetTag,
            referenceName,
            vendorName,
            requiresInspection,
          }) => ({
            serialNumber,
            model,
            manufacturer,
            category,
            assetTag: assetTag.trim() || undefined,
            referenceName: referenceName.trim() || undefined,
            vendorName: vendorName.trim(),
            requiresInspection,
          }),
        ),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inbound-deliveries'] });
      void qc.invalidateQueries({ queryKey: ['delivery', id] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      void qc.invalidateQueries({ queryKey: ['pending-inspections-dashboard'] });
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      navigate(`/inbound/${id ?? ''}`);
    },
    onError: (err: Error) => {
      setSubmitError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError('');
    if (devices.length === 0) {
      setSubmitError('Scan at least one device before submitting.');
      return;
    }
    if (!locationId) {
      setSubmitError('Select a receiving location.');
      return;
    }
    const invalid = devices.find((d) => !d.model || !d.manufacturer);
    if (invalid) {
      setSubmitError(`Device ${invalid.serialNumber} is missing model or manufacturer.`);
      return;
    }
    const missingVendor = devices.find((d) => !d.vendorName.trim());
    if (missingVendor) {
      setSubmitError(`Device ${missingVendor.serialNumber} is missing vendor name.`);
      return;
    }
    submitMutation.mutate();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(`/inbound/${id ?? ''}`)}
          className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Receive devices</h1>
          {delivery && (
            <p className="text-sm text-gray-500 mt-0.5">
              Against{' '}
              <span className="font-mono font-semibold text-gray-700">
                {delivery.purchaseOrderRef}
              </span>
            </p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Location + Courier ref */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">Receipt details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Receiving location <span className="text-red-500">*</span>
              </label>
              <select
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              >
                <option value="">Select location…</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} - {loc.zoneCode}/{loc.binCode}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Courier reference <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={courierRef}
                onChange={(e) => setCourierRef(e.target.value)}
                placeholder="Tracking number or AWB"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
          </div>
        </div>

        {/* Scan input */}
        <div className="bg-[#1A2B3C] rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 text-white mb-3">
            <Scan size={18} />
            <span className="text-sm font-semibold">Scan serial number</span>
            <span className="ml-auto text-xs text-[#8AA6BF]">
              {devices.length} device{devices.length !== 1 ? 's' : ''} added
            </span>
          </div>
          <input
            ref={scanRef}
            autoFocus
            type="text"
            value={scanValue}
            onChange={(e) => setScanValue(e.target.value)}
            onKeyDown={handleScan}
            placeholder="Scan barcode or type serial and press Enter…"
            className="w-full px-4 py-3 bg-white/10 text-white placeholder-white/40 border border-white/20 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E86F2C] focus:border-transparent"
          />
          <p className="mt-2 text-xs text-[#8AA6BF]">
            Point a barcode scanner here - it types the serial and sends Enter automatically.
          </p>
        </div>

        {/* Device list */}
        {devices.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-3.5 border-b border-gray-100 text-sm font-semibold text-gray-700">
              Devices to receive
            </div>
            <div className="divide-y divide-gray-50">
              {devices.map((device, idx) => (
                <div key={device.key} className="px-5 py-4 space-y-3">
                  {/* Row header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-[#E86F2C] text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                        {idx + 1}
                      </span>
                      <span className="font-mono font-semibold text-gray-900 text-sm">
                        {device.serialNumber}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeDevice(device.key)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>

                  {/* Device fields */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Vendor <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={device.vendorName}
                        onChange={(e) => updateDevice(device.key, 'vendorName', e.target.value)}
                        placeholder="IValue, or other vendor"
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Category
                      </label>
                      <select
                        value={device.category}
                        onChange={(e) => updateDevice(device.key, 'category', e.target.value)}
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C] capitalize"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">Model</label>
                      <input
                        type="text"
                        value={device.model}
                        onChange={(e) => updateDevice(device.key, 'model', e.target.value)}
                        placeholder="ThinkPad X1"
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Manufacturer
                      </label>
                      <input
                        type="text"
                        value={device.manufacturer}
                        onChange={(e) => updateDevice(device.key, 'manufacturer', e.target.value)}
                        placeholder="Lenovo"
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Asset tag <span className="text-gray-400">(opt.)</span>
                      </label>
                      <input
                        type="text"
                        value={device.assetTag}
                        onChange={(e) => updateDevice(device.key, 'assetTag', e.target.value)}
                        placeholder="TAG-001"
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Reference No. <span className="text-gray-400">(opt.)</span>
                      </label>
                      <input
                        type="text"
                        value={device.referenceName}
                        onChange={(e) => updateDevice(device.key, 'referenceName', e.target.value)}
                        placeholder="Client's own reference"
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C]"
                      />
                    </div>
                  </div>

                  {/* Inspection toggle */}
                  <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={device.requiresInspection}
                      onClick={() =>
                        updateDevice(device.key, 'requiresInspection', !device.requiresInspection)
                      }
                      className={`relative w-9 h-5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-[#E86F2C] focus:ring-offset-1 ${
                        device.requiresInspection ? 'bg-[#E86F2C]' : 'bg-gray-200'
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          device.requiresInspection ? 'translate-x-4' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-sm text-gray-700">
                      {device.requiresInspection ? (
                        <span className="flex items-center gap-1 text-amber-600 font-medium">
                          <AlertCircle size={14} />
                          Inspection required
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-emerald-600">
                          <CheckCircle size={14} />
                          Sealed box - inspection exempt
                        </span>
                      )}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {devices.length === 0 && (
          <div className="text-center py-12 text-gray-400 text-sm">
            No devices scanned yet. Use the scanner or type a serial number above.
          </div>
        )}

        {/* Error */}
        {submitError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {submitError}
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-gray-500">
            {devices.length > 0
              ? `Ready to receive ${devices.length} device${devices.length !== 1 ? 's' : ''}`
              : 'Scan devices to enable submit'}
          </span>
          <button
            type="submit"
            disabled={devices.length === 0 || submitMutation.isPending}
            className="bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitMutation.isPending ? 'Saving…' : `Confirm receipt (${devices.length})`}
          </button>
        </div>
      </form>
    </div>
  );
}
