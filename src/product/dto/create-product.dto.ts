import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductType } from '@prisma/client';

export class ProductImageDto {
  @IsString()
  url: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

export class SpecificationDto {
  @IsString()
  name: string;

  @IsString()
  value: string;
}

export class ProductVariantDto {
  @IsOptional()
  @IsString()
  image?: string;

  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  attributeValueIds: number[];
}

export class CreateProductDto {
  @IsString()
  name: string;

  @IsEnum(ProductType)
  type: ProductType;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  categoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  subCategoryId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  brandId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  unitId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  taxRateId?: number;

  @IsOptional()
  @IsBoolean()
  hasImei?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images?: ProductImageDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SpecificationDto)
  specifications?: SpecificationDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantDto)
  variants?: ProductVariantDto[];
}
