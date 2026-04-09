import { Module } from '@nestjs/common';
import { BannerService } from './banner.service.js';
import { BannerController } from './banner.controller.js';

@Module({
  controllers: [BannerController],
  providers: [BannerService],
  exports: [BannerService],
})
export class BannerModule {}
