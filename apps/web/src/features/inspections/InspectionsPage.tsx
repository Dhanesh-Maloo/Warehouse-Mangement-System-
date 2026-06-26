import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { ClipboardCheck, Plus, AlertTriangle, Clock } from 'lucide-react';

interface Asset {
  id: string;
  serialNumber: string;
  model: string;
  manufacturer: string;
  category: string;
  currentStatus: string;
}
interface Inspection {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  conditionGrade: string | null;
  slaMinutes: number | null;
  asset: { id: string; serialNumber: string; model: string };
}

const SLA_TARGET_MINUTES = 1440; // 24 business hours

// Rough client-side SLA estimate (calendar minutes, not business hours — full calc is server-side)
function slaStatus(startedAt: string): 'on_track' | 'at_risk' | 'breached' {
  const elapsed = (Date.now() - new Date(startedAt).getTime()) / 60_000;
  if (elapsed >= SLA_TARGET_MINUTES) return 'breached';
  if (elapsed >= SLA_TARGET_MINUTES * 0.8) return 'at_risk';
  return 'on_track';
}

function breachReason(startedAt: string): string {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const overdueMins = Math.floor(elapsedMs / 60_000) - SLA_TARGET_MINUTES;
  if (overdueMins < 60) return `${overdueMins}m overdue (target: 24 hrs)`;
  const hrs = Math.floor(overdueMins / 60);
  if (hrs < 24) return `${hrs}h ${overdueMins % 60}m overdue (target: 24 hrs)`;
  const days = Math.floor(hrs / 24);
  const remHrs = hrs % 24;
  return `${days}d ${remHrs}h overdue (target: 24 hrs)`;
}

const SLA_BADGE: Record<string, string> = {
  on_track: 'bg-emerald-100 text-emerald-700',
  at_risk: 'bg-amber-100 text-amber-700',
  breached: 'bg-red-100 text-red-700',
};

const GRADE_COLOR: Record<string, string> = {
  A: 'text-emerald-600',
  B: 'text-blue-600',
  C: 'text-amber-600',
  D: 'text-red-600',
};

