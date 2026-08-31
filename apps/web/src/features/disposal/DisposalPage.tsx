import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Plus } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Client {
  id: string;
  name: string;
}

interface InventoryAsset {
  id: string;
  serialNumber: string;
  model: string;
  manufacturer: string;
  clientId: string;
}

type DisposalType = 'non_certified' | 'certified_blanco' | 'itad_bundled';
type DisposalStatus = 'pending' | 'approved' | 'in_progress' | 'completed' | 'cancelled';

interface DisposalRequest {
  id: string;
  asset: {
    id: string;
    serialNumber: string;
    model: string;
    manufacturer: string;
  };
  disposalType: DisposalType;
  requiresCertification: boolean;
  status: DisposalStatus;
  notes?: string;
  createdAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<DisposalStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  approved: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<DisposalStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  in_progress: 'In Progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DISPOSAL_TYPE_META: Record<
  DisposalType,
  { label: string; price: string; description: string }
> = {
  non_certified: {
    label: 'Non-Certified Disposal',
    price: '₹450 + GST',
    description: 'Decommission with no data wipe certificate',
  },
  certified_blanco: {
    label: 'Certified Data Destruction',
    price: '₹550 + GST',
    description: 'Certified wipe + destruction certificate',
  },
  itad_bundled: {
    label: 'Retrieval + ITAD Bundled',
    price: '₹1,750 + GST',
    description: 'Retrieve device + disposal handling, single fee',
  },
};

const CERTIFICATION_ADDON_PRICE = '₹550 + GST';

// ─── Component ───────────────────────────────────────────────────────────────

export function DisposalPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const isClientUser = user?.role === 'client_user';
  const isEditor = user?.role === 'editor';
  const isClientAdmin = user?.role === 'client_admin';
  // editors are scoped to their own client like client_users, but can create disposal requests
  const isClientScoped = isClientUser || isEditor || isClientAdmin;
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  const canApprove = isAdminOrManager || isClientAdmin;
  const clientId = isClientScoped ? (user?.clientId ?? undefined) : undefined;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);

  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [disposalType, setDisposalType] = useState<DisposalType>('non_certified');
  const [ivalueTicketNumber, setIvalueTicketNumber] = useState('');
  const [clientTicketNumber, setClientTicketNumber] = useState('');
  const [notes, setNotes] = useState('');

  const effectiveClientId = isClientScoped ? (clientId ?? '') : selectedClientId;

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: clientsList = [] } = useQuery({
    queryKey: ['clients-list-disposal'],
    queryFn: () => api.get<{ data: Client[]; total: number }>('/clients').then((r) => r.data),
    enabled: !isClientScoped,
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['in-storage-assets', effectiveClientId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'in_storage' });
      if (effectiveClientId) params.set('clientId', effectiveClientId);
      const res = await api.get<{ data: InventoryAsset[]; total: number }>(
        `/assets?${params.toString()}`,
      );
      return res.data;
    },
    enabled: showForm && !!effectiveClientId,
  });

  const { data: disposals = [], isLoading } = useQuery({
    queryKey: ['disposal-requests', clientId],
    queryFn: async () => {
      const params = clientId ? `?clientId=${clientId}` : '';
      const res = await api.get<DisposalRequest[]>(`/disposal${params}`);
      return res;
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => api.post('/disposal', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['disposal-requests'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      resetForm();
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/disposal/${id}/approve`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['disposal-requests'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      setConfirmApproveId(null);
    },
  });

  const startProcessingMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/disposal/${id}/start-processing`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['disposal-requests'] });
    },
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/disposal/${id}/complete`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['disposal-requests'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
    },
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function resetForm() {
    setShowForm(false);
    setSelectedClientId('');
    setSelectedAssetId('');
    setDisposalType('non_certified');
    setIvalueTicketNumber('');
    setClientTicketNumber('');
    setNotes('');
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      clientId: effectiveClientId,
      assetId: selectedAssetId,
      disposalType,
      ivalueTicketNumber: ivalueTicketNumber.trim() || undefined,
      clientTicketNumber: clientTicketNumber.trim() || undefined,
      notes: notes.trim() || undefined,
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Disposal</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage end-of-life device disposal and data destruction
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Disposal Request
        </button>
      </div>

      {/* ── New request form ───────────────────────────────────────────────── */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <h2 className="text-base font-semibold text-gray-900">New Disposal Request</h2>
          <form onSubmit={handleCreate} className="space-y-5">
            {/* Ticket numbers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  IValue Ticket Number <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={ivalueTicketNumber}
                  onChange={(e) => setIvalueTicketNumber(e.target.value)}
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
                  value={clientTicketNumber}
                  onChange={(e) => setClientTicketNumber(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
            </div>

            {/* Client selector (not shown for client-scoped roles) */}
            {!isClientScoped && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={selectedClientId}
                  onChange={(e) => {
                    setSelectedClientId(e.target.value);
                    setSelectedAssetId('');
                  }}
                  className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                >
                  <option value="">Select client…</option>
                  {clientsList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Asset selector */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Asset <span className="text-red-500">*</span>
              </label>
              <select
                required
                value={selectedAssetId}
                onChange={(e) => setSelectedAssetId(e.target.value)}
                disabled={!effectiveClientId}
                className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] disabled:bg-gray-50 disabled:text-gray-400"
              >
                <option value="">
                  {effectiveClientId
                    ? assets.length === 0
                      ? 'No in-storage assets'
                      : 'Select an asset…'
                    : 'Select a client first'}
                </option>
                {assets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.serialNumber} - {a.manufacturer} {a.model}
                  </option>
                ))}
              </select>
            </div>

            {/* Disposal type radio group */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Disposal Type <span className="text-red-500">*</span>
              </label>
              <div className="space-y-2">
                {(
                  Object.entries(DISPOSAL_TYPE_META) as [
                    DisposalType,
                    (typeof DISPOSAL_TYPE_META)[DisposalType],
                  ][]
                ).map(([value, meta]) => (
                  <label
                    key={value}
                    className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      disposalType === value
                        ? 'border-[#E86F2C] bg-orange-50'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="disposalType"
                      value={value}
                      checked={disposalType === value}
                      onChange={() => setDisposalType(value)}
                      className="mt-0.5 accent-[#E86F2C]"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">{meta.label}</span>
                        <span className="text-sm font-semibold text-[#E86F2C]">({meta.price})</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{meta.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
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
                className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors hover:bg-[#D05E1E]"
              >
                {createMutation.isPending ? 'Submitting…' : 'Submit Request'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Approval confirmation dialog ───────────────────────────────────── */}
      {confirmApproveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm mx-4 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Confirm Approval</h3>
            <p className="text-sm text-gray-600">
              Are you sure you want to approve this disposal request? This will move the asset into
              the disposal workflow and log the billing event.
            </p>
            {approveMutation.error && (
              <p className="text-sm text-red-600">{(approveMutation.error as Error).message}</p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => approveMutation.mutate(confirmApproveId)}
                disabled={approveMutation.isPending}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
              >
                {approveMutation.isPending ? 'Approving…' : 'Yes, Approve'}
              </button>
              <button
                type="button"
                onClick={() => setConfirmApproveId(null)}
                className="flex-1 text-sm text-gray-600 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Disposal requests table ────────────────────────────────────────── */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">Asset</th>
                <th className="text-left px-5 py-3">Disposal Type</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {disposals.map((d) => {
                const typeMeta = DISPOSAL_TYPE_META[d.disposalType];
                return (
                  <tr
                    key={d.id}
                    className="border-b border-gray-50 hover:bg-orange-50/40 transition-colors"
                  >
                    {/* Asset */}
                    <td className="px-5 py-3.5">
                      <Link to={`/inventory/${d.asset.id}`} className="group block">
                        <p className="font-mono font-semibold text-[#E86F2C] group-hover:underline">
                          {d.asset.serialNumber}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {d.asset.manufacturer} {d.asset.model}
                        </p>
                      </Link>
                    </td>

                    {/* Disposal type badge */}
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col gap-0.5">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-gray-800 font-medium">{typeMeta.label}</span>
                          <span className="text-xs font-semibold text-[#E86F2C] bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded-md">
                            {typeMeta.price}
                          </span>
                        </span>
                        <span className="text-xs text-gray-400">{typeMeta.description}</span>
                        {d.requiresCertification && (
                          <span className="text-xs font-medium text-emerald-700 mt-0.5">
                            + Certification ({CERTIFICATION_ADDON_PRICE})
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Status — inline select for actionable rows */}
                    <td className="px-5 py-3.5">
                      {canApprove && d.status === 'pending' ? (
                        <select
                          defaultValue="pending"
                          onChange={(e) => {
                            if (e.target.value === 'approved') setConfirmApproveId(d.id);
                            e.target.value = 'pending';
                          }}
                          className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                        >
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                        </select>
                      ) : d.status === 'approved' ? (
                        <select
                          defaultValue="approved"
                          onChange={(e) => {
                            if (e.target.value === 'in_progress')
                              startProcessingMutation.mutate(d.id);
                            e.target.value = 'approved';
                          }}
                          disabled={startProcessingMutation.isPending}
                          className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white disabled:opacity-50"
                        >
                          <option value="approved">Approved</option>
                          <option value="in_progress">Start Processing</option>
                        </select>
                      ) : d.status === 'in_progress' ? (
                        <select
                          defaultValue="in_progress"
                          onChange={(e) => {
                            if (e.target.value === 'completed') completeMutation.mutate(d.id);
                            e.target.value = 'in_progress';
                          }}
                          disabled={completeMutation.isPending}
                          className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white disabled:opacity-50"
                        >
                          <option value="in_progress">In Progress</option>
                          <option value="completed">Completed</option>
                        </select>
                      ) : (
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                            STATUS_COLORS[d.status] ?? 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {STATUS_LABELS[d.status] ?? d.status}
                        </span>
                      )}
                    </td>

                    {/* Created date */}
                    <td className="px-5 py-3.5 text-gray-600">
                      {new Date(d.createdAt).toLocaleDateString('en-IN')}
                    </td>

                    <td />
                  </tr>
                );
              })}
              {disposals.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-gray-400 text-sm">
                    No disposal requests yet. Create one above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Start-processing / completion error toasts (inline) */}
      {startProcessingMutation.error && (
        <p className="text-sm text-red-600">
          Start processing failed: {(startProcessingMutation.error as Error).message}
        </p>
      )}
      {completeMutation.error && (
        <p className="text-sm text-red-600">
          Complete failed: {(completeMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
