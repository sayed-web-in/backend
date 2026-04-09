import {
  IsInt,
  IsString,
  IsNumber,
  IsArray,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderItemDto {
  @IsInt()
  storeProductId: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  unitPrice: number;
}

export class CreateOrderDto {
  @IsInt()
  customerId: number;

  @IsString()
  name: string;

  @IsString()
  phone: string;

  @IsString()
  division: string;

  @IsString()
  district: string;

  @IsString()
  address: string;

  @IsString()
  paymentMethod: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
}
