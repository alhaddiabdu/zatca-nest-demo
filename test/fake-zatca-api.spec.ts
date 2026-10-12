import { ServiceUnavailableException } from '@nestjs/common';
import { createVerify, X509Certificate } from 'crypto';
import { FakeZatcaApiService } from '../src/zatca/api/fake-zatca-api.service';
import { certBase64ToPem, tokenToCertBase64 } from '../src/zatca/crypto/certificate';
import { generateKeyAndCsr } from '../src/zatca/crypto/csr';
import { INITIAL_PIH, signInvoice } from '../src/zatca/crypto/signer';
import { buildInvoiceXml } from '../src/zatca/xml/invoice-builder';
import { InvoiceCategory } from '../src/zatca/xml/invoice.types';

const seller = {
  name: 'شركة التجربة', vatNumber: '399999999900003', crn: '1010010000', street: 'شارع', buildingNumber: '1234',
  district: 'حي', city: 'الرياض', postalCode: '12345',
};
const buyer = {
  name: 'عميل', vatNumber: '300000000000003',
  address: { street: 'طريق', buildingNumber: '1234', district: 'حي', city: 'الرياض', postalCode: '12211' },
};

describe('FakeZatcaApiService', () => {
  const fake = new FakeZatcaApiService();
  const csr = generateKeyAndCsr({
    commonName: 'TST-1-399999999900003', orgUnit: 'Branch', orgName: seller.name, vatNumber: seller.vatNumber,
    solutionName: 'S', model: 'M', serial: 'X', invoiceType: '1100', location: 'L', industry: 'I',
    certTemplateName: 'TSTZATCA-Code-Signing',
  });
  let compliance: { binarySecurityToken: string; secret: string; requestId: string };

  afterAll(() => fake.onModuleDestroy());

  const signed = (id: string, category: InvoiceCategory = 'simplified', token = compliance.binarySecurityToken) => {
    const built = buildInvoiceXml(
      {
        id, uuid: '6f4d20e0-6bfe-4a80-9389-7dabe6620f12', category, kind: 'invoice',
        issueDate: '2026-10-12', issueTime: '10:00:00', icv: 1, pih: INITIAL_PIH,
        buyer: category === 'standard' ? buyer : undefined,
        lines: [{ name: 'منتج', quantity: 1, unitPrice: 100 }],
      },
      seller,
    );
    const certBase64 = tokenToCertBase64(token);
    const s = signInvoice({ unsignedXml: built.unsignedXml, privateKeyPem: csr.privateKeyPem, certBase64, qrFields: built.qrFields });
    return { ...s, certBase64, body: { invoiceHash: s.invoiceHash, uuid: 'u', invoice: Buffer.from(s.signedXml).toString('base64') } };
  };

  it('issues a compliance CSID signed by the local CA for the CSR key', async () => {
    const res = await fake.requestComplianceCsid('developer-portal', csr.csrBase64, '123345');
    expect(res.status).toBe(200);
    compliance = { binarySecurityToken: res.body.binarySecurityToken, secret: res.body.secret, requestId: String(res.body.requestID) };
    const cert = new X509Certificate(certBase64ToPem(tokenToCertBase64(compliance.binarySecurityToken)));
    expect(cert.issuer).toContain('Fake ZATCA Local CA');
    expect(cert.subject).toContain('TST-1-399999999900003');
  });

  it('a certificate from the fake signs invoices with the unchanged signer', () => {
    const s = signed('INV-1');
    const cert = new X509Certificate(certBase64ToPem(s.certBase64));
    const v = createVerify('sha256');
    v.update(Buffer.from(s.invoiceHash, 'base64'));
    expect(v.verify(cert.publicKey, Buffer.from(s.signature, 'base64'))).toBe(true);
  });

  it('rejects an invalid OTP with 400', async () => {
    expect((await fake.requestComplianceCsid('simulation', csr.csrBase64, '12')).status).toBe(400);
  });

  it('passes compliance checks, standard → CLEARED, simplified → REPORTED', async () => {
    const std = await fake.complianceCheck('developer-portal', compliance, signed('C-1', 'standard').body);
    expect(std).toMatchObject({ status: 200, body: { clearanceStatus: 'CLEARED', validationResults: { status: 'PASS' } } });
    const simp = await fake.complianceCheck('developer-portal', compliance, signed('C-2').body);
    expect(simp.body.reportingStatus).toBe('REPORTED');
  });

  it('issues a production CSID for the same key', async () => {
    const res = await fake.requestProductionCsid('developer-portal', compliance);
    expect(res.status).toBe(200);
    const prod = new X509Certificate(certBase64ToPem(tokenToCertBase64(res.body.binarySecurityToken)));
    const comp = new X509Certificate(certBase64ToPem(tokenToCertBase64(compliance.binarySecurityToken)));
    expect(prod.publicKey.export({ type: 'spki', format: 'der' })).toEqual(comp.publicKey.export({ type: 'spki', format: 'der' }));
    expect(prod.serialNumber).not.toBe(comp.serialNumber);
  });

  it('unknown compliance request → 400', async () => {
    const res = await fake.requestProductionCsid('developer-portal', { ...compliance, requestId: 'nope' });
    expect(res.status).toBe(400);
  });

  it('reporting: normal → 200 REPORTED', async () => {
    const res = await fake.report('developer-portal', compliance, signed('INV-OK-1').body);
    expect(res).toMatchObject({ status: 200, ok: true, body: { reportingStatus: 'REPORTED' } });
  });

  it('clearance returns clearedInvoice', async () => {
    const s = signed('INV-STD-1', 'standard');
    const res = await fake.clear('developer-portal', compliance, s.body);
    expect(res).toMatchObject({ status: 200, body: { clearanceStatus: 'CLEARED', clearedInvoice: s.body.invoice } });
  });

  it('special invoice numbers produce 503, 400 and 202', async () => {
    expect(await fake.report('core', compliance, signed('INV-FAIL503-1').body)).toMatchObject({ status: 503, ok: false });
    const rej = await fake.report('core', compliance, signed('INV-REJECT400-1').body);
    expect(rej.status).toBe(400);
    expect(rej.body.validationResults.errorMessages[0].code).toBe('FAKE-REJECTED');
    const warn = await fake.clear('core', compliance, signed('INV-WARN202-1', 'standard').body);
    expect(warn).toMatchObject({ status: 202, ok: true, body: { validationResults: { status: 'WARNING' } } });
  });

  it('TIMEOUT throws ServiceUnavailableException like a network failure', async () => {
    await expect(fake.report('core', compliance, signed('INV-TIMEOUT-1').body)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('counts calls per method', () => {
    expect(fake.calls.report).toBeGreaterThanOrEqual(4);
    expect(fake.calls.requestComplianceCsid).toBe(2);
  });
});