export function InspectionsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [showStart, setShowStart] = useState(false);

  // Start inspection form state
  const [serialSearch, setSerialSearch] = useState('');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [inspType, setInspType] = useState<'inbound' | 'outbound' | 'periodic'>('inbound');

  const clientId = user?.role === 'client_user' ? (user.clientId ?? undefined) : undefined;

  const { data: inspections = [], isLoading } = useQuery({
    queryKey: ['inspections', clientId, statusFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (clientId) params.set('clientId', clientId);
      if (statusFilter) params.set('status', statusFilter);
      return api.get<Inspection[]>(`/inspections${params.size ? `?${params}` : ''}`);
    },
  });

  // All active assets (for the start panel) — any status except disposed
  const { data: pendingAssets } = useQuery({
    queryKey: ['assets-for-inspection', clientId],
    queryFn: () => {
      const params = new URLSearchParams({ take: '200' });
      if (clientId) params.set('clientId', clientId);
      return api
        .get<{ data: Asset[] }>(`/assets?${params.toString()}`)
        .then((r) => r.data.filter((a) => a.currentStatus !== 'disposed'));
    },
    enabled: showStart,
  });

  const filteredAssets = (pendingAssets ?? []).filter(
    (a) =>
      !serialSearch ||
      a.serialNumber.toLowerCase().includes(serialSearch.toLowerCase()) ||
      a.model.toLowerCase().includes(serialSearch.toLowerCase()),
  );

  const startMutation = useMutation({
    mutationFn: (vars: { assetId: string; type: string }) =>
      api.post<{ id: string }>('/inspections', vars),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['inspections'] });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['inventory-summary'] });
      navigate(`/inspections/${data.id}`);
    },
  });

  const inProgress = inspections.filter((i) => i.status === 'in_progress');
  const completed = inspections.filter((i) => i.status !== 'in_progress');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inspections</h1>
          <p className="text-sm text-gray-500 mt-1">Device condition assessments</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          >
            <option value="">All statuses</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          {user?.role !== 'client_user' && (
            <button
              onClick={() => setShowStart(true)}
              className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              <Plus size={16} />
              Start inspection
            </button>
          )}
        </div>
      </div>

      {/* Start inspection slide panel */}
      {showStart && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-900">Start new inspection</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Inspection type</label>
            <div className="flex gap-2">
              {(['inbound', 'outbound', 'periodic'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setInspType(t)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors capitalize ${
                    inspType === t
                      ? 'border-[#E86F2C] bg-orange-50 text-[#E86F2C]'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select asset <span className="text-gray-400 font-normal">(from inventory)</span>
            </label>
            <input
              type="text"
              value={serialSearch}
              onChange={(e) => setSerialSearch(e.target.value)}
              placeholder="Search by serial or model…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] mb-2"
            />
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {filteredAssets.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-gray-400">
                  No assets found in inventory.
                </p>
              ) : (
                filteredAssets.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setSelectedAsset(a)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-orange-50 transition-colors ${
                      selectedAsset?.id === a.id ? 'bg-orange-50' : ''
                    }`}
                  >
                    <div
                      className={`w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                        selectedAsset?.id === a.id
                          ? 'border-[#E86F2C] bg-[#E86F2C]'
                          : 'border-gray-300'
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-semibold text-gray-900">
                          {a.serialNumber}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            a.currentStatus === 'in_inspection'
                              ? 'bg-amber-100 text-amber-700'
                              : a.currentStatus === 'in_storage'
                                ? 'bg-emerald-100 text-emerald-700'
                                : a.currentStatus === 'deployed'
                                  ? 'bg-orange-100 text-orange-700'
                                  : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {a.currentStatus.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {a.manufacturer} {a.model} ·{' '}
                        <span className="capitalize">{a.category}</span>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {startMutation.isError && (
            <p className="text-sm text-red-600">{(startMutation.error as Error).message}</p>
          )}

          <div className="flex gap-3">
            <button
              onClick={() =>
                selectedAsset && startMutation.mutate({ assetId: selectedAsset.id, type: inspType })
              }
              disabled={!selectedAsset || startMutation.isPending}
              className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40"
            >
              {startMutation.isPending ? 'Starting…' : 'Start inspection'}
            </button>
            <button
              onClick={() => {
                setShowStart(false);
                setSelectedAsset(null);
                setSerialSearch('');
              }}
              className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <>
          {/* In-progress */}
          {inProgress.length > 0 && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
                In progress ({inProgress.length})
              </h2>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-5 py-3">Serial number</th>
                      <th className="text-left px-5 py-3">Model</th>
                      <th className="text-left px-5 py-3">Type</th>
                      <th className="text-left px-5 py-3">Started</th>
                      <th className="text-left px-5 py-3">SLA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inProgress.map((ins) => {
                      const sla = slaStatus(ins.startedAt);
                      return (
                        <tr
                          key={ins.id}
                          onClick={() => navigate(`/inspections/${ins.id}`)}
                          className="border-b border-gray-50 hover:bg-orange-50/40 cursor-pointer transition-colors"
                        >
                          <td className="px-5 py-3.5">
                            <Link
                              to={`/inventory/${ins.asset.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="font-mono text-xs font-semibold text-[#E86F2C] hover:underline"
                            >
                              {ins.asset.serialNumber}
                            </Link>
                          </td>
                          <td className="px-5 py-3.5 text-gray-700">{ins.asset.model}</td>
                          <td className="px-5 py-3.5 capitalize text-gray-600">{ins.type}</td>
                          <td className="px-5 py-3.5 text-gray-600 whitespace-nowrap">
                            {new Date(ins.startedAt).toLocaleString('en-IN', {
                              timeZone: 'Asia/Kolkata',
                              day: 'numeric',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex flex-col gap-0.5">
                              <span
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium w-fit ${SLA_BADGE[sla]}`}
                              >
                                {sla === 'breached' && <AlertTriangle size={11} />}
                                {sla === 'at_risk' && <Clock size={11} />}
                                {sla.replace('_', ' ')}
                              </span>
                              {sla === 'breached' && (
                                <span className="text-[10px] text-red-500 font-medium px-1">
                                  {breachReason(ins.startedAt)}
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Completed */}
          {(completed.length > 0 || inProgress.length === 0) && (
            <div className="space-y-2">
              <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
                {statusFilter ? 'Results' : 'Completed'} ({completed.length})
              </h2>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                      <th className="text-left px-5 py-3">Serial number</th>
                      <th className="text-left px-5 py-3">Model</th>
                      <th className="text-left px-5 py-3">Type</th>
                      <th className="text-left px-5 py-3">Completed</th>
                      <th className="text-left px-5 py-3">SLA (min)</th>
                      <th className="text-left px-5 py-3">Grade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completed.map((ins) => (
                      <tr
                        key={ins.id}
                        onClick={() => navigate(`/inspections/${ins.id}`)}
                        className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-3.5">
                          <Link
                            to={`/inventory/${ins.asset.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="font-mono text-xs font-semibold text-[#E86F2C] hover:underline"
                          >
                            {ins.asset.serialNumber}
                          </Link>
                        </td>
                        <td className="px-5 py-3.5 text-gray-700">{ins.asset.model}</td>
                        <td className="px-5 py-3.5 capitalize text-gray-600">{ins.type}</td>
                        <td className="px-5 py-3.5 text-gray-600 whitespace-nowrap">
                          {ins.completedAt
                            ? new Date(ins.completedAt).toLocaleString('en-IN', {
                                timeZone: 'Asia/Kolkata',
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </td>
                        <td className="px-5 py-3.5 tabular-nums text-gray-600">
                          {ins.slaMinutes ?? '—'}
                          {ins.slaMinutes !== null && ins.slaMinutes > SLA_TARGET_MINUTES && (
                            <span className="ml-1.5 text-red-500 text-xs">⚠</span>
                          )}
                        </td>
                        <td
                          className={`px-5 py-3.5 font-bold text-lg ${GRADE_COLOR[ins.conditionGrade ?? ''] ?? 'text-gray-400'}`}
                        >
                          {ins.conditionGrade ?? '—'}
                        </td>
                      </tr>
                    ))}
                    {completed.length === 0 && inProgress.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-5 py-12 text-center text-gray-400 text-sm">
                          <ClipboardCheck size={24} className="mx-auto mb-2 text-gray-300" />
                          No inspections yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
