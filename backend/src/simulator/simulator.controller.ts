import { BadRequestException, Body, Controller, Param, Post } from '@nestjs/common';
import { SimulatorService, SimScenario } from './simulator.service';

@Controller('simulator')
export class SimulatorController {
  constructor(private readonly simulator: SimulatorService) {}

  // 本地模拟：正常批次 / 重复批次 / 晚到批次
  @Post('faults/:faultId/logs/:scenario')
  simulate(
    @Param('faultId') faultId: string,
    @Param('scenario') scenario: string,
  ) {
    if (!['normal', 'duplicate', 'late'].includes(scenario))
      throw new BadRequestException('scenario 必须为 normal | duplicate | late');
    return this.simulator.simulate(faultId, scenario as SimScenario);
  }
}
