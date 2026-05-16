import { Module } from '@nestjs/common';
import { SaleService } from './sale.service.js';
import { SaleController } from './sale.controller.js';
import { SaleCreateService } from './services/sale-create.service.js';
import { SalePaymentService } from './services/sale-payment.service.js';
import { SaleQueryService } from './services/sale-query.service.js';
import { SaleReturnService } from './services/sale-return.service.js';
import { SaleProductReportService } from './services/sale-product-report.service.js';

@Module({
  controllers: [SaleController],
  providers: [
    SaleCreateService,
    SalePaymentService,
    SaleQueryService,
    SaleReturnService,
    SaleProductReportService,
    SaleService,
  ],
  exports: [
    SaleService,
    SaleCreateService,
    SalePaymentService,
    SaleQueryService,
    SaleReturnService,
    SaleProductReportService,
  ],
})
export class SaleModule {}
