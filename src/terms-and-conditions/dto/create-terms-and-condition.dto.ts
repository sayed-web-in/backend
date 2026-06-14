import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateTermsAndConditionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(1)
  description: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
