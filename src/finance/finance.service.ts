import { Injectable } from '@nestjs/common';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { TransferFundsDto } from './dto/transfer-funds.dto.js';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { CreateIncomeCategoryDto } from './dto/create-income-category.dto.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';
import { CreateTaxRateDto } from './dto/create-tax-rate.dto.js';
import { FinanceQueryDto } from './dto/finance-query.dto.js';
import { FinanceAccountService } from './services/finance-account.service.js';
import { FinanceExpenseService } from './services/finance-expense.service.js';
import { FinanceIncomeService } from './services/finance-income.service.js';
import { FinanceReportService } from './services/finance-report.service.js';
import { FinanceTaxService } from './services/finance-tax.service.js';

/** Facade — keeps controller and module imports stable. */
@Injectable()
export class FinanceService {
  constructor(
    private readonly accountSvc: FinanceAccountService,
    private readonly expenseSvc: FinanceExpenseService,
    private readonly incomeSvc: FinanceIncomeService,
    private readonly reportSvc: FinanceReportService,
    private readonly taxSvc: FinanceTaxService,
  ) {}

  getAccounts() {
    return this.accountSvc.getAccounts();
  }
  createAccount(dto: CreateAccountDto) {
    return this.accountSvc.createAccount(dto);
  }
  updateAccount(id: number, dto: Partial<CreateAccountDto>) {
    return this.accountSvc.updateAccount(id, dto);
  }
  deleteAccount(id: number) {
    return this.accountSvc.deleteAccount(id);
  }
  getTransactions(query: FinanceQueryDto) {
    return this.accountSvc.getTransactions(query);
  }
  createTransaction(dto: CreateTransactionDto) {
    return this.accountSvc.createTransaction(dto);
  }
  transferFunds(dto: TransferFundsDto) {
    return this.accountSvc.transferFunds(dto);
  }

  getExpenseCategories() {
    return this.expenseSvc.getExpenseCategories();
  }
  createExpenseCategory(dto: CreateExpenseCategoryDto) {
    return this.expenseSvc.createExpenseCategory(dto);
  }
  updateExpenseCategory(id: number, dto: Partial<CreateExpenseCategoryDto>) {
    return this.expenseSvc.updateExpenseCategory(id, dto);
  }
  deleteExpenseCategory(id: number) {
    return this.expenseSvc.deleteExpenseCategory(id);
  }
  getExpenses(query: FinanceQueryDto) {
    return this.expenseSvc.getExpenses(query);
  }
  getExpenseSummary(query: FinanceQueryDto) {
    return this.expenseSvc.getExpenseSummary(query);
  }
  createExpense(dto: CreateExpenseDto) {
    return this.expenseSvc.createExpense(dto);
  }
  updateExpense(id: number, dto: Partial<CreateExpenseDto>) {
    return this.expenseSvc.updateExpense(id, dto);
  }
  deleteExpense(id: number) {
    return this.expenseSvc.deleteExpense(id);
  }

  getIncomeCategories() {
    return this.incomeSvc.getIncomeCategories();
  }
  createIncomeCategory(dto: CreateIncomeCategoryDto) {
    return this.incomeSvc.createIncomeCategory(dto);
  }
  updateIncomeCategory(id: number, dto: Partial<CreateIncomeCategoryDto>) {
    return this.incomeSvc.updateIncomeCategory(id, dto);
  }
  deleteIncomeCategory(id: number) {
    return this.incomeSvc.deleteIncomeCategory(id);
  }
  getIncomes(query: FinanceQueryDto) {
    return this.incomeSvc.getIncomes(query);
  }
  getIncomeSummary(query: FinanceQueryDto) {
    return this.incomeSvc.getIncomeSummary(query);
  }
  createIncome(dto: CreateIncomeDto) {
    return this.incomeSvc.createIncome(dto);
  }
  updateIncome(id: number, dto: Partial<CreateIncomeDto>) {
    return this.incomeSvc.updateIncome(id, dto);
  }
  deleteIncome(id: number) {
    return this.incomeSvc.deleteIncome(id);
  }

  getTrialBalance(branchId?: number) {
    return this.reportSvc.getTrialBalance(branchId);
  }
  getCashFlow(dateFrom?: string, dateTo?: string) {
    return this.reportSvc.getCashFlow(dateFrom, dateTo);
  }
  getAccountStatement(accountId: number, dateFrom?: string, dateTo?: string) {
    return this.reportSvc.getAccountStatement(accountId, dateFrom, dateTo);
  }
  getProfitAndLoss(dateFrom?: string, dateTo?: string) {
    return this.reportSvc.getProfitAndLoss(dateFrom, dateTo);
  }

  getTaxRates() {
    return this.taxSvc.getTaxRates();
  }
  createTaxRate(dto: CreateTaxRateDto) {
    return this.taxSvc.createTaxRate(dto);
  }
  updateTaxRate(id: number, dto: Partial<CreateTaxRateDto>) {
    return this.taxSvc.updateTaxRate(id, dto);
  }
  deleteTaxRate(id: number) {
    return this.taxSvc.deleteTaxRate(id);
  }
}
