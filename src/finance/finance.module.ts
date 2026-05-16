import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service.js';
import { FinanceController } from './finance.controller.js';
import { ReportModule } from '../report/report.module.js';
import { FinanceAccountService } from './services/finance-account.service.js';
import { FinanceExpenseService } from './services/finance-expense.service.js';
import { FinanceIncomeService } from './services/finance-income.service.js';
import { FinanceReportService } from './services/finance-report.service.js';
import { FinanceTaxService } from './services/finance-tax.service.js';

@Module({
  imports: [ReportModule],
  controllers: [FinanceController],
  providers: [
    FinanceAccountService,
    FinanceExpenseService,
    FinanceIncomeService,
    FinanceReportService,
    FinanceTaxService,
    FinanceService,
  ],
  exports: [
    FinanceService,
    FinanceAccountService,
    FinanceExpenseService,
    FinanceIncomeService,
    FinanceReportService,
    FinanceTaxService,
  ],
})
export class FinanceModule {}
