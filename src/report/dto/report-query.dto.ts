import { IsOptional, IsDateString, IsInt, Min, Max, IsIn, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.dto.js';

export class ReportQueryDto extends PaginationDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Alias for `dateFrom` (seller-admin style). */
  @IsOptional()
  @IsDateString()
  startDate?: string;

  /** Alias for `dateTo` (seller-admin style). */
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  branchId?: number;

  /** When set (with optional branchId), profit-loss returns a monthly matrix for that year (storefront-style). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @IsOptional()
  @IsString()
  @IsIn(['paid', 'partial', 'due'])
  paymentStatus?: 'paid' | 'partial' | 'due';

  /** Product category (stock report), expense category, or income category depending on endpoint. */
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

  /** Product-expiry: only batches whose `batchDate` is at least this many days ago (default 90). Pagination `limit` is rows per page. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  batchMinAgeDays?: number;
}
