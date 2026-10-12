/**
 * استيراد الحالة القديمة من data/egs-<env>.json إلى PostgreSQL (مرة واحدة).
 *
 *   npm run import:json -- --dry-run     يعرض ما سيحدث دون كتابة
 *   npm run import:json                  الاستيراد
 *   npm run import:json -- --dir ./data --force
 *
 * - المفتاح الخاص و secret و binarySecurityToken تُشفَّر بـ MASTER_KEY قبل الحفظ.
 * - ينقل icv و pih و onboardedAt و localTest، وكل pending يصبح فاتورة PENDING تُعاد محاولتها فوراً.
 * - بيانات SELLER_* و EGS_* تُطبَّق على الوضع المذكور في ZATCA_ENV فقط (كان الإعداد القديم لوحدة واحدة).
 * - يرفض الكتابة فوق وضع فيه بيانات (مفتاح، شهادة، عداد > 0، أو فواتير) إلا مع --force.
 * - لا يطبع أي قيمة سرية.
 */
import { X509Certificate } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../src/database/database.options';
import { EnvironmentEntity, ZatcaEnvName } from '../src/database/entities/environment.entity';
import { InvoiceEntity } from '../src/database/entities/invoice.entity';
import { CryptoBoxService, parseMasterKey } from '../src/security/crypto-box.service';
import { certBase64ToPem, tokenToCertBase64 } from '../src/zatca/crypto/certificate';

interface LegacyCredentials {
  binarySecurityToken: string;
  secret: string;
  requestId?: string;
}

interface LegacyState {
  privateKeyPem?: string;
  csrPem?: string;
  compliance?: LegacyCredentials;
  production?: LegacyCredentials;
  chain?: { icv: number; pih: string };
  onboardedAt?: string;
  pending?: Array<{
    id: string;
    uuid: string;
    category: 'standard' | 'simplified';
    invoiceHash: string;
    xmlBase64: string;
    createdAt: string;
    lastError?: string;
  }>;
  localTest?: { privateKeyPem: string; certPem: string };
}

export interface ImportOptions {
  dir: string;
  ds: DataSource;
  box: CryptoBoxService;
  dryRun?: boolean;
  force?: boolean;
  /** متغيرات البيئة (SELLER_* و EGS_* و ZATCA_ENV) */
  vars?: NodeJS.ProcessEnv;
}

export interface ImportReport {
  env: ZatcaEnvName;
  file: string;
  action: 'imported' | 'would-import' | 'skipped' | 'failed';
  reason?: string;
  icv?: number;
  pending?: number;
  hasPrivateKey?: boolean;
  hasProduction?: boolean;
  sellerFromEnv?: boolean;
}

const FILE = /^egs-(developer-portal|simulation|core)\.json$/;

const SETTINGS_VARS: Record<string, keyof EnvironmentEntity> = {
  SELLER_NAME: 'sellerName',
  SELLER_VAT: 'sellerVatNumber',
  SELLER_CRN: 'sellerCrn',
  SELLER_STREET: 'sellerStreet',
  SELLER_BUILDING: 'sellerBuildingNumber',
  SELLER_DISTRICT: 'sellerDistrict',
  SELLER_CITY: 'sellerCity',
  SELLER_POSTAL: 'sellerPostalCode',
  EGS_COMMON_NAME: 'egsCommonName',
  EGS_ORG_UNIT: 'egsOrgUnit',
  EGS_SOLUTION_NAME: 'egsSolutionName',
  EGS_MODEL: 'egsModel',
  EGS_SERIAL: 'egsSerial',
  EGS_INVOICE_TYPE: 'egsInvoiceType',
  EGS_LOCATION: 'egsLocation',
  EGS_INDUSTRY: 'egsIndustry',
};

const KINDS: Record<string, InvoiceEntity['kind']> = { '388': 'invoice', '381': 'credit', '383': 'debit' };

