import { Body, Controller, Get, Param, Put, ValidationPipe } from '@nestjs/common';
import { EnvironmentsService } from './environments.service';
import { UpdateSettingsDto } from './settings.dto';

/**
 * تحقق صارم: أي حقل غير معروف يُرفض (400) بدل حذفه بصمت.
 * الـ body معرّف كـ object حتى يتجاوزه الـ ValidationPipe العام (whitelist يحذف الحقول الزائدة
 * قبل أن تصل لهنا)، ويتحقق منه هذا الـ pipe وحده عبر expectedType.
 */
const strictSettingsPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  expectedType: UpdateSettingsDto,
});

@Controller('zatca/environments')
export class EnvironmentsController {
  constructor(private readonly environments: EnvironmentsService) {}

  @Get(':env/settings')
  async get(@Param('env') env: string) {
    return this.environments.settingsView(await this.environments.get(env));
  }

  @Put(':env/settings')
  update(@Param('env') env: string, @Body(strictSettingsPipe) body: object) {
    return this.environments.updateSettings(env, body as UpdateSettingsDto);
  }
}
