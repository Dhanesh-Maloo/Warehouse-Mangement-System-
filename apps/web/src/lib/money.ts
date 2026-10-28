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
