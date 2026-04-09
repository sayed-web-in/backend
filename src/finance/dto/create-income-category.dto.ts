import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class CreateIncomeCategoryDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
