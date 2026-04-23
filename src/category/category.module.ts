import { Module } from '@nestjs/common';
import { CategoryService } from './category.service.js';
import {
  CategoryController,
  SubCategoryController,
} from './category.controller.js';

@Module({
  controllers: [CategoryController, SubCategoryController],
  providers: [CategoryService],
  exports: [CategoryService],
})
export class CategoryModule {}
