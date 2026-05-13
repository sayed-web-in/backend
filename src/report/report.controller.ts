import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportService } from './report.service.js';
import { ReportQueryDto } from './dto/report-query.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportController {
  constructor(private readonly reportService: ReportService) {}

  @Get('sales')
  salesReport(@Query() query: ReportQueryDto) {
    return this.reportService.salesReport(query);
  }

  @Get('purchase')
  purchaseReport(@Query() query: ReportQueryDto) {
    return this.reportService.purchaseReport(query);
  }

  @Get('stock')
  stockReport(@Query() query: ReportQueryDto) {
    return this.reportService.stockReport(query);
  }

  @Get('supplier')
  supplierReport(@Query() query: ReportQueryDto) {
    return this.reportService.supplierReport(query);
  }

  @Get('customer')
  customerReport(@Query() query: ReportQueryDto) {
    return this.reportService.customerReport(query);
  }

  @Get('product')
  productReport(@Query() query: ReportQueryDto) {
    return this.reportService.productReport(query);
  }

  @Get('product-expiry')
  productExpiryReport(@Query() query: ReportQueryDto) {
    return this.reportService.productExpiryReport(query);
  }

  @Get('product-quantity')
  productQuantityReport(@Query() query: ReportQueryDto) {
    return this.reportService.productQuantityReport(query);
  }

  @Get('expense')
  expenseReport(@Query() query: ReportQueryDto) {
    return this.reportService.expenseReport(query);
  }

  @Get('income')
  incomeReport(@Query() query: ReportQueryDto) {
    return this.reportService.incomeReport(query);
  }

  @Get('profit-loss')
  profitLossReport(@Query() query: ReportQueryDto) {
    return this.reportService.profitLossReport(query);
  }
}
