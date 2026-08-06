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

type ResaleStatus = 'listed' | 'sold' | 'cancelled';

interface ResaleListing {
  id: string;
  clientId: string;
  asset: {
    id: string;
    serialNumber: string;
    model: string;
    manufacturer: string;
  };
  listedPricePaise: string | null;
  status: ResaleStatus;
  soldPricePaise: string | null;
  soldAt: string | null;
  notes?: string | null;
  listedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<ResaleStatus, string> = {
  listed: 'bg-blue-100 text-blue-700',
  sold: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<ResaleStatus, string> = {
  listed: 'Listed',
  sold: 'Sold',
  cancelled: 'Cancelled',
};

const NEXT_STATUSES: Partial<Record<ResaleStatus, ResaleStatus[]>> = {
  listed: ['sold', 'cancelled'],
};

function formatPaise(paise: string | null | undefined): string {
  if (paise === null || paise === undefined) return '-';
  const rupees = Number(paise) / 100;
  return `₹${rupees.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ResalePage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const isClientUser = user?.role === 'client_user';
  const isEditor = user?.role === 'editor';
  const isClientAdmin = user?.role === 'client_admin';
  // editors/client_admins are scoped to their own client, like client_users
  const isClientScoped = isClientUser || isEditor || isClientAdmin;
  const clientId = isClientScoped ? (user?.clientId ?? undefined) : undefined;

  // ── UI state ──────────────────────────────────────────────────────────────
  const [showForm, setShowForm] = useState(false);
  const [pendingSold, setPendingSold] = useState<{ id: string; price: string } | null>(null);
  const [soldError, setSoldError] = useState('');

  // ── Form state ────────────────────────────────────────────────────────────
  const [selectedClientId, setSelectedClientId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [listedPrice, setListedPrice] = useState('');
  const [notes, setNotes] = useState('');

  const effectiveClientId = isClientScoped ? (clientId ?? '') : selectedClientId;

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: clientsList = [] } = useQuery({
    queryKey: ['clients-list-resale'],
    queryFn: () => api.get<{ data: Client[]; total: number }>('/clients').then((r) => r.data),
    enabled: !isClientScoped,
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['in-storage-assets-resale', effectiveClientId],
    queryFn: async () => {
      const params = new URLSearchParams({ status: 'in_storage' });
      if (effectiveClientId) params.set('clientId', effectiveClientId);
      const res = await api.get<{ data: InventoryAsset[]; total: number }>(
        `/inventory?${params.toString()}`,
      );
      return res.data;
    },
    enabled: showForm && !!effectiveClientId,
  });

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ['resale-listings', clientId],
    queryFn: async () => {
      const params = clientId ? `?clientId=${clientId}` : '';
      const res = await api.get<ResaleListing[]>(`/resale${params}`);
      return res;
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => api.post('/resale', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['resale-listings'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      resetForm();
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({
      id,
      status,
      soldPricePaise,
    }: {
      id: string;
      status: ResaleStatus;
      soldPricePaise?: number;
    }) => api.patch(`/resale/${id}/status`, { status, soldPricePaise }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['resale-listings'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      setPendingSold(null);
      setSoldError('');
    },
    onError: (e: Error) => setSoldError(e.message),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function resetForm() {
    setShowForm(false);
    setSelectedClientId('');
    setSelectedAssetId('');
    setListedPrice('');
    setNotes('');
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    createMutation.mutate({
      clientId: effectiveClientId,
      assetId: selectedAssetId,
      listedPricePaise: listedPrice ? Math.round(parseFloat(listedPrice) * 100) : undefined,
      notes: notes.trim() || undefined,
    });
  }

  function handleStatusChange(listing: ResaleListing, newStatus: ResaleStatus) {
    setSoldError('');
    if (newStatus === 'sold') {
      setPendingSold({ id: listing.id, price: '' });
      return;
    }
    statusMutation.mutate({ id: listing.id, status: newStatus });
  }

  function confirmSold() {
    if (!pendingSold) return;
    const soldPricePaise = pendingSold.price
      ? Math.round(parseFloat(pendingSold.price) * 100)
      : undefined;
    statusMutation.mutate({ id: pendingSold.id, status: 'sold', soldPricePaise });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Resale</h1>
          <p className="text-sm text-gray-500 mt-1">
            Manage resale listings for in-storage devices
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Resale Listing
        </button>
      </div>

      {/* ── New listing form ───────────────────────────────────────────────── */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <h2 className="text-base font-semibold text-gray-900">New Resale Listing</h2>
          <form onSubmit={handleCreate} className="space-y-5">
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

            {/* Listed price */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Listed price (₹) <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={listedPrice}
                onChange={(e) => setListedPrice(e.target.value)}
                placeholder="e.g. 15000"
                className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
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
                {createMutation.isPending ? 'Submitting…' : 'Create Listing'}
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

      {/* ── Sold-price confirmation dialog ─────────────────────────────────── */}
      {pendingSold && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm mx-4 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Mark as Sold</h3>
            <p className="text-sm text-gray-600">
              Optionally record the sold price for this listing.
            </p>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sold price (₹) <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                autoFocus
                value={pendingSold.price}
                onChange={(e) => setPendingSold({ ...pendingSold, price: e.target.value })}
                placeholder="e.g. 14500"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
            {soldError && <p className="text-sm text-red-600">{soldError}</p>}
            <div className="flex gap-3 pt-1">
              <button
                onClick={confirmSold}
                disabled={statusMutation.isPending}
                className="flex-1 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition-colors"
              >
                {statusMutation.isPending ? 'Saving…' : 'Confirm Sold'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setPendingSold(null);
                  setSoldError('');
                }}
                className="flex-1 text-sm text-gray-600 px-4 py-2 rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resale listings table ──────────────────────────────────────────── */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">Asset</th>
                <th className="text-left px-5 py-3">Listed Price</th>
                <th className="text-left px-5 py-3">Sold Price</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Listed</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {listings.map((l) => {
                const nextStatuses = NEXT_STATUSES[l.status] ?? [];
                const canUpdate = nextStatuses.length > 0;
                return (
                  <tr
                    key={l.id}
                    className="border-b border-gray-50 hover:bg-orange-50/40 transition-colors"
                  >
                    {/* Asset */}
                    <td className="px-5 py-3.5">
                      <Link to={`/inventory/${l.asset.id}`} className="group block">
                        <p className="font-mono font-semibold text-[#E86F2C] group-hover:underline">
                          {l.asset.serialNumber}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {l.asset.manufacturer} {l.asset.model}
                        </p>
                      </Link>
                    </td>

                    {/* Listed price */}
                    <td className="px-5 py-3.5 text-gray-700">{formatPaise(l.listedPricePaise)}</td>

                    {/* Sold price */}
                    <td className="px-5 py-3.5 text-gray-700">
                      {l.status === 'sold' ? formatPaise(l.soldPricePaise) : '-'}
                    </td>

                    {/* Status — inline select for actionable rows, badge for terminal states */}
                    <td className="px-5 py-3.5">
                      {canUpdate ? (
                        <select
                          defaultValue={l.status}
                          onChange={(e) => handleStatusChange(l, e.target.value as ResaleStatus)}
                          disabled={statusMutation.isPending}
                          className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white disabled:opacity-50"
                        >
                          <option value={l.status}>{STATUS_LABELS[l.status]}</option>
                          {nextStatuses.map((s) => (
                            <option key={s} value={s}>
                              {STATUS_LABELS[s]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                            STATUS_COLORS[l.status] ?? 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {STATUS_LABELS[l.status] ?? l.status}
                        </span>
                      )}
                    </td>

                    {/* Listed date */}
                    <td className="px-5 py-3.5 text-gray-600">
                      {new Date(l.listedAt).toLocaleDateString('en-IN')}
                    </td>

                    <td />
                  </tr>
                );
              })}
              {listings.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-400 text-sm">
                    No resale listings yet. Create one above.
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
