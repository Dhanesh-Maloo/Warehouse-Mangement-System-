/**
 * Parse a rupee amount typed by the user into integer paise (money is never a float
 * on the wire). Empty input means "no charge" and returns undefined; anything that is
 * not a non-negative number returns null so the caller can show an error.
 */
export function rupeesToPaise(input: string): number | undefined | null {
  const trimmed = input.trim().replace(/,/g, '');
  if (trimmed === '') return undefined;
  const rupees = Number(trimmed);
  if (!Number.isFinite(rupees) || rupees < 0) return null;
  return Math.round(rupees * 100);
}

/** Format an integer paise amount (number or numeric string from the API) as ₹ with Indian grouping. */
export function formatPaise(paise: number | string): string {
  return (Number(paise) / 100).toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 2,
  });
}
