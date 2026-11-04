/** Transport pricing configured on a client, in basis points (1500 = 15%). */
export interface TransportPricing {
  markupBps: number;
  gstBps: number;
}

export interface TransportCharge {
  basePaise: bigint;
  markupPaise: bigint;
  gstPaise: bigint;
  /** What goes to billing: base + markup + GST on (base + markup). */
  totalPaise: bigint;
}

/** Integer division with half-up rounding, so every amount stays whole paise. */
function percentOf(amount: bigint, bps: number): bigint {
  return (amount * BigInt(bps) + BigInt(5000)) / BigInt(10000);
}

/**
 * Turn the amount the operator typed into the amount billed: add the markup, then charge GST on
 * that sum (so GST also applies to the markup). Without pricing the amount is billed as typed.
 */
export function computeTransportCharge(
  basePaise: bigint,
  pricing: TransportPricing | null,
): TransportCharge {
  if (!pricing) {
    return { basePaise, markupPaise: BigInt(0), gstPaise: BigInt(0), totalPaise: basePaise };
  }
  const markupPaise = percentOf(basePaise, pricing.markupBps);
  const gstPaise = percentOf(basePaise + markupPaise, pricing.gstBps);
  return { basePaise, markupPaise, gstPaise, totalPaise: basePaise + markupPaise + gstPaise };
}

/** Pricing from a client row, or null when the client has none configured. */
export function pricingFromClient(
  client: { transportMarkupBps: number | null; transportGstBps: number | null } | null,
): TransportPricing | null {
  if (!client || (client.transportMarkupBps == null && client.transportGstBps == null)) return null;
  return { markupBps: client.transportMarkupBps ?? 0, gstBps: client.transportGstBps ?? 0 };
}

const rupees = (paise: bigint): string => `₹${(Number(paise) / 100).toFixed(2)}`;
const pct = (bps: number): string => `${bps / 100}%`;

/** One-line breakdown for ledger notes, e.g. "Base ₹1000.00 + 15% ₹150.00 + 18% GST ₹207.00". */
export function describeTransportCharge(c: TransportCharge, pricing: TransportPricing | null): string {
  if (!pricing) return '';
  return `Base ${rupees(c.basePaise)} + ${pct(pricing.markupBps)} ${rupees(c.markupPaise)} + ${pct(pricing.gstBps)} GST ${rupees(c.gstPaise)}`;
}
