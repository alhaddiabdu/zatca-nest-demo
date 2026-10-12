import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CreateInvoiceDto, OnboardDto } from './dto/create-invoice.dto';
import { InvoiceService } from './invoice.service';
import { OnboardingService } from './onboarding.service';

@Controller('zatca')
export class ZatcaController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly invoices: InvoiceService,
  ) {}

  /** حالة الوحدة: هل هي مسجلة، وآخر عداد وتجزئة */
  @Get('status')
  status() {
    return this.onboarding.status();
  }

  /** التسجيل الكامل: CSR ← شهادة امتثال ← فحوصات ← شهادة إنتاج */
  @Post('onboard')
  @HttpCode(200)
  onboard(@Body() dto: OnboardDto) {
    return this.onboarding.onboard(dto.otp, !!dto.force);
  }

  /** إصدار فاتورة وإرسالها. أضف ?dryRun=true للتجربة بدون إرسال */
  @Post('invoices')
  @HttpCode(200)
  issue(@Body() dto: CreateInvoiceDto, @Query('dryRun') dryRun?: string) {
    return this.invoices.issue(dto, dryRun === 'true');
  }

  /** إعادة إرسال الفواتير المعلقة */
  @Post('invoices/retry-pending')
  @HttpCode(200)
  retry() {
    return this.invoices.retryPending();
  }
}
