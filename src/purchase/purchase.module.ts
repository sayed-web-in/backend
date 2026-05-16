import { Module } from '@nestjs/common';
import { PurchaseService } from './purchase.service.js';
import { PurchaseController } from './purchase.controller.js';
import { PurchaseCreateService } from './services/purchase-create.service.js';
import { PurchaseQueryService } from './services/purchase-query.service.js';
import { PurchaseReturnService } from './services/purchase-return.service.js';

@Module({
  controllers: [PurchaseController],
  providers: [
    PurchaseCreateService,
    PurchaseQueryService,
    PurchaseReturnService,
    PurchaseService,
  ],
  exports: [
    PurchaseService,
    PurchaseCreateService,
    PurchaseQueryService,
    PurchaseReturnService,
  ],
})
export class PurchaseModule {}
