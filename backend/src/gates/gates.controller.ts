import { Controller, Get } from '@nestjs/common';
import { GatesService } from './gates.service';

@Controller('gates')
export class GatesController {
  constructor(private readonly gates: GatesService) {}

  @Get()
  list() {
    return this.gates.list();
  }
}