/** قراءة الحقول التي لم تُحفظ في JSON من الـ XML الموقّع نفسه */
function parseXml(xml: string) {
  const pick = (re: RegExp) => re.exec(xml)?.[1];
  const attachment = (id: string) =>
    pick(new RegExp(`<cbc:ID>${id}</cbc:ID>\\s*<cac:Attachment>\\s*<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]*)<`));
  const amount = (tag: string) => {
    const v = pick(new RegExp(`<cac:LegalMonetaryTotal>[\\s\\S]*?<cbc:${tag}[^>]*>([^<]+)</cbc:${tag}>`));
    return v === undefined ? null : Number(v);
  };
  const icv = pick(/<cbc:ID>ICV<\/cbc:ID>\s*<cbc:UUID>(\d+)<\/cbc:UUID>/);
  return {
    kind: KINDS[pick(/<cbc:InvoiceTypeCode[^>]*>(\d+)</) ?? ''] ?? 'invoice',
    issueDate: pick(/<cbc:IssueDate>([^<]+)</),
    issueTime: pick(/<cbc:IssueTime>([^<]+)</),
    icv: icv ? Number(icv) : null,
    pih: attachment('PIH') ?? null,
    qr: attachment('QR') ?? '',
    netAmount: amount('TaxExclusiveAmount'),
    totalAmount: amount('TaxInclusiveAmount'),
  };
}

function certNotAfter(token: string): Date | null {
  try {
    return new Date(new X509Certificate(certBase64ToPem(tokenToCertBase64(token))).validTo);
  } catch {
    return null;
  }
}

