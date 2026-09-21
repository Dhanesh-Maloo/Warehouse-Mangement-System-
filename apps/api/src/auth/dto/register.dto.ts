import { IsString, MinLength } from 'class-validator';

export class RegisterDto {
  @IsString()
  token!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
