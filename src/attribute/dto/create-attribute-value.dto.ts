import { IsString } from 'class-validator';

export class CreateAttributeValueDto {
  @IsString()
  value: string;
}
