import { IsBoolean, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateEndUserDto } from './create-end-user.dto';

export class UpdateEndUserDto extends PartialType(CreateEndUserDto) {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
