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
import { SaleService } from './sale.service.js';
import { CreateSaleDto } from './dto/create-sale.dto.js';
import { CompletePaylaterDto } from './dto/complete-paylater.dto.js';
import { AddSalePaymentDto } from './dto/add-sale-payment.dto.js';
import { CreateSaleReturnDto } from './dto/create-sale-return.dto.js';
import { SaleQueryDto } from './dto/sale-query.dto.js';
import { PayLaterQueryDto } from './dto/pay-later-query.dto.js';
import { SaleReturnQueryDto } from './dto/sale-return-query.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('sales')
@UseGuards(JwtAuthGuard)
export class SaleController {
  constructor(private readonly saleService: SaleService) {}

  @Post()
  create(@Body() dto: CreateSaleDto) {
    return this.saleService.createSale(dto);
  }

  /** Aggregates for overview cards (same filters as list, not paginated). */
  @Get('summary')
  getSaleSummary(@Query() query: SaleQueryDto) {
    return this.saleService.getSaleListSummary(query);
  }

  @Get('returns/summary')
  getReturnsSummary(@Query() query: SaleReturnQueryDto) {
    return this.saleService.getSaleReturnSummary(query);
  }

  @Get('returns')
  findReturns(@Query() query: SaleReturnQueryDto) {
    return this.saleService.findReturns(query);
  }

  @Get('pay-later/stats')
  getPayLaterStats(@Query() query: PayLaterQueryDto) {
    return this.saleService.getPayLaterStats(query);
  }

  @Get('pay-later')
  getPayLaterSales(@Query() query: PayLaterQueryDto) {
    return this.saleService.getPayLaterSales(query);
  }

  @Get('serial/:serial')
  searchBySerial(@Param('serial') serial: string) {
    return this.saleService.searchBySerial(serial);
  }

  @Get()
  findAll(@Query() query: SaleQueryDto) {
    return this.saleService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.saleService.findOne(id);
  }

  @Get(':id/payments')
  getSalePayments(@Param('id', ParseIntPipe) id: number) {
    return this.saleService.getSalePayments(id);
  }

  /** Static path before `:id/complete` so Nest never mis-matches `return`. */
  @Post('return')
  createReturn(@Body() dto: CreateSaleReturnDto) {
    return this.saleService.createReturn(dto);
  }

  @Post(':id/complete')
  completePaylater(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompletePaylaterDto,
  ) {
    return this.saleService.completePaylater(id, dto);
  }

  @Post(':id/payments')
  addPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddSalePaymentDto,
  ) {
    return this.saleService.addPayment(id, dto);
  }
}
