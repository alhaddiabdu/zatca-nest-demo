import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../../src/database/database.module';
import { EnvironmentsModule } from '../../src/zatca/environments/environments.module';
import { validSettings } from '../fixtures/settings';
import { resetDatabase } from './helpers';

describe('GET/PUT /zatca/environments/:env/settings', () => {
  let app: INestApplication;
  let ds: DataSource;
  const url = (env: string) => `/zatca/environments/${env}/settings`;

  beforeAll(async () => {
    await resetDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), DatabaseModule, EnvironmentsModule],
    }).compile();
    app = moduleRef.createNestApplication();
    // نفس الـ pipe العام في main.ts
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);
  });
  afterAll(() => app?.close());

  it('GET developer-portal → seeded and complete', async () => {
    const res = await request(app.getHttpServer()).get(url('developer-portal')).expect(200);
    expect(res.body).toMatchObject({ env: 'developer-portal', complete: true, missing: [], lockedFields: [] });
    expect(res.body.seller.vatNumber).toBe('399999999900003');
  });

  it('GET simulation → incomplete with 16 missing fields', async () => {
    const res = await request(app.getHttpServer()).get(url('simulation')).expect(200);
    expect(res.body.complete).toBe(false);
    expect(res.body.missing).toHaveLength(16);
  });

  it('unknown mode → 404', async () => {
    await request(app.getHttpServer()).get(url('xyz')).expect(404);
    await request(app.getHttpServer()).put(url('xyz')).send(validSettings()).expect(404);
  });

  it('14-digit VAT number → 400', async () => {
    const body = validSettings();
    body.seller.vatNumber = '31012345670000';
    const res = await request(app.getHttpServer()).put(url('simulation')).send(body).expect(400);
    expect(JSON.stringify(res.body.message)).toContain('الرقم الضريبي');
  });

  it('extra field → 400 (not silently dropped)', async () => {
    const res = await request(app.getHttpServer()).put(url('simulation')).send({ ...validSettings(), extra: 1 }).expect(400);
    expect(JSON.stringify(res.body.message)).toContain('extra');
    const nested = validSettings() as Record<string, Record<string, unknown>>;
    nested.egs.hack = 'x';
    await request(app.getHttpServer()).put(url('simulation')).send(nested).expect(400);
  });

  it('orgUnit with newline → 400, serial with | → 400, invoiceType 1111 → 400', async () => {
    for (const [field, value] of [['orgUnit', 'A\nB'], ['serial', 'a|b'], ['invoiceType', '1111']]) {
      const body = validSettings() as Record<string, Record<string, unknown>>;
      body.egs[field] = value;
      await request(app.getHttpServer()).put(url('simulation')).send(body).expect(400);
    }
  });

  it('valid settings → 200 and complete', async () => {
    const res = await request(app.getHttpServer()).put(url('simulation')).send(validSettings()).expect(200);
    expect(res.body).toMatchObject({ complete: true, missing: [], seller: { vatNumber: '310123456700003' } });
  });

  describe('after onboarding', () => {
    beforeAll(() => ds.query(`update environments set production_token_enc = 'v1:x' where env = 'simulation'`));

    it('exposes locked fields', async () => {
      const res = await request(app.getHttpServer()).get(url('simulation')).expect(200);
      expect(res.body.lockedFields).toContain('seller.vatNumber');
      expect(res.body.lockedFields).not.toContain('seller.street');
    });

    it('changing vatNumber → 409 FIELDS_LOCKED', async () => {
      const body = validSettings();
      body.seller.vatNumber = '399999999900003';
      const res = await request(app.getHttpServer()).put(url('simulation')).send(body).expect(409);
      expect(res.body).toMatchObject({ code: 'FIELDS_LOCKED', fields: ['seller.vatNumber'] });
    });

    it('changing the street → 200', async () => {
      const body = validSettings();
      body.seller.street = 'شارع التحلية';
      const res = await request(app.getHttpServer()).put(url('simulation')).send(body).expect(200);
      expect(res.body.seller.street).toBe('شارع التحلية');
    });
  });
});
