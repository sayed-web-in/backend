import { Module } from '@nestjs/common';
import { BranchService } from './branch.service.js';
import { BranchController } from './branch.controller.js';

@Module({
  controllers: [BranchController],
  providers: [BranchService],
  exports: [BranchService],
})
export class BranchModule {}
