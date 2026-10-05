import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  FaultsService,
  RegisterFaultDto,
  RepairCloseDto,
} from './faults.service';

@Controller('faults')
export class FaultsController {
  constructor(private readonly faults: FaultsService) {}

  @Post()
  register(@Body() dto: RegisterFaultDto) {
    return this.faults.register(dto);
  }

  @Get()
  list(@Query('status') status?: 'ALERT' | 'REPAIR_CLOSED') {
    return this.faults.list(status);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.faults.detail(id);
  }

  @Post(':id/repair-close')
  repairClose(@Param('id') id: string, @Body() dto: RepairCloseDto) {
    return this.faults.repairClose(id, dto);
  }
}
