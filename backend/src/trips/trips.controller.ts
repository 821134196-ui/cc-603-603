import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  TripsService,
  RegisterTripDto,
  RefundDto,
} from './trips.service';

@Controller('trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.trips.get(id);
  }

  @Post(':id/register')
  register(@Param('id') id: string, @Body() dto: RegisterTripDto) {
    return this.trips.register(id, dto);
  }

  @Post(':id/refund')
  refund(@Param('id') id: string, @Body() dto: RefundDto) {
    return this.trips.refund(id, dto);
  }
}
