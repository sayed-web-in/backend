import { Type } from 'class-transformer';
import { IsInt, IsNumber, Min } from 'class-validator';

export class PatchSaleReturnRefundDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  paymentAmount!: number;

  @Type(() => Number)
  @IsInt()
  refundAccountId!: number;
}
