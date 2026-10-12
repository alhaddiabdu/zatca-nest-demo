import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FakeZatcaApiService } from '../../src/zatca/api/fake-zatca-api.service';
import { ZatcaApi } from '../../src/zatca/api/zatca-api.port';
import { createTestApp } from './app';
import { resetDatabase } from './helpers';

const BUYER = {
  name: 'مؤسسة العميل', vatNumber: '300000000000003',
  address: { street: 'طريق الملك فهد', buildingNumber: '1234', district: 'العليا', city: 'الرياض', postalCode: '12211' },
};

describe('GET /zatca/invoices, /:id and /:id/xml', () => {
  let app: INestApplication;
  let ds: DataSource;
  let stdId: string;
  let pendingId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await resetDatabase();
    delete process.env.ZATCA_ENV;
    app = await createTestApp();
    ds = app.get(DataSource);
    const fake = app.get(ZatcaApi) as FakeZatcaApiService;
    await http().put('/zatca/mode').send({ mode: 'developer-portal' }).expect(200);
    await http().post('/zatca/onboard').send({}).expect(200);

    // فاتورتان عبر الـ API: قياسية معتمدة، ومبسطة معلّقة
    stdId = (await http().post('/zatca/invoices').send({ id: 'INV-STD', category: 'standard', buyer: BUYER, lines: [{ name: 'خدمة', quantity: 1, unitPrice: 100 }] })).body.invoiceId;
    fake.setOutage(true);
    pendingId = (await http().post('/zatca/invoices').send({ id: 'INV-PEND', category: 'simplified', lines: [{ name: 'قهوة', quantity: 1, unitPrice: 10 }] })).body.invoiceId;
    fake.setOutage(false);
    await http().post('/zatca/invoices?dryRun=true').send({ id: 'DRY-1', category: 'simplified', lines: [{ name: 'قهوة', quantity: 1, unitPrice: 10 }] }).expect(200);

    // 23 فاتورة مقبولة إضافية مباشرة في الجدول (المجموع 25 فعلية في بوابة المطورين)
    await ds.query(`
      insert into invoices (env, invoice_number, uuid, category, kind, chain_epoch, icv, invoice_hash, issue_date, issue_time, lines, status, signed_xml, qr, total_amount)
      select 'developer-portal', 'BULK-' || g, gen_random_uuid(), 'simplified', 'invoice', 1, 100 + g, 'h', ('2026-10-0' || (1 + g % 9))::date, '10:00:00', '[]', 'ACCEPTED', '<x/>', 'q', 11.50
      from generate_series(1, 23) g`);
    await ds.query(`
      insert into invoices (env, invoice_number, uuid, category, kind, invoice_hash, issue_date, issue_time, lines, status, signed_xml, qr)
      values ('simulation', 'SIM-1', gen_random_uuid(), 'standard', 'credit', 'h', '2026-10-12', '10:00:00', '[]', 'REJECTED', '<x/>', 'q')`);
  });
  afterAll(() => app?.close());

  it('25 invoices → page 2 of size 20 has 5 items and total=25', async () => {
    const { body } = await http().get('/zatca/invoices?page=2&pageSize=20').expect(200);
    expect(body).toMatchObject({ env: 'developer-portal', total: 25, page: 2, pageSize: 20 });
    expect(body.items).toHaveLength(5);
    expect(body.items[0].signedXml).toBeUndefined();
  });

  it('default page size is 20, dry runs hidden unless asked', async () => {
    expect((await http().get('/zatca/invoices').expect(200)).body.items).toHaveLength(20);
    expect((await http().get('/zatca/invoices?includeDryRun=true').expect(200)).body.total).toBe(26);
    expect((await http().get('/zatca/invoices?status=DRY_RUN').expect(200)).body.total).toBe(1);
  });

  it('status=PENDING returns only pending', async () => {
    const { body } = await http().get('/zatca/invoices?status=PENDING').expect(200);
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: pendingId, status: 'PENDING', attempts: 1 });
  });

  it('filters by category, kind, search, dates and mode', async () => {
    expect((await http().get('/zatca/invoices?category=standard')).body.total).toBe(1);
    expect((await http().get('/zatca/invoices?q=std')).body.items[0].invoiceNumber).toBe('INV-STD');
    expect((await http().get('/zatca/invoices?q=BULK-1')).body.total).toBe(11); // BULK-1 و BULK-10..19
    expect((await http().get('/zatca/invoices?from=2026-10-01&to=2026-10-02')).body.total).toBeGreaterThan(0);
    const sim = (await http().get('/zatca/invoices?env=simulation').expect(200)).body;
    expect(sim).toMatchObject({ env: 'simulation', total: 1 });
    expect(sim.items[0]).toMatchObject({ kind: 'credit', status: 'REJECTED' });
  });

  it('validates the query: pageSize=500 → 400, page=0 → 400, unknown status → 400', async () => {
    await http().get('/zatca/invoices?pageSize=500').expect(400);
    await http().get('/zatca/invoices?page=0').expect(400);
    await http().get('/zatca/invoices?status=SENT').expect(400);
    await http().get('/zatca/invoices?from=12-10-2026').expect(400);
  });

  it('details: response, QR image, no full XML; unknown → 404, invalid id → 400', async () => {
    const { body } = await http().get(`/zatca/invoices/${stdId}`).expect(200);
    expect(body).toMatchObject({ invoiceNumber: 'INV-STD', status: 'ACCEPTED', hasClearedXml: true, submissionChannel: 'clearance' });
    expect(body.qrImage).toMatch(/^data:image\/png;base64,/);
    expect(body.zatcaResponse.clearanceStatus).toBe('CLEARED');
    expect(body.signedXml).toBeUndefined();
    await http().get('/zatca/invoices/6f4d20e0-6bfe-4a80-9389-7dabe6620f12').expect(404);
    await http().get('/zatca/invoices/not-a-uuid').expect(400);
  });

  it('cleared XML is returned as application/xml; signed version too', async () => {
    const cleared = await http().get(`/zatca/invoices/${stdId}/xml?version=cleared`).expect(200);
    expect(cleared.headers['content-type']).toContain('application/xml');
    expect(cleared.text).toContain('<cbc:ID>INV-STD</cbc:ID>');
    const signed = await http().get(`/zatca/invoices/${stdId}/xml?version=signed`).expect(200);
    expect(signed.text).toContain('<ds:SignatureValue>');
  });

  it('cleared version of a pending invoice → 404', async () => {
    await http().get(`/zatca/invoices/${pendingId}/xml?version=cleared`).expect(404);
    await http().get(`/zatca/invoices/${pendingId}/xml`).expect(200);
  });

  it('temporary compatibility: lookup by invoice number in the active mode', async () => {
    expect((await http().get('/zatca/invoices/INV-STD/xml').expect(200)).text).toContain('INV-STD');
    expect((await http().get('/zatca/invoices/DRY-1/xml?dryRun=true').expect(200)).text).toContain('DRY-1');
    await http().get('/zatca/invoices/NOPE/xml').expect(404);
  });
});
