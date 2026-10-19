import { IsDateString, IsIn, IsOptional, IsString } from 'class-validator';

export class UpdateGrnDto {
  // Correct the date the devices were physically received. A date-only value
  // (YYYY-MM-DD) is interpreted as that day in IST, keeping the original time of day.
  @IsOptional()
  @IsDateString()
  receivedAt?: string;

  @IsOptional()
  @IsString()
  courierRef?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateReceivedDeviceDto {
  @IsOptional()
  @IsString()
  serialNumber?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;

  @IsOptional()
  @IsString()
  referenceName?: string;

  @IsOptional()
  @IsString()
  vendorName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['new', 'used', 'dead', 'not_working'])
  assetCondition?: 'new' | 'used' | 'dead' | 'not_working';
}
