import { IsBoolean, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationDto } from '../../common/pagination.dto.js';

export class TermsAndConditionQueryDto extends PaginationDto {
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isActive?: boolean;
}
