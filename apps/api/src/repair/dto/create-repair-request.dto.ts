import { IsInt, IsISO8601, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CreateRepairRequestDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  assetId!: string;

  @IsString()
  serviceCenterName!: string;

  // Non-negative integer paise, not arbitrary currency input — money is always stored as integers.
  @IsInt()
  @Min(0)
  @IsOptional()
  estimateCostPaise?: number;

  // Overrides the default SLA target (5 business days from request creation)
  // when the service center gives a different completion estimate.
  @IsISO8601()
  @IsOptional()
  slaTargetAt?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
