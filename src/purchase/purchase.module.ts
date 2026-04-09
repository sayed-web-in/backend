import { Module } from '@nestjs/common';
import { PurchaseService } from './purchase.service.js';
import { PurchaseController } from './purchase.controller.js';

@Module({
  controllers: [PurchaseController],
  providers: [PurchaseService],
  exports: [PurchaseService],
})
export class PurchaseModule {}
