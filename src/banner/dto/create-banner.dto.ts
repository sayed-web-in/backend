import { IsString, IsOptional, IsBoolean, IsInt, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { BannerType } from '@prisma/client';

export class CreateBannerDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsString()
  image: string;

  @IsOptional()
  @IsString()
  link?: string;

  @IsEnum(BannerType)
  type: BannerType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
