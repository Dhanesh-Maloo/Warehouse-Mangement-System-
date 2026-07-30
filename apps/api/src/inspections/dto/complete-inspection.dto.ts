import { IsEnum, IsBoolean, IsOptional, IsString, IsArray, IsNotEmpty } from 'class-validator';
import { ConditionGrade } from '@prisma/client';

export class CompleteInspectionDto {
  @IsEnum(ConditionGrade)
  conditionGrade!: ConditionGrade;

  // Job details
  @IsOptional()
  @IsString()
  ticketNumber?: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  contactNumber?: string;

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

  // Accessories — itemized
  @IsBoolean()
  acAdapterPresent!: boolean;

  @IsBoolean()
  powerCablePresent!: boolean;

  @IsBoolean()
  headsetPresent!: boolean;

  @IsOptional()
  @IsString()
  otherAccessories?: string;

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

  // Device diagnostics — free text, mandatory
  @IsString()
  @IsNotEmpty()
  operatingSystem!: string;

  @IsString()
  @IsNotEmpty()
  cpu!: string;

  @IsString()
  @IsNotEmpty()
  ram!: string;

  @IsString()
  @IsNotEmpty()
  display!: string;

  @IsString()
  @IsNotEmpty()
  batteryHealth!: string;

  @IsString()
  @IsNotEmpty()
  hardwareTestResult!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  photoKeys?: string[];
}
