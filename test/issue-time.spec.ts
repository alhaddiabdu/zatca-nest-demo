import { createSelfSignedCert, generateKeyAndCsr } from '../src/zatca/crypto/csr';
import { pemToCertBase64 } from '../src/zatca/crypto/certificate';
import { INITIAL_PIH, signInvoice } from '../src/zatca/crypto/signer';
import { decodeQr } from '../src/zatca/crypto/qr';
import { utcIssueDateTime } from '../src/zatca/issue-time';
import { buildInvoiceXml } from '../src/zatca/xml/invoice-builder';

const seller = {
  name: 'شركة التجربة', vatNumber: '399999999900003', crn: '1010010000', street: 'شارع', buildingNumber: '1234',
  district: 'حي', city: 'الرياض', postalCode: '12345',
};

describe('utcIssueDateTime', () => {
  it('returns the UTC date and HH:mm:ssZ', () => {
    // 01:30 في الرياض يوم 13 = 22:30 UTC يوم 12
    expect(utcIssueDateTime(new Date('2026-10-12T22:30:05.900Z'))).toEqual({ date: '2026-10-12', time: '22:30:05Z' });
    expect(utcIssueDateTime().time).toMatch(/^\d{2}:\d{2}:\d{2}Z$/);
  });
});

describe('QR timestamp (tag 3)', () => {
  const { privateKeyPem } = generateKeyAndCsr({
    commonName: 't', orgUnit: 't', orgName: 't', vatNumber: seller.vatNumber, solutionName: 't', model: 't',
    serial: 't', invoiceType: '1100', location: 't', industry: 't', certTemplateName: 'TSTZATCA-Code-Signing',
  });
  const certBase64 = pemToCertBase64(createSelfSignedCert(privateKeyPem));

  it.each(['simplified', 'standard'] as const)('%s: equals IssueDate + "T" + IssueTime from the signed XML and ends with Z', (category) => {
    const { date, time } = utcIssueDateTime(new Date('2026-10-13T09:15:30Z'));
    const built = buildInvoiceXml(
      {
        id: 'T-1', uuid: '6f4d20e0-6bfe-4a80-9389-7dabe6620f12', category, kind: 'invoice',
        issueDate: date, issueTime: time, icv: 1, pih: INITIAL_PIH,
        buyer: category === 'standard'
          ? { name: 'مشترٍ', vatNumber: '300000000000003', address: { street: 'ش', buildingNumber: '1234', district: 'ح', city: 'الرياض', postalCode: '12211' } }
          : undefined,
        lines: [{ name: 'منتج', quantity: 1, unitPrice: 10 }],
      },
      seller,
    );
    const { signedXml, qr } = signInvoice({ unsignedXml: built.unsignedXml, privateKeyPem, certBase64, qrFields: built.qrFields });

    const issueDate = signedXml.match(/<cbc:IssueDate>([^<]+)</)![1];
    const issueTime = signedXml.match(/<cbc:IssueTime>([^<]+)</)![1];
    expect([issueDate, issueTime]).toEqual(['2026-10-13', '09:15:30Z']);

    const tag3 = decodeQr(qr)[3];
    expect(tag3).toBe(`${issueDate}T${issueTime}`);
    expect(tag3).toBe('2026-10-13T09:15:30Z');
    expect(tag3.endsWith('Z')).toBe(true);
  });
});
