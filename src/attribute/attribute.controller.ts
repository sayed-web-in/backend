import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { AttributeService } from './attribute.service.js';
import { CreateAttributeDto } from './dto/create-attribute.dto.js';
import { UpdateAttributeDto } from './dto/update-attribute.dto.js';
import { CreateAttributeValueDto } from './dto/create-attribute-value.dto.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PaginationDto } from '../common/pagination.dto.js';

@Controller('attributes')
export class AttributeController {
  constructor(private readonly attributeService: AttributeService) {}

  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.attributeService.findAll(query);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateAttributeDto) {
    return this.attributeService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAttributeDto,
  ) {
    return this.attributeService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.attributeService.remove(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/values')
  addValue(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAttributeValueDto,
  ) {
    return this.attributeService.addValue(id, dto);
  }
}

@Controller('attribute-values')
export class AttributeValueController {
  constructor(private readonly attributeService: AttributeService) {}

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.attributeService.removeValue(id);
  }
}
