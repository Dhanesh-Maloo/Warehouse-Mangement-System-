import { IsEnum, IsBoolean, IsOptional, IsString, IsArray, IsNotEmpty } from 'class-validator';
import { ConditionGrade } from '@prisma/client';

export class CompleteInspectionDto {
  @IsEnum(ConditionGrade)
  conditionGrade!: ConditionGrade;

  // Job details
  @IsOptional()
  @IsString()
  ivalueTicketNumber?: string;

  @IsOptional()
  @IsString()
  clientTicketNumber?: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsString()
  contactNumber?: string;

  // Every checklist item below is tri-state: true (Yes), false (No), or
  // null/undefined (N/A) — N/A is excluded from pass/fail and grade signal.

  // Physical appearance
  @IsOptional()
  @IsBoolean()
  scratchesOnCasing?: boolean | null;

  @IsOptional()
  @IsBoolean()
  lidClosingOk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  scratchesOnScreen?: boolean | null;

  @IsOptional()
  @IsBoolean()
  keyboardIssues?: boolean | null;

  @IsOptional()
  @IsBoolean()
  missingFeet?: boolean | null;

  @IsOptional()
  @IsBoolean()
  chargerDamage?: boolean | null;

  // Accessories — itemized
  @IsOptional()
  @IsBoolean()
  acAdapterPresent?: boolean | null;

  @IsOptional()
  @IsBoolean()
  powerCablePresent?: boolean | null;

  @IsOptional()
  @IsBoolean()
  headsetPresent?: boolean | null;

  @IsOptional()
  @IsString()
  otherAccessories?: string;

  // Functional checks
  @IsOptional()
  @IsBoolean()
  webcamOk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  speakersOk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  bluetoothOk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  batteryCharges?: boolean | null;

  @IsOptional()
  @IsBoolean()
  screenOk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  keyboardOk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  trackpadOk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  portsOk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  powersOnOk?: boolean | null;

  @IsOptional()
  @IsBoolean()
  imagesUploaded?: boolean | null;

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
