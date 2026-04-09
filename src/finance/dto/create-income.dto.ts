import { IsInt, IsOptional, IsNumber, IsString, IsDateString, Min } from 'class-validator';

export class CreateIncomeDto {
  @IsInt()
  categoryId: number;

  @IsOptional()
  @IsInt()
  accountId?: number;

  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsDateString()
  date?: string;
}
