import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
} from 'class-validator';

export class UpdateSaleReturnDto {
  @IsOptional()
  @IsEnum(['pending', 'completed', 'cancelled'])
  status?: 'pending' | 'completed' | 'cancelled';

  /** Cumulative cash refund paid toward net refund cap (seller-admin). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  refundAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  refundAccountId?: number;

  /** Legacy alias: incremental cash payment (added to cumulative refund). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  paymentAmount?: number;
}
