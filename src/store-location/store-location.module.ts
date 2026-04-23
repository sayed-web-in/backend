import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { StoreLocationController } from './store-location.controller.js';
import { StoreLocationService } from './store-location.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [StoreLocationController],
  providers: [StoreLocationService],
})
export class StoreLocationModule {}
