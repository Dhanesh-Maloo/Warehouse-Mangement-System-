import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Plus, X, Truck, Search } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Client {
  id: string;
  name: string;
}

interface InventoryAsset {
  id: string;
  serialNumber: string;
  model: string;
  manufacturer: string;
  category: string;
}

interface EndUser {
  id: string;
  name: string;
  clientId: string;
}

interface DeploymentOrder {
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<DeploymentOrder['status'], string> = {
  pending: 'bg-gray-100 text-gray-700',
  in_transit: 'bg-amber-100 text-amber-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<DeploymentOrder['status'], string> = {
  pending: 'Pending',
  in_transit: 'In Transit',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const VALID_NEXT_STATUSES: Record<DeploymentOrder['status'], DeploymentOrder['status'][]> = {
  pending: ['in_transit', 'delivered'],
  in_transit: ['in_transit', 'delivered'],
  delivered: [],
  cancelled: [],
};

// ---------------------------------------------------------------------------
// Empty form shape
// ---------------------------------------------------------------------------

const EMPTY_FORM = {
  assetId: '',
  endUserId: '',
  bundleType: 'standard' as 'standard' | 'full_prep',
  addrLine1: '',
  addrLine2: '',
  addrCity: '',
  addrState: '',
  addrPincode: '',
  contactName: '',
  contactPhone: '',
  requiresLabeling: false,
  requiresRepacking: false,
  ivalueTicketNumber: '',
  clientTicketNumber: '',
  notes: '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DeploymentPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const isClientUser = user?.role === 'client_user';
  const isEditor = user?.role === 'editor';
  const isClientAdmin = user?.role === 'client_admin';
  // editors are scoped to their own client like client_users, but can create/edit
  const isClientScoped = isClientUser || isEditor || isClientAdmin;
  const canCreate =
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'operator' ||
    isEditor ||
    isClientAdmin;

  const clientId = isClientScoped ? (user?.clientId ?? undefined) : undefined;

  // New deployment form visibility
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');

  // End user combobox
  const [endUserInput, setEndUserInput] = useState('');
  const [showEndUserDrop, setShowEndUserDrop] = useState(false);

  // Inline status change: one pending change at a time
  const [pendingChange, setPendingChange] = useState<{
    orderId: string;
    newStatus: DeploymentOrder['status'];
    trackingNumber: string;
  } | null>(null);
  const [statusError, setStatusError] = useState('');

  // Inline tracking number editing
  const [editingTracking, setEditingTracking] = useState<{ orderId: string; value: string } | null>(
    null,
  );

  // Filter / search client (admin view)
  const [filterClientId, setFilterClientId] = useState('');

  // Orders list filters
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('');

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: async () => {
      const res = await api.get<{ data: Client[] }>('/clients');
      return res.data;
    },
    enabled: !isClientScoped,
  });

  // Resolve which clientId to use for assets / end-users / deployment list
  const activeClientId = isClientScoped ? clientId : filterClientId || undefined;

