import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Plus, Truck } from 'lucide-react';

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
  category: string;
}

interface EndUser {
  id: string;
  name: string;
  clientId: string;
}

type RetrievalStatus =
  | 'pending'
  | 'initiated'
  | 'in_transit'
  | 'received'
  | 'completed'
  | 'cancelled';

type BundleType = 'standard' | 'full_cycle';
type CourierZone = 'intra_state' | 'inter_state' | 'rural';

interface RetrievalRequest {
  id: string;
  asset: {
    id: string;
    serialNumber: string;
    model: string;
  };
  pickupAddress: {
    line1: string;
    city: string;
    state: string;
    pincode: string;
  };
  contactName: string;
  contactPhone: string;
  courierZone: CourierZone;
  bundleType: BundleType;
  requiresPostInspection: boolean;
  requiresWipe: boolean;
  requiresRedeploySetup: boolean;
  damageFound: boolean | null;
  notes?: string;
  trackingNumber?: string;
  status: RetrievalStatus;
  requestedAt: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<RetrievalStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  initiated: 'bg-blue-100 text-blue-700',
  in_transit: 'bg-amber-100 text-amber-700',
  received: 'bg-purple-100 text-purple-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<RetrievalStatus, string> = {
  pending: 'Pending',
  initiated: 'Initiated',
  in_transit: 'In Transit',
  received: 'Received',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const COURIER_ZONE_LABELS: Record<CourierZone, string> = {
  intra_state: 'City',
  inter_state: 'Interstate',
  rural: 'Rural',
};

const COURIER_ZONE_COLORS: Record<CourierZone, string> = {
  intra_state: 'bg-sky-100 text-sky-700',
  inter_state: 'bg-indigo-100 text-indigo-700',
  rural: 'bg-teal-100 text-teal-700',
};

const NEXT_STATUSES: Partial<Record<RetrievalStatus, RetrievalStatus[]>> = {
  pending: ['initiated', 'cancelled'],
  initiated: ['in_transit', 'cancelled'],
  in_transit: ['received', 'cancelled'],
  received: ['completed'],
};

const EMPTY_FORM = {
  assetId: '',
  bundleType: 'standard' as BundleType,
  addressLine1: '',
  city: '',
  state: '',
  pincode: '',
  contactName: '',
  contactPhone: '',
  requiresPostInspection: false,
  requiresWipe: false,
  requiresRedeploySetup: false,
  redeployEndUserId: '',
  redeployAddressLine1: '',
  redeployCity: '',
  redeployState: '',
  redeployPincode: '',
  redeployContactName: '',
  redeployContactPhone: '',
  notes: '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RetrievalPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedClientId, setSelectedClientId] = useState('');

  const isClientUser = user?.role === 'client_user';
  const isEditor = user?.role === 'editor';
  const isClientAdmin = user?.role === 'client_admin';
  // editors are scoped to their own client like client_users, but can create retrievals
  const isClientScoped = isClientUser || isEditor || isClientAdmin;
  const clientId = isClientScoped ? (user?.clientId ?? undefined) : undefined;

  // Fetch clients (admin/manager/operator only)
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-list'],
    queryFn: () => api.get<{ data: Client[] }>('/clients').then((r) => r.data),
    enabled: !isClientScoped,
  });

  // Deployed assets for the relevant client
  const assetClientId = isClientScoped ? clientId : selectedClientId;
  const { data: deployedAssets = [] } = useQuery({
    queryKey: ['deployed-assets', assetClientId],
    queryFn: async () => {
      const res = await api.get<{ data: InventoryAsset[]; total: number }>(
        `/assets?status=deployed${assetClientId ? `&clientId=${assetClientId}` : ''}`,
      );
      return res.data;
    },
    enabled: showForm && !!assetClientId,
  });

  // End users for the relevant client — only needed to pick a Full Cycle redeploy destination
  const { data: endUsers = [] } = useQuery({
    queryKey: ['end-users', assetClientId],
    queryFn: () => api.get<EndUser[]>(`/end-users?clientId=${assetClientId}`),
    enabled: showForm && form.bundleType === 'full_cycle' && !!assetClientId,
  });

  // Retrieval requests list
  const { data: retrievals = [], isLoading } = useQuery({
    queryKey: ['retrieval-requests', clientId],
    queryFn: () =>
      api.get<RetrievalRequest[]>(`/retrieval${clientId ? `?clientId=${clientId}` : ''}`),
  });

  // Courier zone is derived server-side from the pickup pincode. This is a
  // read-only preview for the cost estimate — the backend re-resolves it
  // authoritatively when the request is created.
  const {
    data: zoneData,
    isError: zoneIsError,
    error: zoneError,
    refetch: refetchZone,
  } = useQuery({
    queryKey: ['courier-zone-preview', form.pincode],
    queryFn: () =>
      api.get<{ zone: CourierZone }>(
        `/logistics/resolve-zone?pincode=${encodeURIComponent(form.pincode)}`,
      ),
    enabled: showForm && /^\d{6}$/.test(form.pincode),
    retry: 2,
    retryDelay: 1000,
  });
  const zonePreview = zoneData?.zone;

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (payload: unknown) => api.post('/retrieval', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['retrieval-requests'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      void qc.invalidateQueries({ queryKey: ['deployed-assets'] });
      setShowForm(false);
      setForm({ ...EMPTY_FORM });
      setSelectedClientId('');
    },
  });

  // Status update mutation
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RetrievalStatus }) =>
      api.patch(`/retrieval/${id}/status`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['retrieval-requests'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
    },
    onError: (e: Error) => alert(e.message),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const cid = isClientScoped ? (user?.clientId ?? '') : selectedClientId;
    const isFullCycle = form.bundleType === 'full_cycle';
    createMutation.mutate({
      clientId: cid,
      assetId: form.assetId,
      bundleType: form.bundleType,
      pickupAddress: {
        line1: form.addressLine1,
        city: form.city,
        state: form.state,
        pincode: form.pincode,
      },
      contactName: form.contactName,
      contactPhone: form.contactPhone,
      // Diagnostic inspection is now a standard step for every retrieval —
      // always true; the field remains for backward compatibility.
      requiresPostInspection: true,
      requiresWipe: form.requiresWipe,
      requiresRedeploySetup: isFullCycle ? form.requiresRedeploySetup : undefined,
      redeployEndUserId: isFullCycle ? form.redeployEndUserId || undefined : undefined,
      redeployDeliveryAddress: isFullCycle
        ? {
            line1: form.redeployAddressLine1,
            city: form.redeployCity,
            state: form.redeployState,
            pincode: form.redeployPincode,
          }
        : undefined,
      redeployContactName: isFullCycle ? form.redeployContactName : undefined,
      redeployContactPhone: isFullCycle ? form.redeployContactPhone : undefined,
      notes: form.notes.trim() || undefined,
    });
  }

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  // Bundle price preview — the diagnostic inspection is billed separately
  // when it's completed (INSPECT rate code), not at request-creation time.
  const bundlePaise = form.bundleType === 'full_cycle' ? 50000 : 19000;
  const formatRupees = (p: number) => `₹${(p / 100).toFixed(0)}`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Retrievals</h1>
          <p className="text-sm text-gray-500 mt-1">
            Asset retrieval requests from deployed locations
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Retrieval Request
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <h2 className="text-base font-semibold text-gray-900">New Retrieval Request</h2>
          <form onSubmit={handleCreate} className="space-y-5">
            {/* Client selector (not shown for client-scoped roles) */}
            {!isClientScoped && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Client <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={selectedClientId}
                    onChange={(e) => {
                      setSelectedClientId(e.target.value);
                      setField('assetId', '');
                    }}
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
              </div>
            )}

            {/* Asset + Bundle */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Asset <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={form.assetId}
                  onChange={(e) => setField('assetId', e.target.value)}
                  disabled={!assetClientId}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] disabled:bg-gray-50 disabled:text-gray-400"
                >
                  <option value="">
                    {assetClientId
                      ? deployedAssets.length === 0
                        ? 'No deployed assets'
                        : 'Select asset…'
                      : 'Select a client first'}
                  </option>
                  {deployedAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.serialNumber} - {a.model}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bundle type <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={form.bundleType}
                  onChange={(e) => setField('bundleType', e.target.value as BundleType)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                >
                  <option value="standard">Standard - ₹190</option>
                  <option value="full_cycle">Full Cycle (retrieve + redeploy) - ₹500</option>
                </select>
              </div>
            </div>

            {/* Pickup address */}
            <div>
              <p className="text-sm font-medium text-gray-700 mb-2">
                Pickup address <span className="text-red-500">*</span>
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={form.addressLine1}
                  onChange={(e) => setField('addressLine1', e.target.value)}
                  placeholder="Street / building / floor"
                  className="sm:col-span-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
                <input
                  type="text"
                  required
                  value={form.city}
                  onChange={(e) => setField('city', e.target.value)}
                  placeholder="City"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
                <input
                  type="text"
                  required
                  value={form.state}
                  onChange={(e) => setField('state', e.target.value)}
                  placeholder="State"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
                <input
                  type="text"
                  required
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={form.pincode}
                  onChange={(e) => setField('pincode', e.target.value)}
                  placeholder="Pincode (6 digits)"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
            </div>

            {/* Contact + Courier zone */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.contactName}
                  onChange={(e) => setField('contactName', e.target.value)}
                  placeholder="Full name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Contact phone <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={form.contactPhone}
                  onChange={(e) => setField('contactPhone', e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Courier zone</label>
                <div
                  className={`w-full px-3 py-2 border rounded-lg text-sm ${
                    zoneIsError
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-gray-200 bg-gray-50 text-gray-700'
                  }`}
                >
                  {!/^\d{6}$/.test(form.pincode)
                    ? 'Enter a 6-digit pincode above'
                    : zonePreview === 'intra_state'
                      ? 'City - ₹1,500'
                      : zonePreview === 'inter_state'
                        ? 'Interstate - ₹2,500'
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
              </div>
            </div>

            {/* Diagnostic step — now mandatory for every retrieval, both bundle types */}
            <div className="rounded-lg bg-sky-50 border border-sky-100 px-4 py-2.5 text-xs text-sky-800">
              Every retrieval now goes through a diagnostic inspection once received at the
              warehouse - device in → inspect → physical diagnostic check → damage alert, or (Full
              Cycle) proceed to redeploy. This happens automatically; there&apos;s no opt-out.
            </div>

            {/* Wipe — placeholder, captured but not yet executed automatically */}
            <div className="flex items-center gap-3">
              <input
                id="requires-wipe"
                type="checkbox"
                checked={form.requiresWipe}
                onChange={(e) => setField('requiresWipe', e.target.checked)}
                className="h-4 w-4 rounded border-gray-300 text-[#E86F2C] focus:ring-[#E86F2C] accent-[#E86F2C]"
              />
              <label
                htmlFor="requires-wipe"
                className="text-sm text-gray-700 cursor-pointer select-none"
              >
                Requires data wipe{' '}
                <span className="text-gray-400">
                  (flags the request for your team - not yet automated)
                </span>
              </label>
            </div>

            {/* Full Cycle redeploy details */}
            {form.bundleType === 'full_cycle' && (
              <div className="rounded-lg border border-orange-200 bg-orange-50/40 p-4 space-y-4">
                <p className="text-sm font-semibold text-gray-800">
                  Redeploy destination <span className="text-red-500">*</span>
                </p>
                <p className="text-xs text-gray-500 -mt-2">
                  Once the diagnostic check finds no damage, the deployment order below is created
                  automatically for the new user.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      New end user
                    </label>
                    <select
                      required
                      value={form.redeployEndUserId}
                      onChange={(e) => setField('redeployEndUserId', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                    >
                      <option value="">Select end user…</option>
                      {endUsers.map((eu) => (
                        <option key={eu.id} value={eu.id}>
                          {eu.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <label className="flex items-center gap-2 mt-6 cursor-pointer text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.requiresRedeploySetup}
                      onChange={(e) => setField('requiresRedeploySetup', e.target.checked)}
                      className="w-4 h-4 rounded accent-[#E86F2C]"
                    />
                    Requires setup <span className="text-xs text-gray-500">(Full Prep bundle)</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={form.redeployAddressLine1}
                    onChange={(e) => setField('redeployAddressLine1', e.target.value)}
                    placeholder="Street / building / floor"
                    className="sm:col-span-2 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                  <input
                    type="text"
                    required
                    value={form.redeployCity}
                    onChange={(e) => setField('redeployCity', e.target.value)}
                    placeholder="City"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                  <input
                    type="text"
                    required
                    value={form.redeployState}
                    onChange={(e) => setField('redeployState', e.target.value)}
                    placeholder="State"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                  <input
                    type="text"
                    required
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={form.redeployPincode}
                    onChange={(e) => setField('redeployPincode', e.target.value)}
                    placeholder="Pincode (6 digits)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    type="text"
                    required
                    value={form.redeployContactName}
                    onChange={(e) => setField('redeployContactName', e.target.value)}
                    placeholder="Recipient's name"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                  <input
                    type="tel"
                    required
                    value={form.redeployContactPhone}
                    onChange={(e) => setField('redeployContactPhone', e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                </div>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
                placeholder="Any special handling instructions"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>

            {/* Cost preview */}
            <div className="rounded-lg bg-orange-50 border border-orange-100 px-4 py-3 text-sm text-gray-700 flex items-center justify-between">
              <span>
                Estimated charges:{' '}
                <span className="font-semibold">{formatRupees(bundlePaise)}</span> retrieval +
                courier (inspection billed separately on completion)
              </span>
              <span className="font-bold text-[#E86F2C]">Total: {formatRupees(bundlePaise)}</span>
            </div>

            {createMutation.error && (
              <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>
            )}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-[#D05E1E] transition-colors"
              >
                {createMutation.isPending ? 'Saving…' : 'Create request'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setForm({ ...EMPTY_FORM });
                  setSelectedClientId('');
                }}
                className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">Asset</th>
                <th className="text-left px-5 py-3">Pickup location</th>
                <th className="text-left px-5 py-3">Zone</th>
                <th className="text-left px-5 py-3">Bundle</th>
                <th className="text-left px-5 py-3">Damage</th>
                <th className="text-left px-5 py-3">Tracking #</th>
                <th className="text-left px-5 py-3">Notes</th>
                <th className="text-left px-5 py-3">Requested</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {retrievals.map((r) => {
                const nextStatuses = NEXT_STATUSES[r.status] ?? [];
                const canUpdate = nextStatuses.length > 0;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-gray-50 hover:bg-orange-50/40 transition-colors"
                  >
                    {/* Asset */}
                    <td className="px-5 py-3.5">
                      <Link to={`/inventory/${r.asset.id}`} className="group block">
                        <div className="font-mono text-xs font-semibold text-[#E86F2C] group-hover:underline">
                          {r.asset.serialNumber}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">{r.asset.model}</div>
                      </Link>
                    </td>

                    {/* Pickup address */}
                    <td className="px-5 py-3.5">
                      <div className="text-gray-900">{r.pickupAddress.city}</div>
                      <div className="text-xs text-gray-400 mt-0.5">{r.pickupAddress.state}</div>
                    </td>

                    {/* Courier zone badge */}
                    <td className="px-5 py-3.5">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                          COURIER_ZONE_COLORS[r.courierZone]
                        }`}
                      >
                        {COURIER_ZONE_LABELS[r.courierZone]}
                      </span>
                    </td>

                    {/* Bundle type */}
                    <td className="px-5 py-3.5 text-gray-700 capitalize">
                      {r.bundleType === 'full_cycle' ? (
                        <span className="inline-flex items-center gap-1">
                          <Truck size={13} className="text-[#E86F2C]" />
                          Full cycle
                        </span>
                      ) : (
                        'Standard'
                      )}
                      {r.requiresWipe && (
                        <div className="text-[10px] text-amber-600 mt-0.5">Wipe requested</div>
                      )}
                    </td>

                    {/* Damage found — set once the post-retrieval inspection completes */}
                    <td className="px-5 py-3.5">
                      {r.damageFound === null ? (
                        <span className="text-gray-400 text-xs">Pending</span>
                      ) : r.damageFound ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                          Damage found
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                          Clean
                        </span>
                      )}
                    </td>

                    {/* Tracking number */}
                    <td className="px-5 py-3.5 text-xs">
                      {r.trackingNumber ? (
                        <span className="font-mono text-gray-700">{r.trackingNumber}</span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>

                    {/* Notes */}
                    <td className="px-5 py-3.5 text-xs text-gray-600 max-w-[180px]">
                      {r.notes ? (
                        <span className="line-clamp-2" title={r.notes}>
                          {r.notes}
                        </span>
                      ) : (
                        <span className="text-gray-400">-</span>
                      )}
                    </td>

                    {/* Requested date */}
                    <td className="px-5 py-3.5 text-gray-500 text-xs whitespace-nowrap">
                      {new Date(r.requestedAt).toLocaleDateString('en-IN')}
                    </td>

                    {/* Status — inline select for actionable rows, badge for terminal states */}
                    <td className="px-5 py-3.5">
                      {canUpdate ? (
                        <select
                          defaultValue={r.status}
                          onChange={(e) =>
                            updateStatusMutation.mutate({
                              id: r.id,
                              status: e.target.value as RetrievalStatus,
                            })
                          }
                          disabled={updateStatusMutation.isPending}
                          className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white disabled:opacity-50"
                        >
                          <option value={r.status}>{STATUS_LABELS[r.status]}</option>
                          {nextStatuses.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}
                        >
                          {STATUS_LABELS[r.status]}
                        </span>
                      )}
                    </td>
                    <td />
                  </tr>
                );
              })}
              {retrievals.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-gray-400 text-sm">
                    No retrieval requests yet. Create one above.
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
