import { PartialType } from '@nestjs/mapped-types';
import { CreateBannerDto } from './create-banner.dto.js';

export class UpdateBannerDto extends PartialType(CreateBannerDto) {}
