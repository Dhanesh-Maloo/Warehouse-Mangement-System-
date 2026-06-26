import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Plus, X, Pencil } from 'lucide-react';

interface RateCardItem {
  id: string;
  code: string;
  description: string;
  basis: string;
  categoryApplies: string;
  unitRatePaise: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isBundle: boolean;
}

function formatPaise(p: string) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(
    Number(p) / 100,
  );
}

const BASES = ['per_device', 'per_shipment', 'monthly_per_device', 'per_label'];
const CATEGORIES = ['any', 'laptop', 'monitor', 'peripheral'];
const EMPTY = {
  code: '',
  description: '',
  basis: 'per_device',
  categoryApplies: 'any',
  unitRupees: '',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  isBundle: false,
};

export function RateCardPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const isAdmin = user?.role === 'admin';
  const [showForm, setShowForm] = useState(false);
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [formError, setFormError] = useState('');

  function openEdit(item: RateCardItem) {
    setForm({
      code: item.code,
      description: item.description,
      basis: item.basis,
      categoryApplies: item.categoryApplies,
      unitRupees: (Number(item.unitRatePaise) / 100).toFixed(2),
      effectiveFrom: new Date().toISOString().slice(0, 10),
      isBundle: item.isBundle,
    });
    setEditingCode(item.code);
    setFormError('');
    setShowForm(true);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['rate-card-current'],
    queryFn: () => api.get<RateCardItem[]>('/rate-card/current'),
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const paise = Math.round(parseFloat(form.unitRupees) * 100);
      if (isNaN(paise) || paise < 0) throw new Error('Enter a valid rate in ₹');
      return api.post('/rate-card', {
        code: form.code.toUpperCase().trim(),
        description: form.description,
        basis: form.basis,
        categoryApplies: form.categoryApplies,
        unitRatePaise: paise,
        effectiveFrom: form.effectiveFrom,
        isBundle: form.isBundle,
        bundleComponentCodes: [],
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rate-card-current'] });
      setShowForm(false);
      setForm(EMPTY);
      setEditingCode(null);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  function field(k: keyof typeof form, v: string | boolean) {
    setForm((p) => ({ ...p, [k]: v }));
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rate Card</h1>
          <p className="text-sm text-gray-500 mt-1">
            Current pricing — creating a new rate closes the previous version
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => {
              setForm(EMPTY);
              setEditingCode(null);
              setFormError('');
              setShowForm(true);
            }}
            className="flex items-center gap-2 bg-[#E86F2C] hover:bg-[#D05E1E] text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            <Plus size={16} />
            New rate
          </button>
        )}
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              {editingCode ? `Edit rate — ${editingCode}` : 'Add new rate'}
            </h2>
            <button
              onClick={() => { setShowForm(false); setEditingCode(null); }}
              className="p-1 text-gray-400 hover:text-gray-600"
            >
              <X size={18} />
            </button>
          </div>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            {editingCode
              ? `Saving will close the current version of ${editingCode} and create a new one effective from the date below.`
              : 'If a rate with this code already exists, it will be closed and a new version created effective from the date you choose.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Code <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={form.code}
                onChange={(e) => field('code', e.target.value)}
                placeholder="INGEST_LAPTOP"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-red-500">*</span>
              </label>
              <input
                required
                value={form.description}
                onChange={(e) => field('description', e.target.value)}
                placeholder="Device ingestion — laptop"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Basis</label>
              <select
                value={form.basis}
                onChange={(e) => field('basis', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
              >
                {BASES.map((b) => (
                  <option key={b} value={b}>
                    {b.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Applies to</label>
              <select
                value={form.categoryApplies}
                onChange={(e) => field('categoryApplies', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Unit rate (₹) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={form.unitRupees}
                onChange={(e) => field('unitRupees', e.target.value)}
                placeholder="150.00"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Effective from <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                required
                value={form.effectiveFrom}
                onChange={(e) => field('effectiveFrom', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
              />
            </div>
          </div>
          {formError && <p className="text-sm text-red-600">{formError}</p>}
          <div className="flex gap-3">
            <button
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
              className="bg-[#E86F2C] text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
            >
              {createMutation.isPending ? 'Saving…' : 'Save rate'}
            </button>
            <button
              onClick={() => setShowForm(false)}
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
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">Code</th>
                <th className="text-left px-5 py-3">Description</th>
                <th className="text-left px-5 py-3">Basis</th>
                <th className="text-left px-5 py-3">Applies to</th>
                <th className="text-right px-5 py-3">Unit rate</th>
                <th className="text-left px-5 py-3">Effective from</th>
                {isAdmin && <th className="px-5 py-3" />}
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((item) => (
                <tr key={item.id} className="border-b border-gray-50 hover:bg-orange-50/40 group transition-colors">
                  <td className="px-5 py-3 font-mono font-semibold text-gray-900 text-xs">
                    {item.code}
                  </td>
                  <td className="px-5 py-3 text-gray-700">{item.description}</td>
                  <td className="px-5 py-3 text-gray-600">{item.basis.replace(/_/g, ' ')}</td>
                  <td className="px-5 py-3 text-gray-600 capitalize">{item.categoryApplies}</td>
                  <td className="px-5 py-3 text-right font-semibold text-gray-900 tabular-nums">
                    {formatPaise(item.unitRatePaise)}
                  </td>
                  <td className="px-5 py-3 text-gray-600">
                    {new Date(item.effectiveFrom).toLocaleDateString('en-IN')}
                  </td>
                  {isAdmin && (
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => openEdit(item)}
                        className="p-1.5 text-gray-400 hover:text-[#E86F2C] hover:bg-orange-50 rounded-lg opacity-0 group-hover:opacity-100 transition-all"
                        title="Edit rate"
                      >
                        <Pencil size={13} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {(data ?? []).length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="px-5 py-12 text-center text-gray-400 text-sm">
                    No rates yet. Add the first rate above.
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
