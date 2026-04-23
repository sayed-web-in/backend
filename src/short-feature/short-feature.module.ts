import { Module } from '@nestjs/common';
import { ShortFeatureController } from './short-feature.controller.js';
import { ShortFeatureService } from './short-feature.service.js';

@Module({
  controllers: [ShortFeatureController],
  providers: [ShortFeatureService],
  exports: [ShortFeatureService],
})
export class ShortFeatureModule {}
