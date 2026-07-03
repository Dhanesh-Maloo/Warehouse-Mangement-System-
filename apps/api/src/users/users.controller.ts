import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

// A client_admin can only ever create/promote users into roles that are themselves
// fenced to a single client — never a role with cross-client visibility.
const CLIENT_SCOPED_ROLES = new Set(['client_user', 'editor', 'client_admin']);

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @Roles('admin', 'manager', 'client_admin')
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<UsersService['findAll']> {
    const clientId = user?.role === 'client_admin' ? (user.clientId ?? undefined) : undefined;
    return this.usersService.findAll(
      skip ? parseInt(skip, 10) : 0,
      take ? parseInt(take, 10) : 50,
      clientId,
    );
  }

  @Get(':id')
  @Roles('admin', 'manager', 'client_admin')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<UsersService['findOne']> {
    const target = await this.usersService.findOne(id);
    if (user.role === 'client_admin' && target.clientId !== user.clientId) {
      throw new ForbiddenException('Cannot view a user from another client');
    }
    return target;
  }

  @Post()
  @Roles('admin', 'client_admin')
  create(
    @Body() dto: CreateUserDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<UsersService['create']> {
    if (user.role === 'client_admin') {
      if (!CLIENT_SCOPED_ROLES.has(dto.role)) {
        throw new ForbiddenException(
          'A client admin can only create client_user, editor, or client_admin accounts',
        );
      }
      dto.clientId = user.clientId ?? undefined;
    }
    return this.usersService.create(dto);
  }

  @Put(':id')
  @Roles('admin', 'client_admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<UsersService['update']> {
    if (user.role === 'client_admin') {
      const target = await this.usersService.findOne(id);
      if (target.clientId !== user.clientId) {
        throw new ForbiddenException('Cannot edit a user from another client');
      }
      if (dto.role && !CLIENT_SCOPED_ROLES.has(dto.role)) {
        throw new ForbiddenException(
          'A client admin can only assign client_user, editor, or client_admin roles',
        );
      }
      // never let a client_admin move a user to a different client
      dto.clientId = user.clientId ?? undefined;
    }
    return this.usersService.update(id, dto);
  }

  @Patch(':id/status')
  @Roles('admin', 'client_admin')
  async setStatus(
    @Param('id') id: string,
    @Body('status') status: 'active' | 'suspended',
    @CurrentUser() user: JwtPayload,
  ): ReturnType<UsersService['setStatus']> {
    if (user.role === 'client_admin') {
      const target = await this.usersService.findOne(id);
      if (target.clientId !== user.clientId) {
        throw new ForbiddenException('Cannot change status of a user from another client');
      }
    }
    return this.usersService.setStatus(id, status);
  }

  /** Soft delete — sets status to 'suspended'. Users are never hard-deleted (audit log, created records reference them). */
  @Delete(':id')
  @Roles('admin', 'client_admin')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<UsersService['setStatus']> {
    if (user.role === 'client_admin') {
      const target = await this.usersService.findOne(id);
      if (target.clientId !== user.clientId) {
        throw new ForbiddenException('Cannot deactivate a user from another client');
      }
    }
    return this.usersService.setStatus(id, 'suspended');
  }
}
