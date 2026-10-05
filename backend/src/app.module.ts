import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { GatesModule } from './gates/gates.module';
import { FaultsModule } from './faults/faults.module';
import { LogsModule } from './logs/logs.module';
import { TripsModule } from './trips/trips.module';
import { TicketsModule } from './tickets/tickets.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { SimulatorModule } from './simulator/simulator.module';

@Module({
  imports: [
    PrismaModule,
    GatesModule,
    FaultsModule,
    LogsModule,
    TripsModule,
    TicketsModule,
    DashboardModule,
    SimulatorModule,
  ],
})
export class AppModule {}
