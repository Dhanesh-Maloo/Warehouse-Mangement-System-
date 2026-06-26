import { Controller, Get, Post, Put, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('admin', 'manager')
  findAll(): ReturnType<UsersService['findAll']> {
    return this.usersService.findAll();
  }

  @Get(':id')
  @Roles('admin', 'manager')
  findOne(@Param('id') id: string): ReturnType<UsersService['findOne']> {
    return this.usersService.findOne(id);
  }

  @Post()
  @Roles('admin')
  create(@Body() dto: CreateUserDto): ReturnType<UsersService['create']> {
    return this.usersService.create(dto);
  }

  @Put(':id')
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto): ReturnType<UsersService['update']> {
    return this.usersService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles('admin')
  setStatus(
    @Param('id') id: string,
    @Body('status') status: 'active' | 'suspended',
  ): ReturnType<UsersService['setStatus']> {
    return this.usersService.setStatus(id, status);
  }
}
