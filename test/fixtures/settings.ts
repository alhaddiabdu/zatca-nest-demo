/** إعدادات منشأة صحيحة لوضع المحاكاة (بيانات تجريبية) */
export const validSettings = () => ({
  seller: {
    name: 'شركة المحاكاة', vatNumber: '310123456700003', crn: '1010101010', street: 'طريق الملك فهد',
    buildingNumber: '1234', district: 'العليا', city: 'الرياض', postalCode: '12211',
  },
  egs: {
    commonName: 'PRE-1-310123456700003', orgUnit: 'Main Branch', solutionName: 'MyERP', model: 'NestDemo',
    serial: 'abc-123', invoiceType: '1100', location: 'RRRD2929', industry: 'Retail',
  },
});
