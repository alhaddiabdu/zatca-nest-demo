import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FakeZatcaApiService } from '../../src/zatca/api/fake-zatca-api.service';
import { ZatcaApi } from '../../src/zatca/api/zatca-api.port';
import { createTestApp } from './app';
import { resetDatabase } from './helpers';

const simplified = (id: string) => ({ id, category: 'simplified', lines: [{ name: 'قهوة', quantity: 1, unitPrice: 10 }] });

describe('GET /zatca/status with dashboard counts', () => {
  let app: INestApplication;
  let ds: DataSource;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await resetDatabase();
    delete process.env.ZATCA_ENV;
    app = await createTestApp();
    ds = app.get(DataSource);
    await http().put('/zatca/mode').send({ mode: 'developer-portal' }).expect(200);
  });
  afterAll(() => app?.close());

  it('before onboarding: configured, zero counts', async () => {
    const { body } = await http().get('/zatca/status').expect(200);
    expect(body).toMatchObject({
      env: 'developer-portal', state: 'configured', onboarded: false, pendingCount: 0, pendingOverdue: 0,
      mode: { label: 'بوابة المطورين', color: 'green' },
      chain: { icv: 0, chainEpoch: 1 },
      countsByStatus: { DRY_RUN: 0, PENDING: 0, ACCEPTED: 0, ACCEPTED_WITH_WARNINGS: 0, REJECTED: 0 },
    });
  });

  it('after 2 accepted + 1 pending (+1 dry run): counts and chain from the database', async () => {
    await http().post('/zatca/onboard').send({}).expect(200);
    await http().post('/zatca/invoices').send(simplified('A-1')).expect(200);
    await http().post('/zatca/invoices').send(simplified('A-2')).expect(200);
    const fake = app.get(ZatcaApi) as FakeZatcaApiService;
    fake.setOutage(true);
    await http().post('/zatca/invoices').send(simplified('P-1')).expect(200);
    fake.setOutage(false);
    await http().post('/zatca/invoices?dryRun=true').send(simplified('D-1')).expect(200);

    const { body } = await http().get('/zatca/status').expect(200);
    expect(body.countsByStatus).toEqual({ DRY_RUN: 1, PENDING: 1, ACCEPTED: 2, ACCEPTED_WITH_WARNINGS: 0, REJECTED: 0 });
    expect(body).toMatchObject({ state: 'onboarded', onboarded: true, pendingCount: 1, chain: { icv: 3 } });
    expect(body.productionCertNotAfter).not.toBeNull();
  });

  it('a simplified invoice pending for more than 24 hours is overdue', async () => {
    await ds.query(`update invoices set created_at = now() - interval '25 hours' where invoice_number = 'P-1'`);
    expect((await http().get('/zatca/status').expect(200)).body.pendingOverdue).toBe(1);
  });

  it('counts are per mode', async () => {
    await http().put('/zatca/mode').send({ mode: 'simulation' }).expect(200);
    const { body } = await http().get('/zatca/status').expect(200);
    expect(body).toMatchObject({ env: 'simulation', state: 'unconfigured', pendingCount: 0, mode: { color: 'orange' } });
    expect(body.countsByStatus.ACCEPTED).toBe(0);
  });
});
