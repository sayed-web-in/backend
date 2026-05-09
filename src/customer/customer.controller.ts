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
import { CustomerService } from './customer.service.js';
import { CreateCustomerDto } from './dto/create-customer.dto.js';
import { UpdateCustomerDto } from './dto/update-customer.dto.js';
import { QuickTransactionDto } from './dto/quick-transaction.dto.js';
import { CreateCustomerTransactionDto } from './dto/create-customer-transaction.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PaginationDto } from '../common/pagination.dto.js';

@Controller('customers')
@UseGuards(JwtAuthGuard)
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.customerService.findAll(query);
  }

  @Get('summary')
  getSummary(@Query() query: PaginationDto) {
    return this.customerService.getSummary(query);
  }

  @Get('due')
  getDueCustomers(@Query() query: PaginationDto) {
    return this.customerService.getDueCustomers(query);
  }

  @Get(':id/stats')
  getStats(@Param('id', ParseIntPipe) id: number) {
    return this.customerService.getCustomerStats(id);
  }

  @Get(':id/transactions')
  listCustomerTransactions(@Param('id', ParseIntPipe) id: number) {
    return this.customerService.listCustomerTransactions(id);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.customerService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customerService.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customerService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.customerService.remove(id);
  }

  @Post(':id/transaction')
  addTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: QuickTransactionDto,
  ) {
    return this.customerService.addQuickTransaction(id, dto);
  }

  @Post(':id/transactions')
  createCustomerTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCustomerTransactionDto,
  ) {
    return this.customerService
      .createCustomerTransaction(id, dto)
      .then((data) => ({ data }));
  }

  @Delete(':id/transactions/:txId')
  deleteCustomerTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Param('txId', ParseIntPipe) txId: number,
  ) {
    return this.customerService.deleteCustomerTransaction(id, txId);
  }
}
