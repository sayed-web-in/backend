import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CreateStoreLocationDto } from './dto/create-store-location.dto.js';
import { UpdateStoreLocationDto } from './dto/update-store-location.dto.js';
import { StoreLocationService } from './store-location.service.js';

@Controller('store-locations')
export class StoreLocationController {
  constructor(private readonly service: StoreLocationService) {}

  @Get('public')
  findPublic() {
    return this.service.findPublic();
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findAll() {
    return this.service.findAll();
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateStoreLocationDto) {
    return this.service.create(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateStoreLocationDto) {
    return this.service.update(id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
