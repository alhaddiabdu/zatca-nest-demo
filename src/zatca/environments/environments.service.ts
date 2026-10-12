import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnvironmentEntity, ZatcaEnvName } from '../../database/entities/environment.entity';
import { CryptoBoxService } from '../../security/crypto-box.service';
import { Credentials } from '../storage/egs-store.service';
import { EgsInfo, SellerInfo } from '../zatca.config';

export const ZATCA_ENVS: readonly ZatcaEnvName[] = ['developer-portal', 'simulation', 'core'];

export const isZatcaEnv = (value: unknown): value is ZatcaEnvName => ZATCA_ENVS.includes(value as ZatcaEnvName);

/** غير مُعدّ / مُعدّ / مسجل */
export type EnvState = 'unconfigured' | 'configured' | 'onboarded';

/** حقول إعدادات المنشأة: الاسم في الـ API ← الخاصية في الكيان */
export const SETTINGS_FIELDS = {
  seller: {
    name: 'sellerName',
    vatNumber: 'sellerVatNumber',
    crn: 'sellerCrn',
    street: 'sellerStreet',
    buildingNumber: 'sellerBuildingNumber',
    district: 'sellerDistrict',
    city: 'sellerCity',
    postalCode: 'sellerPostalCode',
  },
  egs: {
    commonName: 'egsCommonName',
    orgUnit: 'egsOrgUnit',
    solutionName: 'egsSolutionName',
    model: 'egsModel',
    serial: 'egsSerial',
    invoiceType: 'egsInvoiceType',
    location: 'egsLocation',
    industry: 'egsIndustry',
  },
} as const satisfies Record<'seller' | 'egs', Record<string, keyof EnvironmentEntity>>;

export interface EnvSecrets {
  privateKeyPem: string | null;
  compliance: Credentials | null;
  production: Credentials | null;
  localTest: { privateKeyPem: string; certPem: string } | null;
}

export interface SaveCredentialsInput {
  privateKeyPem: string;
  csrPem: string;
  compliance: Credentials;
  production: Credentials;
  productionCertNotAfter: Date | null;
  onboardedAt: Date;
  /** عند التسجيل تبدأ سلسلة جديدة */
  chain?: { chainEpoch: number; icv: number; pih: string };
}

/**
 * قراءة وكتابة صف الوضع في جدول environments.
 * الأسرار تُشفَّر قبل الحفظ وتُفك هنا فقط، و aad = "<env>:<اسم العمود>".
 */
@Injectable()
export class EnvironmentsService {
  constructor(
    @InjectRepository(EnvironmentEntity) private readonly repo: Repository<EnvironmentEntity>,
    private readonly box: CryptoBoxService,
  ) {}

  async get(env: string): Promise<EnvironmentEntity> {
    const row = isZatcaEnv(env) ? await this.repo.findOneBy({ env }) : null;
    if (!row) throw new NotFoundException({ code: 'UNKNOWN_MODE', message: `وضع غير معروف: ${env}` });
    return row;
  }

  async getSecrets(env: ZatcaEnvName): Promise<EnvSecrets> {
    const row = await this.get(env);
    const dec = (value: string | null, column: string) => (value ? this.box.decrypt(value, `${env}:${column}`) : null);
    const creds = (token: string | null, secret: string | null, requestId: string | null, prefix: string) =>
      token && secret
        ? {
            binarySecurityToken: dec(token, `${prefix}_token_enc`)!,
            secret: dec(secret, `${prefix}_secret_enc`)!,
            requestId: requestId ?? undefined,
          }
        : null;
    const localKey = dec(row.localTestKeyEnc, 'local_test_key_enc');
    return {
      privateKeyPem: dec(row.privateKeyEnc, 'private_key_enc'),
      compliance: creds(row.complianceTokenEnc, row.complianceSecretEnc, row.complianceRequestId, 'compliance'),
      production: creds(row.productionTokenEnc, row.productionSecretEnc, row.productionRequestId, 'production'),
      localTest: localKey && row.localTestCertPem ? { privateKeyPem: localKey, certPem: row.localTestCertPem } : null,
    };
  }

  async saveCredentials(env: ZatcaEnvName, input: SaveCredentialsInput): Promise<void> {
    const enc = (value: string, column: string) => this.box.encrypt(value, `${env}:${column}`);
    await this.repo.update(
      { env },
      {
        privateKeyEnc: enc(input.privateKeyPem, 'private_key_enc'),
        csrPem: input.csrPem,
        complianceTokenEnc: enc(input.compliance.binarySecurityToken, 'compliance_token_enc'),
        complianceSecretEnc: enc(input.compliance.secret, 'compliance_secret_enc'),
        complianceRequestId: input.compliance.requestId ?? null,
        productionTokenEnc: enc(input.production.binarySecurityToken, 'production_token_enc'),
        productionSecretEnc: enc(input.production.secret, 'production_secret_enc'),
        productionRequestId: input.production.requestId ?? null,
        productionCertNotAfter: input.productionCertNotAfter,
        onboardedAt: input.onboardedAt,
        ...(input.chain ?? {}),
      },
    );
  }

  async saveLocalTest(env: ZatcaEnvName, local: { privateKeyPem: string; certPem: string }): Promise<void> {
    await this.repo.update(
      { env },
      {
        localTestKeyEnc: this.box.encrypt(local.privateKeyPem, `${env}:local_test_key_enc`),
        localTestCertPem: local.certPem,
      },
    );
  }

  state(row: EnvironmentEntity): EnvState {
    if (row.productionTokenEnc) return 'onboarded';
    return this.missingSettings(row).length === 0 ? 'configured' : 'unconfigured';
  }

  /** الحقول الناقصة بأسماء الـ API، مثل "seller.vatNumber" */
  missingSettings(row: EnvironmentEntity): string[] {
    const missing: string[] = [];
    for (const group of ['seller', 'egs'] as const) {
      for (const [field, prop] of Object.entries(SETTINGS_FIELDS[group])) {
        const value = row[prop as keyof EnvironmentEntity];
        if (typeof value !== 'string' || !value.trim()) missing.push(`${group}.${field}`);
      }
    }
    return missing;
  }

  /** بيانات البائع بالشكل الذي يستخدمه بناء XML (مع إزالة مسافات أعمدة char) */
  toSeller(row: EnvironmentEntity): SellerInfo {
    return this.pick(row, 'seller') as unknown as SellerInfo;
  }

  toEgs(row: EnvironmentEntity): EgsInfo {
    return this.pick(row, 'egs') as unknown as EgsInfo;
  }

  private pick(row: EnvironmentEntity, group: 'seller' | 'egs'): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [field, prop] of Object.entries(SETTINGS_FIELDS[group])) {
      out[field] = String(row[prop as keyof EnvironmentEntity] ?? '').trim();
    }
    return out;
  }
}
