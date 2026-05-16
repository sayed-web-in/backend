import { Injectable } from '@nestjs/common';
import { CreatePurchaseDto } from './dto/create-purchase.dto.js';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto.js';
import { PurchaseQueryDto } from './dto/purchase-query.dto.js';
import { PurchaseCreateService } from './services/purchase-create.service.js';
import { PurchaseQueryService } from './services/purchase-query.service.js';
import { PurchaseReturnService } from './services/purchase-return.service.js';

/** Facade — keeps controller and module imports stable. */
@Injectable()
export class PurchaseService {
  constructor(
    private readonly createSvc: PurchaseCreateService,
    private readonly querySvc: PurchaseQueryService,
    private readonly returnSvc: PurchaseReturnService,
  ) {}

  create(dto: CreatePurchaseDto) {
    return this.createSvc.create(dto);
  }
  findAll(query: PurchaseQueryDto) {
    return this.querySvc.findAll(query);
  }
  getSummary(query: PurchaseQueryDto) {
    return this.querySvc.getSummary(query);
  }
  findOne(id: number) {
    return this.querySvc.findOne(id);
  }
  getPurchaseProducts(query: PurchaseQueryDto) {
    return this.querySvc.getPurchaseProducts(query);
  }

  createReturn(dto: CreatePurchaseReturnDto) {
    return this.returnSvc.createReturn(dto);
  }
  findReturns(query: PurchaseQueryDto) {
    return this.returnSvc.findReturns(query);
  }
  findReturnOne(returnId: number) {
    return this.returnSvc.findReturnOne(returnId);
  }
  getReturnSummary(query: PurchaseQueryDto) {
    return this.returnSvc.getReturnSummary(query);
  }
}
