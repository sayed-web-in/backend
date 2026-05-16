import { Injectable } from '@nestjs/common';
import { CreateSaleDto } from './dto/create-sale.dto.js';
import { CompletePaylaterDto } from './dto/complete-paylater.dto.js';
import { AddSalePaymentDto } from './dto/add-sale-payment.dto.js';
import { CreateSaleReturnDto } from './dto/create-sale-return.dto.js';
import { UpdateSaleReturnDto } from './dto/update-sale-return.dto.js';
import { SaleQueryDto } from './dto/sale-query.dto.js';
import { ProductTransactionQueryDto } from './dto/product-transaction-query.dto.js';
import type { PayLaterQueryDto } from './dto/pay-later-query.dto.js';
import type { SaleReturnQueryDto } from './dto/sale-return-query.dto.js';
import { SaleCreateService } from './services/sale-create.service.js';
import { SalePaymentService } from './services/sale-payment.service.js';
import { SaleQueryService } from './services/sale-query.service.js';
import { SaleReturnService } from './services/sale-return.service.js';
import { SaleProductReportService } from './services/sale-product-report.service.js';

/**
 * Facade over domain-specific sale services (keeps controller & module imports stable).
 */
@Injectable()
export class SaleService {
  constructor(
    private readonly createSvc: SaleCreateService,
    private readonly paymentSvc: SalePaymentService,
    private readonly querySvc: SaleQueryService,
    private readonly returnSvc: SaleReturnService,
    private readonly productReportSvc: SaleProductReportService,
  ) {}

  createSale(dto: CreateSaleDto) {
    return this.createSvc.create(dto);
  }

  completePaylater(saleId: number, dto: CompletePaylaterDto) {
    return this.paymentSvc.completePayLater(saleId, dto);
  }

  getSalePayments(saleId: number) {
    return this.paymentSvc.listPayments(saleId);
  }

  addPayment(saleId: number, dto: AddSalePaymentDto) {
    return this.paymentSvc.addDuePayment(saleId, dto);
  }

  findAll(query: SaleQueryDto) {
    return this.querySvc.findAll(query);
  }

  getSaleListSummary(query: SaleQueryDto) {
    return this.querySvc.getSaleListSummary(query);
  }

  findOne(id: number) {
    return this.querySvc.findOne(id);
  }

  getPayLaterStats(query: PayLaterQueryDto) {
    return this.querySvc.getPayLaterStats(query);
  }

  getPayLaterSales(query: PayLaterQueryDto) {
    return this.querySvc.getPayLaterSales(query);
  }

  findReturns(query: SaleReturnQueryDto) {
    return this.returnSvc.findReturns(query);
  }

  getSaleReturnSummary(query: SaleReturnQueryDto) {
    return this.returnSvc.getSaleReturnSummary(query);
  }

  findReturnOne(returnId: number) {
    return this.returnSvc.findReturnOne(returnId);
  }

  createReturn(dto: CreateSaleReturnDto) {
    return this.returnSvc.createReturn(dto);
  }

  updateSaleReturn(returnId: number, dto: UpdateSaleReturnDto) {
    return this.returnSvc.updateSaleReturn(returnId, dto);
  }

  recordReturnCashRefund(
    returnId: number,
    dto: { paymentAmount: number; refundAccountId: number },
  ) {
    return this.returnSvc.recordReturnCashRefund(returnId, dto);
  }

  getProductTransactions(query: ProductTransactionQueryDto) {
    return this.productReportSvc.getProductTransactions(query);
  }

  searchBySerial(serial: string) {
    return this.productReportSvc.searchBySerial(serial);
  }
}
