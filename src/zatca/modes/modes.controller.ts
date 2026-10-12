import { Body, Controller, Get, Put } from '@nestjs/common';
import { ModeService } from './mode.service';
import { SetModeDto } from './set-mode.dto';

@Controller('zatca')
export class ModesController {
  constructor(private readonly modes: ModeService) {}

  /** البطاقات الثلاث: حالة كل وضع وعدد فواتيره */
  @Get('modes')
  list() {
    return this.modes.listModes();
  }

  @Get('mode')
  async get() {
    return { active: await this.modes.getActive() };
  }

  /** التحويل إلى core يتطلب confirm: "CORE" */
  @Put('mode')
  set(@Body() dto: SetModeDto) {
    return this.modes.setMode(dto.mode, dto.confirm);
  }
}
