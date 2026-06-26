import { useQuery } from '@tanstack/react-query';
import type { HealthResponse } from '@warehouse/shared';

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`API responded with HTTP ${res.status}`);
  return res.json() as Promise<HealthResponse>;
}

export function HomePage() {
  const { data, isLoading, isError, error } = useQuery<HealthResponse, Error>({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
  });

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-8">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">Warehouse Management</h1>
          <p className="mt-1 text-sm text-slate-500">IValue India</p>
        </div>

        {isLoading && (
          <div className="flex items-center gap-2 text-slate-500">
            <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-slate-400" />
            <span className="text-sm">Checking API…</span>
          </div>
        )}

        {isError && (
          <div className="rounded-lg bg-red-50 p-4">
            <div className="flex items-center gap-2">
              <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
              <span className="text-sm font-medium text-red-700">API Unreachable</span>
            </div>
            <p className="mt-1 text-xs text-red-600">{error.message}</p>
            <p className="mt-1 text-xs text-red-500">
              Make sure the API is running: <code>pnpm dev</code>
            </p>
          </div>
        )}

        {data && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  data.status === 'ok' ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <span className="text-sm font-medium text-slate-800">
                {data.status === 'ok' ? 'API Online' : 'API Degraded'}
              </span>
            </div>

            <dl className="divide-y divide-slate-100 rounded-lg border border-slate-100 text-sm">
              <div className="flex justify-between px-4 py-2.5">
                <dt className="text-slate-500">Database</dt>
                <dd
                  className={`font-medium ${
                    data.database === 'ok' ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {data.database}
                </dd>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <dt className="text-slate-500">Uptime</dt>
                <dd className="font-medium text-slate-700">{Math.round(data.uptime)}s</dd>
              </div>
              <div className="flex justify-between px-4 py-2.5">
                <dt className="text-slate-500">Last checked</dt>
                <dd className="font-medium text-slate-700">
                  {new Date(data.timestamp).toLocaleTimeString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                  })}
                  {' IST'}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