  const { data: availableAssets = [] } = useQuery({
    queryKey: ['inventory-in-storage', activeClientId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'in_storage' });
      if (activeClientId) params.set('clientId', activeClientId);
      const res = await api.get<{ data: InventoryAsset[]; total: number }>(
        `/inventory?${params.toString()}`,
      );
      return res.data;
    },
    enabled: showForm,
  });

  const { data: endUsers = [] } = useQuery({
    queryKey: ['end-users', activeClientId],
    queryFn: () => {
      const params = new URLSearchParams();
      if (activeClientId) params.set('clientId', activeClientId);
      return api.get<EndUser[]>(`/end-users?${params.toString()}`);
    },
    enabled: showForm,
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['deployment-orders', activeClientId, orderSearch, orderStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (activeClientId) params.set('clientId', activeClientId);
      if (orderSearch.trim()) params.set('search', orderSearch.trim());
      if (orderStatusFilter) params.set('status', orderStatusFilter);
      return api.get<DeploymentOrder[]>(`/deployment?${params.toString()}`);
    },
    // Keeps showing the previous results while a new filter/search fetch is
    // in flight, instead of flipping isLoading back to true (which would
    // unmount the filter bar's input and drop keyboard focus on every keystroke).
    placeholderData: keepPreviousData,
  });

  // Courier zone is derived server-side from the delivery pincode. This is a
  // read-only preview for the cost estimate — the backend re-resolves it
  // authoritatively when the order is created.
  const pincode = form.addrPincode.trim();
  const {
    data: zoneData,
    isError: zoneIsError,
    error: zoneError,
    refetch: refetchZone,
  } = useQuery({
    queryKey: ['courier-zone-preview', pincode],
    queryFn: () =>
      api.get<{ zone: 'intra_state' | 'inter_state' | 'rural' }>(
        `/logistics/resolve-zone?pincode=${encodeURIComponent(pincode)}`,
      ),
    enabled: showForm && /^\d{6}$/.test(pincode),
    retry: 2,
    retryDelay: 1000,
  });
  const zonePreview = zoneData?.zone;

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createEndUserMutation = useMutation({
    mutationFn: ({ name, clientId: cid }: { name: string; clientId: string }) =>
      api.post<EndUser>('/end-users', { name, clientId: cid }),
    onSuccess: (newUser) => {
      void qc.invalidateQueries({ queryKey: ['end-users'] });
      f('endUserId', newUser.id);
      setEndUserInput(newUser.name);
      setShowEndUserDrop(false);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => api.post('/deployment', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deployment-orders'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      void qc.invalidateQueries({ queryKey: ['inventory-in-storage'] });
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEndUserInput('');
      setFormError('');
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
      trackingNumber,
    }: {
      id: string;
      status: string;
      trackingNumber?: string;
    }) =>
      api.patch(`/deployment/${id}/status`, {
        status,
        trackingNumber: trackingNumber || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deployment-orders'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      setPendingChange(null);
      setStatusError('');
    },
    onError: (e: Error) => setStatusError(e.message),
  });

  const zoneMutation = useMutation({
    mutationFn: ({
      id,
      courierZone,
    }: {
      id: string;
      courierZone: DeploymentOrder['courierZone'];
    }) => api.patch(`/deployment/${id}/zone`, { courierZone }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['deployment-orders'] }),
    onError: (e: Error) => alert(e.message),
  });

  const trackingMutation = useMutation({
    mutationFn: ({ id, trackingNumber }: { id: string; trackingNumber: string }) =>
      api.patch(`/deployment/${id}/tracking`, { trackingNumber }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['deployment-orders'] });
      setEditingTracking(null);
    },
    onError: (e: Error) => alert(e.message),
  });

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    const cid = isClientScoped ? (user?.clientId ?? '') : (activeClientId ?? '');
    if (!cid) {
      setFormError('Select a client first.');
      return;
    }
    if (!form.assetId) {
      setFormError('Select an asset.');
      return;
    }

    // If user typed a name but didn't explicitly select/create — resolve it now
    let resolvedEndUserId = form.endUserId || undefined;
    const typedName = endUserInput.trim();
    if (typedName && !resolvedEndUserId) {
      const match = endUsers.find((eu) => eu.name.toLowerCase() === typedName.toLowerCase());
      if (match) {
        resolvedEndUserId = match.id;
      } else {
        try {
          const newUser = await api.post<EndUser>('/end-users', { name: typedName, clientId: cid });
          void qc.invalidateQueries({ queryKey: ['end-users'] });
          resolvedEndUserId = newUser.id;
        } catch {
          setFormError(`Could not create end user "${typedName}".`);
          return;
        }
      }
    }

    createMutation.mutate({
      clientId: cid,
      assetId: form.assetId,
      endUserId: resolvedEndUserId,
      bundleType: form.bundleType,
      deliveryAddress: {
        line1: form.addrLine1,
        line2: form.addrLine2 || undefined,
        city: form.addrCity,
        state: form.addrState,
        pincode: form.addrPincode,
      },
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      requiresLabeling: form.requiresLabeling,
      requiresRepacking: form.requiresRepacking,
      ivalueTicketNumber: form.ivalueTicketNumber.trim() || undefined,
      clientTicketNumber: form.clientTicketNumber.trim() || undefined,
      notes: form.notes || undefined,
    });
  }

  function handleInlineStatusChange(order: DeploymentOrder, newStatus: DeploymentOrder['status']) {
    setStatusError('');
    setPendingChange({ orderId: order.id, newStatus, trackingNumber: '' });
  }

  function confirmStatusChange() {
    if (!pendingChange) return;
    statusMutation.mutate({
      id: pendingChange.orderId,
      status: pendingChange.newStatus,
      trackingNumber: pendingChange.trackingNumber || undefined,
    });
  }

  function f<K extends keyof typeof EMPTY_FORM>(k: K, v: (typeof EMPTY_FORM)[K]) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  // ---------------------------------------------------------------------------
  // Derived cost display
  // ---------------------------------------------------------------------------

  function estimatedCost(): string {
    let paise = 0;
    paise += form.bundleType === 'standard' ? 12800 : 38000;
    if (zonePreview === 'intra_state') paise += 150000;
    else if (zonePreview === 'inter_state') paise += 250000;
    else if (zonePreview === 'rural') paise += 320000;
    if (form.requiresLabeling) paise += 4800;
    if (form.requiresRepacking) paise += 14000;
    const rupees = paise / 100;
    return rupees.toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Deployment</h1>
          <p className="text-sm text-gray-500 mt-1">Pick, pack and dispatch assets to end users</p>
        </div>
        <div className="flex items-center gap-3">
          {!isClientScoped && (
            <select
              value={filterClientId}
              onChange={(e) => setFilterClientId(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
            >
              <option value="">All clients</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {canCreate && (
            <button
              onClick={() => {
                setShowForm(true);
                setFormError('');
              }}
              className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              <Plus size={16} />
              New Deployment Order
            </button>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Create form                                                         */}
      {/* ------------------------------------------------------------------ */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">New Deployment Order</h2>
            <button
              onClick={() => {
                setShowForm(false);
                setForm(EMPTY_FORM);
                setEndUserInput('');
                setFormError('');
              }}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </div>

          <form onSubmit={handleCreate} className="space-y-6">
            {/* Ticket numbers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  IValue Ticket Number <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.ivalueTicketNumber}
                  onChange={(e) => f('ivalueTicketNumber', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client Ticket Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.clientTicketNumber}
                  onChange={(e) => f('clientTicketNumber', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
            </div>

            {/* Client selector (not shown for client-scoped roles) */}
            {!isClientScoped && (
              <div className="max-w-sm">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={filterClientId}
                  onChange={(e) => setFilterClientId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
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

            {/* Asset + End User */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Asset serial or ID <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={form.assetId}
                  onChange={(e) => f('assetId', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                >
                  <option value="">Select asset in storage…</option>
                  {availableAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.serialNumber} - {a.manufacturer} {a.model}
                    </option>
                  ))}
                </select>
              </div>
              <div className="relative">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End User <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={endUserInput}
                  onChange={(e) => {
                    setEndUserInput(e.target.value);
                    f('endUserId', '');
                    setShowEndUserDrop(true);
                  }}
                  onFocus={() => setShowEndUserDrop(true)}
                  onBlur={() => setTimeout(() => setShowEndUserDrop(false), 150)}
                  placeholder="Search or type a name…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
                {form.endUserId && (
                  <span className="absolute right-3 top-[2.15rem] text-xs text-emerald-600 font-medium pointer-events-none">
                    ✓ linked
                  </span>
                )}
                {showEndUserDrop && (
                  <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {endUsers
                      .filter((eu) => eu.name.toLowerCase().includes(endUserInput.toLowerCase()))
                      .map((eu) => (
                        <button
                          key={eu.id}
                          type="button"
                          onMouseDown={() => {
                            f('endUserId', eu.id);
                            setEndUserInput(eu.name);
                            setShowEndUserDrop(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-800 hover:bg-[#E86F2C]/10 hover:text-[#E86F2C] transition-colors"
                        >
                          {eu.name}
                        </button>
                      ))}
                    {endUserInput.trim() &&
                      !endUsers.some(
                        (eu) => eu.name.toLowerCase() === endUserInput.trim().toLowerCase(),
                      ) && (
                        <button
                          type="button"
                          onMouseDown={() => {
                            const cid = isClientScoped
                              ? (user?.clientId ?? '')
                              : (activeClientId ?? '');
                            if (!cid) {
                              setFormError('Select a client before creating an end user.');
                              return;
                            }
                            createEndUserMutation.mutate({
                              name: endUserInput.trim(),
                              clientId: cid,
                            });
                          }}
                          disabled={createEndUserMutation.isPending}
                          className="w-full text-left px-4 py-2 text-sm text-[#E86F2C] font-medium hover:bg-[#E86F2C]/10 transition-colors border-t border-gray-100"
                        >
                          {createEndUserMutation.isPending
                            ? 'Creating…'
                            : `+ Create "${endUserInput.trim()}"`}
                        </button>
                      )}
                    {endUsers.filter((eu) =>
                      eu.name.toLowerCase().includes(endUserInput.toLowerCase()),
                    ).length === 0 &&
                      !endUserInput.trim() && (
                        <p className="px-4 py-3 text-xs text-gray-400">
                          No end users yet. Type a name to create one.
                        </p>
                      )}
                  </div>
                )}
              </div>
            </div>

            {/* Bundle type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Bundle type <span className="text-red-500">*</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-3">
                {(
                  [
                    { value: 'standard', label: 'Standard (Pick & Pack)', price: '₹128' },
                    { value: 'full_prep', label: 'Full Prep - bundled', price: '₹380' },
                  ] as const
                ).map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 px-4 py-3 border rounded-lg cursor-pointer transition-colors ${
                      form.bundleType === opt.value
                        ? 'border-[#E86F2C] bg-[#E86F2C]/5 ring-1 ring-[#E86F2C]'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="bundleType"
                      value={opt.value}
                      checked={form.bundleType === opt.value}
                      onChange={() => f('bundleType', opt.value)}
                      className="accent-[#E86F2C]"
                    />
                    <span className="text-sm text-gray-800">
                      {opt.label} <span className="font-semibold text-[#E86F2C]">{opt.price}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Delivery address */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-3">
                Delivery address <span className="text-red-500">*</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Address line 1
                  </label>
                  <input
                    required
                    value={form.addrLine1}
                    onChange={(e) => f('addrLine1', e.target.value)}
                    placeholder="Flat/Office, Street"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Address line 2 <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    value={form.addrLine2}
                    onChange={(e) => f('addrLine2', e.target.value)}
                    placeholder="Landmark, Area"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                </div>
                {(
                  [
                    { k: 'addrCity', label: 'City', placeholder: 'Mumbai' },
                    { k: 'addrState', label: 'State', placeholder: 'Maharashtra' },
                    { k: 'addrPincode', label: 'PIN code', placeholder: '400001' },
                  ] as Array<{ k: keyof typeof EMPTY_FORM; label: string; placeholder: string }>
                ).map(({ k, label, placeholder }) => (
                  <div key={k}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input
                      required
                      value={form[k] as string}
                      onChange={(e) => f(k, e.target.value)}
                      placeholder={placeholder}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Contact */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact name <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  value={form.contactName}
                  onChange={(e) => f('contactName', e.target.value)}
                  placeholder="Recipient's name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact phone <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  type="tel"
                  value={form.contactPhone}
                  onChange={(e) => f('contactPhone', e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
            </div>

            {/* Courier zone — auto-derived from the delivery pincode */}
            <div className="max-w-sm">
              <label className="block text-sm font-medium text-gray-700 mb-1">Courier zone</label>
              <div
                className={`w-full px-3 py-2 border rounded-lg text-sm ${
                  zoneIsError
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-gray-200 bg-gray-50 text-gray-700'
                }`}
              >
                {!/^\d{6}$/.test(pincode)
                  ? 'Enter a 6-digit PIN code above to determine the zone'
                  : zonePreview === 'intra_state'
                    ? 'Intra-state City - ₹1,500'
                    : zonePreview === 'inter_state'
                      ? 'Inter-state - ₹2,500'
                      : zonePreview === 'rural'
                        ? 'Rural - ₹3,200'
                        : zoneIsError
                          ? ((zoneError as Error)?.message ?? 'Could not resolve zone')
                          : 'Resolving…'}
              </div>
              {zoneIsError && (
                <button
                  type="button"
                  onClick={() => void refetchZone()}
                  className="text-xs text-[#E86F2C] font-medium mt-1 hover:underline"
                >
                  Retry
                </button>
              )}
              <p className="text-xs text-gray-400 mt-1">
                Automatically determined from the PIN code. Can be corrected after the order is
                created if misclassified.
              </p>
            </div>

            {/* Add-ons */}
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.requiresLabeling}
                  onChange={(e) => f('requiresLabeling', e.target.checked)}
                  className="w-4 h-4 rounded accent-[#E86F2C]"
                />
                Requires labeling <span className="text-xs text-gray-500">(₹48/label)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={form.requiresRepacking}
                  onChange={(e) => f('requiresRepacking', e.target.checked)}
                  className="w-4 h-4 rounded accent-[#E86F2C]"
                />
                Requires repacking <span className="text-xs text-gray-500">(₹140)</span>
              </label>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => f('notes', e.target.value)}
                placeholder="Any special delivery instructions"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>

            {/* Estimated cost */}
            <div className="flex items-center gap-2 px-4 py-3 bg-[#E86F2C]/5 border border-[#E86F2C]/20 rounded-lg">
              <Truck size={15} className="text-[#E86F2C] flex-shrink-0" />
              <span className="text-sm text-gray-700">
                Estimated order cost:{' '}
                <span className="font-semibold text-[#E86F2C]">{estimatedCost()}</span>
              </span>
            </div>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-[#D05E1E] transition-colors"
              >
                {createMutation.isPending ? 'Creating…' : 'Create deployment order'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setForm(EMPTY_FORM);
                  setEndUserInput('');
                  setFormError('');
                }}
                className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Orders table                                                        */}
      {/* ------------------------------------------------------------------ */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Filters */}
          <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wide">
              Status
            </label>
            <select
              value={orderStatusFilter}
              onChange={(e) => setOrderStatusFilter(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="in_transit">In Transit</option>
              <option value="delivered">Delivered</option>
              <option value="cancelled">Cancelled</option>
            </select>

            <div className="relative ml-auto">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder="Search asset, ticket no, or tracking no…"
                className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white w-72"
              />
            </div>
            {(orderSearch || orderStatusFilter) && (
              <button
                type="button"
                onClick={() => {
                  setOrderSearch('');
                  setOrderStatusFilter('');
                }}
                className="text-xs text-gray-500 hover:text-gray-700 underline"
              >
                Clear filters
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-3">Asset</th>
                  <th className="text-left px-5 py-3">End User</th>
                  <th className="text-left px-5 py-3">Delivery Address</th>
                  <th className="text-left px-5 py-3">Courier Zone</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">IValue Ticket #</th>
                  <th className="text-left px-5 py-3">Client Ticket #</th>
                  <th className="text-left px-5 py-3">Tracking No.</th>
                  <th className="text-left px-5 py-3">Requested</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const nextOptions = VALID_NEXT_STATUSES[order.status].filter(
                    (s) => s !== order.status,
                  );
                  const isPending = pendingChange?.orderId === order.id;
                  return (
                    <tr
                      key={order.id}
                      className="border-b border-gray-50 hover:bg-orange-50/40 transition-colors"
                    >
                      {/* Asset */}
                      <td className="px-5 py-3.5">
                        <Link
                          to={`/inventory/${order.asset.id}`}
                          className="group block"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <p className="font-mono font-semibold text-[#E86F2C] text-xs group-hover:underline">
                            {order.asset.serialNumber}
                          </p>
                          <p className="text-xs text-gray-500">{order.asset.model}</p>
                        </Link>
                      </td>

                      {/* End user */}
                      <td className="px-5 py-3.5 text-gray-600 text-xs">
                        {order.endUser?.name ?? (
                          <span className="text-gray-400 italic">Not assigned</span>
                        )}
                      </td>

                      {/* Delivery address */}
                      <td className="px-5 py-3.5 text-xs text-gray-600">
                        <p>{order.deliveryAddress.city}</p>
                        <p className="text-gray-400">{order.deliveryAddress.state}</p>
                      </td>

                      {/* Courier zone — inline select */}
                      <td className="px-5 py-3.5">
                        <select
                          value={order.courierZone}
                          onChange={(e) =>
                            zoneMutation.mutate({
                              id: order.id,
                              courierZone: e.target.value as DeploymentOrder['courierZone'],
                            })
                          }
                          className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                        >
                          <option value="intra_state">City</option>
                          <option value="inter_state">Interstate</option>
                          <option value="rural">Rural</option>
                        </select>
                      </td>

                      {/* Status — inline select for actionable rows */}
                      <td className="px-5 py-3.5">
                        {nextOptions.length > 0 ? (
                          <select
                            value={isPending ? pendingChange.newStatus : order.status}
                            onChange={(e) =>
                              handleInlineStatusChange(
                                order,
                                e.target.value as DeploymentOrder['status'],
                              )
                            }
                            className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                          >
                            <option value={order.status}>{STATUS_LABELS[order.status]}</option>
                            {nextOptions.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[order.status] ?? 'bg-gray-100 text-gray-700'}`}
                          >
                            {STATUS_LABELS[order.status] ?? order.status}
                          </span>
                        )}
                      </td>

                      {/* IValue Ticket # */}
                      <td className="px-5 py-3.5 text-xs font-mono text-gray-600">
                        {order.ivalueTicketNumber || <span className="text-gray-300">-</span>}
                      </td>

                      {/* Client Ticket # */}
                      <td className="px-5 py-3.5 text-xs font-mono text-gray-600">
                        {order.clientTicketNumber || <span className="text-gray-300">-</span>}
                      </td>

                      {/* Tracking number — inline editable */}
                      <td className="px-5 py-3.5 text-xs">
                        <input
                          type="text"
                          value={
                            editingTracking?.orderId === order.id
                              ? editingTracking.value
                              : (order.trackingNumber ?? '')
                          }
                          placeholder="Add tracking…"
                          onFocus={() =>
                            setEditingTracking({
                              orderId: order.id,
                              value: order.trackingNumber ?? '',
                            })
                          }
                          onChange={(e) =>
                            setEditingTracking((prev) =>
                              prev?.orderId === order.id
                                ? { ...prev, value: e.target.value }
                                : prev,
                            )
                          }
                          onBlur={() => {
                            if (editingTracking?.orderId === order.id) {
                              const val = editingTracking.value.trim();
                              if (val !== (order.trackingNumber ?? '')) {
                                trackingMutation.mutate({ id: order.id, trackingNumber: val });
                              } else {
                                setEditingTracking(null);
                              }
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            if (e.key === 'Escape') setEditingTracking(null);
                          }}
                          className="font-mono w-28 px-2 py-1 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-transparent hover:border-gray-400 transition-colors"
                        />
                      </td>

                      {/* Requested date */}
                      <td className="px-5 py-3.5 text-gray-500 text-xs">
                        {new Date(order.requestedAt).toLocaleDateString('en-IN')}
                      </td>

                      {/* Confirm panel — appears when a new status is selected */}
                      <td className="px-5 py-3.5">
                        {isPending ? (
                          <div className="flex items-center gap-2 flex-wrap">
                            {(pendingChange.newStatus === 'in_transit' ||
                              pendingChange.newStatus === 'delivered') && (
                              <input
                                type="text"
                                value={pendingChange.trackingNumber}
                                onChange={(e) =>
                                  setPendingChange((p) =>
                                    p ? { ...p, trackingNumber: e.target.value } : p,
                                  )
                                }
                                placeholder="Tracking # (optional)"
                                className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] w-36"
                              />
                            )}
                            <button
                              onClick={confirmStatusChange}
                              disabled={statusMutation.isPending}
                              className="bg-[#E86F2C] text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-50 hover:bg-[#D05E1E] transition-colors"
                            >
                              {statusMutation.isPending ? 'Saving…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => {
                                setPendingChange(null);
                                setStatusError('');
                              }}
                              className="text-xs text-gray-500 hover:text-gray-700"
                            >
                              Cancel
                            </button>
                            {statusError && <p className="text-xs text-red-600">{statusError}</p>}
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-5 py-12 text-center text-gray-400 text-sm">
                      {orderSearch || orderStatusFilter
                        ? 'No deployment orders match the selected filters.'
                        : 'No deployment orders yet. Create one above.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {orders.length > 0 && (
            <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
              {orders.length} order{orders.length !== 1 ? 's' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
