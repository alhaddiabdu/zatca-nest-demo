import { registerAs } from '@nestjs/config';

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

export interface ZatcaConfig {
  env: ZatcaEnv;
  baseUrl: string;
  certTemplateName: string;
  dataDir: string;
  seller: SellerInfo;
  egs: EgsInfo;
}

export default registerAs('zatca', (): ZatcaConfig => {
  const env = (process.env.ZATCA_ENV ?? 'developer-portal') as ZatcaEnv;
  if (!ZATCA_BASE_URLS[env]) {
    throw new Error(`ZATCA_ENV غير صحيح: ${env}`);
  }
  return {
    env,
    baseUrl: ZATCA_BASE_URLS[env],
    certTemplateName: CERT_TEMPLATE_NAMES[env],
    dataDir: process.env.DATA_DIR ?? './data',
    seller: {
      name: process.env.SELLER_NAME ?? 'شركة التجربة المحدودة',
      vatNumber: process.env.SELLER_VAT ?? '399999999900003',
      crn: process.env.SELLER_CRN ?? '1010010000',
      street: process.env.SELLER_STREET ?? 'الأمير سلطان',
      buildingNumber: process.env.SELLER_BUILDING ?? '2322',
      district: process.env.SELLER_DISTRICT ?? 'المربع',
      city: process.env.SELLER_CITY ?? 'الرياض',
      postalCode: process.env.SELLER_POSTAL ?? '23333',
    },
    egs: {
      commonName: process.env.EGS_COMMON_NAME ?? 'TST-886431145-399999999900003',
      orgUnit: process.env.EGS_ORG_UNIT ?? 'Riyadh Branch',
      solutionName: process.env.EGS_SOLUTION_NAME ?? 'MyERP',
      model: process.env.EGS_MODEL ?? 'NestDemo',
      serial: process.env.EGS_SERIAL ?? 'ed22f1d8-e6a2-1118-9b58-d9a8f11e445f',
      invoiceType: process.env.EGS_INVOICE_TYPE ?? '1100',
      location: process.env.EGS_LOCATION ?? 'RRRD2929',
      industry: process.env.EGS_INDUSTRY ?? 'Supply activities',
    },
  };
});
