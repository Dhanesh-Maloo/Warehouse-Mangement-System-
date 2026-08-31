import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { Search, Ticket, Receipt } from 'lucide-react';

interface LedgerEvent {
  eventType: string;
  amountPaise: string;
  occurredAt: string;
}

interface TicketLookupItem {
  module: 'inbound' | 'retrieval' | 'inspection' | 'deployment' | 'disposal' | 'repair';
  id: string;
  ivalueTicketNumber: string | null;
  clientTicketNumber: string | null;
  workDescription: string;
  status: string;
  date: string;
  asset: { serialNumber: string; model: string; manufacturer: string } | null;
  ledgerEvents: LedgerEvent[];
  amountPaise: string;
}

interface TicketLookupResult {
  query: string;
  items: TicketLookupItem[];
  totalAmountPaise: string;
}

const MODULE_LABELS: Record<TicketLookupItem['module'], string> = {
  inbound: 'Inbound',
  retrieval: 'Retrieval',
  inspection: 'Inspection',
  deployment: 'Deployment',
  disposal: 'Disposal',
  repair: 'Repair',
};

const MODULE_COLORS: Record<TicketLookupItem['module'], string> = {
  inbound: 'bg-sky-100 text-sky-700',
  retrieval: 'bg-amber-100 text-amber-700',
  inspection: 'bg-purple-100 text-purple-700',
  deployment: 'bg-[#E86F2C]/10 text-[#E86F2C]',
  disposal: 'bg-gray-100 text-gray-600',
  repair: 'bg-blue-100 text-blue-700',
};

const MODULE_LINK: Record<TicketLookupItem['module'], (id: string) => string> = {
  inbound: (id) => `/inbound/${id}`,
  retrieval: () => `/retrieval`,
  inspection: (id) => `/inspections/${id}`,
  deployment: () => `/deployment`,
  disposal: () => `/disposal`,
  repair: () => `/repair`,
};

const CURRENCY_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
});

function formatPaise(paise: string | number): string {
  return CURRENCY_FORMATTER.format(Number(paise) / 100);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function TicketLookupPage() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const { data, isLoading, isFetched } = useQuery({
    queryKey: ['ticket-lookup', query],
    queryFn: () => api.get<TicketLookupResult>(`/ticket-lookup?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length > 0,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setQuery(search.trim());
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Ticket Lookup</h1>
        <p className="text-sm text-gray-500 mt-1">
          Search by IValue or client ticket number to see what work was done and its total cost.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex gap-3">
        <div className="relative flex-1 max-w-lg">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Enter IValue or client ticket number…"
            className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#E86F2C]"
          />
        </div>
        <button
          type="submit"
          disabled={!search.trim()}
          className="px-5 py-2 bg-[#E86F2C] text-white rounded-lg text-sm font-medium hover:bg-[#d4621f] disabled:opacity-50 transition-colors"
        >
          Search
        </button>
      </form>

      {isLoading && <div className="text-sm text-gray-400">Searching…</div>}

      {!isLoading && isFetched && data && (
        <>
          {data.items.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Ticket size={24} className="mx-auto mb-2 text-gray-300" />
              No work found for ticket &quot;{data.query}&quot;.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">
                    {data.items.length} matching record{data.items.length !== 1 ? 's' : ''} for
                    &quot;{data.query}&quot;
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400">Total amount</p>
                  <p className="text-xl font-semibold text-gray-900">
                    {formatPaise(data.totalAmountPaise)}
                  </p>
                </div>
              </div>

              {data.items.map((item) => (
                <div
                  key={`${item.module}-${item.id}`}
                  className="bg-white rounded-xl border border-gray-100 shadow-sm p-5"
                >
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${MODULE_COLORS[item.module]}`}
                        >
                          {MODULE_LABELS[item.module]}
                        </span>
                        <span className="text-xs text-gray-400 capitalize">
                          {item.status.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-gray-400">{fmtDate(item.date)}</span>
                      </div>
                      <Link
                        to={MODULE_LINK[item.module](item.id)}
                        className="text-sm font-medium text-gray-900 hover:text-[#E86F2C] hover:underline"
                      >
                        {item.workDescription}
                      </Link>
                      {item.asset && (
                        <p className="text-xs text-gray-500 mt-1 font-mono">
                          {item.asset.serialNumber} · {item.asset.manufacturer} {item.asset.model}
                        </p>
                      )}
                      <div className="flex gap-4 mt-2 text-xs text-gray-400">
                        {item.ivalueTicketNumber && <span>IValue: {item.ivalueTicketNumber}</span>}
                        {item.clientTicketNumber && <span>Client: {item.clientTicketNumber}</span>}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Amount</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {formatPaise(item.amountPaise)}
                      </p>
                    </div>
                  </div>

                  {item.ledgerEvents.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                        <Receipt size={12} />
                        Ledger events
                      </div>
                      <div className="space-y-1">
                        {item.ledgerEvents.map((ev, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs text-gray-600"
                          >
                            <span>
                              {ev.eventType} · {fmtDate(ev.occurredAt)}
                            </span>
                            <span
                              className={Number(ev.amountPaise) < 0 ? 'text-red-500' : undefined}
                            >
                              {formatPaise(ev.amountPaise)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
