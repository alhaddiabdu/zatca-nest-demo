import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface CsrInput {
  commonName: string;
  orgUnit: string;
  orgName: string;
  vatNumber: string;
  solutionName: string;
  model: string;
  serial: string;
  invoiceType: string;
  location: string;
  industry: string;
  certTemplateName: string;
}

export interface CsrResult {
  privateKeyPem: string;
  csrPem: string;
  /** الصيغة التي تطلبها الهيئة في حقل csr: نص الـ PEM كاملاً مرمّزاً Base64 */
  csrBase64: string;
}

/**
 * الخطوة 1: توليد مفتاح خاص (ECDSA secp256k1) وطلب شهادة CSR بالحقول التي تشترطها الهيئة.
 * يعتمد على أداة openssl المثبتة في النظام لأن Node لا يولّد CSR بإضافات مخصصة.
 */
export function generateKeyAndCsr(input: CsrInput): CsrResult {
  const dir = mkdtempSync(join(tmpdir(), 'zatca-csr-'));
  try {
    const keyPath = join(dir, 'key.pem');
    const cfgPath = join(dir, 'csr.cnf');
    const csrPath = join(dir, 'csr.pem');

    const config = `
oid_section = OIDs
[ OIDs ]
certificateTemplateName = 1.3.6.1.4.1.311.20.2

[ req ]
default_md = sha256
prompt = no
utf8 = yes
string_mask = utf8only
req_extensions = req_ext
distinguished_name = dn

[ dn ]
CN = ${input.commonName}
C = SA
OU = ${input.orgUnit}
O = ${input.orgName}

[ req_ext ]
certificateTemplateName = ASN1:PRINTABLESTRING:${input.certTemplateName}
subjectAltName = dirName:alt_names

[ alt_names ]
SN = 1-${input.solutionName}|2-${input.model}|3-${input.serial}
UID = ${input.vatNumber}
title = ${input.invoiceType}
registeredAddress = ${input.location}
businessCategory = ${input.industry}
`;
    writeFileSync(cfgPath, config, 'utf8');

    execFileSync('openssl', ['ecparam', '-name', 'secp256k1', '-genkey', '-noout', '-out', keyPath]);
    execFileSync('openssl', ['req', '-new', '-sha256', '-key', keyPath, '-config', cfgPath, '-out', csrPath]);

    const privateKeyPem = readFileSync(keyPath, 'utf8');
    const csrPem = readFileSync(csrPath, 'utf8');
    return { privateKeyPem, csrPem, csrBase64: Buffer.from(csrPem, 'utf8').toString('base64') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * شهادة ذاتية التوقيع للتجربة المحلية فقط (dryRun بدون تسجيل لدى الهيئة).
 * الهيئة لن تقبل فواتير موقعة بها.
 */
export function createSelfSignedCert(privateKeyPem: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'zatca-self-'));
  try {
    const keyPath = join(dir, 'key.pem');
    const certPath = join(dir, 'cert.pem');
    writeFileSync(keyPath, privateKeyPem);
    execFileSync('openssl', [
      'req', '-new', '-x509', '-sha256', '-days', '365', '-key', keyPath,
      '-subj', '/CN=Local-Test-Only/O=Demo/C=SA', '-out', certPath,
    ]);
    return readFileSync(certPath, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
