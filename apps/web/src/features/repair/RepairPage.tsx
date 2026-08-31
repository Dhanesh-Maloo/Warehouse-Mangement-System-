import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Plus, Upload, FileText, Search } from 'lucide-react';

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
}

type RepairStatus =
  | 'pending'
  | 'approved'
  | 'sent'
  | 'in_repair'
  | 'returned'
  | 'completed'
  | 'cancelled';
type RepairType = 'oem_warranty' | 'in_house' | 'out_of_warranty';
type RepairCategory = 'software' | 'hardware';

interface RepairRequest {
  id: string;
  clientId: string;
  asset: {
    id: string;
    serialNumber: string;
    model: string;
    manufacturer: string;
  } | null;
  serviceCenterName: string;
  // BigInt paise fields serialize as strings (or null) — see apps/api/src/main.ts
  estimateCostPaise: string | null;
  status: RepairStatus;
  repairType: RepairType;
  repairCategory: RepairCategory | null;
  ivalueTicketNumber: string | null;
  clientTicketNumber: string | null;
  notes?: string;
  requestedAt: string;
  approvedAt: string | null;
  slaTargetAt: string | null;
  isOverdue: boolean;
}

const REPAIR_TYPE_LABELS: Record<RepairType, string> = {
  oem_warranty: 'OEM / Warranty',
  in_house: 'In-House',
  out_of_warranty: 'Out of Warranty',
};

const REPAIR_CATEGORY_LABELS: Record<RepairCategory, string> = {
  software: 'Software',
  hardware: 'Hardware',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<RepairStatus, string> = {
  pending: 'bg-gray-100 text-gray-700',
  approved: 'bg-sky-100 text-sky-700',
  sent: 'bg-blue-100 text-blue-700',
  in_repair: 'bg-amber-100 text-amber-700',
  returned: 'bg-purple-100 text-purple-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<RepairStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  sent: 'Sent',
  in_repair: 'In Repair',
  returned: 'Returned',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const ALL_STATUSES: RepairStatus[] = [
  'pending',
  'approved',
  'sent',
  'in_repair',
  'returned',
  'completed',
  'cancelled',
];

const REPAIR_TERMINAL_STATUSES = new Set<RepairStatus>(['completed', 'cancelled']);

// 'approved' is reached only via the dedicated Approve action (designated
// manager sign-off) below — not through this generic status dropdown.
const NEXT_STATUSES: Partial<Record<RepairStatus, RepairStatus[]>> = {
  pending: ['cancelled'],
  approved: ['sent', 'cancelled'],
  sent: ['in_repair', 'cancelled'],
  in_repair: ['returned', 'cancelled'],
  returned: ['completed'],
};

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
});

function formatEstimate(paise: string | null): string {
  if (paise === null || paise === undefined) return '-';
  return CURRENCY_FORMATTER.format(Number(paise) / 100);
}

