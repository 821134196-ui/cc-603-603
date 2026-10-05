import { Module } from '@nestjs/common';
import { IncidentsModule } from './incidents';
import { LogsModule } from './logs';
import { TripsModule } from './trips';
import { OrdersModule } from './orders';
import { DashboardModule } from './dashboard';

@Module({
  imports: [IncidentsModule, LogsModule, TripsModule, OrdersModule, DashboardModule],
})
export class AppModule {}
