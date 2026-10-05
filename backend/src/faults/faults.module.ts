import { Module } from '@nestjs/common';
import { FaultsService } from './faults.service';
import { FaultsController } from './faults.controller';

@Module({
  providers: [FaultsService],
  controllers: [FaultsController],
  exports: [FaultsService],
})
export class FaultsModule {}
