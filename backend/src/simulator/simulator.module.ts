import { Module } from '@nestjs/common';
import { SimulatorService } from './simulator.service';
import { SimulatorController } from './simulator.controller';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [LogsModule],
  providers: [SimulatorService],
  controllers: [SimulatorController],
})
export class SimulatorModule {}
