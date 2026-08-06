import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { ShieldCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import { EmptyState } from '../../components/EmptyState';

interface AuditEntry {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  occurredAt: string;
  ipAddress: string | null;
  user: { id: string; fullName: string; email: string };
}
interface AuditResponse {
  data: AuditEntry[];
  total: number;
}

const ENTITY_COLORS: Record<string, string> = {
  user: 'bg-blue-100 text-blue-700',
  asset: 'bg-emerald-100 text-emerald-700',
  client: 'bg-purple-100 text-purple-700',
  rate_card: 'bg-amber-100 text-amber-700',
  disposal: 'bg-red-100 text-red-700',
};

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

const TAKE = 50;

export function AuditLogPage() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const params = new URLSearchParams();
  if (entity) params.set('entity', entity);
  if (action) params.set('action', action);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('skip', String(page * TAKE));
  params.set('take', String(TAKE));

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', entity, action, from, to, page],
    queryFn: () => api.get<AuditResponse>(`/audit-log?${params.toString()}`),
  });

  const entries = data?.data ?? [];
  const total = data?.total ?? 0;

  const inputCls =
    'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C] bg-white';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        <p className="text-sm text-gray-500 mt-1">
          Immutable record of every state change in the system
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={entity}
          onChange={(e) => {
            setEntity(e.target.value);
            setPage(0);
          }}
          className={inputCls}
        >
          <option value="">All entities</option>
          <option value="user">User</option>
          <option value="client">Client</option>
          <option value="asset">Asset</option>
          <option value="rate_card">Rate card</option>
          <option value="disposal">Disposal</option>
          <option value="inspection">Inspection</option>
        </select>
        <input
          value={action}
          onChange={(e) => {
            setAction(e.target.value);
            setPage(0);
          }}
          placeholder="Filter by action…"
          className={inputCls + ' w-44'}
        />
        <input
          type="date"
          value={from}
          onChange={(e) => {
            setFrom(e.target.value);
            setPage(0);
          }}
          className={inputCls}
          title="From date"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setPage(0);
          }}
          className={inputCls}
          title="To date"
        />
        {(entity || action || from || to) && (
          <button
            onClick={() => {
              setEntity('');
              setAction('');
              setFrom('');
              setTo('');
              setPage(0);
            }}
            className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-gray-400">Loading…</div>
      ) : entries.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
          <EmptyState
            icon={ShieldCheck}
            title="No audit events found"
            description="Audit events are recorded automatically as users take actions in the system."
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-gray-500 text-xs uppercase tracking-wide">
                  <th className="text-left px-5 py-3">When</th>
                  <th className="text-left px-5 py-3">User</th>
                  <th className="text-left px-5 py-3">Action</th>
                  <th className="text-left px-5 py-3">Entity</th>
                  <th className="text-left px-5 py-3">Entity ID</th>
                  <th className="text-left px-5 py-3">IP</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <>
                    <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-3 text-gray-600 text-xs whitespace-nowrap">
                        {fmtDateTime(e.occurredAt)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium text-gray-900 text-xs">{e.user.fullName}</div>
                        <div className="text-gray-400 text-xs">{e.user.email}</div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="font-mono text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                          {e.action}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ENTITY_COLORS[e.entity] ?? 'bg-gray-100 text-gray-600'}`}
                        >
                          {e.entity.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td
                        className="px-5 py-3 font-mono text-xs text-gray-500 max-w-[120px] truncate"
                        title={e.entityId}
                      >
                        {e.entityId.slice(0, 8)}…
                      </td>
                      <td className="px-5 py-3 text-xs text-gray-400">{e.ipAddress ?? '-'}</td>
                      <td className="px-5 py-3 text-right">
                        {(Boolean(e.oldValue) || Boolean(e.newValue)) && (
                          <button
                            onClick={() => setExpanded((prev) => (prev === e.id ? null : e.id))}
                            className="text-xs text-[#E86F2C] hover:underline"
                          >
                            {expanded === e.id ? 'Hide' : 'Diff'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === e.id && (
                      <tr key={`${e.id}-diff`} className="bg-gray-50">
                        <td colSpan={7} className="px-5 py-4">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-xs font-semibold text-gray-500 mb-1">Before</div>
                              <pre className="text-xs bg-white border border-gray-200 rounded p-3 overflow-auto max-h-40 text-gray-700">
                                {JSON.stringify(e.oldValue as Record<string, unknown>, null, 2)}
                              </pre>
                            </div>
                            <div>
                              <div className="text-xs font-semibold text-gray-500 mb-1">After</div>
                              <pre className="text-xs bg-white border border-gray-200 rounded p-3 overflow-auto max-h-40 text-gray-700">
                                {JSON.stringify(e.newValue as Record<string, unknown>, null, 2)}
                              </pre>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 text-sm text-gray-600">
            <span>
              {total === 0 ? '0' : `${page * TAKE + 1}–${Math.min((page + 1) * TAKE, total)}`} of{' '}
              {total} events
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="flex items-center gap-1 px-3 py-1 rounded border border-gray-300 disabled:opacity-40 text-sm hover:bg-gray-50"
              >
                <ChevronLeft size={14} />
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page + 1) * TAKE >= total}
                className="flex items-center gap-1 px-3 py-1 rounded border border-gray-300 disabled:opacity-40 text-sm hover:bg-gray-50"
              >
                Next
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
