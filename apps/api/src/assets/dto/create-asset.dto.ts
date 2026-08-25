import {
  IsString,
  IsEnum,
  IsOptional,
  IsUUID,
  IsBoolean,
  IsInt,
  Min,
  IsDateString,
} from 'class-validator';

export class CreateAssetDto {
  @IsString()
  serialNumber!: string;

  @IsOptional()
  @IsString()
  assetTag?: string;

  @IsOptional()
  @IsString()
  referenceName?: string;

  @IsOptional()
  @IsString()
  vendorName?: string;

  @IsString()
  model!: string;

  @IsString()
  manufacturer!: string;

  @IsEnum(['laptop', 'monitor', 'peripheral'])
  category!: 'laptop' | 'monitor' | 'peripheral';

  @IsUUID()
  clientId!: string;

  @IsOptional()
  @IsUUID()
  currentLocationId?: string;

  @IsOptional()
  @IsEnum(['A', 'B', 'C', 'D'])
  conditionGrade?: 'A' | 'B' | 'C' | 'D';

  @IsOptional()
  @IsEnum(['new', 'used', 'dead', 'not_working'])
  assetCondition?: 'new' | 'used' | 'dead' | 'not_working';

  @IsOptional()
  @IsEnum(['receiving', 'in_inspection', 'in_storage', 'deployed', 'returning', 'disposed'])
  currentStatus?:
    | 'receiving'
    | 'in_inspection'
    | 'in_storage'
    | 'deployed'
    | 'returning'
    | 'disposed';

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
