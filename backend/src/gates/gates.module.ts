import { Module } from '@nestjs/common';
import { GatesService } from './gates.service';
import { GatesController } from './gates.controller';

@Module({
  providers: [GatesService],
  controllers: [GatesController],
  exports: [GatesService],
})
export class GatesModule {}
