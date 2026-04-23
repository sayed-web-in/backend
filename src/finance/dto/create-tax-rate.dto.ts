import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  Min,
} from 'class-validator';

export class CreateTaxRateDto {
  @IsString()
  name: string;

  @IsNumber()
  @Min(0)
  rate: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
