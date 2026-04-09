import { Module } from '@nestjs/common';
import { SaleService } from './sale.service.js';
import { SaleController } from './sale.controller.js';

@Module({
  controllers: [SaleController],
  providers: [SaleService],
  exports: [SaleService],
})
export class SaleModule {}
