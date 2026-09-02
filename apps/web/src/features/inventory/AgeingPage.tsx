import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { Hourglass } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Client {
  id: string;
  name: string;
}

type AgeingBucket = '0-7' | '8-30' | '31-60' | '61-90' | '90+';

interface AgeingRow {
  id: string;
  serialNumber: string;
  assetTag: string | null;
  model: string;
  manufacturer: string;
  category: string;
  clientId: string;
  clientName: string;
  daysIdle: number;
  bucket: AgeingBucket;
  idleSince: string;
}

interface AgeingResponse {
  buckets: Record<AgeingBucket, number>;
  rows: AgeingRow[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const BUCKET_ORDER: AgeingBucket[] = ['0-7', '8-30', '31-60', '61-90', '90+'];

const BUCKET_LABELS: Record<AgeingBucket, string> = {
  '0-7': '0–7 days',
  '8-30': '8–30 days',
  '31-60': '31–60 days',
  '61-90': '61–90 days',
  '90+': '90+ days',
};

const BUCKET_COLORS: Record<AgeingBucket, string> = {
  '0-7': 'bg-emerald-100 text-emerald-700',
  '8-30': 'bg-sky-100 text-sky-700',
  '31-60': 'bg-amber-100 text-amber-700',
  '61-90': 'bg-orange-100 text-orange-700',
  '90+': 'bg-red-100 text-red-700',
};

const CATEGORY_LABELS: Record<string, string> = {
  laptop: 'Laptop',
  monitor: 'Monitor',
  peripheral: 'Peripheral',
};

export function AgeingPage() {
  const { user } = useAuth();
  const isClientScoped =
    user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin';

  const [selectedClientId, setSelectedClientId] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [bucketFilter, setBucketFilter] = useState<AgeingBucket | ''>('');

  const { data: clientsList = [] } = useQuery({
    queryKey: ['clients-list-ageing'],
    queryFn: () => api.get<{ data: Client[]; total: number }>('/clients').then((r) => r.data),
    enabled: !isClientScoped,
  });

  const effectiveClientId = isClientScoped ? (user?.clientId ?? '') : selectedClientId;

  const { data, isLoading } = useQuery({
    queryKey: ['inventory-ageing', effectiveClientId, categoryFilter],
    queryFn: () => {
      const params = new URLSearchParams();
      if (effectiveClientId) params.set('clientId', effectiveClientId);
      if (categoryFilter) params.set('category', categoryFilter);
      return api.get<AgeingResponse>(`/inventory/ageing?${params.toString()}`);
    },
  });

  const buckets = data?.buckets;
  const rows = (data?.rows ?? []).filter((r) => !bucketFilter || r.bucket === bucketFilter);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Hourglass size={22} className="text-[#E86F2C]" />
          Stock Ageing
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Idle stock in storage, grouped by how long it&apos;s been sitting there uninterrupted.
        </p>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-wrap items-end gap-3">
        {!isClientScoped && (
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Client</label>
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
            >
              <option value="">All clients</option>
              {clientsList.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white"
          >
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {bucketFilter && (
          <button
            onClick={() => setBucketFilter('')}
            className="text-xs text-gray-500 hover:text-gray-700 underline mb-1"
          >
            Clear bucket filter
          </button>
        )}
      </div>

      {/* ── Bucket summary tiles ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {BUCKET_ORDER.map((b) => (
          <button
            key={b}
            type="button"
            onClick={() => setBucketFilter((prev) => (prev === b ? '' : b))}
            className={`text-left bg-white rounded-xl border shadow-sm p-4 transition-colors ${
              bucketFilter === b
                ? 'border-[#E86F2C] ring-2 ring-[#E86F2C]/30'
                : 'border-gray-100 hover:border-gray-300'
            }`}
          >
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${BUCKET_COLORS[b]}`}
            >
              {BUCKET_LABELS[b]}
            </span>
            <p className="text-2xl font-bold text-gray-900 mt-2 tabular-nums">
              {buckets ? buckets[b] : '—'}
            </p>
          </button>
        ))}
      </div>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                <th className="text-left px-5 py-3">Asset</th>
                <th className="text-left px-5 py-3">Client</th>
                <th className="text-left px-5 py-3">Category</th>
                <th className="text-left px-5 py-3">Idle since</th>
                <th className="text-left px-5 py-3">Days idle</th>
                <th className="text-left px-5 py-3">Bucket</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-gray-50 hover:bg-orange-50/40 transition-colors"
                >
                  <td className="px-5 py-3.5">
                    <Link to={`/inventory/${r.id}`} className="group block">
                      <div className="font-mono text-xs font-semibold text-[#E86F2C] group-hover:underline">
                        {r.serialNumber}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {r.manufacturer} {r.model}
                        {r.assetTag ? ` · Tag: ${r.assetTag}` : ''}
                      </div>
                    </Link>
                  </td>
                  <td className="px-5 py-3.5 text-gray-700">{r.clientName}</td>
                  <td className="px-5 py-3.5 text-gray-700 capitalize">
                    {CATEGORY_LABELS[r.category] ?? r.category}
                  </td>
                  <td className="px-5 py-3.5 text-gray-500 text-xs whitespace-nowrap">
                    {new Date(r.idleSince).toLocaleDateString('en-IN')}
                  </td>
                  <td className="px-5 py-3.5 text-gray-900 font-semibold tabular-nums">
                    {r.daysIdle}
                  </td>
                  <td className="px-5 py-3.5">
                    <span
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${BUCKET_COLORS[r.bucket]}`}
                    >
                      {BUCKET_LABELS[r.bucket]}
                    </span>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-gray-400 text-sm">
                    No idle stock matches the selected filters.
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
