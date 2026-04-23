import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { StorefrontSettingsService } from './storefront-settings.service.js';
import { UpsertStorefrontSettingsDto } from './dto/upsert-storefront-settings.dto.js';

@Controller('storefront-settings')
export class StorefrontSettingsController {
  constructor(private readonly service: StorefrontSettingsService) {}

  @Get('public')
  getPublicSettings() {
    return this.service.getPublicSettings();
  }

  @UseGuards(JwtAuthGuard)
  @Patch()
  upsert(@Body() dto: UpsertStorefrontSettingsDto) {
    return this.service.upsert(dto);
  }
}
