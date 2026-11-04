import { computeTransportCharge, pricingFromClient } from './transport-pricing';

describe('computeTransportCharge', () => {
  const esevel = { markupBps: 1500, gstBps: 1800 };

  it('adds 15% then 18% GST on the sum: 1000 -> 1150 -> 1357', () => {
    const c = computeTransportCharge(BigInt(100000), esevel);
    expect(c.markupPaise).toBe(BigInt(15000));
    expect(c.gstPaise).toBe(BigInt(20700));
    expect(c.totalPaise).toBe(BigInt(135700));
  });

  it('keeps whole paise by rounding half up', () => {
    // 333 paise: markup 49.95 -> 50, GST on 383 = 68.94 -> 69
    const c = computeTransportCharge(BigInt(333), esevel);
    expect(c.markupPaise).toBe(BigInt(50));
    expect(c.gstPaise).toBe(BigInt(69));
    expect(c.totalPaise).toBe(BigInt(452));
  });

  it('bills the amount as typed when the client has no pricing', () => {
    const c = computeTransportCharge(BigInt(100000), null);
    expect(c.totalPaise).toBe(BigInt(100000));
  });

  it('returns zero for a zero amount', () => {
    expect(computeTransportCharge(BigInt(0), esevel).totalPaise).toBe(BigInt(0));
  });
});

describe('pricingFromClient', () => {
  it('is null when neither percentage is set', () => {
    expect(pricingFromClient({ transportMarkupBps: null, transportGstBps: null })).toBeNull();
    expect(pricingFromClient(null)).toBeNull();
  });
  it('treats a missing half as 0%', () => {
    expect(pricingFromClient({ transportMarkupBps: 1500, transportGstBps: null })).toEqual({
      markupBps: 1500,
      gstBps: 0,
    });
  });
});
