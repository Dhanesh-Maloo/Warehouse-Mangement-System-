import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Breadcrumbs } from '../../components/Breadcrumbs';
import { DocumentsPanel } from '../../components/DocumentsPanel';
import { ArrowLeft, MapPin, ClipboardCheck, Package, Pencil, X } from 'lucide-react';

interface Location {
  id: string;
  name: string;
  zoneCode: string;
  binCode: string;
}

interface LedgerEntry {
  id: string;
  eventType: string;
  occurredAt: string;
  quantity: number;
  unitRatePaise: string;
  amountPaise: string;
  referenceType: string | null;
  referenceId: string | null;
}

interface Inspection {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  conditionGrade: string | null;
  slaMinutes: number | null;
}

interface AssetDetail {
  id: string;
  serialNumber: string;
  assetTag: string | null;
  referenceName: string | null;
  vendorName: string | null;
  model: string;
  manufacturer: string;
  category: string;
  currentStatus: string;
  conditionGrade: string | null;
  assetCondition: 'new' | 'used' | 'dead' | 'not_working' | null;
  createdAt: string;
  currentLocation: { id: string; name: string; zoneCode: string; binCode: string } | null;
  inspections: Inspection[];
  ledgerEntries: LedgerEntry[];
  repairHandling: boolean | null;
  repairServiceName: string | null;
  repairEstimateCost: number | null;
  awbNumber: string | null;
  courierName: string | null;
  deliveredAt: string | null;
  disposalType: string | null;
  hasCertification: boolean | null;
}

const STATUS_COLORS: Record<string, string> = {
  receiving: 'bg-blue-100 text-blue-700',
  in_inspection: 'bg-amber-100 text-amber-700',
  in_storage: 'bg-emerald-100 text-emerald-700',
  deployed: 'bg-[#E86F2C]/10 text-[#E86F2C]',
  returning: 'bg-purple-100 text-purple-700',
  disposed: 'bg-gray-100 text-gray-500',
  in_repair: 'bg-amber-100 text-amber-700',
  for_resale: 'bg-blue-100 text-blue-700',
  sold: 'bg-emerald-100 text-emerald-700',
};

const GRADE_COLORS: Record<string, string> = {
  A: 'text-emerald-600',
  B: 'text-blue-600',
  C: 'text-amber-600',
  D: 'text-red-600',
};

const EVENT_LABELS: Record<string, { label: string; color: string }> = {
  INGEST: { label: 'Received', color: 'bg-blue-500' },
  INSPECT: { label: 'Inspected', color: 'bg-amber-500' },
  DEPLOY: { label: 'Deployed', color: 'bg-[#E86F2C]' },
  RETRIEVE: { label: 'Retrieved', color: 'bg-purple-500' },
  DISPOSE: { label: 'Disposed', color: 'bg-gray-400' },
};

function formatPaise(paise: string): string {
  const rupees = Number(paise) / 100;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(rupees);
}

function agingDays(createdAt: string) {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86_400_000);
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface TimelineItem {
  date: string;
  kind: 'ledger' | 'inspection';
  ledger?: LedgerEntry;
  inspection?: Inspection;
}

