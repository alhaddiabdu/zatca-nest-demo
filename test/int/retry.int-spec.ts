import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FakeZatcaApiService } from '../../src/zatca/api/fake-zatca-api.service';
import { ZatcaApi } from '../../src/zatca/api/zatca-api.port';
import { RetryService } from '../../src/zatca/submission/retry.service';
import { createTestApp } from './app';
import { resetDatabase } from './helpers';

const BUYER = {
  name: 'مؤسسة العميل', vatNumber: '300000000000003',
  address: { street: 'طريق الملك فهد', buildingNumber: '1234', district: 'العليا', city: 'الرياض', postalCode: '12211' },
};
const simplified = (id: string) => ({ id, category: 'simplified', lines: [{ name: 'قهوة', quantity: 1, unitPrice: 10 }] });
const standard = (id: string) => ({ id, category: 'standard', buyer: BUYER, lines: [{ name: 'خدمة', quantity: 1, unitPrice: 100 }] });

describe('Retrying PENDING invoices from PostgreSQL', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fake: FakeZatcaApiService;
  let retry: RetryService;
  const http = () => request(app.getHttpServer());
  const row = async (n: string) => (await ds.query('select * from invoices where invoice_number = $1 and not is_dry_run', [n]))[0];
  /** إصدار فواتير أثناء "توقف" الهيئة فتبقى PENDING */
  const issueDuringOutage = async (...bodies: object[]) => {
    fake.setOutage(true);
    for (const b of bodies) expect((await http().post('/zatca/invoices').send(b).expect(200)).body.status).toBe('PENDING');
    fake.setOutage(false);
  };

  beforeAll(async () => {
    await resetDatabase();
    delete process.env.ZATCA_ENV;
    app = await createTestApp();
    ds = app.get(DataSource);
    fake = app.get(ZatcaApi);
    retry = app.get(RetryService);
    await http().put('/zatca/mode').send({ mode: 'developer-portal' }).expect(200);
    await http().post('/zatca/onboard').send({}).expect(200);
  });
  afterAll(() => app?.close());

  it('manual retry sends PENDING invoices: simplified and standard → ACCEPTED, cleared_xml saved', async () => {
    await issueDuringOutage(simplified('R-1'), standard('R-2'));
    const res = await http().post('/zatca/invoices/retry-pending').expect(200);
    expect(res.body).toMatchObject({ attempted: 2, accepted: 2, rejected: 0, stillPending: 0 });
    expect(res.body.sent).toHaveLength(2);
    expect(await row('R-1')).toMatchObject({ status: 'ACCEPTED', attempts: 2, next_retry_at: null });
    const r2 = await row('R-2');
    expect(r2).toMatchObject({ status: 'ACCEPTED', submission_channel: 'clearance' });
    expect(r2.cleared_xml).toContain('<cbc:ID>R-2</cbc:ID>');
  });

  it('a retry answered with 400 → REJECTED and the row stays in the table', async () => {
    await issueDuringOutage(simplified('REJECT400-R'));
    const res = await retry.retryDue('developer-portal', { force: true });
    expect(res).toMatchObject({ attempted: 1, rejected: 1 });
    const r = await row('REJECT400-R');
    expect(r).toMatchObject({ status: 'REJECTED', http_status: 400, attempts: 2 });
  });

  it('still down → stays PENDING with a longer backoff', async () => {
    await issueDuringOutage(simplified('R-DOWN'));
    fake.setOutage(true);
    const res = await retry.retryDue('developer-portal', { force: true });
    fake.setOutage(false);
    expect(res).toMatchObject({ attempted: 1, stillPending: 1 });
    const r = await row('R-DOWN');
    expect(r).toMatchObject({ status: 'PENDING', attempts: 2 });
    const delta = new Date(r.next_retry_at).getTime() - Date.now();
    expect(delta).toBeGreaterThan(9 * 60_000); // backoff(2) = 10 دقائق
  });

  it('without force only due invoices are sent', async () => {
    expect((await retry.retryDue('developer-portal')).attempted).toBe(0);
    await ds.query(`update invoices set next_retry_at = now() - interval '1 minute' where invoice_number = 'R-DOWN'`);
    expect(await retry.retryDue('developer-portal')).toMatchObject({ attempted: 1, accepted: 1 });
  });

  it('two parallel retries never send the same invoice twice', async () => {
    await issueDuringOutage(simplified('P-1'), simplified('P-2'), simplified('P-3'), simplified('P-4'));
    const before = fake.calls.report ?? 0;
    const [a, b] = await Promise.all([
      retry.retryDue('developer-portal', { force: true }),
      retry.retryDue('developer-portal', { force: true }),
    ]);
    expect((fake.calls.report ?? 0) - before).toBe(4);
    expect(a.attempted + b.attempted).toBe(4);
    const statuses = await ds.query(`select status, attempts from invoices where invoice_number like 'P-%'`);
    expect(statuses.every((s: { status: string; attempts: number }) => s.status === 'ACCEPTED' && s.attempts === 2)).toBe(true);
  });

  it('dry runs are never sent', async () => {
    await http().post('/zatca/invoices?dryRun=true').send(simplified('DRY-R')).expect(200);
    expect((await retry.retryDue(undefined, { force: true })).attempted).toBe(0);
  });
});
