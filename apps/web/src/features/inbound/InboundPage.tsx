import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Plus, Trash2, Package } from 'lucide-react';

interface Client {
  id: string;
  name: string;
}
interface DeliveryItem {
  category: 'laptop' | 'monitor' | 'peripheral';
  model: string;
  manufacturer: string;
  quantity: number;
}
interface Delivery {
  id: string;
  purchaseOrderRef: string;
  expectedArrivalDate: string;
  status: string;
  items: { category: string; quantity: number; receivedQuantity: number }[];
  grns: { deviceCount: number }[];
}


const EMPTY_ITEM: DeliveryItem = { category: 'laptop', model: '', manufacturer: '', quantity: 1 };

export function InboundPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'received' | 'not_received'>('all');

  // Form state
  const [selectedClientId, setSelectedClientId] = useState('');
  const [poRef, setPoRef] = useState('');
  const [arrivalDate, setArrivalDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<DeliveryItem[]>([{ ...EMPTY_ITEM }]);

  const isClientUser = user?.role === 'client_user';
  const isEditor = user?.role === 'editor';
  const isClientAdmin = user?.role === 'client_admin';
  // editors are scoped to their own client like client_users, but can create deliveries
  const isClientScoped = isClientUser || isEditor || isClientAdmin;
  const clientId = isClientScoped ? (user?.clientId ?? undefined) : undefined;

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: async () => {
      const res = await api.get<{ data: Client[] }>('/clients');
      return res.data;
    },
    enabled: !isClientScoped,
  });

  const { data: deliveries = [], isLoading } = useQuery({
    queryKey: ['inbound-deliveries', clientId],
    queryFn: () =>
      api.get<Delivery[]>(`/inbound/deliveries${clientId ? `?clientId=${clientId}` : ''}`),
  });

  const statusChangeMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      api.patch(`/inbound/deliveries/${id}/status`, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['inbound-deliveries'] }),
    onError: (e: Error) => alert(e.message),
  });

  const filteredDeliveries = deliveries.filter((d) => {
    if (statusFilter === 'received') return d.status === 'completed';
    if (statusFilter === 'not_received') return d.status !== 'completed';
    return true;
  });

  function addItem() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateItem<K extends keyof DeliveryItem>(idx: number, field: K, value: DeliveryItem[K]) {
    setItems((prev) => prev.map((item, i) => (i === idx ? { ...item, [field]: value } : item)));
  }

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => api.post('/inbound/deliveries', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['inbound-deliveries'] });
      setShowForm(false);
      setPoRef('');
      setArrivalDate('');
      setNotes('');
      setSelectedClientId('');
      setItems([{ ...EMPTY_ITEM }]);
    },
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const cid = isClientScoped ? (user?.clientId ?? '') : selectedClientId;
    createMutation.mutate({
      clientId: cid,
      purchaseOrderRef: poRef,
      expectedArrivalDate: arrivalDate,
      notes: notes.trim() || undefined,
      items,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inbound</h1>
          <p className="text-sm text-gray-500 mt-1">Expected deliveries and receipt records</p>
        </div>
        {!isClientUser && (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New delivery
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <h2 className="text-base font-semibold text-gray-900">Log expected delivery</h2>
          <form onSubmit={handleCreate} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {!isClientScoped && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={selectedClientId}
                    onChange={(e) => setSelectedClientId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  >
                    <option value="">Select client…</option>
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  PO reference <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={poRef}
                  onChange={(e) => setPoRef(e.target.value)}
                  placeholder="PO-2026-001"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expected arrival <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={arrivalDate}
                  onChange={(e) => setArrivalDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  Expected items <span className="text-red-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={addItem}
                  className="text-xs text-[#E86F2C] hover:underline"
                >
                  + Add line
                </button>
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-2">
                      <select
                        value={item.category}
                        onChange={(e) =>
                          updateItem(idx, 'category', e.target.value as DeliveryItem['category'])
                        }
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C] capitalize"
                      >
                        <option value="laptop">Laptop</option>
                        <option value="monitor">Monitor</option>
                        <option value="peripheral">Peripheral</option>
                      </select>
                    </div>
                    <div className="col-span-4">
                      <input
                        type="text"
                        required
                        value={item.model}
                        onChange={(e) => updateItem(idx, 'model', e.target.value)}
                        placeholder="Model (e.g. ThinkPad X1)"
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C]"
                      />
                    </div>
                    <div className="col-span-3">
                      <input
                        type="text"
                        required
                        value={item.manufacturer}
                        onChange={(e) => updateItem(idx, 'manufacturer', e.target.value)}
                        placeholder="Manufacturer"
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C]"
                      />
                    </div>
                    <div className="col-span-2">
                      <input
                        type="number"
                        required
                        min={1}
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(idx, 'quantity', parseInt(e.target.value, 10) || 1)
                        }
                        className="w-full px-2.5 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-[#E86F2C]"
                      />
                    </div>
                    <div className="col-span-1 flex justify-center">
                      {items.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItem(idx)}
                          className="p-1 text-gray-400 hover:text-red-500"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-gray-400">Category · Model · Manufacturer · Qty</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any special instructions or remarks"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>

            {createMutation.error && (
              <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
              >
                {createMutation.isPending ? 'Saving…' : 'Create delivery'}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Deliveries table */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
            >
              <option value="all">All</option>
              <option value="received">Received</option>
              <option value="not_received">Not Received</option>
            </select>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">PO Reference</th>
                <th className="text-left px-5 py-3">Expected arrival</th>
                <th className="text-left px-5 py-3">Items</th>
                <th className="text-left px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredDeliveries.map((d) => {
                const totalExpected = d.items.reduce((s, i) => s + i.quantity, 0);
                const totalReceived = (d.grns ?? []).reduce((s, g) => s + g.deviceCount, 0);
                return (
                  <tr
                    key={d.id}
                    onClick={() => navigate(`/inbound/${d.id}`)}
                    className="border-b border-gray-50 hover:bg-orange-50/40 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3.5 font-mono font-semibold text-gray-900">
                      {d.purchaseOrderRef}
                    </td>
                    <td className="px-5 py-3.5 text-gray-600">
                      {new Date(d.expectedArrivalDate).toLocaleDateString('en-IN')}
                    </td>
                    <td className="px-5 py-3.5 text-gray-600 flex items-center gap-1">
                      <Package size={14} className="text-gray-400" />
                      {totalReceived}/{totalExpected}
                    </td>
                    <td className="px-5 py-3.5">
                      <select
                        value={d.status === 'completed' ? 'completed' : 'not_received'}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          const newStatus = e.target.value === 'completed' ? 'completed' : 'pending';
                          statusChangeMutation.mutate({ id: d.id, status: newStatus });
                        }}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#E86F2C] appearance-none pr-6 ${
                          d.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                        style={{ backgroundImage: 'none' }}
                      >
                        <option value="not_received">Not Received</option>
                        <option value="completed">Received</option>
                      </select>
                    </td>
                  </tr>
                );
              })}
              {filteredDeliveries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center text-gray-400 text-sm">
                    {statusFilter === 'all' ? 'No deliveries yet. Create one above.' : 'No deliveries match the selected filter.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
