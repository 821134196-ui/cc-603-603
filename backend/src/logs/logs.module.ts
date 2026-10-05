import { Module } from '@nestjs/common';
import { LogsService } from './logs.service';
import { LogsController } from './logs.controller';
import { TripsModule } from '../trips/trips.module';

@Module({
  imports: [TripsModule],
  providers: [LogsService],
  controllers: [LogsController],
  exports: [LogsService],
})
export class LogsModule {}
