import {
  IsString,
  IsEnum,
  IsInt,
  IsBoolean,
  IsDateString,
  IsArray,
  IsOptional,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RateBasis, RateCategoryApplies } from '@prisma/client';

export class CreateRateCardItemDto {
  @IsString()
  code!: string;

  @IsString()
  description!: string;

  @IsEnum(RateBasis)
  basis!: RateBasis;

  @IsEnum(RateCategoryApplies)
  categoryApplies!: RateCategoryApplies;

  // In paise
  @IsInt()
  @Min(0)
  @Type(() => Number)
  unitRatePaise!: number;

  @IsDateString()
  effectiveFrom!: string;

  @IsBoolean()
  isBundle!: boolean;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  bundleComponentCodes?: string[];
}
