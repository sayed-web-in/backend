import { Module } from '@nestjs/common';
import { ServiceService } from './service.service.js';
import { ServiceController } from './service.controller.js';

@Module({
  controllers: [ServiceController],
  providers: [ServiceService],
  exports: [ServiceService],
})
export class ServiceModule {}
