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
import { StockService } from './stock.service.js';
import { CreateAdjustmentDto } from './dto/create-adjustment.dto.js';
import { CreateTransferDto } from './dto/create-transfer.dto.js';
import { StockQueryDto } from './dto/stock-query.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('stock')
@UseGuards(JwtAuthGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post('adjustment')
  createAdjustment(@Body() dto: CreateAdjustmentDto) {
    return this.stockService.createAdjustment(dto);
  }

  @Get('adjustments')
  getAdjustments(@Query() query: StockQueryDto) {
    return this.stockService.getAdjustments(query);
  }

  @Post('transfer')
  createTransfer(@Body() dto: CreateTransferDto) {
    return this.stockService.createTransfer(dto);
  }

  @Get('transfers')
  getTransfers(@Query() query: StockQueryDto) {
    return this.stockService.getTransfers(query);
  }

  @Post('transfers/:id/complete')
  completeTransfer(@Param('id', ParseIntPipe) id: number) {
    return this.stockService.completeTransfer(id);
  }

  @Get('report')
  getStockReport(@Query('branchId', ParseIntPipe) branchId: number) {
    return this.stockService.getStockReport(branchId);
  }
}
