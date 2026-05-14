import { Module } from '@nestjs/common';
import { FinanceService } from './finance.service.js';
import { FinanceController } from './finance.controller.js';
import { ReportModule } from '../report/report.module.js';

@Module({
  imports: [ReportModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService],
})
export class FinanceModule {}
