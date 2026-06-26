import { IsEnum, IsOptional, IsString, IsUUID, IsBoolean, IsInt, Min, IsDateString } from 'class-validator';
import { AssetStatus, ConditionGrade } from '@prisma/client';

export class UpdateAssetStatusDto {
  @IsOptional()
  @IsEnum(AssetStatus)
  currentStatus?: AssetStatus;

  @IsOptional()
  @IsUUID()
  currentLocationId?: string | null;

  @IsOptional()
  @IsEnum(ConditionGrade)
  conditionGrade?: ConditionGrade;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  assetTag?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;

  @IsOptional()
  @IsEnum(['laptop', 'monitor', 'peripheral'])
  category?: 'laptop' | 'monitor' | 'peripheral';

  @IsOptional()
  @IsEnum(['new', 'used', 'dead', 'not_working'])
  assetCondition?: 'new' | 'used' | 'dead' | 'not_working';

  @IsOptional()
  @IsBoolean()
  repairHandling?: boolean;

  @IsOptional()
  @IsString()
  repairServiceName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  repairEstimateCost?: number;

  @IsOptional()
  @IsString()
  awbNumber?: string;

  @IsOptional()
  @IsString()
  courierName?: string;

  @IsOptional()
  @IsDateString()
  deliveredAt?: string;

  @IsOptional()
  @IsString()
  disposalType?: string;

  @IsOptional()
  @IsBoolean()
  hasCertification?: boolean;
}
