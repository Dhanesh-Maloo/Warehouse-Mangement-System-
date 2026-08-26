import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Search, Package, Plus, X, Pencil, ChevronDown, Loader2, MoveRight } from 'lucide-react';

interface DisposalSummary {
  disposalType: string;
  certificateS3Key: string | null;
  status: string;
}

interface DeploymentSummary {
  dispatchedAt: string | null;
  deliveredAt: string | null;
  trackingNumber: string | null;
  courierName: string | null;
}

interface Asset {
  id: string;
  serialNumber: string;
  assetTag: string | null;
  referenceName: string | null;
  vendorName: string | null;
  assetCondition: 'new' | 'used' | 'dead' | null;
  model: string;
  manufacturer: string;
  category: string;
  currentStatus: string;
  conditionGrade: string | null;
  currentLocation: { name: string } | null;
  disposalRequests: DisposalSummary[];
  deploymentOrders: DeploymentSummary[];
  createdAt: string;
  updatedAt: string;
  repairHandling: boolean | null;
  repairServiceName: string | null;
  repairEstimateCost: number | null;
  awbNumber: string | null;
  courierName: string | null;
  deliveredAt: string | null;
  disposalType: string | null;
  hasCertification: boolean | null;
}

interface AssetsResponse {
  data: Asset[];
  total: number;
}

interface Client {
  id: string;
  name: string;
}
interface Location {
  id: string;
  name: string;
}

type AssetCategory = 'laptop' | 'monitor' | 'peripheral';
type ConditionGrade = 'A' | 'B' | 'C' | 'D';
type AssetCondition = 'new' | 'used' | 'dead' | 'not_working';
type AssetStatus =
  | 'receiving'
  | 'in_inspection'
  | 'in_storage'
  | 'deployed'
  | 'returning'
  | 'disposed'
  | 'in_repair'
  | 'for_resale'
  | 'sold';

const EMPTY_ADD_FORM = {
  serialNumber: '',
  assetTag: '',
  referenceName: '',
  vendorName: '',
  manufacturer: '',
  model: '',
  category: 'laptop' as AssetCategory,
  clientId: '',
  currentLocationId: '',
  conditionGrade: '' as ConditionGrade | '',
  assetCondition: '' as AssetCondition | '',
  currentStatus: 'in_storage' as AssetStatus,
  repairHandling: false,
  repairServiceName: '',
  repairEstimateCost: '',
  awbNumber: '',
  courierName: '',
  deliveredAt: '',
  disposalType: '',
  hasCertification: false,
};

const EMPTY_EDIT_FORM = {
  serialNumber: '',
  assetTag: '',
  referenceName: '',
  vendorName: '',
  manufacturer: '',
  model: '',
  category: 'laptop' as AssetCategory,
  conditionGrade: '' as ConditionGrade | '',
  assetCondition: '' as AssetCondition | '',
  currentStatus: 'in_storage' as AssetStatus,
  currentLocationId: '',
  repairHandling: false,
  repairServiceName: '',
  repairEstimateCost: '',
  awbNumber: '',
  courierName: '',
  deliveredAt: '',
  disposalType: '',
  hasCertification: false,
};

// ─── Inline dropdown cell ─────────────────────────────────────────────────────

interface SelectOpt {
  value: string;
  label: string;
}

