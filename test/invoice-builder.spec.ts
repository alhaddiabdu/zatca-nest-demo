import { DOMParser } from '@xmldom/xmldom';
import { createSelfSignedCert, generateKeyAndCsr } from '../src/zatca/crypto/csr';
import { pemToCertBase64 } from '../src/zatca/crypto/certificate';
import { decodeQr } from '../src/zatca/crypto/qr';
import { INITIAL_PIH, signInvoice } from '../src/zatca/crypto/signer';
import { buildInvoiceXml } from '../src/zatca/xml/invoice-builder';
import { InvoiceInput } from '../src/zatca/xml/invoice.types';

const seller = {
  name: 'شركة التجربة', vatNumber: '399999999900003', crn: '1010010000', street: 'شارع', buildingNumber: '1234',
  district: 'حي', city: 'الرياض', postalCode: '12345',
};
const ADDRESS = { street: 'طريق الملك فهد', buildingNumber: '1234', district: 'العليا', city: 'الرياض', postalCode: '12211' };

const input = (over: Partial<InvoiceInput> = {}): InvoiceInput => ({
  id: 'T-1', uuid: '6f4d20e0-6bfe-4a80-9389-7dabe6620f12', category: 'simplified', kind: 'invoice',
  issueDate: '2026-10-13', issueTime: '09:15:30Z', icv: 1, pih: INITIAL_PIH,
  lines: [{ name: 'منتج', quantity: 1, unitPrice: 10 }],
  ...over,
});

const { privateKeyPem } = generateKeyAndCsr({
  commonName: 't', orgUnit: 't', orgName: 't', vatNumber: seller.vatNumber, solutionName: 't', model: 't',
  serial: 't', invoiceType: '1100', location: 't', industry: 't', certTemplateName: 'TSTZATCA-Code-Signing',
});
const certBase64 = pemToCertBase64(createSelfSignedCert(privateKeyPem));
const sign = (i: InvoiceInput) => {
  const built = buildInvoiceXml(i, seller);
  return { built, ...signInvoice({ unsignedXml: built.unsignedXml, privateKeyPem, certBase64, qrFields: built.qrFields }) };
};

/**
 * المسار الكامل لكل عنصر فارغ (بلا عناصر أبناء ولا نص ولا خصائص) وكل خاصية فارغة.
 * يُستثنى URI="" في ds:Reference للفاتورة: يفرضه XML-DSig (مرجع للمستند كله) وهو في أمثلة الهيئة نفسها.
 */
const SIGNED_DATA_REF_URI = /\/ds:SignedInfo\/ds:Reference\/@URI$/;

function emptyNodes(xml: string): string[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const out: string[] = [];
  const walk = (el: Element, path: string) => {
    const here = `${path}/${el.nodeName}`;
    const children = Array.from(el.childNodes);
    const hasChildEl = children.some((n) => n.nodeType === 1);
    const hasText = children.some((n) => (n.nodeType === 3 || n.nodeType === 4) && (n.nodeValue ?? '').trim() !== '');
    if (!hasChildEl && !hasText && el.attributes.length === 0) out.push(here);
    for (const a of Array.from(el.attributes)) if (a.value.trim() === '') out.push(`${here}/@${a.name}`);
    children.filter((n): n is Element => n.nodeType === 1).forEach((c) => walk(c, here));
  };
  walk(doc.documentElement, '');
  return out.filter((p) => !SIGNED_DATA_REF_URI.test(p));
}

const customerParty = (xml: string) => xml.match(/<cac:AccountingCustomerParty>[\s\S]*?<\/cac:AccountingCustomerParty>/)![0];

describe('BR-KSA-F-03: no empty elements', () => {
  it.each([
    ['simplified invoice without buyer', input()],
    ['simplified credit note without buyer', input({ kind: 'credit', originalInvoiceId: 'T-0', reason: 'إرجاع' })],
    ['simplified invoice with buyer name only', input({ buyer: { name: 'عميل' } })],
    ['standard invoice', input({ category: 'standard', buyer: { name: 'مشترٍ', vatNumber: '300000000000003', address: ADDRESS } })],
  ])('%s: signed XML has no empty element or attribute', (_, i) => {
    expect(emptyNodes(sign(i).signedXml)).toEqual([]);
  });

  it('simplified without buyer keeps the mandatory AccountingCustomerParty with only the VAT tax scheme', () => {
    const party = customerParty(buildInvoiceXml(input(), seller).unsignedXml).replace(/\s+/g, '');
    expect(party).toBe(
      '<cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>' +
        '</cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>',
    );
  });

  it('buyer data present: no extra tax scheme block is added', () => {
    const party = customerParty(buildInvoiceXml(input({ buyer: { name: 'عميل' } }), seller).unsignedXml);
    expect(party).not.toContain('PartyTaxScheme');
    expect(party).toContain('<cbc:RegistrationName>عميل</cbc:RegistrationName>');
  });
});