export function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveLocationId, setMoveLocationId] = useState('');
  const [moveError, setMoveError] = useState('');

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    serialNumber: '',
    assetTag: '',
    referenceName: '',
    vendorName: '',
    model: '',
    manufacturer: '',
    category: '',
    conditionGrade: '',
    assetCondition: '',
    currentStatus: '',
    repairHandling: false,
    repairServiceName: '',
    repairEstimateCost: '',
    awbNumber: '',
    courierName: '',
    deliveredAt: '',
    disposalType: '',
    hasCertification: false,
  });
  const [editError, setEditError] = useState('');

  function openEditModal() {
    if (!asset) return;
    setEditForm({
      serialNumber: asset.serialNumber,
      assetTag: asset.assetTag ?? '',
      referenceName: asset.referenceName ?? '',
      vendorName: asset.vendorName ?? '',
      model: asset.model,
      manufacturer: asset.manufacturer,
      category: asset.category,
      conditionGrade: asset.conditionGrade ?? '',
      assetCondition: asset.assetCondition ?? '',
      currentStatus: asset.currentStatus,
      repairHandling: asset.repairHandling ?? false,
      repairServiceName: asset.repairServiceName ?? '',
      repairEstimateCost: asset.repairEstimateCost?.toString() ?? '',
      awbNumber: asset.awbNumber ?? '',
      courierName: asset.courierName ?? '',
      deliveredAt: asset.deliveredAt ? new Date(asset.deliveredAt).toISOString().split('T')[0] : '',
      disposalType: asset.disposalType ?? '',
      hasCertification: asset.hasCertification ?? false,
    });
    setEditError('');
    setShowEditModal(true);
  }

  const editMutation = useMutation({
    mutationFn: (formData: typeof editForm) => {
      const body: Record<string, unknown> = {
        serialNumber: formData.serialNumber || undefined,
        assetTag: formData.assetTag || undefined,
        referenceName: formData.referenceName || undefined,
        vendorName: formData.vendorName || undefined,
        model: formData.model || undefined,
        manufacturer: formData.manufacturer || undefined,
        category: formData.category || undefined,
        conditionGrade: formData.conditionGrade || undefined,
        assetCondition: formData.assetCondition || undefined,
        currentStatus: formData.currentStatus || undefined,
        repairHandling: formData.repairHandling,
        awbNumber: formData.awbNumber.trim() || undefined,
        courierName: formData.courierName.trim() || undefined,
        deliveredAt: formData.deliveredAt || undefined,
        disposalType: formData.disposalType || undefined,
        hasCertification: formData.hasCertification,
      };
      if (formData.repairHandling) {
        body.repairServiceName = formData.repairServiceName || undefined;
        body.repairEstimateCost = formData.repairEstimateCost
          ? parseInt(formData.repairEstimateCost, 10)
          : undefined;
      }
      return api.patch(`/assets/${id ?? ''}`, body);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['asset', id] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['storage-summary'] });
      setShowEditModal(false);
      setEditError('');
    },
    onError: (err: Error) => setEditError(err.message),
  });

  const { data: asset, isLoading } = useQuery({
    queryKey: ['asset', id],
    queryFn: () => api.get<AssetDetail>(`/assets/${id ?? ''}`),
    enabled: !!id,
  });

  const { data: locations = [] } = useQuery({
    queryKey: ['locations'],
    queryFn: () => api.get<Location[]>('/locations'),
    enabled: showMoveModal,
  });

  const moveMutation = useMutation({
    mutationFn: () => api.patch(`/assets/${id ?? ''}/move`, { locationId: moveLocationId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['asset', id] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      setShowMoveModal(false);
      setMoveLocationId('');
      setMoveError('');
    },
    onError: (err: Error) => setMoveError(err.message),
  });

  function handleMove(e: React.FormEvent) {
    e.preventDefault();
    setMoveError('');
    if (!moveLocationId) {
      setMoveError('Select a location.');
      return;
    }
    moveMutation.mutate();
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-gray-400">Loading…</div>
    );
  }

  if (!asset) {
    return (
      <div className="text-center py-16 text-gray-500">
        Asset not found.{' '}
        <Link to="/inventory" className="text-[#E86F2C] underline">
          Back to inventory
        </Link>
      </div>
    );
  }

  // Build unified timeline (reverse chronological)
  const timeline: TimelineItem[] = [
    ...asset.ledgerEntries.map((e) => ({ date: e.occurredAt, kind: 'ledger' as const, ledger: e })),
    ...asset.inspections.map((i) => ({
      date: i.startedAt,
      kind: 'inspection' as const,
      inspection: i,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const days = agingDays(asset.createdAt);

  return (
    <div className="space-y-6">
      <Breadcrumbs
        crumbs={[{ label: 'Inventory', to: '/inventory' }, { label: asset.serialNumber }]}
      />
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => navigate('/inventory')}
          className="mt-1 p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 transition-colors"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-gray-900 font-mono">{asset.serialNumber}</h1>
            {asset.assetTag && (
              <span className="text-sm text-gray-500 font-mono bg-gray-100 px-2 py-0.5 rounded">
                {asset.assetTag}
              </span>
            )}
            {asset.referenceName && (
              <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                Ref No: {asset.referenceName}
              </span>
            )}
            {asset.vendorName && (
              <span className="text-sm text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                Vendor: {asset.vendorName}
              </span>
            )}
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[asset.currentStatus] ?? 'bg-gray-100 text-gray-700'}`}
            >
              {asset.currentStatus.replace(/_/g, ' ')}
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-1">
            {asset.manufacturer} {asset.model} ·{' '}
            <span className="capitalize">{asset.category}</span>
            {asset.conditionGrade && (
              <>
                {' '}
                · Grade{' '}
                <span className={`font-bold ${GRADE_COLORS[asset.conditionGrade]}`}>
                  {asset.conditionGrade}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={openEditModal}
            className="flex items-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
          >
            <Pencil size={15} />
            Edit asset
          </button>
          {(asset.currentStatus === 'in_storage' || asset.currentStatus === 'in_inspection') && (
            <button
              onClick={() => setShowMoveModal(true)}
              className="flex items-center gap-2 border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors whitespace-nowrap"
            >
              <MapPin size={15} />
              Move location
            </button>
          )}
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Location</div>
          <div className="text-sm font-semibold text-gray-900">
            {asset.currentLocation?.name ?? (
              <span className="text-gray-400 font-normal">Unassigned</span>
            )}
          </div>
          {asset.currentLocation && (
            <div className="text-xs text-gray-400 mt-0.5">
              Zone {asset.currentLocation.zoneCode} · Bin {asset.currentLocation.binCode}
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Condition</div>
          <div
            className={`text-lg font-bold ${GRADE_COLORS[asset.conditionGrade ?? ''] ?? 'text-gray-400'}`}
          >
            {asset.conditionGrade ? `Grade ${asset.conditionGrade}` : '-'}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Age in warehouse</div>
          <div className="text-sm font-semibold text-gray-900">{days} days</div>
          <div className="text-xs text-gray-400 mt-0.5">Since {fmtDateTime(asset.createdAt)}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="text-xs font-medium text-gray-500 mb-1">Inspections</div>
          <div className="text-sm font-semibold text-gray-900">{asset.inspections.length}</div>
          <div className="text-xs text-gray-400 mt-0.5">
            {asset.inspections.filter((i) => i.status === 'completed').length} completed
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Event timeline</h2>
        </div>
        {timeline.length === 0 ? (
          <div className="px-5 py-12 text-center text-gray-400 text-sm">
            No events recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {timeline.map((item, idx) => {
              if (item.kind === 'ledger' && item.ledger) {
                const e = item.ledger;
                const meta = EVENT_LABELS[e.eventType] ?? {
                  label: e.eventType,
                  color: 'bg-gray-400',
                };
                const amount = Number(e.amountPaise);
                return (
                  <div key={`ledger-${e.id}`} className="flex gap-4 px-5 py-4">
                    <div className="flex flex-col items-center flex-shrink-0 w-8">
                      <div className={`w-3 h-3 rounded-full mt-1 flex-shrink-0 ${meta.color}`} />
                      {idx < timeline.length - 1 && (
                        <div className="w-px flex-1 bg-gray-100 mt-1" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pb-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900">{meta.label}</span>
                          <span className="font-mono text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            {e.eventType}
                          </span>
                        </div>
                        {amount !== 0 && (
                          <span
                            className={`text-sm font-semibold tabular-nums ${amount < 0 ? 'text-red-600' : 'text-gray-900'}`}
                          >
                            {formatPaise(e.amountPaise)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        {fmtDateTime(e.occurredAt)}
                        {e.referenceType && (
                          <>
                            {' '}
                            · <span className="capitalize">{e.referenceType}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              }

              if (item.kind === 'inspection' && item.inspection) {
                const ins = item.inspection;
                return (
                  <div key={`ins-${ins.id}`} className="flex gap-4 px-5 py-4">
                    <div className="flex flex-col items-center flex-shrink-0 w-8">
                      <div className="w-3 h-3 rounded-full mt-1 flex-shrink-0 bg-amber-400" />
                      {idx < timeline.length - 1 && (
                        <div className="w-px flex-1 bg-gray-100 mt-1" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0 pb-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-gray-900 capitalize">
                            {ins.type} inspection
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                              ins.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-700'
                                : ins.status === 'failed'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {ins.status.replace('_', ' ')}
                          </span>
                        </div>
                        <Link
                          to={`/inspections/${ins.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1 text-xs text-[#E86F2C] hover:underline"
                        >
                          <ClipboardCheck size={12} />
                          View
                        </Link>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        Started {fmtDateTime(ins.startedAt)}
                        {ins.conditionGrade && (
                          <>
                            {' '}
                            · Grade{' '}
                            <span className={`font-bold ${GRADE_COLORS[ins.conditionGrade]}`}>
                              {ins.conditionGrade}
                            </span>
                          </>
                        )}
                        {ins.slaMinutes !== null && <> · {ins.slaMinutes} business min</>}
                      </div>
                    </div>
                  </div>
                );
              }

              return null;
            })}
          </div>
        )}
      </div>

      {/* Inspections quick list */}
      {asset.inspections.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
            <ClipboardCheck size={15} className="text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-700">Inspections</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-5 py-3">Type</th>
                <th className="text-left px-5 py-3">Started</th>
                <th className="text-left px-5 py-3">Status</th>
                <th className="text-left px-5 py-3">Grade</th>
                <th className="text-left px-5 py-3">SLA (min)</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {asset.inspections.map((ins) => (
                <tr key={ins.id} className="border-b border-gray-50">
                  <td className="px-5 py-3 capitalize text-gray-700">{ins.type}</td>
                  <td className="px-5 py-3 text-gray-600 whitespace-nowrap">
                    {fmtDateTime(ins.startedAt)}
                  </td>
                  <td className="px-5 py-3">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        ins.status === 'completed'
                          ? 'bg-emerald-100 text-emerald-700'
                          : ins.status === 'failed'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {ins.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td
                    className={`px-5 py-3 font-bold ${GRADE_COLORS[ins.conditionGrade ?? ''] ?? 'text-gray-400'}`}
                  >
                    {ins.conditionGrade ?? '-'}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-gray-600">{ins.slaMinutes ?? '-'}</td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      to={`/inspections/${ins.id}`}
                      className="text-xs text-[#E86F2C] hover:underline"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Documents */}
      <DocumentsPanel entityType="asset" entityId={asset.id} />

      {/* Edit asset modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Pencil size={16} className="text-gray-400" />
                Edit asset
              </h2>
              <button
                onClick={() => setShowEditModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                editMutation.mutate(editForm);
              }}
              className="space-y-3"
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Serial number
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
                    Asset tag <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.assetTag}
                    onChange={(e) => setEditForm((f) => ({ ...f, assetTag: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] font-mono"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Reference No. <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.referenceName}
                    onChange={(e) => setEditForm((f) => ({ ...f, referenceName: e.target.value }))}
                    placeholder="Client's own reference"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Vendor <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={editForm.vendorName}
                    onChange={(e) => setEditForm((f) => ({ ...f, vendorName: e.target.value }))}
                    placeholder="iValue, or other vendor"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Manufacturer
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
                  <label className="block text-xs font-medium text-gray-700 mb-1">Model</label>
                  <input
                    type="text"
                    value={editForm.model}
                    onChange={(e) => setEditForm((f) => ({ ...f, model: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={editForm.category}
                    onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  >
                    <option value="">Select…</option>
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
                    onChange={(e) => setEditForm((f) => ({ ...f, conditionGrade: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  >
                    <option value="">Not graded</option>
                    <option value="A">A - Excellent</option>
                    <option value="B">B - Good</option>
                    <option value="C">C - Fair</option>
                    <option value="D">D - Poor</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Asset condition
                  </label>
                  <select
                    value={editForm.assetCondition}
                    onChange={(e) => setEditForm((f) => ({ ...f, assetCondition: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                  >
                    <option value="">Not set</option>
                    <option value="new">New</option>
                    <option value="used">Used</option>
                    <option value="dead">Dead</option>
                    <option value="not_working">Not Working</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={editForm.currentStatus}
                    onChange={(e) => setEditForm((f) => ({ ...f, currentStatus: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
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
              </div>
              {/* Repair handling */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-gray-700">Repair handling</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditForm((f) => ({ ...f, repairHandling: true }))}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${editForm.repairHandling ? 'bg-[#E86F2C] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditForm((f) => ({ ...f, repairHandling: false }))}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${!editForm.repairHandling ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    >
                      No
                    </button>
                  </div>
                </div>
                {editForm.repairHandling && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">
                        Service name
                      </label>
                      <input
                        type="text"
                        value={editForm.repairServiceName}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, repairServiceName: e.target.value }))
                        }
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
                        value={editForm.repairEstimateCost}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, repairEstimateCost: e.target.value }))
                        }
                        placeholder="e.g. 5000"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Shipping & Disposal */}
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
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
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
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

              {editError && <p className="text-sm text-red-600">{editError}</p>}
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
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2.5 text-sm text-gray-600 rounded-lg hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Move location modal */}
      {showMoveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Package size={16} className="text-gray-400" />
                Move to new location
              </h2>
              <button
                onClick={() => setShowMoveModal(false)}
                className="p-1 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            </div>
            <p className="text-sm text-gray-500">
              Current:{' '}
              <span className="font-semibold text-gray-800">
                {asset.currentLocation?.name ?? 'Unassigned'}
              </span>
            </p>
            <form onSubmit={handleMove} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  New location <span className="text-red-500">*</span>
                </label>
                <select
                  value={moveLocationId}
                  onChange={(e) => setMoveLocationId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
                >
                  <option value="">Select location…</option>
                  {locations
                    .filter((l) => l.id !== asset.currentLocation?.id)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name} - Zone {l.zoneCode} / Bin {l.binCode}
                      </option>
                    ))}
                </select>
              </div>
              {moveError && <p className="text-sm text-red-600">{moveError}</p>}
              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={moveMutation.isPending}
                  className="flex-1 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold py-2.5 rounded-lg disabled:opacity-50 transition-colors"
                >
                  {moveMutation.isPending ? 'Moving…' : 'Confirm move'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowMoveModal(false)}
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
