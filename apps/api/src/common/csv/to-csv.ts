// Quotes a field only when it contains a comma, quote, or newline, escaping
// embedded quotes by doubling them (RFC 4180) — needed here because asset
// fields like model/vendorName/referenceName are free text, unlike the
// mostly-numeric/id ledger export this pattern was first written for.
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(row.map(escapeCsvField).join(','));
  }
  return lines.join('\n');
}
