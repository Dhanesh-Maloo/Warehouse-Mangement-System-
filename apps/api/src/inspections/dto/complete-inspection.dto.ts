import { IsEnum, IsBoolean, IsOptional, IsString, IsArray } from 'class-validator';
import { ConditionGrade } from '@prisma/client';

export class CompleteInspectionDto {
  @IsEnum(ConditionGrade)
  conditionGrade!: ConditionGrade;

  // Physical appearance
  @IsBoolean()
  scratchesOnCasing!: boolean;

  @IsBoolean()
  lidClosingOk!: boolean;

  @IsBoolean()
  scratchesOnScreen!: boolean;

  @IsBoolean()
  keyboardIssues!: boolean;

  @IsBoolean()
  missingFeet!: boolean;

  @IsBoolean()
  chargerDamage!: boolean;

  @IsBoolean()
  allAccessoriesPresent!: boolean;

  // Functional checks
  @IsBoolean()
  webcamOk!: boolean;

  @IsBoolean()
  speakersOk!: boolean;

  @IsBoolean()
  bluetoothOk!: boolean;

  @IsBoolean()
  batteryCharges!: boolean;

  @IsBoolean()
  screenOk!: boolean;

  @IsBoolean()
  keyboardOk!: boolean;

  @IsBoolean()
  trackpadOk!: boolean;

  @IsBoolean()
  portsOk!: boolean;

  @IsBoolean()
  powersOnOk!: boolean;

  @IsBoolean()
  imagesUploaded!: boolean;

  // Process — null means N/A
  @IsOptional()
  @IsBoolean()
  sanitization?: boolean | null;

  @IsOptional()
  @IsBoolean()
  factoryReset?: boolean | null;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoKeys?: string[];
}
