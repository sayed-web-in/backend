import { IsString, IsOptional, IsEmail, IsBoolean, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSupplierDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  company?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Opening supplier prepayment balance (optional). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  advanceBalance?: number;
}
