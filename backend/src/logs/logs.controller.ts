import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { LogsService, UploadLogsDto, ReviewLogDto } from './logs.service';

@Controller()
export class LogsController {
  constructor(private readonly logs: LogsService) {}

  @Post('faults/:faultId/logs/upload')
  upload(@Param('faultId') faultId: string, @Body() dto: UploadLogsDto) {
    return this.logs.upload(faultId, dto);
  }

  @Get('faults/:faultId/logs')
  list(@Param('faultId') faultId: string) {
    return this.logs.listForFault(faultId);
  }

  @Post('logs/:id/review')
  review(@Param('id') id: string, @Body() dto: ReviewLogDto) {
    return this.logs.review(id, dto);
  }
}
