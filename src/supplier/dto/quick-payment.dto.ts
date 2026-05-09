import {
  IsNumber,
  IsOptional,
  IsString,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';

export class QuickPaymentDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @IsInt()
  @Min(1)
  paymentAccountId: number;

  /** Optional backdated / explicit posting time for the cashbook entry (UTC ISO). */
  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  note?: string;
}
