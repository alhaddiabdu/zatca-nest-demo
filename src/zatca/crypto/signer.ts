import { createHash, createSign } from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import { C14nCanonicalization } from 'xml-crypto';
import { getCertificateInfo } from './certificate';
import { buildQr } from './qr';

/** قيمة PIH لأول فاتورة في السلسلة: Base64 لتجزئة الرقم "0" */
export const INITIAL_PIH =
  'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==';

/** نصوص مؤقتة يضعها مُنشئ الفاتورة، ثم يستبدلها الموقّع */
export const UBL_EXTENSIONS_PLACEHOLDER = '__UBL_EXTENSIONS__';
export const QR_PLACEHOLDER = '__QR_CODE__';

/**
 * الخطوة 7: تجزئة الفاتورة.
 * نحذف UBLExtensions و cac:Signature ومرجع QR، ثم تطبيع C14N، ثم SHA-256، ثم Base64.
 * ملاحظة مهمة: المسافات والأسطر حول العناصر المحذوفة تبقى ضمن التجزئة،
 * لذلك نحسبها على نفس النص النهائي (مع العناصر المؤقتة) وليس على نسخة منفصلة.
 */
export function computeInvoiceHash(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  const toRemove: any[] = [];
  for (let n: any = root.firstChild; n; n = n.nextSibling) {
    if (n.nodeType !== 1) continue;
    if (n.nodeName === 'ext:UBLExtensions' || n.nodeName === 'cac:Signature') toRemove.push(n);
    if (n.nodeName === 'cac:AdditionalDocumentReference') {
      const id = n.getElementsByTagName('cbc:ID')[0];
      if (id && id.textContent === 'QR') toRemove.push(n);
    }
  }
  toRemove.forEach((n) => root.removeChild(n));
  const canonical = new C14nCanonicalization().process(root as any, {});
  return createHash('sha256').update(canonical, 'utf8').digest('base64');
}

/** الخطوة 8: التوقيع الرقمي ECDSA على بايتات التجزئة */
export function signHash(invoiceHash: string, privateKeyPem: string): string {
  const signer = createSign('sha256');
  signer.update(Buffer.from(invoiceHash, 'base64'));
  return signer.sign(privateKeyPem).toString('base64');
}

const DS_NS = 'http://www.w3.org/2000/09/xmldsig#';
const XADES_NS = 'http://uri.etsi.org/01903/v1.3.2#';

function buildSignedProperties(p: {
  signingTime: string;
  certHash: string;
  issuerName: string;
  serialNumber: string;
}) {
  const i = (n: number) => ' '.repeat(n);
  const body = (ds: string) =>
    `${i(36)}<xades:SignedSignatureProperties>
${i(40)}<xades:SigningTime>${p.signingTime}</xades:SigningTime>
${i(40)}<xades:SigningCertificate>
${i(44)}<xades:Cert>
${i(48)}<xades:CertDigest>
${i(52)}<ds:DigestMethod${ds} Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
${i(52)}<ds:DigestValue${ds}>${p.certHash}</ds:DigestValue>
${i(48)}</xades:CertDigest>
${i(48)}<xades:IssuerSerial>
${i(52)}<ds:X509IssuerName${ds}>${escapeXml(p.issuerName)}</ds:X509IssuerName>
${i(52)}<ds:X509SerialNumber${ds}>${p.serialNumber}</ds:X509SerialNumber>
${i(48)}</xades:IssuerSerial>
${i(44)}</xades:Cert>
${i(40)}</xades:SigningCertificate>
${i(36)}</xades:SignedSignatureProperties>
${i(32)}</xades:SignedProperties>`;

  // النص المضمّن في الفاتورة
  const embedded = `<xades:SignedProperties Id="xadesSignedProperties">\n${body('')}`;
  // النص الذي تُحسب عليه التجزئة: نفس العنصر مع إعلان النطاقات كما يراها المدقق عند عزله
  const forHash = `<xades:SignedProperties xmlns:xades="${XADES_NS}" Id="xadesSignedProperties">\n${body(
    ` xmlns:ds="${DS_NS}"`,
  )}`;
  return { embedded, forHash };
}

