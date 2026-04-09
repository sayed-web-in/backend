import { Module } from '@nestjs/common';
import { AttributeService } from './attribute.service.js';
import { AttributeController, AttributeValueController } from './attribute.controller.js';

@Module({
  controllers: [AttributeController, AttributeValueController],
  providers: [AttributeService],
  exports: [AttributeService],
})
export class AttributeModule {}
