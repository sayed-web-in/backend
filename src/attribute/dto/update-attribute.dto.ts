import { PartialType } from '@nestjs/mapped-types';
import { CreateAttributeDto } from './create-attribute.dto.js';

export class UpdateAttributeDto extends PartialType(CreateAttributeDto) {}
