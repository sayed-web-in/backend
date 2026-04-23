import { PartialType } from '@nestjs/mapped-types';
import { CreateShortFeatureDto } from './create-short-feature.dto.js';

export class UpdateShortFeatureDto extends PartialType(CreateShortFeatureDto) {}