function InlineSelect({
  assetId,
  field,
  value,
  options,
  onSave,
  saving,
  renderBadge,
}: {
  assetId: string;
  field: string;
  value: string;
  options: SelectOpt[];
  onSave: (assetId: string, field: string, value: string) => void;
  saving: boolean;
  renderBadge: (value: string) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const selectRef = useRef<HTMLSelectElement>(null);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen(true);
  }

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    e.stopPropagation();
    const newVal = e.target.value;
    setOpen(false);
    if (newVal !== value) onSave(assetId, field, newVal);
  }

  function handleBlur() {
    setOpen(false);
  }

  // auto-focus when opened
  useEffect(() => {
    if (open && selectRef.current) selectRef.current.focus();
  }, [open]);

  if (saving) {
    return (
      <span className="flex items-center gap-1 text-gray-400 text-xs">
        <Loader2 size={12} className="animate-spin" />
        {renderBadge(value)}
      </span>
    );
  }

  if (open) {
    return (
      <select
        ref={selectRef}
        defaultValue={value}
        onChange={handleChange}
        onBlur={handleBlur}
        onClick={(e) => e.stopPropagation()}
        className="text-xs border border-[#E86F2C] rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#E86F2C] shadow-sm cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <button
      onClick={handleClick}
      className="group/inline flex items-center gap-1 cursor-pointer hover:opacity-80 transition-opacity"
      title="Click to change"
    >
      {renderBadge(value)}
      <ChevronDown
        size={10}
        className="text-gray-300 group-hover/inline:text-[#E86F2C] opacity-0 group-hover/inline:opacity-100 transition-all flex-shrink-0"
      />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RepairSection({
  repairHandling,
  repairServiceName,
  repairEstimateCost,
  onChange,
}: {
  repairHandling: boolean;
  repairServiceName: string;
  repairEstimateCost: string;
  onChange: (field: string, value: string | boolean) => void;
}) {
  return (
    <div className="col-span-full border border-gray-200 rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-700">Repair handling</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange('repairHandling', true)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${repairHandling ? 'bg-[#E86F2C] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => onChange('repairHandling', false)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${!repairHandling ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
          >
            No
          </button>
        </div>
      </div>
      {repairHandling && (
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Service name</label>
            <input
              type="text"
              value={repairServiceName}
              onChange={(e) => onChange('repairServiceName', e.target.value)}
              placeholder="e.g. Dell Support"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Estimate cost (₹)
            </label>
            <input
              type="number"
              min="0"
              value={repairEstimateCost}
              onChange={(e) => onChange('repairEstimateCost', e.target.value)}
              placeholder="e.g. 5000"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function InventoryPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(() => searchParams.get('status') ?? '');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);

  useEffect(() => {
    const s = searchParams.get('status') ?? '';
    setStatus(s);
    setPage(0);
  }, [searchParams]);
  const take = 50;

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState(EMPTY_ADD_FORM);
  const [addFormError, setAddFormError] = useState('');

  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [editForm, setEditForm] = useState(EMPTY_EDIT_FORM);
  const [editFormError, setEditFormError] = useState('');

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkTargetLocationId, setBulkTargetLocationId] = useState('');

  const canAdd =
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'operator' ||
    user?.role === 'editor' ||
    user?.role === 'client_admin';
  const canEdit =
    user?.role === 'admin' ||
    user?.role === 'manager' ||
    user?.role === 'operator' ||
    user?.role === 'editor' ||
    user?.role === 'client_admin';
  const needsClientSelect = user?.role === 'admin' || user?.role === 'manager';

  const { data: clientsList = [] } = useQuery({
    queryKey: ['clients-list-for-add'],
    queryFn: () => api.get<{ data: Client[]; total: number }>('/clients').then((r) => r.data),
    enabled: showAddForm && needsClientSelect,
  });

  const { data: locationsList = [] } = useQuery({
    queryKey: ['locations-list-for-add'],
    queryFn: () => api.get<Location[]>('/locations'),
    enabled: showAddForm || editingAsset !== null || selectedIds.size > 0,
  });

  const bulkMoveMutation = useMutation({
    mutationFn: (payload: { assetIds: string[]; locationId: string }) =>
      api.post('/assets/bulk-move', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['storage-summary'] });
      setSelectedIds(new Set());
      setBulkTargetLocationId('');
    },
  });

  const addMutation = useMutation({
    mutationFn: async (payload: typeof EMPTY_ADD_FORM & { effectiveClientId: string }) => {
      const body: Record<string, unknown> = {
        serialNumber: payload.serialNumber.trim(),
        model: payload.model.trim(),
        manufacturer: payload.manufacturer.trim(),
        category: payload.category,
        clientId: payload.effectiveClientId,
        currentStatus: payload.currentStatus,
      };
      if (payload.assetTag.trim()) body.assetTag = payload.assetTag.trim();
      if (payload.referenceName.trim()) body.referenceName = payload.referenceName.trim();
      if (payload.vendorName.trim()) body.vendorName = payload.vendorName.trim();
      if (payload.currentLocationId) body.currentLocationId = payload.currentLocationId;
      if (payload.conditionGrade) body.conditionGrade = payload.conditionGrade;
      if (payload.assetCondition) body.assetCondition = payload.assetCondition;
      body.repairHandling = payload.repairHandling;
      if (payload.repairHandling) {
        if (payload.repairServiceName.trim())
          body.repairServiceName = payload.repairServiceName.trim();
        if (payload.repairEstimateCost)
          body.repairEstimateCost = parseInt(payload.repairEstimateCost, 10);
      }
      if (payload.awbNumber.trim()) body.awbNumber = payload.awbNumber.trim();
      if (payload.courierName.trim()) body.courierName = payload.courierName.trim();
      if (payload.deliveredAt) body.deliveredAt = payload.deliveredAt;
      if (payload.disposalType) body.disposalType = payload.disposalType;
      body.hasCertification = payload.hasCertification;
      return api.post<Asset>('/assets', body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['storage-summary'] });
      setShowAddForm(false);
      setAddForm(EMPTY_ADD_FORM);
      setAddFormError('');
    },
    onError: (err: Error) => {
      setAddFormError(
        err.message || 'Failed to add asset. Check if the serial number is already registered.',
      );
    },
  });

  const editMutation = useMutation({
    mutationFn: async (payload: typeof EMPTY_EDIT_FORM & { id: string }) => {
      const body: Record<string, unknown> = {
        serialNumber: payload.serialNumber.trim() || undefined,
        assetTag: payload.assetTag.trim() || undefined,
        referenceName: payload.referenceName.trim() || undefined,
        vendorName: payload.vendorName.trim() || undefined,
        model: payload.model.trim() || undefined,
        manufacturer: payload.manufacturer.trim() || undefined,
        category: payload.category || undefined,
        conditionGrade: payload.conditionGrade || undefined,
        assetCondition: payload.assetCondition || undefined,
        currentStatus: payload.currentStatus || undefined,
        currentLocationId: payload.currentLocationId || undefined,
        repairHandling: payload.repairHandling,
        awbNumber: payload.awbNumber.trim() || undefined,
        courierName: payload.courierName.trim() || undefined,
        deliveredAt: payload.deliveredAt || undefined,
        disposalType: payload.disposalType || undefined,
        hasCertification: payload.hasCertification,
      };
      if (payload.repairHandling) {
        body.repairServiceName = payload.repairServiceName.trim() || undefined;
        body.repairEstimateCost = payload.repairEstimateCost
          ? parseInt(payload.repairEstimateCost, 10)
          : undefined;
      } else {
        body.repairServiceName = undefined;
        body.repairEstimateCost = undefined;
      }
      return api.patch(`/assets/${payload.id}`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['storage-summary'] });
      setEditingAsset(null);
      setEditFormError('');
    },
    onError: (err: Error) => setEditFormError(err.message || 'Failed to save changes.'),
  });

  // tracks which cells are mid-save: "assetId:field"
  const [savingCells, setSavingCells] = useState<Set<string>>(new Set());

  const quickPatchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) =>
      api.patch(`/assets/${id}`, patch),
    onSuccess: (_data, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      void queryClient.invalidateQueries({ queryKey: ['storage-summary'] });
      // clear the saving indicator
      const field = Object.keys(vars.patch)[0];
      setSavingCells((prev) => {
        const next = new Set(prev);
        next.delete(`${vars.id}:${field}`);
        return next;
      });
    },
    onError: (_err, vars) => {
      const field = Object.keys(vars.patch)[0];
      setSavingCells((prev) => {
        const next = new Set(prev);
        next.delete(`${vars.id}:${field}`);
        return next;
      });
    },
  });

  // Transitions into these statuses must go through their dedicated workflow
  // endpoints (deployment/retrieval/disposal) so ledger entries, order records,
  // and — for disposal — the approval gate aren't bypassed by a bare status patch.
  const WORKFLOW_STATUS_ROUTES: Record<string, string> = {
    deployed: '/deployment',
    returning: '/retrieval',
    disposed: '/disposal',
    in_repair: '/repair',
    for_resale: '/resale',
  };

  function handleInlineSave(assetId: string, field: string, value: string) {
    if (field === 'currentStatus' && value in WORKFLOW_STATUS_ROUTES) {
      navigate(WORKFLOW_STATUS_ROUTES[value]);
      return;
    }
    setSavingCells((prev) => new Set(prev).add(`${assetId}:${field}`));
    const patch: Record<string, unknown> =
      field === 'hasCertification'
        ? { hasCertification: value === 'true' }
        : { [field]: value || undefined };
    quickPatchMutation.mutate({ id: assetId, patch });
  }

  function openEdit(e: React.MouseEvent, asset: Asset) {
    e.stopPropagation();
    setEditForm({
      serialNumber: asset.serialNumber,
      assetTag: asset.assetTag ?? '',
      referenceName: asset.referenceName ?? '',
      vendorName: asset.vendorName ?? '',
      manufacturer: asset.manufacturer,
      model: asset.model,
      category: asset.category as AssetCategory,
      conditionGrade: (asset.conditionGrade as ConditionGrade | null) ?? '',
      assetCondition: (asset.assetCondition as AssetCondition | null) ?? '',
      currentStatus: asset.currentStatus as AssetStatus,
      currentLocationId: '',
      repairHandling: asset.repairHandling ?? false,
      repairServiceName: asset.repairServiceName ?? '',
      repairEstimateCost: asset.repairEstimateCost?.toString() ?? '',
      awbNumber: asset.awbNumber ?? '',
      courierName: asset.courierName ?? '',
      deliveredAt: asset.deliveredAt ? new Date(asset.deliveredAt).toISOString().split('T')[0] : '',
      disposalType: asset.disposalType ?? '',
      hasCertification: asset.hasCertification ?? false,
    });
    setEditFormError('');
    setEditingAsset(asset);
  }

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setAddFormError('');
    if (!addForm.serialNumber.trim() || !addForm.model.trim() || !addForm.manufacturer.trim()) {
      setAddFormError('Serial number, manufacturer, and model are required.');
      return;
    }
    const effectiveClientId = needsClientSelect ? addForm.clientId : (user?.clientId ?? '');
    if (!effectiveClientId) {
      setAddFormError('Please select a client.');
      return;
    }
    addMutation.mutate({ ...addForm, effectiveClientId });
  };

  const clientId =
    user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
      ? (user.clientId ?? undefined)
      : undefined;

  const registerParams = new URLSearchParams();
  if (clientId) registerParams.set('clientId', clientId);
  if (search) registerParams.set('search', search);
  if (status) registerParams.set('status', status);
  if (category) registerParams.set('category', category);
  registerParams.set('skip', String(page * take));
  registerParams.set('take', String(take));

  const { data, isLoading } = useQuery({
    queryKey: ['assets', clientId, search, status, category, page],
    queryFn: () => api.get<AssetsResponse>(`/assets?${registerParams.toString()}`),
  });

  const disposalLabel: Record<string, string> = {
    non_certified: 'Non-Certified',
    certified_blanco: 'Certified',
    itad_bundled: 'Certified',
  };
  const disposalColors: Record<string, string> = {
    non_certified: 'bg-gray-100 text-gray-600',
    certified_blanco: 'bg-emerald-100 text-emerald-700',
    itad_bundled: 'bg-blue-100 text-blue-700',
  };
  const gradeColors: Record<string, string> = {
    A: 'bg-emerald-100 text-emerald-700',
    B: 'bg-blue-100 text-blue-700',
    C: 'bg-amber-100 text-amber-700',
    D: 'bg-red-100 text-red-600',
  };

  const fmt = (dt: string | null | undefined) =>
    dt
      ? new Date(dt).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: '2-digit',
          timeZone: 'Asia/Kolkata',
        })
      : '-';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-1">{data?.total ?? 0} assets total</p>
        </div>
        {canAdd && (
          <button
            onClick={() => {
              setShowAddForm((s) => !s);
              setAddFormError('');
              setAddForm(EMPTY_ADD_FORM);
            }}
            className="flex items-center gap-2 px-4 py-2 bg-[#E86F2C] text-white rounded-lg text-sm font-medium hover:bg-[#d4621f] transition-colors"
          >
            {showAddForm ? <X size={16} /> : <Plus size={16} />}
            {showAddForm ? 'Cancel' : 'Add asset'}
          </button>
        )}
      </div>

      {/* Add Asset Form */}
      {showAddForm && canAdd && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-4">Add new asset</h2>
          <form onSubmit={handleAddSubmit}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Asset tag</label>
                <input
                  type="text"
                  value={addForm.assetTag}
                  onChange={(e) => setAddForm((f) => ({ ...f, assetTag: e.target.value }))}
                  placeholder="AT-XXXX"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Reference No.
                </label>
                <input
                  type="text"
                  value={addForm.referenceName}
                  onChange={(e) => setAddForm((f) => ({ ...f, referenceName: e.target.value }))}
                  placeholder="Client's own reference"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Vendor</label>
                <input
                  type="text"
                  value={addForm.vendorName}
                  onChange={(e) => setAddForm((f) => ({ ...f, vendorName: e.target.value }))}
                  placeholder="iValue, or other vendor"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Serial number <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={addForm.serialNumber}
                  onChange={(e) => setAddForm((f) => ({ ...f, serialNumber: e.target.value }))}
                  placeholder="SN-XXXXXXXX"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Manufacturer <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={addForm.manufacturer}
                  onChange={(e) => setAddForm((f) => ({ ...f, manufacturer: e.target.value }))}
                  placeholder="e.g. Dell, Apple, Lenovo"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Model <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={addForm.model}
                  onChange={(e) => setAddForm((f) => ({ ...f, model: e.target.value }))}
                  placeholder="e.g. Latitude 5540"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={addForm.category}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, category: e.target.value as AssetCategory }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                >
                  <option value="laptop">Laptop</option>
                  <option value="monitor">Monitor</option>
                  <option value="peripheral">Peripheral</option>
                </select>
              </div>
              {needsClientSelect && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Client <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={addForm.clientId}
                    onChange={(e) => setAddForm((f) => ({ ...f, clientId: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
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
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
                <select
                  value={addForm.currentLocationId}
                  onChange={(e) => setAddForm((f) => ({ ...f, currentLocationId: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                >
                  <option value="">No location assigned</option>
                  {locationsList.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Condition grade
                </label>
                <select
                  value={addForm.conditionGrade}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      conditionGrade: e.target.value as ConditionGrade | '',
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                >
                  <option value="">Not graded</option>
                  <option value="A">A - Excellent</option>
                  <option value="B">B - Good</option>
                  <option value="C">C - Fair</option>
                  <option value="D">D - Poor</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Asset condition
                </label>
                <select
                  value={addForm.assetCondition}
                  onChange={(e) =>
                    setAddForm((f) => ({
                      ...f,
                      assetCondition: e.target.value as AssetCondition | '',
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                >
                  <option value="">Not set</option>
                  <option value="new">New</option>
                  <option value="used">Used</option>
                  <option value="dead">Dead</option>
                  <option value="not_working">Not Working</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Initial status
                </label>
                <select
                  value={addForm.currentStatus}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, currentStatus: e.target.value as AssetStatus }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                >
                  <option value="in_storage">In storage</option>
                  <option value="receiving">Receiving</option>
                  <option value="in_inspection">In inspection</option>
                </select>
              </div>
              <RepairSection
                repairHandling={addForm.repairHandling}
                repairServiceName={addForm.repairServiceName}
                repairEstimateCost={addForm.repairEstimateCost}
                onChange={(field, value) => setAddForm((f) => ({ ...f, [field]: value }))}
              />
              {/* Shipping & disposal */}
              <div className="col-span-full border border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Shipping &amp; Disposal
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      AWB / Tracking No.
                    </label>
                    <input
                      type="text"
                      value={addForm.awbNumber}
                      onChange={(e) => setAddForm((f) => ({ ...f, awbNumber: e.target.value }))}
                      placeholder="e.g. 123-45678901"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Courier name
                    </label>
                    <input
                      type="text"
                      value={addForm.courierName}
                      onChange={(e) => setAddForm((f) => ({ ...f, courierName: e.target.value }))}
                      placeholder="e.g. FedEx, DHL"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Delivery date
                    </label>
                    <input
                      type="date"
                      value={addForm.deliveredAt}
                      onChange={(e) => setAddForm((f) => ({ ...f, deliveredAt: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Disposal type
                    </label>
                    <select
                      value={addForm.disposalType}
                      onChange={(e) => setAddForm((f) => ({ ...f, disposalType: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                    >
                      <option value="non_certified">Non-Certified</option>
                      <option value="certified_blanco">Certified</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2 flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3">
                    <label className="text-xs font-medium text-gray-700">Certification</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setAddForm((f) => ({ ...f, hasCertification: true }))}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${addForm.hasCertification ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setAddForm((f) => ({ ...f, hasCertification: false }))}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${!addForm.hasCertification ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        No
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            {addFormError && <p className="mt-3 text-sm text-red-600">{addFormError}</p>}
            <div className="mt-5 flex gap-3">
              <button
                type="submit"
                disabled={addMutation.isPending}
                className="px-5 py-2 bg-[#E86F2C] text-white rounded-lg text-sm font-medium hover:bg-[#d4621f] disabled:opacity-50 transition-colors"
              >
                {addMutation.isPending ? 'Adding…' : 'Add asset'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(false);
                  setAddForm(EMPTY_ADD_FORM);
                  setAddFormError('');
                }}
                className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search serial, tag, reference no, vendor, model…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setPage(0);
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
        >
          <option value="">All categories</option>
          <option value="laptop">Laptop</option>
          <option value="monitor">Monitor</option>
          <option value="peripheral">Peripheral</option>
        </select>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(0);
          }}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
        >
          <option value="">All statuses</option>
          <option value="receiving">Receiving</option>
          <option value="in_inspection">In inspection</option>
          <option value="in_storage">In storage</option>
          <option value="deployed">Deployed</option>
          <option value="returning">Returning</option>
          <option value="disposed">Disposed</option>
        </select>
      </div>

      {/* Bulk transfer action bar */}
      {canEdit && selectedIds.size > 0 && (
        <div className="flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-4 py-3">
          <span className="text-sm font-medium text-gray-700">
            {selectedIds.size} asset{selectedIds.size !== 1 ? 's' : ''} selected
          </span>
          <select
            value={bulkTargetLocationId}
            onChange={(e) => setBulkTargetLocationId(e.target.value)}
            className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
          >
            <option value="">Transfer to location…</option>
            {locationsList.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!bulkTargetLocationId || bulkMoveMutation.isPending}
            onClick={() =>
              bulkMoveMutation.mutate({
                assetIds: Array.from(selectedIds),
                locationId: bulkTargetLocationId,
              })
            }
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#E86F2C] hover:bg-[#d4621f] text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
          >
            <MoveRight size={14} />
            {bulkMoveMutation.isPending ? 'Transferring…' : 'Transfer'}
          </button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            Clear
          </button>
          {bulkMoveMutation.isError && (
            <span className="text-sm text-red-600">
              {(bulkMoveMutation.error as Error).message}
            </span>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                  {canEdit && (
                    <th className="px-4 py-3 whitespace-nowrap">
                      <input
                        type="checkbox"
                        checked={
                          (data?.data ?? []).length > 0 &&
                          (data?.data ?? []).every((a) => selectedIds.has(a.id))
                        }
                        onChange={(e) => {
                          const ids = (data?.data ?? []).map((a) => a.id);
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) ids.forEach((id) => next.add(id));
                            else ids.forEach((id) => next.delete(id));
                            return next;
                          });
                        }}
                        className="w-4 h-4 accent-[#E86F2C] cursor-pointer"
                      />
                    </th>
                  )}
                  <th className="text-left px-4 py-3 whitespace-nowrap">Date Added</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Asset Tag</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Serial No.</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Condition</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Category</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Model</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Status</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Dispatch Date</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">AWB (Tracking No.)</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Courier</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Delivered Date</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Disposal</th>
                  <th className="text-left px-4 py-3 whitespace-nowrap">Certification</th>
                  {canEdit && <th className="px-4 py-3" />}
                </tr>
              </thead>
              <tbody>
                {(data?.data ?? []).map((a) => {
                  const disposal = a.disposalRequests?.[0];
                  const deployment = a.deploymentOrders?.[0];
                  const STATUS_LABELS: Record<string, string> = {
                    receiving: 'Receiving',
                    in_inspection: 'In Inspection',
                    in_storage: 'In House',
                    deployed: 'Deployed',
                    returning: 'Returning',
                    disposed: 'Disposed',
                    in_repair: 'In Repair',
                    for_resale: 'For Resale',
                    sold: 'Sold',
                  };
                  const STATUS_COLORS: Record<string, string> = {
                    receiving: 'bg-sky-100 text-sky-700',
                    in_inspection: 'bg-purple-100 text-purple-700',
                    in_storage: 'bg-emerald-100 text-emerald-700',
                    deployed: 'bg-[#E86F2C]/10 text-[#E86F2C]',
                    returning: 'bg-amber-100 text-amber-700',
                    disposed: 'bg-gray-100 text-gray-500',
                    in_repair: 'bg-amber-100 text-amber-700',
                    for_resale: 'bg-blue-100 text-blue-700',
                    sold: 'bg-emerald-100 text-emerald-700',
                  };

                  return (
                    <tr
                      key={a.id}
                      onClick={() => navigate(`/inventory/${a.id}`)}
                      className="border-b border-gray-50 hover:bg-orange-50/40 cursor-pointer transition-colors group"
                    >
                      {canEdit && (
                        <td
                          className="px-4 py-3 whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(a.id)}
                            onChange={(e) => {
                              setSelectedIds((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(a.id);
                                else next.delete(a.id);
                                return next;
                              });
                            }}
                            className="w-4 h-4 accent-[#E86F2C] cursor-pointer"
                          />
                        </td>
                      )}
                      {/* 1. Date Added */}
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {fmt(a.createdAt)}
                      </td>

                      {/* 2. Asset Tag */}
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">
                        {a.assetTag ?? <span className="text-gray-300">-</span>}
                      </td>

                      {/* 3. Serial No. — now adjacent to Asset Tag */}
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-gray-900 whitespace-nowrap">
                        {a.serialNumber}
                      </td>

                      {/* 4. Condition Grade — inline editable */}
                      <td
                        className="px-4 py-3 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canEdit ? (
                          <InlineSelect
                            assetId={a.id}
                            field="conditionGrade"
                            value={a.conditionGrade ?? ''}
                            saving={savingCells.has(`${a.id}:conditionGrade`)}
                            options={[
                              { value: '', label: '- Not graded' },
                              { value: 'A', label: 'Grade A - Excellent' },
                              { value: 'B', label: 'Grade B - Good' },
                              { value: 'C', label: 'Grade C - Fair' },
                              { value: 'D', label: 'Grade D - Poor' },
                            ]}
                            onSave={handleInlineSave}
                            renderBadge={(v) =>
                              v ? (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs font-bold ${gradeColors[v] ?? 'bg-gray-100 text-gray-600'}`}
                                >
                                  Grade {v}
                                </span>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )
                            }
                          />
                        ) : a.conditionGrade ? (
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-bold ${gradeColors[a.conditionGrade] ?? 'bg-gray-100 text-gray-600'}`}
                          >
                            Grade {a.conditionGrade}
                          </span>
                        ) : (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>

                      {/* 5. Category */}
                      <td className="px-4 py-3 text-gray-600 capitalize text-xs whitespace-nowrap">
                        {a.category}
                      </td>

                      {/* 6. Model */}
                      <td className="px-4 py-3 text-gray-700 text-xs whitespace-nowrap">
                        {a.manufacturer} {a.model}
                      </td>

                      {/* 7. Status — inline editable */}
                      <td
                        className="px-4 py-3 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canEdit ? (
                          <InlineSelect
                            assetId={a.id}
                            field="currentStatus"
                            value={a.currentStatus}
                            saving={savingCells.has(`${a.id}:currentStatus`)}
                            options={[
                              { value: 'receiving', label: 'Receiving' },
                              { value: 'in_inspection', label: 'In Inspection' },
                              { value: 'in_storage', label: 'In House' },
                              { value: 'deployed', label: 'Deployed' },
                              { value: 'returning', label: 'Returning' },
                              { value: 'disposed', label: 'Disposed' },
                              { value: 'in_repair', label: 'In Repair' },
                              { value: 'for_resale', label: 'For Resale' },
                              { value: 'sold', label: 'Sold' },
                            ]}
                            onSave={handleInlineSave}
                            renderBadge={(v) => (
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[v] ?? 'bg-gray-100 text-gray-600'}`}
                              >
                                {STATUS_LABELS[v] ?? v}
                              </span>
                            )}
                          />
                        ) : (
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[a.currentStatus] ?? 'bg-gray-100 text-gray-600'}`}
                          >
                            {STATUS_LABELS[a.currentStatus] ?? a.currentStatus}
                          </span>
                        )}
                      </td>

                      {/* 8. Dispatch Date */}
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {fmt(deployment?.dispatchedAt)}
                      </td>

                      {/* 9. AWB (Tracking No.) — asset-level field, falls back to deployment */}
                      <td className="px-4 py-3 font-mono text-xs text-gray-600 whitespace-nowrap">
                        {a.awbNumber ?? deployment?.trackingNumber ?? (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>

                      {/* 10. Courier — asset-level field, falls back to deployment */}
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        {a.courierName ?? deployment?.courierName ?? (
                          <span className="text-gray-300">-</span>
                        )}
                      </td>

                      {/* 11. Delivered Date — asset-level field, falls back to deployment */}
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {fmt(a.deliveredAt ?? deployment?.deliveredAt)}
                      </td>

                      {/* 12. Disposal — inline editable */}
                      <td
                        className="px-4 py-3 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canEdit ? (
                          <InlineSelect
                            assetId={a.id}
                            field="disposalType"
                            value={a.disposalType ?? ''}
                            saving={savingCells.has(`${a.id}:disposalType`)}
                            options={[
                              { value: 'non_certified', label: 'Non-Certified' },
                              { value: 'certified_blanco', label: 'Certified' },
                            ]}
                            onSave={handleInlineSave}
                            renderBadge={(v) =>
                              v ? (
                                <span
                                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${disposalColors[v] ?? 'bg-gray-100 text-gray-600'}`}
                                >
                                  {disposalLabel[v] ?? v}
                                </span>
                              ) : (
                                <span className="text-gray-300">-</span>
                              )
                            }
                          />
                        ) : (
                          (() => {
                            const dtype = a.disposalType ?? disposal?.disposalType;
                            return dtype ? (
                              <span
                                className={`px-2 py-0.5 rounded-full text-xs font-medium ${disposalColors[dtype] ?? 'bg-gray-100 text-gray-600'}`}
                              >
                                {disposalLabel[dtype] ?? dtype}
                              </span>
                            ) : (
                              <span className="text-gray-300">-</span>
                            );
                          })()
                        )}
                      </td>

                      {/* 13. Certification — inline editable */}
                      <td
                        className="px-4 py-3 whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {canEdit ? (
                          <InlineSelect
                            assetId={a.id}
                            field="hasCertification"
                            value={String(a.hasCertification ?? false)}
                            saving={savingCells.has(`${a.id}:hasCertification`)}
                            options={[
                              { value: 'true', label: 'Yes' },
                              { value: 'false', label: 'No' },
                            ]}
                            onSave={handleInlineSave}
                            renderBadge={(v) =>
                              v === 'true' ? (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                                  Yes
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                                  No
                                </span>
                              )
                            }
                          />
                        ) : (a.hasCertification ?? disposal?.certificateS3Key) ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            Yes
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500">
                            No
                          </span>
                        )}
                      </td>

                      {/* Edit button */}
                      {canEdit && (
                        <td className="px-4 py-3 whitespace-nowrap text-right">
                          <button
                            onClick={(e) => openEdit(e, a)}
                            className="p-1.5 text-gray-400 hover:text-[#E86F2C] hover:bg-orange-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                            title="Edit asset"
                          >
                            <Pencil size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {(data?.data ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={canEdit ? 15 : 13}
                      className="px-5 py-12 text-center text-gray-400 text-sm"
                    >
                      <Package size={24} className="mx-auto mb-2 text-gray-300" />
                      No assets found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {(data?.total ?? 0) > take && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm text-gray-600">
              <span>
                {page * take + 1}–{Math.min((page + 1) * take, data?.total ?? 0)} of {data?.total}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(page + 1) * take >= (data?.total ?? 0)}
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Edit asset modal */}
      {editingAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Pencil size={16} className="text-gray-400" />
                Edit asset
              </h2>
              <button
                onClick={() => setEditingAsset(null)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                editMutation.mutate({ ...editForm, id: editingAsset.id });
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Asset tag</label>
                  <input
                    type="text"
                    value={editForm.assetTag}
                    onChange={(e) => setEditForm((f) => ({ ...f, assetTag: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] font-mono"
                    placeholder="AT-XXXX"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Reference No.
                  </label>
                  <input
                    type="text"
                    value={editForm.referenceName}
                    onChange={(e) => setEditForm((f) => ({ ...f, referenceName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                    placeholder="Client's own reference"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Vendor</label>
                  <input
                    type="text"
                    value={editForm.vendorName}
                    onChange={(e) => setEditForm((f) => ({ ...f, vendorName: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                    placeholder="iValue, or other vendor"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Serial number <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.serialNumber}
                    onChange={(e) => setEditForm((f) => ({ ...f, serialNumber: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Manufacturer <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.manufacturer}
                    onChange={(e) => setEditForm((f) => ({ ...f, manufacturer: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Model <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.model}
                    onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={editForm.category}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, category: e.target.value as AssetCategory }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                  >
                    <option value="laptop">Laptop</option>
                    <option value="monitor">Monitor</option>
                    <option value="peripheral">Peripheral</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Condition grade
                  </label>
                  <select
                    value={editForm.conditionGrade}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        conditionGrade: e.target.value as ConditionGrade | '',
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                  >
                    <option value="">Not graded</option>
                    <option value="A">A - Excellent</option>
                    <option value="B">B - Good</option>
                    <option value="C">C - Fair</option>
                    <option value="D">D - Poor</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Asset condition
                  </label>
                  <select
                    value={editForm.assetCondition}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        assetCondition: e.target.value as AssetCondition | '',
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                  >
                    <option value="">Not set</option>
                    <option value="new">New</option>
                    <option value="used">Used</option>
                    <option value="dead">Dead</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={editForm.currentStatus}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        currentStatus: e.target.value as AssetStatus,
                      }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                  >
                    <option value="receiving">Receiving</option>
                    <option value="in_inspection">In inspection</option>
                    <option value="in_storage">In storage</option>
                    <option value="deployed">Deployed</option>
                    <option value="returning">Returning</option>
                    <option value="disposed">Disposed</option>
                    <option value="in_repair">In repair</option>
                    <option value="for_resale">For resale</option>
                    <option value="sold">Sold</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
                  <select
                    value={editForm.currentLocationId}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, currentLocationId: e.target.value }))
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                  >
                    <option value="">
                      {editingAsset.currentLocation?.name ?? 'No location assigned'}
                    </option>
                    {locationsList.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
                <RepairSection
                  repairHandling={editForm.repairHandling}
                  repairServiceName={editForm.repairServiceName}
                  repairEstimateCost={editForm.repairEstimateCost}
                  onChange={(field, value) => setEditForm((f) => ({ ...f, [field]: value }))}
                />
              </div>
              {/* Shipping & disposal info */}
              <div className="border border-gray-200 rounded-lg p-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Shipping &amp; Disposal
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      AWB / Tracking No.
                    </label>
                    <input
                      type="text"
                      value={editForm.awbNumber}
                      onChange={(e) => setEditForm((f) => ({ ...f, awbNumber: e.target.value }))}
                      placeholder="e.g. 123-45678901"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Courier name
                    </label>
                    <input
                      type="text"
                      value={editForm.courierName}
                      onChange={(e) => setEditForm((f) => ({ ...f, courierName: e.target.value }))}
                      placeholder="e.g. FedEx, DHL"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Delivery date
                    </label>
                    <input
                      type="date"
                      value={editForm.deliveredAt}
                      onChange={(e) => setEditForm((f) => ({ ...f, deliveredAt: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700 mb-1">
                      Disposal type
                    </label>
                    <select
                      value={editForm.disposalType}
                      onChange={(e) => setEditForm((f) => ({ ...f, disposalType: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
                    >
                      <option value="non_certified">Non-Certified</option>
                      <option value="certified_blanco">Certified</option>
                    </select>
                  </div>
                  <div className="col-span-2 flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3">
                    <label className="text-xs font-medium text-gray-700">Certification</label>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditForm((f) => ({ ...f, hasCertification: true }))}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${editForm.hasCertification ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditForm((f) => ({ ...f, hasCertification: false }))}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${!editForm.hasCertification ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                      >
                        No
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              {editFormError && <p className="text-sm text-red-600">{editFormError}</p>}
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={editMutation.isPending}
                  className="flex-1 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {editMutation.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingAsset(null)}
                  className="px-4 py-2.5 text-sm text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
