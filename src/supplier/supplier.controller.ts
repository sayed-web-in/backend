import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { SupplierService } from './supplier.service.js';
import { CreateSupplierDto } from './dto/create-supplier.dto.js';
import { UpdateSupplierDto } from './dto/update-supplier.dto.js';
import { QuickPaymentDto } from './dto/quick-payment.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { SupplierQueryDto } from './dto/supplier-query.dto.js';
import { PaginationDto } from '../common/pagination.dto.js';
import { CreateSupplierTransactionDto } from './dto/create-supplier-transaction.dto.js';

@Controller('suppliers')
@UseGuards(JwtAuthGuard)
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get()
  findAll(@Query() query: SupplierQueryDto) {
    return this.supplierService.findAll(query);
  }

  @Get('summary')
  getSummary(@Query() query: SupplierQueryDto) {
    return this.supplierService.getSummary(query);
  }

  @Get(':id/stats')
  getStats(@Param('id', ParseIntPipe) id: number) {
    return this.supplierService.getStats(id);
  }

  @Get(':id/transactions')
  listTransactions(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: PaginationDto,
  ) {
    return this.supplierService.listTransactions(id, query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.supplierService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSupplierDto) {
    return this.supplierService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.supplierService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.supplierService.remove(id);
  }

  @Post(':id/transactions')
  addCustomTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateSupplierTransactionDto,
  ) {
    return this.supplierService.addCustomTransaction(id, dto);
  }

  @Post(':id/payment')
  addPayment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuickPaymentDto,
  ) {
    return this.supplierService.addQuickPayment(id, dto);
  }
}
