/**
 * تجربة كاملة بدون إنترنت:
 * توليد مفتاح + CSR، شهادة ذاتية التوقيع للتجربة، ثم بناء وتوقيع 3 فواتير متسلسلة
 * وحفظها في مجلد output لتفحصها أو تتحقق منها بأداة fatoora الرسمية:
 *   fatoora -validate -invoice output/01-simplified-invoice.xml
 */
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';
import { generateKeyAndCsr } from '../src/zatca/crypto/csr';
import { pemToCertBase64 } from '../src/zatca/crypto/certificate';
import { INITIAL_PIH, signInvoice } from '../src/zatca/crypto/signer';
import { decodeQr } from '../src/zatca/crypto/qr';
import { utcIssueDateTime } from '../src/zatca/issue-time';
import { buildInvoiceXml } from '../src/zatca/xml/invoice-builder';
import { InvoiceInput } from '../src/zatca/xml/invoice.types';
import { SellerInfo } from '../src/zatca/zatca.config';

const seller: SellerInfo = {
  name: 'شركة التجربة المحدودة',
  vatNumber: '399999999900003',
  crn: '1010010000',
  street: 'الأمير سلطان',
  buildingNumber: '2322',
  district: 'المربع',
  city: 'الرياض',
  postalCode: '23333',
};

const out = join(__dirname, '..', 'output');
mkdirSync(out, { recursive: true });

// 1) مفتاح خاص + CSR
const { privateKeyPem, csrPem } = generateKeyAndCsr({
  commonName: 'TST-886431145-399999999900003',
  orgUnit: 'Riyadh Branch',
  orgName: seller.name,
  vatNumber: seller.vatNumber,
  solutionName: 'MyERP',
  model: 'NestDemo',
  serial: randomUUID(),
  invoiceType: '1100',
  location: 'RRRD2929',
  industry: 'Supply activities',
  certTemplateName: 'TSTZATCA-Code-Signing',
});
writeFileSync(join(out, 'private-key.pem'), privateKeyPem);
writeFileSync(join(out, 'csr.pem'), csrPem);
console.log('✔ تم توليد المفتاح الخاص و CSR');

// 2) شهادة ذاتية التوقيع (بديل مؤقت عن شهادة الهيئة، للتجربة المحلية فقط)
const tmp = mkdtempSync(join(tmpdir(), 'zatca-demo-'));
writeFileSync(join(tmp, 'key.pem'), privateKeyPem);
execFileSync('openssl', [
  'req', '-new', '-x509', '-sha256', '-days', '365',
  '-key', join(tmp, 'key.pem'),
  '-subj', '/CN=Local-Test-CA/O=Demo/C=SA',
  '-out', join(tmp, 'cert.pem'),
]);
const certPem = readFileSync(join(tmp, 'cert.pem'), 'utf8');
writeFileSync(join(out, 'cert.pem'), certPem);
const certBase64 = pemToCertBase64(certPem);
console.log('✔ تم إنشاء شهادة تجريبية محلية');

// 3) سلسلة من 3 وثائق
const { date, time } = utcIssueDateTime();
const docs: Array<Omit<InvoiceInput, 'icv' | 'pih' | 'uuid' | 'issueDate' | 'issueTime'> & { file: string }> = [
  {
    file: '01-simplified-invoice.xml',
    id: 'INV-0001',
    category: 'simplified',
    kind: 'invoice',
    lines: [
      { name: 'قهوة عربية', quantity: 2, unitPrice: 15 },
      { name: 'تمر سكري', quantity: 1, unitPrice: 42.5 },
    ],
  },
  {
    file: '02-standard-invoice.xml',
    id: 'INV-0002',
    category: 'standard',
    kind: 'invoice',
    buyer: {
      name: 'مؤسسة العميل التجارية',
      vatNumber: '300000000000003',
      address: { street: 'طريق الملك فهد', buildingNumber: '1234', district: 'العليا', city: 'الرياض', postalCode: '12211' },
    },
    lines: [{ name: 'خدمة استشارية', quantity: 3, unitPrice: 500 }],
  },
  {
    file: '03-simplified-credit-note.xml',
    id: 'CN-0001',
    category: 'simplified',
    kind: 'credit',
    originalInvoiceId: 'INV-0001',
    reason: 'إرجاع منتج',
    lines: [{ name: 'تمر سكري', quantity: 1, unitPrice: 42.5 }],
  },
];

let icv = 0;
let pih = INITIAL_PIH;
for (const d of docs) {
  icv += 1;
  const { file, ...rest } = d;
  const built = buildInvoiceXml({ ...rest, uuid: randomUUID(), issueDate: date, issueTime: time, icv, pih }, seller);
  const signed = signInvoice({ unsignedXml: built.unsignedXml, privateKeyPem, certBase64, qrFields: built.qrFields });
  writeFileSync(join(out, file), signed.signedXml);
  writeFileSync(join(out, file.replace('.xml', '.pih.txt')), pih);
  console.log(`\n✔ ${file}  (ICV=${icv})`);
  console.log(`   الإجمالي: ${built.totals.total} | الضريبة: ${built.totals.vat}`);
  console.log(`   Hash: ${signed.invoiceHash}`);
  console.log(`   QR: ${JSON.stringify(decodeQr(signed.qr), (k, v) => (typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '…' : v))}`);
  pih = signed.invoiceHash; // تجزئة هذه الفاتورة = PIH للفاتورة التالية
}
console.log(`\nالملفات في: ${out}`);
