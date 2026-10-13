export type Category = 'standard' | 'simplified';
/** أوضاع التشغيل الثلاثة */
export type Mode = 'developer-portal' | 'simulation' | 'core';
/** غير مُعدّ / مُعدّ / مسجل */
export type ModeState = 'unconfigured' | 'configured' | 'onboarded';
export type Kind = 'invoice' | 'credit' | 'debit';

export interface Seller {
  name: string;
  vatNumber: string;
  crn: string;
  street: string;
  buildingNumber: string;
  district: string;
  city: string;
  postalCode: string;
}

export interface Status {
  env: Mode;
  seller: Seller;
  onboarded: boolean;
  onboardedAt: string | null;
  chain: { icv: number; pih: string; chainEpoch?: number };
  pendingCount: number;
  // من الخطوة 21
  mode?: { env: Mode; label: string; color: ModeColor };
  state?: ModeState;
  productionCertNotAfter?: string | null;
  pendingOverdue?: number;
  countsByStatus?: Record<InvoiceStatus, number>;
}

export type ModeColor = 'green' | 'orange' | 'red';

export interface ModeInfo {
  env: Mode;
  label: string;
  color: ModeColor;
  state: ModeState;
  /** false = الوضع معطّل حالياً (الإنتاج) ولا يمكن اختياره */
  available: boolean;
  onboardedAt: string | null;
  invoiceCount: number;
  pendingCount: number;
}

export interface ModesResponse {
  active: Mode | null;
  modes: ModeInfo[];
}

export interface EgsSettings {
  commonName: string;
  orgUnit: string;
  solutionName: string;
  model: string;
  serial: string;
  invoiceType: string;
  location: string;
  industry: string;
}

export interface EnvSettings {
  env: Mode;
  seller: Seller;
  egs: EgsSettings;
  complete: boolean;
  /** الحقول الناقصة، مثل "seller.vatNumber" */
  missing: string[];
  /** الحقول المقفلة بعد التسجيل */
  lockedFields: string[];
}

/** أنواع معرّف المشتري البديل (BR-KSA-81)، مطابقة للخادم */
export type BuyerIdScheme = 'TIN' | 'CRN' | 'MOM' | 'MLS' | '700' | 'SAG' | 'NAT' | 'GCC' | 'IQA' | 'PAS' | 'OTH';

export interface Address {
  street: string;
  buildingNumber: string;
  district: string;
  city: string;
  postalCode: string;
}

export interface InvoicePayload {
  id: string;
  category: Category;
  kind: Kind;
  buyer?: { name: string; vatNumber?: string; otherIdType?: BuyerIdScheme; otherIdValue?: string; address?: Address };
  lines: Array<{ name: string; quantity: number; unitPrice: number; vatPercent?: number }>;
  originalInvoiceId?: string;
  reason?: string;
}

export interface Totals {
  net: number;
  vat: number;
  total: number;
}

export interface ZatcaMessage {
  type?: string;
  code?: string;
  category?: string;
  message: string;
  status?: string;
}

export interface ZatcaBody {
  validationResults?: {
    infoMessages?: ZatcaMessage[] | ZatcaMessage;
    warningMessages?: ZatcaMessage[];
    errorMessages?: ZatcaMessage[];
    status?: string;
  };
  reportingStatus?: string;
  clearanceStatus?: string;
  clearedInvoice?: string;
  [key: string]: unknown;
}

export type IssueStatus = 'ACCEPTED' | 'ACCEPTED_WITH_WARNINGS' | 'REJECTED' | 'PENDING';
export type InvoiceStatus = IssueStatus | 'DRY_RUN';

export interface IssueResult {
  /** معرّف الصف في جدول الفواتير */
  invoiceId?: string;
  dryRun?: boolean;
  note?: string;
  status?: IssueStatus;
  message?: string;
  httpStatus?: number;
  icv: number;
  pih?: string;
  uuid: string;
  invoiceHash?: string;
  totals?: Totals;
  qr?: string;
  qrImage?: string;
  zatca?: ZatcaBody;
  xmlPath?: string;
}

/** صف في جدول الفواتير */
export interface InvoiceSummary {
  id: string;
  env: Mode;
  invoiceNumber: string;
  isDryRun: boolean;
  category: Category;
  kind: Kind;
  icv: number | null;
  status: InvoiceStatus;
  totalAmount: number | null;
  httpStatus: number | null;
  attempts: number;
  nextRetryAt: string | null;
  lastError: string | null;
  issueDate: string;
  issueTime: string;
  createdAt: string;
}

/** تفاصيل فاتورة (بدون الـ XML الكامل) */
export interface InvoiceDetail extends InvoiceSummary {
  uuid: string;
  chainEpoch: number | null;
  pih: string | null;
  invoiceHash: string;
  buyer: InvoicePayload['buyer'] | null;
  lines: InvoicePayload['lines'];
  paymentMeansCode: string | null;
  originalInvoiceId: string | null;
  reason: string | null;
  netAmount: number | null;
  vatAmount: number | null;
  submissionChannel: 'reporting' | 'clearance' | null;
  zatcaResponse: ZatcaBody | null;
  submittedAt: string | null;
  updatedAt: string;
  hasClearedXml: boolean;
  qr: string;
  qrImage: string;
}

export interface Page<T> {
  env: Mode;
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface InvoiceQuery {
  env?: Mode;
  status?: InvoiceStatus;
  category?: Category;
  kind?: Kind;
  q?: string;
  from?: string;
  to?: string;
  includeDryRun?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ComplianceCheck {
  document: string;
  status: number;
  ok: boolean;
  response: ZatcaBody;
}

export interface OnboardResult {
  message: string;
  env?: string;
  onboardedAt?: string;
  complianceChecks?: ComplianceCheck[];
}
