import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../../src/database/database.module';
import { ModeService } from '../../src/zatca/modes/mode.service';
import { ModesModule } from '../../src/zatca/modes/modes.module';
import { resetDatabase } from './helpers';

describe('Operating modes: /zatca/modes and /zatca/mode', () => {
  let app: INestApplication;
  let ds: DataSource;
  let modes: ModeService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    await resetDatabase();
    delete process.env.ZATCA_ENV;
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), DatabaseModule, ModesModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    ds = app.get(DataSource);
    modes = app.get(ModeService);
  });
  afterAll(() => app?.close());

  it('no active mode on first run', async () => {
    expect((await http().get('/zatca/mode').expect(200)).body).toEqual({ active: null });
  });

  it('lists 3 modes with state, label, color and zero counts', async () => {
    const { body } = await http().get('/zatca/modes').expect(200);
    expect(body.active).toBeNull();
    expect(body.modes.map((m: { env: string; state: string; color: string }) => [m.env, m.state, m.color])).toEqual([
      ['developer-portal', 'configured', 'green'],
      ['simulation', 'unconfigured', 'orange'],
      ['core', 'unconfigured', 'red'],
    ]);
    expect(body.modes.every((m: { invoiceCount: number }) => m.invoiceCount === 0)).toBe(true);
    expect(body.modes.map((m: { available: boolean }) => m.available)).toEqual([true, true, false]);
  });

  describe('core is disabled', () => {
    it.each([undefined, 'core', 'CORE'])('PUT core (confirm=%s) → 400 MODE_DISABLED, nothing stored', async (confirm) => {
      const { body } = await http().put('/zatca/mode').send({ mode: 'core', confirm }).expect(400);
      expect(body.code).toBe('MODE_DISABLED');
      expect(body.message).toContain('غير متاح حالياً');
      expect((await http().get('/zatca/mode')).body).toEqual({ active: null });
      const [row] = await ds.query('select core_confirmed_at from app_settings where id = 1');
      expect(row.core_confirmed_at).toBeNull();
    });

    it('a core mode stored before disabling blocks operations with 409 MODE_DISABLED', async () => {
      await ds.query(`update app_settings set active_env = 'core'`);
      await expect(modes.requireActive()).rejects.toMatchObject({ status: 409, response: { code: 'MODE_DISABLED' } });
      await ds.query('update app_settings set active_env = null');
    });
  });

  it('unknown mode → 400', async () => {
    await http().put('/zatca/mode').send({ mode: 'xyz' }).expect(400);
  });

  it('developer-portal and simulation need no confirmation', async () => {
    await http().put('/zatca/mode').send({ mode: 'simulation' }).expect(200);
    expect((await http().put('/zatca/mode').send({ mode: 'developer-portal' }).expect(200)).body).toEqual({ active: 'developer-portal' });
  });

  it('counts invoices (excluding dry runs) and pending per mode', async () => {
    const insert = (env: string, n: string, status: string, dry = false) =>
      ds.query(
        `insert into invoices (env, invoice_number, is_dry_run, uuid, category, kind, invoice_hash, issue_date, issue_time, lines, status, signed_xml, qr)
         values ($1, $2, $3, gen_random_uuid(), 'simplified', 'invoice', 'h', '2026-10-12', '10:00:00', '[]', $4, '<x/>', 'q')`,
        [env, n, dry, status],
      );
    await insert('developer-portal', 'A-1', 'ACCEPTED');
    await insert('developer-portal', 'A-2', 'PENDING');
    await insert('developer-portal', 'A-3', 'DRY_RUN', true);
    await insert('simulation', 'S-1', 'REJECTED');
    const { body } = await http().get('/zatca/modes').expect(200);
    const byEnv = Object.fromEntries(body.modes.map((m: { env: string }) => [m.env, m]));
    expect(byEnv['developer-portal']).toMatchObject({ invoiceCount: 2, pendingCount: 1 });
    expect(byEnv.simulation).toMatchObject({ invoiceCount: 1, pendingCount: 0 });
    expect(byEnv.core).toMatchObject({ invoiceCount: 0, pendingCount: 0 });
  });

  describe('requireActive()', () => {
    beforeAll(() => ds.query('update app_settings set active_env = null'));
    afterEach(() => delete process.env.ZATCA_ENV);

    it('no mode and no ZATCA_ENV → 409 NO_ACTIVE_MODE', async () => {
      await expect(modes.requireActive()).rejects.toMatchObject({ response: { code: 'NO_ACTIVE_MODE' } });
    });

    it('ZATCA_ENV is no longer used as a fallback', async () => {
      process.env.ZATCA_ENV = 'simulation';
      await expect(modes.requireActive()).rejects.toMatchObject({ response: { code: 'NO_ACTIVE_MODE' } });
    });

    it('a stored mode wins over ZATCA_ENV', async () => {
      process.env.ZATCA_ENV = 'simulation';
      await modes.setMode('developer-portal');
      await expect(modes.requireActive()).resolves.toBe('developer-portal');
    });
  });
});
