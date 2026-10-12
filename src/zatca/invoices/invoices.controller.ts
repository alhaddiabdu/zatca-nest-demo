import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { InvoicesQueryDto } from './invoices-query.dto';
import { InvoicesService } from './invoices.service';

@Controller('zatca/invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  /** جدول الفواتير مع الفلترة والترقيم */
  @Get()
  list(@Query() query: InvoicesQueryDto) {
    return this.invoices.list(query);
  }

  /** تفاصيل فاتورة: الحالة، رد الهيئة، صورة QR (بدون الـ XML الكامل) */
  @Get(':id')
  detail(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.invoices.detail(id);
  }

  /** الـ XML: ?version=signed|cleared. أضف ?dryRun=true عند البحث برقم فاتورة تجربة */
  @Get(':id/xml')
  @Header('Content-Type', 'application/xml; charset=utf-8')
  xml(
    @Param('id') id: string,
    @Query('version') version?: 'signed' | 'cleared',
    @Query('dryRun') dryRun?: string,
  ) {
    return this.invoices.xml(id, version === 'signed' || version === 'cleared' ? version : undefined, dryRun === 'true');
  }
}
