import { formatChallanAddress, formatChallanContact } from './deployment-challan-format';

describe('formatChallanAddress', () => {
  it('includes both street lines, city, state and pincode', () => {
    expect(
      formatChallanAddress({
        line1: 'Wise Payments India Pvt. Ltd., Floor 5, Raheja Minspace IT Park',
        line2: 'Hitech City Phase - II, Madhapur',
        city: 'Hyderabad',
        state: 'Telangana',
        pincode: '500081',
      }),
    ).toBe(
      'Wise Payments India Pvt. Ltd., Floor 5, Raheja Minspace IT Park, Hitech City Phase - II, Madhapur, Hyderabad, Telangana, 500081',
    );
  });

  it('skips a missing line2', () => {
    expect(
      formatChallanAddress({
        line1: '12 MG Road',
        city: 'Pune',
        state: 'Maharashtra',
        pincode: '411001',
      }),
    ).toBe('12 MG Road, Pune, Maharashtra, 411001');
  });
});

describe('formatChallanContact', () => {
  it('joins name and phone', () => {
    expect(formatChallanContact('Asha', '9999999999')).toBe('Asha · 9999999999');
  });

  it('shows only the phone when the contact name is empty', () => {
    expect(formatChallanContact('', '8976895136')).toBe('8976895136');
  });
});
