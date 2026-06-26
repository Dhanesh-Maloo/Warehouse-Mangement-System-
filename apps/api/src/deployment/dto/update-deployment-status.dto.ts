import { IsEnum, IsString, IsOptional, IsNumber } from 'class-validator';

export class UpdateDeploymentStatusDto {
  @IsEnum(['in_transit', 'delivered', 'cancelled'])
  status!: 'in_transit' | 'delivered' | 'cancelled';

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  courierName?: string;

  @IsOptional()
  @IsNumber()
  actualCarrierCostPaise?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
