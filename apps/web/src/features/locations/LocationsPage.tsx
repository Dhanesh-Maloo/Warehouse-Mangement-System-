import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Plus, X, MapPin, Pencil, Trash2 } from 'lucide-react';

interface Location {
  id: string;
  name: string;
  zoneCode: string;
  binCode: string;
  description: string | null;
  capacity: number | null;
  _count: { assets: number };
}

const EMPTY_FORM = { name: '', zoneCode: '', binCode: '', description: '', capacity: '' };

type FormState = typeof EMPTY_FORM;

function LocationForm({
  title,
  initial,
  onSave,
  onCancel,
  isPending,
  error,
}: {
  title: string;
  initial: FormState;
  onSave: (f: FormState) => void;
  onCancel: () => void;
  isPending: boolean;
  error: string;
}) {
  const [form, setForm] = useState(initial);
  function field(k: keyof FormState, v: string) {
    setForm((p) => ({ ...p, [k]: v }));
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <button onClick={onCancel} className="p-1 text-gray-400 hover:text-gray-600">
          <X size={18} />
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Name <span className="text-red-500">*</span>
          </label>
          <input
            value={form.name}
            onChange={(e) => field('name', e.target.value)}
            placeholder="A-001"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Zone code <span className="text-red-500">*</span>
          </label>
          <input
            value={form.zoneCode}
            onChange={(e) => field('zoneCode', e.target.value.toUpperCase())}
            placeholder="A"
            maxLength={10}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E86F2C] uppercase"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Bin code <span className="text-red-500">*</span>
          </label>
          <input
            value={form.binCode}
            onChange={(e) => field('binCode', e.target.value)}
            placeholder="001"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Capacity</label>
          <input
            type="number"
            min="1"
            value={form.capacity}
            onChange={(e) => field('capacity', e.target.value)}
            placeholder="e.g. 20"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        <div className="col-span-2 sm:col-span-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <input
            value={form.description}
            onChange={(e) => field('description', e.target.value)}
            placeholder="Zone A - Rack 1, Shelf 1"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-3">
        <button
          onClick={() => onSave(form)}
          disabled={isPending || !form.name || !form.zoneCode || !form.binCode}
          className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 hover:bg-[#D05E1E] transition-colors"
        >
          {isPending ? 'Saving…' : 'Save location'}
        </button>
        <button
          onClick={onCancel}
          className="text-sm text-gray-600 px-4 py-2 rounded-lg hover:bg-gray-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function LocationsPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';

  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editError, setEditError] = useState('');

  const [deleteTarget, setDeleteTarget] = useState<Location | null>(null);

  const { data = [], isLoading } = useQuery({
    queryKey: ['locations-full'],
    queryFn: () => api.get<Location[]>('/locations'),
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['locations-full'] });
    void qc.invalidateQueries({ queryKey: ['locations'] });
  };

  const createMutation = useMutation({
    mutationFn: (f: FormState) =>
      api.post('/locations', {
        name: f.name,
        zoneCode: f.zoneCode.toUpperCase(),
        binCode: f.binCode,
        description: f.description || undefined,
        capacity: f.capacity ? parseInt(f.capacity, 10) : undefined,
      }),
    onSuccess: () => {
      invalidate();
      setShowCreate(false);
      setCreateError('');
    },
    onError: (e: Error) => setCreateError(e.message),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, f }: { id: string; f: FormState }) =>
      api.patch(`/locations/${id}`, {
        name: f.name,
        zoneCode: f.zoneCode.toUpperCase(),
        binCode: f.binCode,
        description: f.description || undefined,
        capacity: f.capacity ? parseInt(f.capacity, 10) : undefined,
      }),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setEditError('');
    },
    onError: (e: Error) => setEditError(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/locations/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
    },
    onError: (e: Error) =>
      setDeleteTarget((prev) => (prev ? ({ ...prev, _deleteError: e.message } as never) : null)),
  });

  const zones = [...new Set(data.map((l) => l.zoneCode))].sort();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Locations</h1>
          <p className="text-sm text-gray-500 mt-1">{data.length} warehouse locations</p>
        </div>
        {canEdit && (
          <button
            onClick={() => {
              setShowCreate(true);
              setCreateError('');
            }}
            className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New location
          </button>
        )}
      </div>

      {showCreate && (
        <LocationForm
          title="New location"
          initial={EMPTY_FORM}
          onSave={(f) => createMutation.mutate(f)}
          onCancel={() => {
            setShowCreate(false);
            setCreateError('');
          }}
          isPending={createMutation.isPending}
          error={createError}
        />
      )}

      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="space-y-4">
          {zones.map((zone) => {
            const zoneLocs = data.filter((l) => l.zoneCode === zone);
            return (
              <div
                key={zone}
                className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden"
              >
                <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                  <MapPin size={14} className="text-[#E86F2C]" />
                  <h2 className="text-sm font-semibold text-gray-700">Zone {zone}</h2>
                  <span className="ml-auto text-xs text-gray-400">
                    {zoneLocs.length} bin{zoneLocs.length !== 1 ? 's' : ''}
                  </span>
                </div>

                <div className="divide-y divide-gray-50">
                  {zoneLocs.map((loc) => (
                    <div key={loc.id}>
                      {editingId === loc.id ? (
                        <div className="p-4">
                          <LocationForm
                            title={`Edit ${loc.name}`}
                            initial={{
                              name: loc.name,
                              zoneCode: loc.zoneCode,
                              binCode: loc.binCode,
                              description: loc.description ?? '',
                              capacity: loc.capacity?.toString() ?? '',
                            }}
                            onSave={(f) => editMutation.mutate({ id: loc.id, f })}
                            onCancel={() => {
                              setEditingId(null);
                              setEditError('');
                            }}
                            isPending={editMutation.isPending}
                            error={editError}
                          />
                        </div>
                      ) : (
                        <div className="px-5 py-4 flex items-start gap-4 group">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-semibold text-gray-900 text-sm">
                                {loc.name}
                              </span>
                              <span className="text-xs text-gray-400 font-mono">
                                {loc.zoneCode}-{loc.binCode}
                              </span>
                              <span
                                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                  loc._count.assets > 0
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-gray-100 text-gray-500'
                                }`}
                              >
                                {loc._count.assets} asset{loc._count.assets !== 1 ? 's' : ''}
                              </span>
                            </div>
                            {loc.description && (
                              <p className="text-xs text-gray-500 mt-0.5">{loc.description}</p>
                            )}
                            {loc.capacity != null && (
                              <div className="mt-2 max-w-xs">
                                <div className="flex justify-between text-xs text-gray-400 mb-0.5">
                                  <span>Capacity</span>
                                  <span>
                                    {loc._count.assets}/{loc.capacity}
                                  </span>
                                </div>
                                <div className="h-1 bg-gray-100 rounded-full">
                                  <div
                                    className={`h-1 rounded-full transition-all ${
                                      loc._count.assets / loc.capacity > 0.9
                                        ? 'bg-red-400'
                                        : loc._count.assets / loc.capacity > 0.7
                                          ? 'bg-amber-400'
                                          : 'bg-emerald-400'
                                    }`}
                                    style={{
                                      width: `${Math.min(100, (loc._count.assets / loc.capacity) * 100)}%`,
                                    }}
                                  />
                                </div>
                              </div>
                            )}
                          </div>

                          {canEdit && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                              <button
                                onClick={() => {
                                  setEditingId(loc.id);
                                  setEditError('');
                                }}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                                title="Edit location"
                              >
                                <Pencil size={14} />
                              </button>
                              <button
                                onClick={() => setDeleteTarget(loc)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Delete location"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {data.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">
              No locations yet. Create the first one above.
            </div>
          )}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Delete location?</h2>
            </div>
            <p className="text-sm text-gray-500 mb-1">
              <span className="font-mono font-semibold text-gray-800">{deleteTarget.name}</span>{' '}
              will be permanently removed.
            </p>
            {deleteTarget._count.assets > 0 && (
              <p className="text-sm text-amber-600 mb-1">
                This location has {deleteTarget._count.assets} asset(s) assigned - move them first.
              </p>
            )}
            {(deleteTarget as never as { _deleteError?: string })._deleteError && (
              <p className="text-sm text-red-600 mb-1">
                {(deleteTarget as never as { _deleteError?: string })._deleteError}
              </p>
            )}
            <div className="flex gap-3 justify-end mt-5">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteTarget.id)}
                disabled={deleteMutation.isPending || deleteTarget._count.assets > 0}
                className="px-4 py-2 text-sm font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
