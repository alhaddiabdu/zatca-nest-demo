import { Body, Controller, Get, Header, HttpCode, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { CreateInvoiceDto, OnboardDto } from './dto/create-invoice.dto';
import { InvoiceService } from './invoice.service';
import { OnboardingService } from './onboarding.service';
import { EgsStoreService } from './storage/egs-store.service';

@Controller('zatca')
export class ZatcaController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly invoices: InvoiceService,
    private readonly store: EgsStoreService,
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

  /** عرض XML الموقّع لفاتورة محفوظة. أضف ?dryRun=true لفواتير التجربة */
  @Get('invoices/:id/xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  xml(@Param('id') id: string, @Query('dryRun') dryRun?: string) {
    const xml = this.store.readInvoiceXml(dryRun === 'true' ? `dryrun-${id}` : id);
    if (xml === null) throw new NotFoundException('الفاتورة غير موجودة');
    return xml;
  }
}
