import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TicketsService, CloseTicketDto } from './tickets.service';

@Controller()
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get('tickets')
  list(@Query('status') status?: 'OPEN' | 'CLOSED') {
    return this.tickets.list(status);
  }

  @Get('faults/:faultId/ticket')
  detailByFault(@Param('faultId') faultId: string) {
    return this.tickets.detailByFault(faultId);
  }

  @Post('tickets/:id/close')
  close(@Param('id') id: string, @Body() dto: CloseTicketDto) {
    return this.tickets.close(id, dto);
  }
}
