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
import { FinanceService } from './finance.service.js';
import { CreateAccountDto } from './dto/create-account.dto.js';
import { CreateTransactionDto } from './dto/create-transaction.dto.js';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto.js';
import { CreateExpenseDto } from './dto/create-expense.dto.js';
import { CreateIncomeCategoryDto } from './dto/create-income-category.dto.js';
import { CreateIncomeDto } from './dto/create-income.dto.js';
import { CreateTaxRateDto } from './dto/create-tax-rate.dto.js';
import { FinanceQueryDto } from './dto/finance-query.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Public } from '../auth/public.decorator.js';

@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  // ─── ACCOUNTS ───────────────────────────────────────────────

  @Get('accounts')
  getAccounts() {
    return this.financeService.getAccounts();
  }

  @Post('accounts')
  createAccount(@Body() dto: CreateAccountDto) {
    return this.financeService.createAccount(dto);
  }

  @Patch('accounts/:id')
  updateAccount(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateAccountDto>,
  ) {
    return this.financeService.updateAccount(id, dto);
  }

  @Delete('accounts/:id')
  deleteAccount(@Param('id', ParseIntPipe) id: number) {
    return this.financeService.deleteAccount(id);
  }

  // ─── TRANSACTIONS ──────────────────────────────────────────

  @Get('transactions')
  getTransactions(@Query() query: FinanceQueryDto) {
    return this.financeService.getTransactions(query);
  }

  @Post('transactions')
  createTransaction(@Body() dto: CreateTransactionDto) {
    return this.financeService.createTransaction(dto);
  }

  // ─── EXPENSE CATEGORIES ────────────────────────────────────

  @Get('expense-categories')
  getExpenseCategories() {
    return this.financeService.getExpenseCategories();
  }

  @Post('expense-categories')
  createExpenseCategory(@Body() dto: CreateExpenseCategoryDto) {
    return this.financeService.createExpenseCategory(dto);
  }

  @Patch('expense-categories/:id')
  updateExpenseCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateExpenseCategoryDto>,
  ) {
    return this.financeService.updateExpenseCategory(id, dto);
  }

  @Delete('expense-categories/:id')
  deleteExpenseCategory(@Param('id', ParseIntPipe) id: number) {
    return this.financeService.deleteExpenseCategory(id);
  }

  // ─── EXPENSES ──────────────────────────────────────────────

  @Get('expenses')
  getExpenses(@Query() query: FinanceQueryDto) {
    return this.financeService.getExpenses(query);
  }

  @Get('expenses/summary')
  getExpenseSummary(@Query() query: FinanceQueryDto) {
    return this.financeService.getExpenseSummary(query);
  }

  @Post('expenses')
  createExpense(@Body() dto: CreateExpenseDto) {
    return this.financeService.createExpense(dto);
  }

  @Patch('expenses/:id')
  updateExpense(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateExpenseDto>,
  ) {
    return this.financeService.updateExpense(id, dto);
  }

  @Delete('expenses/:id')
  deleteExpense(@Param('id', ParseIntPipe) id: number) {
    return this.financeService.deleteExpense(id);
  }

  // ─── INCOME CATEGORIES ────────────────────────────────────

  @Get('income-categories')
  getIncomeCategories() {
    return this.financeService.getIncomeCategories();
  }

  @Post('income-categories')
  createIncomeCategory(@Body() dto: CreateIncomeCategoryDto) {
    return this.financeService.createIncomeCategory(dto);
  }

  @Patch('income-categories/:id')
  updateIncomeCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateIncomeCategoryDto>,
  ) {
    return this.financeService.updateIncomeCategory(id, dto);
  }

  @Delete('income-categories/:id')
  deleteIncomeCategory(@Param('id', ParseIntPipe) id: number) {
    return this.financeService.deleteIncomeCategory(id);
  }

  // ─── INCOMES ───────────────────────────────────────────────

  @Get('incomes')
  getIncomes(@Query() query: FinanceQueryDto) {
    return this.financeService.getIncomes(query);
  }

  @Get('incomes/summary')
  getIncomeSummary(@Query() query: FinanceQueryDto) {
    return this.financeService.getIncomeSummary(query);
  }

  @Post('incomes')
  createIncome(@Body() dto: CreateIncomeDto) {
    return this.financeService.createIncome(dto);
  }

  @Patch('incomes/:id')
  updateIncome(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateIncomeDto>,
  ) {
    return this.financeService.updateIncome(id, dto);
  }

  @Delete('incomes/:id')
  deleteIncome(@Param('id', ParseIntPipe) id: number) {
    return this.financeService.deleteIncome(id);
  }

  // ─── REPORTS ───────────────────────────────────────────────

  @Get('trial-balance')
  getTrialBalance() {
    return this.financeService.getTrialBalance();
  }

  @Get('cash-flow')
  getCashFlow(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.financeService.getCashFlow(dateFrom, dateTo);
  }

  @Get('account-statement')
  getAccountStatement(
    @Query('accountId', ParseIntPipe) accountId: number,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.financeService.getAccountStatement(accountId, dateFrom, dateTo);
  }

  @Get('profit-loss')
  getProfitAndLoss(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.financeService.getProfitAndLoss(dateFrom, dateTo);
  }

  // ─── TAX RATES ─────────────────────────────────────────────

  @Get('tax-rates')
  @Public()
  getTaxRates() {
    return this.financeService.getTaxRates();
  }

  @Post('tax-rates')
  createTaxRate(@Body() dto: CreateTaxRateDto) {
    return this.financeService.createTaxRate(dto);
  }

  @Patch('tax-rates/:id')
  updateTaxRate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<CreateTaxRateDto>,
  ) {
    return this.financeService.updateTaxRate(id, dto);
  }

  @Delete('tax-rates/:id')
  deleteTaxRate(@Param('id', ParseIntPipe) id: number) {
    return this.financeService.deleteTaxRate(id);
  }
}
