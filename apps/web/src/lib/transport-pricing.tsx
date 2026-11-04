import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { formatPaise, rupeesToPaise } from './money';

/** Transport pricing configured on a client, in basis points (1500 = 15%). */
export interface TransportPricing {
  markupBps: number;
  gstBps: number;
}

/** Fetches the client's transport pricing; null when the client bills the typed amount as is. */
export function useTransportPricing(clientId: string | undefined): TransportPricing | null {
  const { data } = useQuery({
    queryKey: ['transport-pricing', clientId],
    enabled: !!clientId,
    queryFn: () =>
      api.get<{ markupBps: number | null; gstBps: number | null }>(
        `/clients/${clientId}/transport-pricing`,
      ),
  });
  if (!data || (data.markupBps == null && data.gstBps == null)) return null;
  return { markupBps: data.markupBps ?? 0, gstBps: data.gstBps ?? 0 };
}

/** Half-up integer percentage, mirroring the API so the preview matches what is billed. */
function percentOf(paise: number, bps: number): number {
  return Math.floor((paise * bps + 5000) / 10000);
}

/** Typed amount -> billed amount: add the markup, then GST on that sum. */
export function transportTotalPaise(basePaise: number, pricing: TransportPricing | null): number {
  if (!pricing) return basePaise;
  const markup = percentOf(basePaise, pricing.markupBps);
  return basePaise + markup + percentOf(basePaise + markup, pricing.gstBps);
}

const pct = (bps: number): string => `${bps / 100}%`;

/** Live breakdown shown under a transport input: typed amount + markup + GST = amount billed. */
export function TransportBreakdown({
  amount,
  pricing,
}: {
  amount: string;
  pricing: TransportPricing | null;
}) {
  const base = rupeesToPaise(amount);
  if (!pricing || !base) return null;
  const markup = percentOf(base, pricing.markupBps);
  const gst = percentOf(base + markup, pricing.gstBps);
  return (
    <div className="mt-2 rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-gray-700 space-y-0.5">
      <div className="flex justify-between">
        <span>Amount entered</span>
        <span className="tabular-nums">{formatPaise(base)}</span>
      </div>
      <div className="flex justify-between">
        <span>+ {pct(pricing.markupBps)}</span>
        <span className="tabular-nums">{formatPaise(markup)}</span>
      </div>
      <div className="flex justify-between">
        <span>+ {pct(pricing.gstBps)} GST on {formatPaise(base + markup)}</span>
        <span className="tabular-nums">{formatPaise(gst)}</span>
      </div>
      <div className="flex justify-between border-t border-orange-200 pt-1 font-semibold text-gray-900">
        <span>Amount billed</span>
        <span className="tabular-nums">{formatPaise(base + markup + gst)}</span>
      </div>
    </div>
  );
}
