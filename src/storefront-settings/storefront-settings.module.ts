import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StorefrontSettingsController } from './storefront-settings.controller.js';
import { StorefrontSettingsService } from './storefront-settings.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [StorefrontSettingsController],
  providers: [StorefrontSettingsService],
})
export class StorefrontSettingsModule {}
