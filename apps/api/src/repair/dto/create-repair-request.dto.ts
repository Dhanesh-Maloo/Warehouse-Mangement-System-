import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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

  @IsString()
  @IsOptional()
  notes?: string;
}
