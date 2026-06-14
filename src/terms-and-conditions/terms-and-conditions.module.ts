import { Module } from '@nestjs/common';
import { TermsAndConditionsController } from './terms-and-conditions.controller.js';
import { TermsAndConditionsService } from './terms-and-conditions.service.js';

@Module({
  controllers: [TermsAndConditionsController],
  providers: [TermsAndConditionsService],
  exports: [TermsAndConditionsService],
})
export class TermsAndConditionsModule {}
