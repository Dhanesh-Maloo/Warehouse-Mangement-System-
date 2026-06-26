import { IsUUID, IsEnum, IsOptional, IsString } from 'class-validator';
import { InspectionType } from '@prisma/client';

export class CreateInspectionDto {
  @IsUUID()
  assetId!: string;

  @IsEnum(InspectionType)
  type!: InspectionType;

  @IsOptional()
  @IsString()
  assignedToUserId?: string;
}
