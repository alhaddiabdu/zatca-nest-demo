import { SellerInfo } from '../zatca.config';
import { escapeXml, QR_PLACEHOLDER, QrFields, UBL_EXTENSIONS_PLACEHOLDER } from '../crypto/signer';
import { CATEGORY_SUBTYPES, DOCUMENT_TYPE_CODES, InvoiceInput } from './invoice.types';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n: number) => round2(n).toFixed(2);
const e = escapeXml;

export interface BuiltInvoice {
  /** الفاتورة قبل التوقيع (فيها نصوص مؤقتة يستبدلها الموقّع) */
  unsignedXml: string;
  qrFields: QrFields;
  totals: { net: number; vat: number; total: number };
}

/**
 * الخطوة 6: بناء فاتورة UBL 2.1 بالحقول التي تشترطها الهيئة.
 * ترتيب العناصر مهم لأن المخطط (XSD) يفرضه.
 * هذا المثال يدعم نسبة الضريبة الأساسية (الفئة S) فقط.
 */
export function buildInvoiceXml(input: InvoiceInput, seller: SellerInfo): BuiltInvoice {
  if (!input.lines.length) throw new Error('الفاتورة يجب أن تحتوي على بند واحد على الأقل');
  if (input.category === 'standard' && !input.buyer?.address) {
    throw new Error('الفاتورة القياسية تتطلب اسم المشتري وعنوانه');
  }
  if (input.kind !== 'invoice' && (!input.originalInvoiceId || !input.reason)) {
    throw new Error('الإشعار الدائن/المدين يتطلب رقم الفاتورة الأصلية وسبب الإشعار');
  }

  // ===== الحسابات =====
  const lines = input.lines.map((l, idx) => {
    const rate = l.vatPercent ?? 15;
    const net = round2(l.quantity * l.unitPrice);
    const vat = round2((net * rate) / 100);
    return { ...l, idx: idx + 1, rate, net, vat };
  });
  const rate = lines[0].rate;
  if (lines.some((l) => l.rate !== rate)) {
    throw new Error('هذا المثال يدعم نسبة ضريبة واحدة لكل الفاتورة');
  }
  const net = round2(lines.reduce((s, l) => s + l.net, 0));
  const vat = round2((net * rate) / 100);
  const total = round2(net + vat);

  // ===== أجزاء XML =====
  const billingRef =
    input.kind !== 'invoice'
      ? `
    <cac:BillingReference>
        <cac:InvoiceDocumentReference>
            <cbc:ID>${e(input.originalInvoiceId!)}</cbc:ID>
        </cac:InvoiceDocumentReference>
    </cac:BillingReference>`
      : '';

  const buyer = input.buyer;
  const buyerAddress = buyer?.address
    ? `
            <cac:PostalAddress>
                <cbc:StreetName>${e(buyer.address.street)}</cbc:StreetName>
                <cbc:BuildingNumber>${e(buyer.address.buildingNumber)}</cbc:BuildingNumber>
                <cbc:CitySubdivisionName>${e(buyer.address.district)}</cbc:CitySubdivisionName>
                <cbc:CityName>${e(buyer.address.city)}</cbc:CityName>
                <cbc:PostalZone>${e(buyer.address.postalCode)}</cbc:PostalZone>
                <cac:Country>
                    <cbc:IdentificationCode>${e(buyer.address.countryCode ?? 'SA')}</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>`
    : '';
  const buyerTax = buyer?.vatNumber
    ? `
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${e(buyer.vatNumber)}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>`
    : '';
  const buyerName = buyer?.name
    ? `
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${e(buyer.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>`
    : '';

  const instructionNote =
    input.kind !== 'invoice'
      ? `
        <cbc:InstructionNote>${e(input.reason!)}</cbc:InstructionNote>`
      : '';

  const invoiceLines = lines
    .map(
      (l) => `
    <cac:InvoiceLine>
        <cbc:ID>${l.idx}</cbc:ID>
        <cbc:InvoicedQuantity unitCode="PCE">${l.quantity}</cbc:InvoicedQuantity>
        <cbc:LineExtensionAmount currencyID="SAR">${money(l.net)}</cbc:LineExtensionAmount>
        <cac:TaxTotal>
            <cbc:TaxAmount currencyID="SAR">${money(l.vat)}</cbc:TaxAmount>
            <cbc:RoundingAmount currencyID="SAR">${money(l.net + l.vat)}</cbc:RoundingAmount>
        </cac:TaxTotal>
        <cac:Item>
            <cbc:Name>${e(l.name)}</cbc:Name>
            <cac:ClassifiedTaxCategory>
                <cbc:ID>S</cbc:ID>
                <cbc:Percent>${l.rate.toFixed(2)}</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:ClassifiedTaxCategory>
        </cac:Item>
        <cac:Price>
            <cbc:PriceAmount currencyID="SAR">${money(l.unitPrice)}</cbc:PriceAmount>
        </cac:Price>
    </cac:InvoiceLine>`,
    )
    .join('');

  const unsignedXml = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"><ext:UBLExtensions>${UBL_EXTENSIONS_PLACEHOLDER}</ext:UBLExtensions>
    <cbc:ProfileID>reporting:1.0</cbc:ProfileID>
    <cbc:ID>${e(input.id)}</cbc:ID>
    <cbc:UUID>${e(input.uuid)}</cbc:UUID>
    <cbc:IssueDate>${input.issueDate}</cbc:IssueDate>
    <cbc:IssueTime>${input.issueTime}</cbc:IssueTime>
    <cbc:InvoiceTypeCode name="${CATEGORY_SUBTYPES[input.category]}">${DOCUMENT_TYPE_CODES[input.kind]}</cbc:InvoiceTypeCode>
    <cbc:DocumentCurrencyCode>SAR</cbc:DocumentCurrencyCode>
    <cbc:TaxCurrencyCode>SAR</cbc:TaxCurrencyCode>${billingRef}
    <cac:AdditionalDocumentReference>
        <cbc:ID>ICV</cbc:ID>
        <cbc:UUID>${input.icv}</cbc:UUID>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>PIH</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${input.pih}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>
    <cac:AdditionalDocumentReference>
        <cbc:ID>QR</cbc:ID>
        <cac:Attachment>
            <cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">${QR_PLACEHOLDER}</cbc:EmbeddedDocumentBinaryObject>
        </cac:Attachment>
    </cac:AdditionalDocumentReference>
    <cac:Signature>
        <cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID>
        <cbc:SignatureMethod>urn:oasis:names:specification:ubl:dsig:enveloped:xades</cbc:SignatureMethod>
    </cac:Signature>
    <cac:AccountingSupplierParty>
        <cac:Party>
            <cac:PartyIdentification>
                <cbc:ID schemeID="CRN">${e(seller.crn)}</cbc:ID>
            </cac:PartyIdentification>
            <cac:PostalAddress>
                <cbc:StreetName>${e(seller.street)}</cbc:StreetName>
                <cbc:BuildingNumber>${e(seller.buildingNumber)}</cbc:BuildingNumber>
                <cbc:CitySubdivisionName>${e(seller.district)}</cbc:CitySubdivisionName>
                <cbc:CityName>${e(seller.city)}</cbc:CityName>
                <cbc:PostalZone>${e(seller.postalCode)}</cbc:PostalZone>
                <cac:Country>
                    <cbc:IdentificationCode>SA</cbc:IdentificationCode>
                </cac:Country>
            </cac:PostalAddress>
            <cac:PartyTaxScheme>
                <cbc:CompanyID>${e(seller.vatNumber)}</cbc:CompanyID>
                <cac:TaxScheme>
                    <cbc:ID>VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:PartyTaxScheme>
            <cac:PartyLegalEntity>
                <cbc:RegistrationName>${e(seller.name)}</cbc:RegistrationName>
            </cac:PartyLegalEntity>
        </cac:Party>
    </cac:AccountingSupplierParty>
    <cac:AccountingCustomerParty>
        <cac:Party>${buyerAddress}${buyerTax}${buyerName}
        </cac:Party>
    </cac:AccountingCustomerParty>
    <cac:Delivery>
        <cbc:ActualDeliveryDate>${input.issueDate}</cbc:ActualDeliveryDate>
    </cac:Delivery>
    <cac:PaymentMeans>
        <cbc:PaymentMeansCode>${e(input.paymentMeansCode ?? '10')}</cbc:PaymentMeansCode>${instructionNote}
    </cac:PaymentMeans>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${money(vat)}</cbc:TaxAmount>
    </cac:TaxTotal>
    <cac:TaxTotal>
        <cbc:TaxAmount currencyID="SAR">${money(vat)}</cbc:TaxAmount>
        <cac:TaxSubtotal>
            <cbc:TaxableAmount currencyID="SAR">${money(net)}</cbc:TaxableAmount>
            <cbc:TaxAmount currencyID="SAR">${money(vat)}</cbc:TaxAmount>
            <cac:TaxCategory>
                <cbc:ID schemeID="UN/ECE 5305" schemeAgencyID="6">S</cbc:ID>
                <cbc:Percent>${rate.toFixed(2)}</cbc:Percent>
                <cac:TaxScheme>
                    <cbc:ID schemeID="UN/ECE 5153" schemeAgencyID="6">VAT</cbc:ID>
                </cac:TaxScheme>
            </cac:TaxCategory>
        </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:LegalMonetaryTotal>
        <cbc:LineExtensionAmount currencyID="SAR">${money(net)}</cbc:LineExtensionAmount>
        <cbc:TaxExclusiveAmount currencyID="SAR">${money(net)}</cbc:TaxExclusiveAmount>
        <cbc:TaxInclusiveAmount currencyID="SAR">${money(total)}</cbc:TaxInclusiveAmount>
        <cbc:AllowanceTotalAmount currencyID="SAR">0.00</cbc:AllowanceTotalAmount>
        <cbc:PrepaidAmount currencyID="SAR">0.00</cbc:PrepaidAmount>
        <cbc:PayableAmount currencyID="SAR">${money(total)}</cbc:PayableAmount>
    </cac:LegalMonetaryTotal>${invoiceLines}
</Invoice>`;

  return {
    unsignedXml,
    qrFields: {
      sellerName: seller.name,
      vatNumber: seller.vatNumber,
      timestamp: `${input.issueDate}T${input.issueTime}`, // IssueDate + "T" + IssueTime حرفياً: UTC ينتهي بـ Z (issue-time.ts)
      totalWithVat: money(total),
      vatTotal: money(vat),
    },
    totals: { net, vat, total },
  };
}

/** التاريخ والوقت بتوقيت الرياض (UTC+3) */
export function riyadhDateTime(d = new Date()): { date: string; time: string } {
  const r = new Date(d.getTime() + 3 * 3600 * 1000).toISOString();
  return { date: r.slice(0, 10), time: r.slice(11, 19) };
}
