import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDisposalRequestDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  assetId!: string;

  @IsEnum(['non_certified', 'certified_blanco', 'itad_bundled'])
  disposalType!: 'non_certified' | 'certified_blanco' | 'itad_bundled';

  // ₹550 + GST add-on, confirmed by Divya. Ignored (never billed) when
  // disposalType is certified_blanco, since that type already includes
  // certification.
  @IsOptional()
  @IsBoolean()
  requiresCertification?: boolean = false;

  @IsString()
  @IsOptional()
  notes?: string;
}
