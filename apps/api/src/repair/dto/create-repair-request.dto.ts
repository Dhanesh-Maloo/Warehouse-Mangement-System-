import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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

  // oem_warranty: repair is handled by the OEM on their own timeline (no internal SLA).
  // in_house: repaired by the iValue team — SLA depends on repairCategory (see below).
  // out_of_warranty: sent to a paid external service center, not OEM/in-house — SLA
  // depends on that vendor's timeline (no fixed default, same as in_house/hardware).
  @IsEnum(['oem_warranty', 'in_house', 'out_of_warranty'])
  repairType!: 'oem_warranty' | 'in_house' | 'out_of_warranty';

  // Required when repairType = in_house: software issues get a fixed internal SLA,
  // hardware issues have no fixed default (turnaround depends on parts availability).
  // Ignored/omitted for oem_warranty.
  @IsEnum(['software', 'hardware'])
  @IsOptional()
  repairCategory?: 'software' | 'hardware';

  // Overrides the computed default SLA target — e.g. an OEM-confirmed completion date,
  // or a parts-availability-based estimate for an in-house hardware repair.
  @IsISO8601()
  @IsOptional()
  slaTargetAt?: string;

  @IsOptional()
  @IsString()
  ivalueTicketNumber?: string;

  @IsOptional()
  @IsString()
  clientTicketNumber?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}
