import { IsISO8601, IsOptional, IsString } from 'class-validator';

export class UpdateRepairSlaDto {
  // The revised target completion date — e.g. an OEM-confirmed date, or an
  // updated estimate once parts availability is known for a hardware repair.
  @IsISO8601()
  slaTargetAt!: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
