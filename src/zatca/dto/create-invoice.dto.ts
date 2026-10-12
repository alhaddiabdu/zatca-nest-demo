import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsPositive, IsString, Matches, Max, Min, ValidateNested,
} from 'class-validator';

export class AddressDto {
  @IsString() street: string;
  @Matches(/^\d{4}$/, { message: 'رقم المبنى 4 أرقام' }) buildingNumber: string;
  @IsString() district: string;
  @IsString() city: string;
  @Matches(/^\d{5}$/, { message: 'الرمز البريدي 5 أرقام' }) postalCode: string;
  @IsOptional() @IsString() countryCode?: string;
}

export class BuyerDto {
  @IsString() name: string;
  @IsOptional() @Matches(/^3\d{13}3$/, { message: 'الرقم الضريبي 15 رقماً يبدأ وينتهي بـ 3' }) vatNumber?: string;
  @IsOptional() @ValidateNested() @Type(() => AddressDto) address?: AddressDto;
}

export class InvoiceLineDto {
  @IsString() name: string;
  @IsNumber() @IsPositive() quantity: number;
  @IsNumber() @Min(0) unitPrice: number;
  @IsOptional() @IsNumber() @Min(0) @Max(100) vatPercent?: number;
}

export class CreateInvoiceDto {
  @IsString() id: string;
  @IsIn(['standard', 'simplified']) category: 'standard' | 'simplified';
  @IsOptional() @IsIn(['invoice', 'credit', 'debit']) kind?: 'invoice' | 'credit' | 'debit';
  @IsOptional() @ValidateNested() @Type(() => BuyerDto) buyer?: BuyerDto;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines: InvoiceLineDto[];
  @IsOptional() @IsString() paymentMeansCode?: string;
  @IsOptional() @IsString() originalInvoiceId?: string;
  @IsOptional() @IsString() reason?: string;
}

export class OnboardDto {
  /** اختياري في بوابة المطورين (يُرسل 123345 تلقائياً). في المحاكاة والإنتاج يُستخرج من بوابة فاتورة */
  @IsOptional() @Matches(/^\d{6}$/, { message: 'رمز OTP من 6 أرقام' }) otp?: string;
  @IsOptional() force?: boolean;
}
