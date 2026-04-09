import {
  IsInt,
  IsEnum,
  IsOptional,
  IsString,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AdjustmentType } from '@prisma/client';

export class AdjustmentItemDto {
  @IsInt()
  storeProductId: number;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class CreateAdjustmentDto {
  @IsEnum(AdjustmentType)
  type: AdjustmentType;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsInt()
  branchId: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdjustmentItemDto)
  items: AdjustmentItemDto[];
}