function buildUblExtensions(p: {
  invoiceHash: string;
  signedPropsHash: string;
  signature: string;
  certBase64: string;
  signedPropertiesXml: string;
}): string {
  return `
    <ext:UBLExtension>
        <ext:ExtensionURI>urn:oasis:names:specification:ubl:dsig:enveloped:xades</ext:ExtensionURI>
        <ext:ExtensionContent>
            <sig:UBLDocumentSignatures xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2" xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2" xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2">
                <sac:SignatureInformation>
                    <cbc:ID>urn:oasis:names:specification:ubl:signature:1</cbc:ID>
                    <sbc:ReferencedSignatureID>urn:oasis:names:specification:ubl:signature:Invoice</sbc:ReferencedSignatureID>
                    <ds:Signature xmlns:ds="${DS_NS}" Id="signature">
                        <ds:SignedInfo>
                            <ds:CanonicalizationMethod Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                            <ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256"/>
                            <ds:Reference Id="invoiceSignedData" URI="">
                                <ds:Transforms>
                                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                        <ds:XPath>not(//ancestor-or-self::ext:UBLExtensions)</ds:XPath>
                                    </ds:Transform>
                                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                        <ds:XPath>not(//ancestor-or-self::cac:Signature)</ds:XPath>
                                    </ds:Transform>
                                    <ds:Transform Algorithm="http://www.w3.org/TR/1999/REC-xpath-19991116">
                                        <ds:XPath>not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])</ds:XPath>
                                    </ds:Transform>
                                    <ds:Transform Algorithm="http://www.w3.org/2006/12/xml-c14n11"/>
                                </ds:Transforms>
                                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                <ds:DigestValue>${p.invoiceHash}</ds:DigestValue>
                            </ds:Reference>
                            <ds:Reference Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties">
                                <ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>
                                <ds:DigestValue>${p.signedPropsHash}</ds:DigestValue>
                            </ds:Reference>
                        </ds:SignedInfo>
                        <ds:SignatureValue>${p.signature}</ds:SignatureValue>
                        <ds:KeyInfo>
                            <ds:X509Data>
                                <ds:X509Certificate>${p.certBase64}</ds:X509Certificate>
                            </ds:X509Data>
                        </ds:KeyInfo>
                        <ds:Object>
                            <xades:QualifyingProperties xmlns:xades="${XADES_NS}" Target="signature">
                                ${p.signedPropertiesXml}
                            </xades:QualifyingProperties>
                        </ds:Object>
                    </ds:Signature>
                </sac:SignatureInformation>
            </sig:UBLDocumentSignatures>
        </ext:ExtensionContent>
    </ext:UBLExtension>
`;
}

export interface QrFields {
  sellerName: string;
  vatNumber: string;
  timestamp: string;
  totalWithVat: string;
  vatTotal: string;
}

export interface SignResult {
  signedXml: string;
  invoiceHash: string;
  qr: string;
  signature: string;
}

/**
 * يجمع الخطوات 7 و8 و9: التجزئة، التوقيع، XAdES، رمز QR.
 * @param unsignedXml فاتورة تحتوي على النصين المؤقتين UBL_EXTENSIONS_PLACEHOLDER و QR_PLACEHOLDER
 */
export function signInvoice(params: {
  unsignedXml: string;
  privateKeyPem: string;
  certBase64: string;
  qrFields: QrFields;
  signingTime?: Date;
}): SignResult {
  const { unsignedXml, privateKeyPem, certBase64, qrFields } = params;

  const invoiceHash = computeInvoiceHash(unsignedXml);
  const signature = signHash(invoiceHash, privateKeyPem);
  const cert = getCertificateInfo(certBase64);

  const signingTime = (params.signingTime ?? new Date()).toISOString().slice(0, 19) + 'Z';
  const sp = buildSignedProperties({
    signingTime,
    certHash: cert.certHash,
    issuerName: cert.issuerName,
    serialNumber: cert.serialNumber,
  });
  const signedPropsHash = Buffer.from(
    createHash('sha256').update(sp.forHash, 'utf8').digest('hex'),
  ).toString('base64');

  const qr = buildQr({
    ...qrFields,
    invoiceHash,
    signature,
    publicKey: cert.publicKeyDer,
    certSignature: cert.certSignature,
  });

  const ublExtensions = buildUblExtensions({
    invoiceHash,
    signedPropsHash,
    signature,
    certBase64,
    signedPropertiesXml: sp.embedded,
  });

  const signedXml = unsignedXml.replace(UBL_EXTENSIONS_PLACEHOLDER, ublExtensions).replace(QR_PLACEHOLDER, qr);

  return { signedXml, invoiceHash, qr, signature };
}

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
