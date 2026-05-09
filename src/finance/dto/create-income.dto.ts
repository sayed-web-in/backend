import {
  IsInt,
  IsOptional,
  IsNumber,
  IsString,
  IsDateString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateIncomeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branchId?: number;

  @IsInt()
  categoryId: number;

  /** Required so cash/bank balance updates (seller-admin style). */
  @IsInt()
  @Min(1)
  accountId: number;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  reference?: string;

  /** active (posts to account) | pending | cancelled */
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}