export async function importJsonState(opts: ImportOptions): Promise<ImportReport[]> {
  const vars = opts.vars ?? {};
  const files = readdirSync(opts.dir).filter((f) => FILE.test(f)).sort();
  const reports: ImportReport[] = [];

  for (const file of files) {
    const env = FILE.exec(file)![1] as ZatcaEnvName;
    // تُحدَّث action حسب النتيجة؛ failed إن توقف قبل ذلك
    const report: ImportReport = { env, file, action: 'failed' };
    reports.push(report);
    try {
      const state = JSON.parse(readFileSync(join(opts.dir, file), 'utf8')) as LegacyState;
      await opts.ds.transaction(async (m) => {
        const envRepo = m.getRepository(EnvironmentEntity);
        const invoiceRepo = m.getRepository(InvoiceEntity);
        const row = await envRepo.findOne({ where: { env }, lock: { mode: 'pessimistic_write' } });
        if (!row) throw new Error(`الوضع ${env} غير موجود في القاعدة. شغّل npm run migration:run أولاً`);

        const invoiceCount = await invoiceRepo.count({ where: { env } });
        const hasData = row.privateKeyEnc || row.localTestKeyEnc || row.productionTokenEnc || row.icv > 0 || invoiceCount > 0;
        if (hasData && !opts.force) {
          Object.assign(report, {
            action: 'skipped',
            reason: `الوضع فيه بيانات مسبقاً (${invoiceCount} فاتورة، icv=${row.icv}). أُلغي الاستيراد. استخدم --force للكتابة فوقها`,
          });
          return;
        }

        const enc = (value: string, column: string) => opts.box.encrypt(value, `${env}:${column}`);
        const patch: Partial<EnvironmentEntity> = {
          icv: state.chain?.icv ?? 0,
          pih: state.chain?.pih ?? row.pih,
          onboardedAt: state.onboardedAt ? new Date(state.onboardedAt) : null,
        };
        if (state.privateKeyPem) patch.privateKeyEnc = enc(state.privateKeyPem, 'private_key_enc');
        if (state.csrPem) patch.csrPem = state.csrPem;
        if (state.compliance) {
          patch.complianceTokenEnc = enc(state.compliance.binarySecurityToken, 'compliance_token_enc');
          patch.complianceSecretEnc = enc(state.compliance.secret, 'compliance_secret_enc');
          patch.complianceRequestId = state.compliance.requestId ?? null;
        }
        if (state.production) {
          patch.productionTokenEnc = enc(state.production.binarySecurityToken, 'production_token_enc');
          patch.productionSecretEnc = enc(state.production.secret, 'production_secret_enc');
          patch.productionRequestId = state.production.requestId ?? null;
          patch.productionCertNotAfter = certNotAfter(state.production.binarySecurityToken);
        }
        if (state.localTest) {
          patch.localTestKeyEnc = enc(state.localTest.privateKeyPem, 'local_test_key_enc');
          patch.localTestCertPem = state.localTest.certPem;
        }
        let sellerFromEnv = false;
        if (vars.ZATCA_ENV === env) {
          for (const [name, prop] of Object.entries(SETTINGS_VARS)) {
            const value = vars[name]?.trim();
            if (value) {
              (patch as Record<string, unknown>)[prop] = value;
              sellerFromEnv = true;
            }
          }
        }

        const pendingRows = (state.pending ?? []).map((p) => {
          const xml = Buffer.from(p.xmlBase64, 'base64').toString('utf8');
          const parsed = parseXml(xml);
          if (!parsed.issueDate || !parsed.issueTime) throw new Error(`تعذر قراءة تاريخ الفاتورة المعلّقة ${p.id} من الـ XML`);
          return invoiceRepo.create({
            env,
            invoiceNumber: p.id,
            isDryRun: false,
            uuid: p.uuid,
            category: p.category,
            kind: parsed.kind,
            chainEpoch: row.chainEpoch,
            icv: parsed.icv,
            pih: parsed.pih,
            invoiceHash: p.invoiceHash,
            issueDate: parsed.issueDate,
            issueTime: parsed.issueTime,
            buyer: null,
            lines: [],
            netAmount: parsed.netAmount,
            vatAmount: parsed.netAmount !== null && parsed.totalAmount !== null ? Math.round((parsed.totalAmount - parsed.netAmount) * 100) / 100 : null,
            totalAmount: parsed.totalAmount,
            status: 'PENDING',
            signedXml: xml,
            qr: parsed.qr,
            attempts: 0,
            nextRetryAt: new Date(),
            lastError: p.lastError ?? null,
            createdAt: new Date(p.createdAt),
          });
        });

        Object.assign(report, {
          icv: patch.icv,
          pending: pendingRows.length,
          hasPrivateKey: !!state.privateKeyPem,
          hasProduction: !!state.production,
          sellerFromEnv,
        });
        if (opts.dryRun) {
          report.action = 'would-import';
          return;
        }
        await envRepo.update({ env }, patch);
        if (pendingRows.length) await invoiceRepo.save(pendingRows);
        report.action = 'imported';
      });
    } catch (err) {
      Object.assign(report, { action: 'failed', reason: (err as Error).message });
    }
  }
  return reports;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');
  const dirArg = args.indexOf('--dir');
  try {
    process.loadEnvFile();
  } catch {
    // لا يوجد .env
  }
  const dir = resolve(dirArg >= 0 ? args[dirArg + 1] : process.env.DATA_DIR ?? './data');
  const box = new CryptoBoxService(parseMasterKey(process.env.MASTER_KEY));
  const ds = new DataSource(buildDataSourceOptions(process.env.DATABASE_URL));
  await ds.initialize();
  try {
    if (await ds.showMigrations()) throw new Error('توجد migrations لم تُطبَّق. شغّل npm run migration:run أولاً');
    console.log(`${dryRun ? '[تجربة، بدون كتابة] ' : ''}الاستيراد من: ${dir}`);
    const reports = await importJsonState({ dir, ds, box, dryRun, force, vars: process.env });
    if (!reports.length) console.log('لا توجد ملفات egs-<env>.json في المجلد');
    for (const r of reports) {
      const details = r.icv === undefined ? '' :
        ` icv=${r.icv} معلّقة=${r.pending} مفتاح=${r.hasPrivateKey ? 'نعم' : 'لا'} شهادة_إنتاج=${r.hasProduction ? 'نعم' : 'لا'} بيانات_المنشأة_من_env=${r.sellerFromEnv ? 'نعم' : 'لا'}`;
      console.log(`- ${r.file} ← ${r.env}: ${r.action}${details}${r.reason ? `\n  ${r.reason}` : ''}`);
    }
    if (reports.some((r) => r.action === 'skipped' || r.action === 'failed')) process.exitCode = 1;
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`فشل الاستيراد: ${(err as Error).message}`);
    process.exit(1);
  });
}
