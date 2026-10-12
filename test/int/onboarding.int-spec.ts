import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../../src/database/database.module';
import { FakeZatcaApiService } from '../../src/zatca/api/fake-zatca-api.service';
import { ZatcaApi } from '../../src/zatca/api/zatca-api.port';
import { ZatcaModule } from '../../src/zatca/zatca.module';
import { validSettings } from '../fixtures/settings';
import { resetDatabase } from './helpers';

/** التسجيل عبر الـ API الحقيقي للتطبيق، مع الناقل الوهمي (لا اتصال بالهيئة) */
describe('POST /zatca/onboard (PostgreSQL + fake transport)', () => {
  let app: INestApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());
  const env = async (name: string) => (await ds.query('select * from environments where env = $1', [name]))[0];

  beforeAll(async () => {
    await resetDatabase();
    delete process.env.ZATCA_ENV;
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), DatabaseModule, ZatcaModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);
    expect(app.get(ZatcaApi)).toBeInstanceOf(FakeZatcaApiService);
  });
  afterAll(() => app?.close());

  it('without an active mode → 409 NO_ACTIVE_MODE', async () => {
    const res = await http().post('/zatca/onboard').send({}).expect(409);
    expect(res.body.code).toBe('NO_ACTIVE_MODE');
  });

  describe('developer-portal', () => {
    beforeAll(() => http().put('/zatca/mode').send({ mode: 'developer-portal' }).expect(200));

    it('onboards without typing an OTP (123345 sent automatically)', async () => {
      const res = await http().post('/zatca/onboard').send({}).expect(200);
      expect(res.body.env).toBe('developer-portal');
      expect(res.body.complianceChecks).toHaveLength(6);
      expect(res.body.complianceChecks.every((c: { ok: boolean }) => c.ok)).toBe(true);
    });

    it('stores 6 compliance checks for the run, all ok', async () => {
      const rows = await ds.query(`select run_id, document, ok, http_status from compliance_checks where env = 'developer-portal'`);
      expect(rows).toHaveLength(6);
      expect(new Set(rows.map((r: { run_id: string }) => r.run_id)).size).toBe(1);
      expect(rows.every((r: { ok: boolean; http_status: number }) => r.ok && r.http_status === 200)).toBe(true);
      expect(rows.map((r: { document: string }) => r.document).sort()).toEqual([
        'simplified-credit', 'simplified-debit', 'simplified-invoice', 'standard-credit', 'standard-debit', 'standard-invoice',
      ]);
    });

    it('stores the key and certificates encrypted, with the chain reset', async () => {
      const row = await env('developer-portal');
      expect(row.private_key_enc).toMatch(/^v1:/);
      expect(row.production_token_enc).toMatch(/^v1:/);
      expect(row.production_secret_enc).toMatch(/^v1:/);
      expect(row.production_cert_not_after).not.toBeNull();
      expect(row.onboarded_at).not.toBeNull();
      expect([row.chain_epoch, Number(row.icv)]).toEqual([1, 0]);
    });

    it('status and modes report the mode as onboarded', async () => {
      expect((await http().get('/zatca/status').expect(200)).body).toMatchObject({ env: 'developer-portal', onboarded: true });
      const modes = (await http().get('/zatca/modes').expect(200)).body.modes;
      expect(modes[0]).toMatchObject({ env: 'developer-portal', state: 'onboarded' });
    });

    it('second onboarding without force does nothing', async () => {
      const res = await http().post('/zatca/onboard').send({}).expect(200);
      expect(res.body.message).toContain('مسجلة مسبقاً');
    });

    it('re-onboarding is refused while PENDING invoices exist', async () => {
      await ds.query(
        `insert into invoices (env, invoice_number, uuid, category, kind, invoice_hash, issue_date, issue_time, lines, status, signed_xml, qr)
         values ('developer-portal', 'P-1', gen_random_uuid(), 'simplified', 'invoice', 'h', '2026-10-12', '10:00:00', '[]', 'PENDING', '<x/>', 'q')`,
      );
      const res = await http().post('/zatca/onboard').send({ force: true }).expect(409);
      expect(res.body).toMatchObject({ code: 'PENDING_EXISTS', pending: 1 });
      await ds.query(`delete from invoices where invoice_number = 'P-1'`);
    });

    it('re-onboarding with force starts a new chain epoch', async () => {
      await http().post('/zatca/onboard').send({ force: true }).expect(200);
      const row = await env('developer-portal');
      expect([row.chain_epoch, Number(row.icv)]).toEqual([2, 0]);
      expect(Number((await ds.query(`select count(distinct run_id) from compliance_checks`))[0].count)).toBe(2);
    });

    it('dryRun still works and stores the local test key encrypted', async () => {
      const res = await http()
        .post('/zatca/invoices?dryRun=true')
        .send({ id: 'DRY-1', category: 'simplified', lines: [{ name: 'قهوة', quantity: 2, unitPrice: 15 }] })
        .expect(200);
      expect(res.body).toMatchObject({ dryRun: true, totals: { total: 34.5 } });
      expect((await env('developer-portal')).local_test_key_enc).toMatch(/^v1:/);
    });

    it('a real (fake transport) invoice is signed with the stored production key and accepted', async () => {
      const res = await http()
        .post('/zatca/invoices')
        .send({ id: 'INV-1', category: 'simplified', lines: [{ name: 'تمر', quantity: 1, unitPrice: 42.5 }] })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'ACCEPTED', httpStatus: 200, icv: 1 });
    });
  });

  describe('simulation', () => {
    beforeAll(() => http().put('/zatca/mode').send({ mode: 'simulation' }).expect(200));

    it('incomplete settings → 400 SETTINGS_INCOMPLETE', async () => {
      const res = await http().post('/zatca/onboard').send({ otp: '111222' }).expect(400);
      expect(res.body.code).toBe('SETTINGS_INCOMPLETE');
      expect(res.body.missing).toHaveLength(16);
    });

    it('no OTP → 400 OTP_REQUIRED, with OTP → onboarded', async () => {
      await http().put('/zatca/environments/simulation/settings').send(validSettings()).expect(200);
      expect((await http().post('/zatca/onboard').send({}).expect(400)).body.code).toBe('OTP_REQUIRED');
      await http().post('/zatca/onboard').send({ otp: '12' }).expect(400);
      const res = await http().post('/zatca/onboard').send({ otp: '111222' }).expect(200);
      expect(res.body.env).toBe('simulation');
      expect((await env('simulation')).production_token_enc).toMatch(/^v1:/);
    });
  });
});
