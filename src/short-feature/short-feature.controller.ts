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
import { PaginationDto } from '../common/pagination.dto.js';
import { CreateShortFeatureDto } from './dto/create-short-feature.dto.js';
import { UpdateShortFeatureDto } from './dto/update-short-feature.dto.js';
import { ShortFeatureService } from './short-feature.service.js';

@Controller('short-features')
export class ShortFeatureController {
  constructor(private readonly shortFeatureService: ShortFeatureService) {}

  @Get()
  findAll(@Query() query: PaginationDto) {
    return this.shortFeatureService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.shortFeatureService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateShortFeatureDto) {
    return this.shortFeatureService.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateShortFeatureDto) {
    return this.shortFeatureService.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.shortFeatureService.remove(id);
  }
}
