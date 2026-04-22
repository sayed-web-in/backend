import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { PurchaseService } from './purchase.service.js';
import { CreatePurchaseDto } from './dto/create-purchase.dto.js';
import { CreatePurchaseReturnDto } from './dto/create-purchase-return.dto.js';
import { PurchaseQueryDto } from './dto/purchase-query.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('purchases')
@UseGuards(JwtAuthGuard)
export class PurchaseController {
  constructor(private readonly purchaseService: PurchaseService) {}

  @Post()
  create(@Body() dto: CreatePurchaseDto) {
    return this.purchaseService.create(dto);
  }

  @Get()
  findAll(@Query() query: PurchaseQueryDto) {
    return this.purchaseService.findAll(query);
  }

  @Get('summary')
  getSummary(@Query() query: PurchaseQueryDto) {
    return this.purchaseService.getSummary(query);
  }

  @Get('returns')
  findReturns(@Query() query: PurchaseQueryDto) {
    return this.purchaseService.findReturns(query);
  }

  @Get('returns/summary')
  getReturnSummary(@Query() query: PurchaseQueryDto) {
    return this.purchaseService.getReturnSummary(query);
  }

  @Get('products')
  getPurchaseProducts(@Query() query: PurchaseQueryDto) {
    return this.purchaseService.getPurchaseProducts(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.purchaseService.findOne(id);
  }

  @Post('return')
  createReturn(@Body() dto: CreatePurchaseReturnDto) {
    return this.purchaseService.createReturn(dto);
  }
}
