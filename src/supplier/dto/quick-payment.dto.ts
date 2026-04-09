import { IsNumber, IsOptional, IsString, IsInt, Min } from 'class-validator';

export class QuickPaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsOptional()
  @IsInt()
  paymentAccountId?: number;

  @IsOptional()
  @IsString()
  note?: string;
}
