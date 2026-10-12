import { randomUUID } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { importJsonState } from '../../scripts/import-json-state';
import { buildDataSourceOptions } from '../../src/database/database.options';
import { CryptoBoxService, parseMasterKey } from '../../src/security/crypto-box.service';
import { FakeZatcaApiService } from '../../src/zatca/api/fake-zatca-api.service';
import { tokenToCertBase64 } from '../../src/zatca/crypto/certificate';
import { createSelfSignedCert, generateKeyAndCsr } from '../../src/zatca/crypto/csr';
import { signInvoice } from '../../src/zatca/crypto/signer';
import { buildInvoiceXml } from '../../src/zatca/xml/invoice-builder';
import { resetDatabase } from './helpers';

const SELLER = {
  name: 'شركة المحاكاة', vatNumber: '310123456700003', crn: '1010101010', street: 'طريق الملك فهد',
  buildingNumber: '1234', district: 'العليا', city: 'الرياض', postalCode: '12211',
};
const PREV_HASH = 'cHJldmlvdXMtaGFzaA==';

describe('scripts/import-json-state.ts', () => {
  let ds: DataSource;
  let box: CryptoBoxService;
  const fake = new FakeZatcaApiService();
  const dir = mkdtempSync(join(tmpdir(), 'zatca-import-'));
  const csr = generateKeyAndCsr({
    commonName: 'PRE-1', orgUnit: 'Main', orgName: SELLER.name, vatNumber: SELLER.vatNumber, solutionName: 'S',
    model: 'M', serial: 'X', invoiceType: '1100', location: 'L', industry: 'I', certTemplateName: 'PREZATCA-Code-Signing',
  });
  let legacy: Record<string, unknown>;
  let pendingXml: string;
  const pendingUuid = randomUUID();
  const env = async (name: string) => (await ds.query('select * from environments where env = $1', [name]))[0];

  beforeAll(async () => {
    await resetDatabase();
    ds = new DataSource(buildDataSourceOptions(process.env.DATABASE_URL));
    await ds.initialize();
    box = new CryptoBoxService(parseMasterKey(process.env.MASTER_KEY));

    // ملف قديم لوحدة مسجّلة في المحاكاة، فيها فاتورة معلّقة رقمها ICV=6
    const ccsid = (await fake.requestComplianceCsid('simulation', csr.csrBase64, '111222')).body;
    const compliance = { binarySecurityToken: ccsid.binarySecurityToken, secret: ccsid.secret, requestId: String(ccsid.requestID) };
    const pcsid = (await fake.requestProductionCsid('simulation', compliance)).body;
    const production = { binarySecurityToken: pcsid.binarySecurityToken, secret: pcsid.secret, requestId: String(pcsid.requestID) };
    const built = buildInvoiceXml(
      { id: 'OLD-7', uuid: pendingUuid, category: 'simplified', kind: 'credit', issueDate: '2026-10-11', issueTime: '09:30:00',
        icv: 6, pih: PREV_HASH, lines: [{ name: 'تمر', quantity: 2, unitPrice: 50 }], originalInvoiceId: 'OLD-1', reason: 'إرجاع' },
      SELLER,
    );
    const signed = signInvoice({ unsignedXml: built.unsignedXml, privateKeyPem: csr.privateKeyPem,
      certBase64: tokenToCertBase64(production.binarySecurityToken), qrFields: built.qrFields });
    pendingXml = signed.signedXml;
    legacy = {
      privateKeyPem: csr.privateKeyPem, csrPem: csr.csrPem, compliance, production,
      chain: { icv: 6, pih: signed.invoiceHash }, onboardedAt: '2026-10-01T08:00:00.000Z',
      pending: [{ id: 'OLD-7', uuid: pendingUuid, category: 'simplified', invoiceHash: signed.invoiceHash,
        xmlBase64: Buffer.from(pendingXml).toString('base64'), createdAt: '2026-10-11T06:30:00.000Z', lastError: 'fetch failed' }],
      localTest: { privateKeyPem: csr.privateKeyPem, certPem: createSelfSignedCert(csr.privateKeyPem) },
    };
    writeFileSync(join(dir, 'egs-simulation.json'), JSON.stringify(legacy));
    writeFileSync(join(dir, 'egs-core.json'), JSON.stringify({ chain: { icv: 0, pih: 'x' } }));
    writeFileSync(join(dir, 'unrelated.json'), '{}');
  });
  afterAll(async () => {
    fake.onModuleDestroy();
    await ds?.destroy();
  });

  it('--dry-run reports the plan and writes nothing', async () => {
    const reports = await importJsonState({ dir, ds, box, dryRun: true });
    expect(reports.map((r) => [r.env, r.action])).toEqual([['core', 'would-import'], ['simulation', 'would-import']]);
    expect(reports[1]).toMatchObject({ icv: 6, pending: 1, hasPrivateKey: true, hasProduction: true });
    expect(Number((await env('simulation')).icv)).toBe(0);
    expect((await ds.query('select count(*)::int as n from invoices'))[0].n).toBe(0);
  });

  it('imports secrets encrypted, the chain, and SELLER_*/EGS_* for ZATCA_ENV only', async () => {
    const vars = { ZATCA_ENV: 'simulation', SELLER_NAME: SELLER.name, SELLER_VAT: SELLER.vatNumber, EGS_INVOICE_TYPE: '1100' };
    const reports = await importJsonState({ dir, ds, box, vars });
    expect(reports.every((r) => r.action === 'imported')).toBe(true);
    expect(reports.find((r) => r.env === 'simulation')!.sellerFromEnv).toBe(true);

    const row = await env('simulation');
    expect([Number(row.icv), row.pih]).toEqual([6, (legacy.chain as { pih: string }).pih]);
    expect(row).toMatchObject({ seller_name: SELLER.name, seller_vat_number: SELLER.vatNumber, egs_invoice_type: '1100' });
    for (const col of ['private_key_enc', 'compliance_token_enc', 'production_secret_enc', 'local_test_key_enc']) {
      expect(row[col]).toMatch(/^v1:/);
    }
    expect(box.decrypt(row.private_key_enc, 'simulation:private_key_enc')).toBe(csr.privateKeyPem);
    expect(row.production_cert_not_after).not.toBeNull();
    expect(new Date(row.onboarded_at).toISOString()).toBe('2026-10-01T08:00:00.000Z');
    expect((await env('core')).seller_name).toBeNull();
  });

  it('each legacy pending item becomes a matching PENDING invoice, due now', async () => {
    const [inv] = await ds.query(`select * from invoices where env = 'simulation'`);
    expect(inv).toMatchObject({
      invoice_number: 'OLD-7', uuid: pendingUuid, status: 'PENDING', category: 'simplified', kind: 'credit',
      icv: '6', pih: PREV_HASH, issue_time: '09:30:00', attempts: 0, last_error: 'fetch failed', total_amount: '115.00',
    });
    expect(inv.signed_xml).toBe(pendingXml);
    expect(new Date(inv.next_retry_at).getTime()).toBeLessThanOrEqual(Date.now());
    expect(new Date(inv.created_at).toISOString()).toBe('2026-10-11T06:30:00.000Z');
  });

  it('a second run is refused', async () => {
    const reports = await importJsonState({ dir, ds, box });
    const sim = reports.find((r) => r.env === 'simulation')!;
    expect(sim.action).toBe('skipped');
    expect(sim.reason).toContain('--force');
    expect((await ds.query(`select count(*)::int as n from invoices`))[0].n).toBe(1);
  });
});
