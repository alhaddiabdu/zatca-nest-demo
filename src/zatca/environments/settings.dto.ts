import { Transform, Type } from 'class-transformer';
import { IsDefined, IsIn, IsString, Length, Matches, ValidateNested } from 'class-validator';

const Trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

/**
 * هذه القيم تُكتب حرفياً داخل ملف إعداد openssl عند توليد الـ CSR (crypto/csr.ts)،
 * فسطر جديد أو = أو | أو أقواس أو $ قد يحقن إعدادات أو يكسر حقل SN.
 */
const CSR_SAFE = /^[^\r\n=|[\]$]+$/;
const CsrSafe = (label: string) =>
  Matches(CSR_SAFE, { message: `${label}: لا يُسمح بالأسطر الجديدة ولا بالرموز = | [ ] $` });

export class SellerSettingsDto {
  @Trim() @IsString({ message: 'اسم المنشأة مطلوب' }) @Length(1, 200, { message: 'اسم المنشأة من 1 إلى 200 حرف' })
  @CsrSafe('اسم المنشأة')
  name: string;

  @Trim() @Matches(/^3\d{13}3$/, { message: 'الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3' })
  vatNumber: string;

  @Trim() @Matches(/^\d{10}$/, { message: 'السجل التجاري 10 أرقام' })
  crn: string;

  @Trim() @IsString({ message: 'الشارع مطلوب' }) @Length(1, 200, { message: 'الشارع من 1 إلى 200 حرف' })
  street: string;

  @Trim() @Matches(/^\d{4}$/, { message: 'رقم المبنى 4 أرقام' })
  buildingNumber: string;

  @Trim() @IsString({ message: 'الحي مطلوب' }) @Length(1, 100, { message: 'الحي من 1 إلى 100 حرف' })
  district: string;

  @Trim() @IsString({ message: 'المدينة مطلوبة' }) @Length(1, 100, { message: 'المدينة من 1 إلى 100 حرف' })
  city: string;

  @Trim() @Matches(/^\d{5}$/, { message: 'الرمز البريدي 5 أرقام' })
  postalCode: string;
}

const egsText = (label: string) => [
  Trim(),
  IsString({ message: `${label} مطلوب` }),
  Length(1, 64, { message: `${label} من 1 إلى 64 حرفاً` }),
  CsrSafe(label),
];
const apply = (decorators: PropertyDecorator[]): PropertyDecorator => (target, key) =>
  decorators.forEach((d) => d(target, key));

export class EgsSettingsDto {
  @apply(egsText('الاسم الشائع (CN)')) commonName: string;
  @apply(egsText('الفرع (OU)')) orgUnit: string;
  @apply(egsText('اسم الحل')) solutionName: string;
  @apply(egsText('الطراز')) model: string;
  @apply(egsText('الرقم التسلسلي')) serial: string;

  @Trim() @IsIn(['1100', '1000', '0100'], { message: 'نوع الفواتير: 1100 (الاثنان) أو 1000 (قياسية) أو 0100 (مبسطة)' })
  invoiceType: string;

  @apply(egsText('الموقع')) location: string;
  @apply(egsText('النشاط')) industry: string;
}

export class UpdateSettingsDto {
  @IsDefined({ message: 'بيانات المنشأة (seller) مطلوبة' })
  @ValidateNested()
  @Type(() => SellerSettingsDto)
  seller: SellerSettingsDto;

  @IsDefined({ message: 'بيانات وحدة الإصدار (egs) مطلوبة' })
  @ValidateNested()
  @Type(() => EgsSettingsDto)
  egs: EgsSettingsDto;
}
