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
import { CreateSaleReturnDto } from './dto/create-sale-return.dto.js';
import { SaleQueryDto } from './dto/sale-query.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PaginationDto } from '../common/pagination.dto.js';

@Controller('sales')
@UseGuards(JwtAuthGuard)
export class SaleController {
  constructor(private readonly saleService: SaleService) {}

  @Post()
  create(@Body() dto: CreateSaleDto) {
    return this.saleService.createSale(dto);
  }

  @Get()
  findAll(@Query() query: SaleQueryDto) {
    return this.saleService.findAll(query);
  }

  @Get('pay-later')
  getPayLaterSales(@Query() query: PaginationDto) {
    return this.saleService.getPayLaterSales(query);
  }

  @Get('serial/:serial')
  searchBySerial(@Param('serial') serial: string) {
    return this.saleService.searchBySerial(serial);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.saleService.findOne(id);
  }

  @Post(':id/complete')
  completePaylater(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompletePaylaterDto,
  ) {
    return this.saleService.completePaylater(id, dto);
  }

  @Post('return')
  createReturn(@Body() dto: CreateSaleReturnDto) {
    return this.saleService.createReturn(dto);
  }
}
