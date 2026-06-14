import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { TermsAndConditionsService } from './terms-and-conditions.service.js';
import { CreateTermsAndConditionDto } from './dto/create-terms-and-condition.dto.js';
import { UpdateTermsAndConditionDto } from './dto/update-terms-and-condition.dto.js';
import { TermsAndConditionQueryDto } from './dto/terms-and-condition-query.dto.js';

@Controller('terms-and-conditions')
@UseGuards(JwtAuthGuard)
export class TermsAndConditionsController {
  constructor(private readonly service: TermsAndConditionsService) {}

  @Get()
  findAll(@Query() query: TermsAndConditionQueryDto) {
    return this.service.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateTermsAndConditionDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTermsAndConditionDto,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
