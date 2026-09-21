import { toCsv } from './to-csv';

describe('toCsv', () => {
  it('joins header and rows with commas', () => {
    const csv = toCsv(
      ['serialNumber', 'model'],
      [
        ['SN-1', 'Latitude 5540'],
        ['SN-2', 'ThinkPad T14'],
      ],
    );
    expect(csv).toBe('serialNumber,model\nSN-1,Latitude 5540\nSN-2,ThinkPad T14');
  });

  it('quotes fields containing a comma, quote, or newline', () => {
    const csv = toCsv(['model'], [['Latitude, 5540'], ['Model "Pro"'], ['Line1\nLine2']]);
    expect(csv).toBe('model\n"Latitude, 5540"\n"Model ""Pro"""\n"Line1\nLine2"');
  });

  it('renders null/undefined fields as empty strings', () => {
    const csv = toCsv(['a', 'b'], [[null, undefined]]);
    expect(csv).toBe('a,b\n,');
  });

  it('serializes Date fields as ISO strings', () => {
    const date = new Date('2026-09-01T00:00:00.000Z');
    const csv = toCsv(['createdAt'], [[date]]);
    expect(csv).toBe('createdAt\n2026-09-01T00:00:00.000Z');
  });
});
