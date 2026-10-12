/**
 * ثوابت الأوضاع الثلاثة. بيانات المنشأة والـ EGS لكل وضع صارت في جدول environments
 * (لم تعد تُقرأ من متغيرات البيئة). SellerInfo يستخدمه بناء XML (xml/invoice-builder.ts).
 */
export type ZatcaEnv = 'developer-portal' | 'simulation' | 'core';

/** عناوين الـ API لكل بيئة */
export const ZATCA_BASE_URLS: Record<ZatcaEnv, string> = {
  'developer-portal': 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  simulation: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  core: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

/** اسم قالب الشهادة الذي يوضع داخل الـ CSR ويختلف حسب البيئة */
export const CERT_TEMPLATE_NAMES: Record<ZatcaEnv, string> = {
  'developer-portal': 'TSTZATCA-Code-Signing',
  simulation: 'PREZATCA-Code-Signing',
  core: 'ZATCA-Code-Signing',
};

/** عنوان الـ API واسم قالب الشهادة لوضع معيّن */
export function envProfile(env: ZatcaEnv): { baseUrl: string; certTemplateName: string } {
  if (!ZATCA_BASE_URLS[env]) throw new Error(`وضع غير معروف: ${env}`);
  return { baseUrl: ZATCA_BASE_URLS[env], certTemplateName: CERT_TEMPLATE_NAMES[env] };
}

export interface SellerInfo {
  name: string;
  vatNumber: string;
  crn: string;
  street: string;
  buildingNumber: string;
  district: string;
  city: string;
  postalCode: string;
}

export interface EgsInfo {
  commonName: string;
  orgUnit: string;
  solutionName: string;
  model: string;
  serial: string;
  invoiceType: string; // مثل 1100
  location: string;
  industry: string;
}
