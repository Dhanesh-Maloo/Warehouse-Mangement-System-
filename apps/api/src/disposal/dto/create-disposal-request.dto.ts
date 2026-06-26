import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateDisposalRequestDto {
  @IsUUID()
  clientId!: string;

  @IsUUID()
  assetId!: string;

  @IsEnum(['non_certified', 'certified_blanco', 'itad_bundled'])
  disposalType!: 'non_certified' | 'certified_blanco' | 'itad_bundled';

  @IsString()
  @IsOptional()
  notes?: string;
}
