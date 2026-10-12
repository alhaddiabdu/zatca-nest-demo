export type Category = 'standard' | 'simplified';
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
  env: 'developer-portal' | 'simulation' | 'core';
  seller: Seller;
  onboarded: boolean;
  onboardedAt: string | null;
  chain: { icv: number; pih: string };
  pendingCount: number;
}

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
  buyer?: { name: string; vatNumber?: string; address?: Address };
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

export interface IssueResult {
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

export interface HistoryItem {
  id: string;
  category: Category;
  kind: Kind;
  status: IssueStatus | 'DRY_RUN';
  total?: number;
  issuedAt: string;
  dryRun: boolean;
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
