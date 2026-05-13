import { Injectable } from '@nestjs/common';
import { ReportQueryDto } from './dto/report-query.dto.js';
import { CustomerReportService } from './services/customer-report.service.js';
import { ExpenseReportService } from './services/expense-report.service.js';
import { IncomeReportService } from './services/income-report.service.js';
import { ProductReportsService } from './services/product-reports.service.js';
import { ProfitLossReportService } from './services/profit-loss-report.service.js';
import { PurchaseReportService } from './services/purchase-report.service.js';
import { SalesReportService } from './services/sales-report.service.js';
import { StockReportService } from './services/stock-report.service.js';
import { SupplierReportService } from './services/supplier-report.service.js';

/**
 * Facade over per-domain report services. Keeps `ReportController` stable and
 * routes each endpoint to a small, maintainable file under `services/`.
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly sales: SalesReportService,
    private readonly purchase: PurchaseReportService,
    private readonly stock: StockReportService,
    private readonly supplier: SupplierReportService,
    private readonly customer: CustomerReportService,
    private readonly products: ProductReportsService,
    private readonly expense: ExpenseReportService,
    private readonly income: IncomeReportService,
    private readonly profitLoss: ProfitLossReportService,
  ) {}

  salesReport(query: ReportQueryDto) {
    return this.sales.salesReport(query);
  }

  purchaseReport(query: ReportQueryDto) {
    return this.purchase.purchaseReport(query);
  }

  stockReport(query: ReportQueryDto) {
    return this.stock.stockReport(query);
  }

  supplierReport(query: ReportQueryDto) {
    return this.supplier.supplierReport(query);
  }

  customerReport(query: ReportQueryDto) {
    return this.customer.customerReport(query);
  }

  productReport(query: ReportQueryDto) {
    return this.products.productReport(query);
  }

  productExpiryReport(query: ReportQueryDto) {
    return this.products.productExpiryReport(query);
  }

  productQuantityReport(query: ReportQueryDto) {
    return this.products.productQuantityReport(query);
  }

  expenseReport(query: ReportQueryDto) {
    return this.expense.expenseReport(query);
  }

  incomeReport(query: ReportQueryDto) {
    return this.income.incomeReport(query);
  }

  profitLossReport(query: ReportQueryDto) {
    return this.profitLoss.profitLossReport(query);
  }
}
