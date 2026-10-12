/** standard = فاتورة ضريبية (B2B) تمر بالاعتماد | simplified = مبسطة (B2C) تمر بالإبلاغ */
export type InvoiceCategory = 'standard' | 'simplified';
/** invoice = فاتورة | credit = إشعار دائن | debit = إشعار مدين */
export type DocumentKind = 'invoice' | 'credit' | 'debit';

export const DOCUMENT_TYPE_CODES: Record<DocumentKind, string> = {
  invoice: '388',
  credit: '381',
  debit: '383',
};

/** الرمز الفرعي في الخاصية name لعنصر InvoiceTypeCode */
export const CATEGORY_SUBTYPES: Record<InvoiceCategory, string> = {
  standard: '0100000',
  simplified: '0200000',
};

export interface Address {
  street: string;
  buildingNumber: string;
  district: string;
  city: string;
  postalCode: string;
  countryCode?: string;
}

export interface Buyer {
  name: string;
  vatNumber?: string;
  address?: Address;
}

export interface InvoiceLine {
  name: string;
  quantity: number;
  unitPrice: number; // السعر قبل الضريبة
  vatPercent?: number; // الافتراضي 15
}

export interface InvoiceInput {
  id: string; // رقم الفاتورة الظاهر للعميل
  uuid: string;
  category: InvoiceCategory;
  kind: DocumentKind;
  issueDate: string; // YYYY-MM-DD
  issueTime: string; // HH:mm:ss
  icv: number; // عداد الفواتير
  pih: string; // تجزئة الفاتورة السابقة
  buyer?: Buyer; // إلزامي في القياسية
  lines: InvoiceLine[];
  paymentMeansCode?: string; // 10 نقدي، 30 تحويل، 42 حساب بنكي، 48 بطاقة
  /** للإشعار الدائن والمدين: رقم الفاتورة الأصلية وسبب الإشعار */
  originalInvoiceId?: string;
  reason?: string;
}
