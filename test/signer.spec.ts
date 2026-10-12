import { createVerify, X509Certificate } from 'crypto';
import { createSelfSignedCert, generateKeyAndCsr } from '../src/zatca/crypto/csr';
import { certBase64ToPem, pemToCertBase64 } from '../src/zatca/crypto/certificate';
import { computeInvoiceHash, INITIAL_PIH, signInvoice } from '../src/zatca/crypto/signer';
import { decodeQr } from '../src/zatca/crypto/qr';
import { buildInvoiceXml } from '../src/zatca/xml/invoice-builder';

const seller = {
  name: 'شركة التجربة', vatNumber: '399999999900003', crn: '1010010000', street: 'شارع', buildingNumber: '1234',
  district: 'حي', city: 'الرياض', postalCode: '12345',
};

describe('ZATCA signing', () => {
  const { privateKeyPem } = generateKeyAndCsr({
    commonName: 't', orgUnit: 't', orgName: 't', vatNumber: seller.vatNumber, solutionName: 't', model: 't',
    serial: 't', invoiceType: '1100', location: 't', industry: 't', certTemplateName: 'TSTZATCA-Code-Signing',
  });
  const certBase64 = pemToCertBase64(createSelfSignedCert(privateKeyPem));

  const built = buildInvoiceXml(
    {
      id: 'T-1', uuid: '6f4d20e0-6bfe-4a80-9389-7dabe6620f12', category: 'simplified', kind: 'invoice',
      issueDate: '2026-10-12', issueTime: '10:00:00', icv: 1, pih: INITIAL_PIH,
      lines: [{ name: 'منتج', quantity: 3, unitPrice: 33.33 }],
    },
    seller,
  );
  const signed = signInvoice({ unsignedXml: built.unsignedXml, privateKeyPem, certBase64, qrFields: built.qrFields });

  it('computes correct totals', () => {
    expect(built.totals).toEqual({ net: 99.99, vat: 15, total: 114.99 });
  });

  it('hash is unchanged after embedding signature and QR', () => {
    expect(computeInvoiceHash(signed.signedXml)).toBe(signed.invoiceHash);
  });

  it('signature verifies with the certificate public key', () => {
    const cert = new X509Certificate(certBase64ToPem(certBase64));
    const v = createVerify('sha256');
    v.update(Buffer.from(signed.invoiceHash, 'base64'));
    expect(v.verify(cert.publicKey, Buffer.from(signed.signature, 'base64'))).toBe(true);
  });

  it('QR contains the expected tags', () => {
    const qr = decodeQr(signed.qr);
    expect(qr[1]).toBe(seller.name);
    expect(qr[3]).toBe('2026-10-12T10:00:00');
    expect(qr[4]).toBe('114.99');
    expect(qr[6]).toBe(signed.invoiceHash);
    expect(qr[9]).toBeDefined();
  });
});