const EMPTY_FORM = {
  assetId: '',
  serviceCenterName: '',
  estimateCost: '',
  repairType: 'in_house' as RepairType,
  repairCategory: '' as RepairCategory | '',
  slaTargetAt: '',
  ivalueTicketNumber: '',
  clientTicketNumber: '',
  notes: '',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RepairPage() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const isClientUser = user?.role === 'client_user';
  const isEditor = user?.role === 'editor';
  const isClientAdmin = user?.role === 'client_admin';
  // editors are scoped to their own client like client_users, but can create repair requests
  const isClientScoped = isClientUser || isEditor || isClientAdmin;
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  // Approval is an authority gate — editors/operators cannot approve their own requests.
  const canApprove = isAdminOrManager || isClientAdmin;
  const clientId = isClientScoped ? (user?.clientId ?? undefined) : undefined;

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [selectedClientId, setSelectedClientId] = useState('');
  const [editingSlaId, setEditingSlaId] = useState<string | null>(null);
  const [slaDraft, setSlaDraft] = useState('');
  const [dcModalRepairId, setDcModalRepairId] = useState<string | null>(null);
  const [dcFile, setDcFile] = useState<File | null>(null);
  const [dcError, setDcError] = useState('');
  const dcFileRef = useRef<HTMLInputElement>(null);
  const [selectResetTick, setSelectResetTick] = useState(0);
  const [confirmApproveId, setConfirmApproveId] = useState<string | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [serviceCenterFilter, setServiceCenterFilter] = useState('');
  const [assetFilter, setAssetFilter] = useState('');
  const [ticketFilter, setTicketFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const effectiveClientId = isClientScoped ? (clientId ?? '') : selectedClientId;

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: clientsList = [] } = useQuery({
    queryKey: ['clients-list-repair'],
    queryFn: () => api.get<{ data: Client[]; total: number }>('/clients').then((r) => r.data),
    enabled: !isClientScoped,
  });

  const { data: assets = [] } = useQuery({
    queryKey: ['in-storage-assets-repair', effectiveClientId],
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

  const { data: repairs = [], isLoading } = useQuery({
    queryKey: [
      'repair-requests',
      clientId,
      statusFilter,
      typeFilter,
      serviceCenterFilter,
      assetFilter,
      ticketFilter,
      fromDate,
      toDate,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      if (statusFilter) params.set('status', statusFilter);
      if (typeFilter) params.set('repairType', typeFilter);
      if (serviceCenterFilter.trim()) params.set('serviceCenterName', serviceCenterFilter.trim());
      if (assetFilter.trim()) params.set('assetSearch', assetFilter.trim());
      if (ticketFilter.trim()) params.set('ticketSearch', ticketFilter.trim());
      if (fromDate) params.set('fromDate', fromDate);
      if (toDate) params.set('toDate', toDate);
      return api.get<RepairRequest[]>(`/repair?${params.toString()}`);
    },
    // Keeps showing previous results while a new filter/search fetch is in
    // flight, instead of flipping isLoading back to true (which would unmount
    // the filter bar's inputs and drop keyboard focus on every keystroke).
    placeholderData: keepPreviousData,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (payload: unknown) => api.post('/repair', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['repair-requests'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      void qc.invalidateQueries({ queryKey: ['in-storage-assets-repair'] });
      resetForm();
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/repair/${id}/approve`, {}),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['repair-requests'] });
      setConfirmApproveId(null);
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: RepairStatus }) =>
      api.patch(`/repair/${id}/status`, { status }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['repair-requests'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
    },
    onError: (e: Error) => alert(e.message),
  });

  const completeWithDcMutation = useMutation({
    mutationFn: async ({ id, file }: { id: string; file: File }) => {
      const form = new FormData();
      form.append('file', file);
      const token = localStorage.getItem('wh_token');
      const base = import.meta.env.VITE_API_URL ?? '';
      const res = await fetch(`${base}/api/v1/repair/${id}/documents`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { message?: string }).message ?? 'DC upload failed');
      }
      await api.patch(`/repair/${id}/status`, { status: 'completed' });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['repair-requests'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      setDcModalRepairId(null);
      setDcFile(null);
      setDcError('');
    },
    onError: (e: Error) => setDcError(e.message),
  });

  function closeDcModal() {
    setDcModalRepairId(null);
    setDcFile(null);
    setDcError('');
    setSelectResetTick((t) => t + 1);
  }

  function handleStatusChange(repairId: string, next: RepairStatus) {
    if (next === 'completed') {
      setDcModalRepairId(repairId);
      setDcFile(null);
      setDcError('');
      return;
    }
    updateStatusMutation.mutate({ id: repairId, status: next });
  }

  const updateSlaMutation = useMutation({
    mutationFn: ({ id, slaTargetAt }: { id: string; slaTargetAt: string }) =>
      api.patch(`/repair/${id}/sla`, { slaTargetAt: new Date(slaTargetAt).toISOString() }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['repair-requests'] });
      setEditingSlaId(null);
    },
    onError: (e: Error) => alert(e.message),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function resetForm() {
    setShowForm(false);
    setSelectedClientId('');
    setForm({ ...EMPTY_FORM });
  }

  function setField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const estimateCostPaise = form.estimateCost.trim()
      ? Math.round(parseFloat(form.estimateCost) * 100)
      : undefined;
    createMutation.mutate({
      clientId: effectiveClientId,
      assetId: form.assetId,
      serviceCenterName: form.serviceCenterName,
      estimateCostPaise,
      repairType: form.repairType,
      repairCategory: form.repairType === 'in_house' ? form.repairCategory || undefined : undefined,
      slaTargetAt: form.slaTargetAt ? new Date(form.slaTargetAt).toISOString() : undefined,
      ivalueTicketNumber: form.ivalueTicketNumber.trim() || undefined,
      clientTicketNumber: form.clientTicketNumber.trim() || undefined,
      notes: form.notes.trim() || undefined,
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Repair</h1>
          <p className="text-sm text-gray-500 mt-1">
            Send devices to a service center for repair and track their return
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          <Plus size={16} />
          New Repair Request
        </button>
      </div>

      {/* ── New request form ───────────────────────────────────────────────── */}
      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-5">
          <h2 className="text-base font-semibold text-gray-900">New Repair Request</h2>
          <form onSubmit={handleCreate} className="space-y-5">
            {/* Ticket numbers */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  IValue Ticket Number <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={form.ivalueTicketNumber}
                  onChange={(e) => setField('ivalueTicketNumber', e.target.value)}
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
                  onChange={(e) => setField('clientTicketNumber', e.target.value)}
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
                    setField('assetId', '');
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
                value={form.assetId}
                onChange={(e) => setField('assetId', e.target.value)}
                disabled={!effectiveClientId}
                className="w-full max-w-md px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] disabled:bg-gray-50 disabled:text-gray-400 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-500 dark:disabled:bg-slate-950 dark:disabled:text-slate-600"
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

            {/* Service center + estimate */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Service Center Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.serviceCenterName}
                  onChange={(e) => setField('serviceCenterName', e.target.value)}
                  placeholder="e.g. Dell Authorized Service Center"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Estimate Cost (₹) <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.estimateCost}
                  onChange={(e) => setField('estimateCost', e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
            </div>

            {/* Repair type + category */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Repair Type <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={form.repairType}
                  onChange={(e) => {
                    const repairType = e.target.value as RepairType;
                    setField('repairType', repairType);
                    if (repairType === 'oem_warranty') setField('repairCategory', '');
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                >
                  <option value="in_house">In-House (IValue team)</option>
                  <option value="oem_warranty">OEM / Warranty</option>
                  <option value="out_of_warranty">Out of Warranty</option>
                </select>
              </div>
              {form.repairType === 'in_house' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Repair Category <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={form.repairCategory}
                    onChange={(e) => setField('repairCategory', e.target.value as RepairCategory)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  >
                    <option value="">Select…</option>
                    <option value="software">Software (default SLA: 3 business days)</option>
                    <option value="hardware">Hardware (depends on parts availability)</option>
                  </select>
                </div>
              )}
            </div>

            {/* SLA override */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                SLA Target Date{' '}
                <span className="text-gray-400 font-normal">
                  (optional -{' '}
                  {form.repairType === 'oem_warranty'
                    ? 'OEM-confirmed date, if known'
                    : form.repairType === 'out_of_warranty'
                      ? 'vendor ETA, if known'
                      : form.repairCategory === 'hardware'
                        ? 'parts ETA, if known'
                        : 'overrides the 3-business-day default'}
                  )
                </span>
              </label>
              <input
                type="date"
                value={form.slaTargetAt}
                onChange={(e) => setField('slaTargetAt', e.target.value)}
                className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
              {(form.repairType === 'oem_warranty' ||
                form.repairType === 'out_of_warranty' ||
                form.repairCategory === 'hardware') &&
                !form.slaTargetAt && (
                  <p className="text-xs text-gray-400 mt-1">
                    No fixed SLA for this repair type - leave blank and set the target date later
                    once known.
                  </p>
                )}
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) => setField('notes', e.target.value)}
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

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
          >
            <option value="">All</option>
            {ALL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Type</label>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
          >
            <option value="">All</option>
            {(Object.entries(REPAIR_TYPE_LABELS) as [RepairType, string][]).map(
              ([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ),
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Service Center</label>
          <input
            type="text"
            value={serviceCenterFilter}
            onChange={(e) => setServiceCenterFilter(e.target.value)}
            placeholder="e.g. Dell ASC"
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] w-40"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Asset</label>
          <input
            type="text"
            value={assetFilter}
            onChange={(e) => setAssetFilter(e.target.value)}
            placeholder="Serial, tag, or model"
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] w-40"
          />
        </div>
        <div className="relative">
          <label className="block text-xs font-medium text-gray-500 mb-1">Ticket number</label>
          <Search size={13} className="absolute left-2.5 top-[1.9rem] text-gray-400" />
          <input
            type="text"
            value={ticketFilter}
            onChange={(e) => setTicketFilter(e.target.value)}
            placeholder="IValue or client ticket #"
            className="pl-7 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] w-48"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Requested from</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Requested to</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        {(statusFilter ||
          typeFilter ||
          serviceCenterFilter ||
          assetFilter ||
          ticketFilter ||
          fromDate ||
          toDate) && (
          <button
            onClick={() => {
              setStatusFilter('');
              setTypeFilter('');
              setServiceCenterFilter('');
              setAssetFilter('');
              setTicketFilter('');
              setFromDate('');
              setToDate('');
            }}
            className="text-xs text-gray-500 hover:text-gray-700 underline mb-1"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* ── Approval confirmation dialog ────────────────────────────────────── */}
      {confirmApproveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg p-6 w-full max-w-sm mx-4 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Confirm Approval</h3>
            <p className="text-sm text-gray-600">
              Are you sure you want to approve this repair request? It can then be sent to the
              service center.
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

      {/* ── Repair requests table ──────────────────────────────────────────── */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">Asset</th>
                <th className="text-left px-5 py-3">Service Center</th>
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3">Estimate</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">IValue Ticket #</th>
                <th className="text-left px-5 py-3">Client Ticket #</th>
                <th className="text-left px-5 py-3">Requested</th>
                <th className="text-left px-5 py-3">SLA Target</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {repairs.map((r) => {
                const nextStatuses = NEXT_STATUSES[r.status] ?? [];
                const canUpdate = nextStatuses.length > 0;
                return (
                  <tr
                    key={r.id}
                    className="border-b border-gray-50 hover:bg-orange-50/40 transition-colors"
                  >
                    {/* Asset */}
                    <td className="px-5 py-3.5">
                      {r.asset ? (
                        <Link to={`/inventory/${r.asset.id}`} className="group block">
                          <p className="font-mono font-semibold text-[#E86F2C] group-hover:underline">
                            {r.asset.serialNumber}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {r.asset.manufacturer} {r.asset.model}
                          </p>
                        </Link>
                      ) : (
                        <span className="text-gray-400 italic text-xs">Asset not found</span>
                      )}
                    </td>

                    {/* Service center */}
                    <td className="px-5 py-3.5 text-gray-800">{r.serviceCenterName}</td>

                    {/* Repair type / category */}
                    <td className="px-5 py-3.5 text-gray-700">
                      <div>{REPAIR_TYPE_LABELS[r.repairType]}</div>
                      {r.repairCategory && (
                        <div className="text-xs text-gray-400">
                          {REPAIR_CATEGORY_LABELS[r.repairCategory]}
                        </div>
                      )}
                    </td>

                    {/* Estimate */}
                    <td className="px-5 py-3.5 text-gray-700">
                      {formatEstimate(r.estimateCostPaise)}
                    </td>

                    {/* Status — inline select for actionable rows, badge for terminal states */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        {canUpdate ? (
                          <select
                            key={`${r.id}-${r.status}-${selectResetTick}`}
                            defaultValue={r.status}
                            onChange={(e) =>
                              handleStatusChange(r.id, e.target.value as RepairStatus)
                            }
                            disabled={updateStatusMutation.isPending}
                            className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white disabled:opacity-50 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-500"
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
                            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                              STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {STATUS_LABELS[r.status] ?? r.status}
                          </span>
                        )}
                        {canApprove && r.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => setConfirmApproveId(r.id)}
                            className="text-xs font-semibold text-blue-600 hover:underline whitespace-nowrap"
                          >
                            Approve
                          </button>
                        )}
                      </div>
                    </td>

                    {/* IValue Ticket # */}
                    <td className="px-5 py-3.5 text-xs font-mono text-gray-600">
                      {r.ivalueTicketNumber || <span className="text-gray-300">-</span>}
                    </td>

                    {/* Client Ticket # */}
                    <td className="px-5 py-3.5 text-xs font-mono text-gray-600">
                      {r.clientTicketNumber || <span className="text-gray-300">-</span>}
                    </td>

                    {/* Requested date */}
                    <td className="px-5 py-3.5 text-gray-600">
                      {new Date(r.requestedAt).toLocaleDateString('en-IN')}
                    </td>

                    {/* SLA target + overdue flag */}
                    <td className="px-5 py-3.5">
                      {editingSlaId === r.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="date"
                            autoFocus
                            value={slaDraft}
                            onChange={(e) => setSlaDraft(e.target.value)}
                            className="px-2 py-1 border border-gray-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                          />
                          <button
                            type="button"
                            disabled={!slaDraft || updateSlaMutation.isPending}
                            onClick={() =>
                              updateSlaMutation.mutate({ id: r.id, slaTargetAt: slaDraft })
                            }
                            className="text-xs font-semibold text-[#E86F2C] hover:underline disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSlaId(null)}
                            className="text-xs text-gray-500 hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          {r.slaTargetAt ? (
                            <>
                              <span className="text-gray-600">
                                {new Date(r.slaTargetAt).toLocaleDateString('en-IN')}
                              </span>
                              {r.isOverdue && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                                  Overdue
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="text-gray-400">Not set</span>
                          )}
                          {!REPAIR_TERMINAL_STATUSES.has(r.status) && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSlaId(r.id);
                                setSlaDraft(
                                  r.slaTargetAt
                                    ? new Date(r.slaTargetAt).toISOString().slice(0, 10)
                                    : '',
                                );
                              }}
                              className="text-xs text-gray-400 hover:text-[#E86F2C] hover:underline"
                            >
                              Edit
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    <td />
                  </tr>
                );
              })}
              {repairs.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-5 py-12 text-center text-gray-400 text-sm">
                    {statusFilter ||
                    typeFilter ||
                    serviceCenterFilter ||
                    assetFilter ||
                    ticketFilter ||
                    fromDate ||
                    toDate
                      ? 'No repair requests match the selected filters.'
                      : 'No repair requests yet. Create one above.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Delivery Challan (DC) upload — required before marking a repair completed */}
      {dcModalRepairId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full">
            <h2 className="text-base font-semibold text-gray-900 mb-1">
              Upload Delivery Challan (DC)
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              A DC must be uploaded before this repair can be marked completed.
            </p>
            <input
              ref={dcFileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => setDcFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              onClick={() => dcFileRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-lg py-6 text-sm text-gray-500 hover:border-[#E86F2C] hover:text-[#E86F2C] transition-colors"
            >
              {dcFile ? (
                <>
                  <FileText size={16} />
                  {dcFile.name}
                </>
              ) : (
                <>
                  <Upload size={16} />
                  Select DC (PDF)
                </>
              )}
            </button>
            {dcError && <p className="text-sm text-red-600 mt-3">{dcError}</p>}
            <div className="flex gap-3 justify-end mt-5">
              <button
                type="button"
                onClick={closeDcModal}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!dcFile || completeWithDcMutation.isPending}
                onClick={() =>
                  dcModalRepairId &&
                  dcFile &&
                  completeWithDcMutation.mutate({ id: dcModalRepairId, file: dcFile })
                }
                className="px-4 py-2 text-sm font-semibold bg-[#E86F2C] hover:bg-[#D05E1E] text-white rounded-lg transition-colors disabled:opacity-40"
              >
                {completeWithDcMutation.isPending ? 'Uploading…' : 'Upload & complete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