describe('BR-KSA-81: alternative buyer identifier', () => {
  const noVat = { name: 'مشترٍ', address: ADDRESS };

  it.each(['invoice', 'credit', 'debit'] as const)('standard %s without VAT number or other ID is rejected before signing', (kind) => {
    const notes = kind === 'invoice' ? {} : { originalInvoiceId: 'T-0', reason: 'تعديل' };
    expect(() => buildInvoiceXml(input({ category: 'standard', kind, buyer: noVat, ...notes }), seller)).toThrow(
      'الفاتورة القياسية وإشعاراتها تتطلب رقماً ضريبياً للمشتري، أو معرّفاً بديلاً',
    );
  });

  it('standard without VAT number but with NAT id → PartyIdentification first in the party', () => {
    const xml = buildInvoiceXml(
      input({ category: 'standard', buyer: { ...noVat, otherIdType: 'NAT', otherIdValue: '1012345678' } }),
      seller,
    ).unsignedXml;
    const party = customerParty(xml).replace(/\s+/g, '');
    expect(party).toMatch(/^<cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:IDschemeID="NAT">1012345678<\/cbc:ID><\/cac:PartyIdentification><cac:PostalAddress>/);
    expect(party).not.toContain('CompanyID');
  });

  it('standard with VAT number needs no other id', () => {
    const xml = buildInvoiceXml(input({ category: 'standard', buyer: { ...noVat, vatNumber: '300000000000003' } }), seller).unsignedXml;
    expect(customerParty(xml)).not.toContain('PartyIdentification');
  });

  it('rejects an unknown scheme or a non-alphanumeric value', () => {
    const bad = (otherIdType: string, otherIdValue: string) => () =>
      buildInvoiceXml(input({ category: 'standard', buyer: { ...noVat, otherIdType: otherIdType as 'NAT', otherIdValue } }), seller);
    expect(bad('XYZ', '123')).toThrow('معرّف المشتري البديل غير صالح');
    expect(bad('CRN', '10-10')).toThrow('معرّف المشتري البديل غير صالح');
  });
});

describe('BR-KSA-EN16931-11: unit price as entered, line net = quantity × price', () => {
  const line = (xml: string) => ({
    price: xml.match(/<cbc:PriceAmount currencyID="SAR">([^<]+)</)![1],
    net: xml.match(/<cac:InvoiceLine>[\s\S]*?<cbc:LineExtensionAmount currencyID="SAR">([^<]+)</)![1],
  });

  it('price 10.005 × quantity 3 → PriceAmount 10.005 unrounded, line net 30.02', () => {
    const built = buildInvoiceXml(input({ lines: [{ name: 'منتج', quantity: 3, unitPrice: 10.005 }] }), seller);
    expect(line(built.unsignedXml)).toEqual({ price: '10.005', net: '30.02' });
    // 3 × 10.005 = 30.015 بالضبط (وفي JS = 30.014999999999997 فكان يُقرَّب خطأً إلى 30.01)
    expect(built.totals).toEqual({ net: 30.02, vat: 4.5, total: 34.52 });
  });

  it.each([
    [15, 2, '15.00', '30.00'],
    [33.33, 3, '33.33', '99.99'],
    [1.005, 1, '1.005', '1.01'],
    [0.1, 3, '0.10', '0.30'],
    [2.5, 1.5, '2.50', '3.75'],
    [0.0000001, 1, '0.0000001', '0.00'],
  ])('price %p × quantity %p → PriceAmount %s, net %s', (unitPrice, quantity, price, net) => {
    expect(line(buildInvoiceXml(input({ lines: [{ name: 'منتج', quantity, unitPrice }] }), seller).unsignedXml)).toEqual({ price, net });
  });
});

describe('QR tag 9 (certificate signature): simplified documents only', () => {
  const notes = { originalInvoiceId: 'T-0', reason: 'تعديل' };
  const doc = (category: 'simplified' | 'standard', kind: 'invoice' | 'credit' | 'debit') =>
    input({
      category, kind, ...(kind === 'invoice' ? {} : notes),
      buyer: category === 'standard' ? { name: 'مشترٍ', vatNumber: '300000000000003', address: ADDRESS } : undefined,
    });

  it.each(['invoice', 'credit', 'debit'] as const)('simplified %s: tags 1–9', (kind) => {
    const tags = decodeQr(sign(doc('simplified', kind)).qr);
    expect(Object.keys(tags).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(tags[9]).toBeTruthy();
  });

  it.each(['invoice', 'credit', 'debit'] as const)('standard %s: tags 1–8, no tag 9', (kind) => {
    const tags = decodeQr(sign(doc('standard', kind)).qr);
    expect(Object.keys(tags).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
