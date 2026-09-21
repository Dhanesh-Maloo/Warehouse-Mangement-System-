import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.toLowerCase().trim())
  email!: string;

  // Omitted for client-scoped roles (client_user/editor/client_admin) — those
  // accounts are invited by email and set their own password via
  // POST /auth/register. Required for internal roles, which are still
  // provisioned directly by an admin.
  @ValidateIf((o: CreateUserDto) => !['client_user', 'editor', 'client_admin'].includes(o.role))
  @IsString()
  @MinLength(8)
  password?: string;

  @IsString()
  fullName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEnum(UserRole)
  role!: UserRole;

  // Required for roles scoped to a single client
  @ValidateIf(
    (o: CreateUserDto) =>
      o.role === 'client_user' || o.role === 'editor' || o.role === 'client_admin',
  )
  @IsUUID()
  clientId?: string;
}
