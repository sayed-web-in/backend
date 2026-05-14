import { Module } from '@nestjs/common';
import { ReportService } from './report.service.js';
import { ReportController } from './report.controller.js';
import { ReportCostingService } from './report-costing.service.js';
import { CustomerReportService } from './services/customer-report.service.js';
import { ExpenseReportService } from './services/expense-report.service.js';
import { IncomeReportService } from './services/income-report.service.js';
import { ProductReportsService } from './services/product-reports.service.js';
import { ProfitLossReportService } from './services/profit-loss-report.service.js';
import { PurchaseReportService } from './services/purchase-report.service.js';
import { SalesReportService } from './services/sales-report.service.js';
import { StockReportService } from './services/stock-report.service.js';
import { SupplierReportService } from './services/supplier-report.service.js';

@Module({
  controllers: [ReportController],
  providers: [
    ReportCostingService,
    SalesReportService,
    PurchaseReportService,
    StockReportService,
    SupplierReportService,
    CustomerReportService,
    ProductReportsService,
    ExpenseReportService,
    IncomeReportService,
    ProfitLossReportService,
    ReportService,
  ],
  exports: [ReportService, ReportCostingService],
})
export class ReportModule {}
