import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { DatabaseModule } from '../../src/database/database.module';
import { generateKeyAndCsr } from '../../src/zatca/crypto/csr';
import { EnvironmentsModule } from '../../src/zatca/environments/environments.module';
import { EnvironmentsService } from '../../src/zatca/environments/environments.service';
import { resetDatabase } from './helpers';

describe('EnvironmentsService (PostgreSQL)', () => {
  let moduleRef: TestingModule;
  let service: EnvironmentsService;
  let ds: DataSource;
  const { privateKeyPem, csrPem } = generateKeyAndCsr({
    commonName: 't', orgUnit: 't', orgName: 't', vatNumber: '399999999900003', solutionName: 't', model: 't',
    serial: 't', invoiceType: '1100', location: 't', industry: 't', certTemplateName: 'TSTZATCA-Code-Signing',
  });
  const compliance = { binarySecurityToken: 'Q09NUExJQU5DRS1UT0tFTg==', secret: 'compliance-secret-value', requestId: '111' };
  const production = { binarySecurityToken: 'UFJPRFVDVElPTi1UT0tFTg==', secret: 'production-secret-value', requestId: '222' };

  beforeAll(async () => {
    await resetDatabase();
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }), DatabaseModule, EnvironmentsModule],
    }).compile();
    service = moduleRef.get(EnvironmentsService);
    ds = moduleRef.get(DataSource);
  });
  afterAll(() => moduleRef?.close());

  const raw = async (env: string) =>
    (await ds.query('select * from environments where env = $1', [env]))[0] as Record<string, string | null>;

  it('derives state from seeds: developer-portal configured, others unconfigured', async () => {
    expect(service.state(await service.get('developer-portal'))).toBe('configured');
    expect(service.state(await service.get('simulation'))).toBe('unconfigured');
    expect(service.state(await service.get('core'))).toBe('unconfigured');
  });

  it('lists missing settings', async () => {
    expect(service.missingSettings(await service.get('developer-portal'))).toEqual([]);
    const missing = service.missingSettings(await service.get('simulation'));
    expect(missing).toHaveLength(16);
    expect(missing).toContain('seller.vatNumber');
    expect(missing).toContain('egs.invoiceType');
  });

  it('returns seller and EGS in the shape used by the XML builder', async () => {
    const row = await service.get('developer-portal');
    expect(service.toSeller(row)).toMatchObject({ vatNumber: '399999999900003', buildingNumber: '2322', postalCode: '23333' });
    expect(service.toEgs(row)).toMatchObject({ invoiceType: '1100', commonName: 'TST-886431145-399999999900003' });
  });

  it('stores secrets encrypted and decrypts them back', async () => {
    await service.saveCredentials('developer-portal', {
      privateKeyPem, csrPem, compliance, production,
      productionCertNotAfter: new Date('2027-10-12T00:00:00Z'), onboardedAt: new Date(),
    });
    const row = await raw('developer-portal');
    for (const col of ['private_key_enc', 'compliance_token_enc', 'compliance_secret_enc', 'production_token_enc', 'production_secret_enc']) {
      expect(row[col]).toMatch(/^v1:/);
    }
    expect(row.private_key_enc).not.toContain('BEGIN EC PRIVATE KEY');
    expect(row.production_secret_enc).not.toContain('production-secret-value');

    const secrets = await service.getSecrets('developer-portal');
    expect(secrets.privateKeyPem).toBe(privateKeyPem);
    expect(secrets.compliance).toEqual(compliance);
    expect(secrets.production).toEqual(production);
    expect(service.state(await service.get('developer-portal'))).toBe('onboarded');
  });

  it('an encrypted value copied to another mode cannot be decrypted (AAD)', async () => {
    await ds.query(`update environments set private_key_enc = (select private_key_enc from environments where env = 'developer-portal') where env = 'core'`);
    await expect(service.getSecrets('core')).rejects.toThrow('تعذر فك تشفير');
    await ds.query(`update environments set private_key_enc = null where env = 'core'`);
  });

  it('stores the local dryRun key encrypted', async () => {
    await service.saveLocalTest('simulation', { privateKeyPem, certPem: 'CERT' });
    expect((await raw('simulation')).local_test_key_enc).toMatch(/^v1:/);
    expect((await service.getSecrets('simulation')).localTest).toEqual({ privateKeyPem, certPem: 'CERT' });
  });

  it('unknown mode → NotFound', async () => {
    await expect(service.get('xyz')).rejects.toThrow('وضع غير معروف');
  });
});
