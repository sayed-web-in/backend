import { Module } from '@nestjs/common';
import { UnitService } from './unit.service.js';
import { UnitController } from './unit.controller.js';

@Module({
  controllers: [UnitController],
  providers: [UnitService],
  exports: [UnitService],
})
export class UnitModule {}
