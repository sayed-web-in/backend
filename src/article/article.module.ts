import { Module } from '@nestjs/common';
import { ArticleService } from './article.service.js';
import { ArticleController } from './article.controller.js';

@Module({
  controllers: [ArticleController],
  providers: [ArticleService],
  exports: [ArticleService],
})
export class ArticleModule {}
