import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { EndUsersService } from './end-users.service';
import { CreateEndUserDto } from './dto/create-end-user.dto';
import { UpdateEndUserDto } from './dto/update-end-user.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('end-users')
export class EndUsersController {
  constructor(private readonly endUsersService: EndUsersService) {}

  /** GET /end-users — all roles; client_user/editor are forced to their own clientId */
  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<EndUsersService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.endUsersService.findAll(effectiveClientId, search);
  }

  /** GET /end-users/:id — all roles; client-scoped roles can't fetch another client's end user */
  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<EndUsersService['findOne']> {
    const endUser = await this.endUsersService.findOne(id);
    const isClientScoped =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin';
    if (isClientScoped && endUser.clientId !== user?.clientId) {
      throw new ForbiddenException('Cannot view an end user from another client');
    }
    return endUser;
  }

  /** POST /end-users — admin, manager, editor, client_admin (editor/client_admin forced to own clientId) */
  @Post()
  @Roles('admin', 'manager', 'editor', 'client_admin')
  create(
    @Body() dto: CreateEndUserDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<EndUsersService['create']> {
    if ((user.role === 'editor' || user.role === 'client_admin') && user.clientId)
      dto.clientId = user.clientId;
    return this.endUsersService.create(dto);
  }

  /** PATCH /end-users/:id — admin, manager, editor, client_admin (client-scoped roles limited to their own client's end users) */
  @Patch(':id')
  @Roles('admin', 'manager', 'editor', 'client_admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEndUserDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<EndUsersService['update']> {
    if (user.role === 'editor' || user.role === 'client_admin') {
      const existing = await this.endUsersService.findOne(id);
      if (existing.clientId !== user.clientId) {
        throw new ForbiddenException('Cannot edit an end user from another client');
      }
    }
    return this.endUsersService.update(id, dto);
  }

  /** DELETE /end-users/:id — soft delete (isActive=false), admin or the owning client's client_admin */
  @Delete(':id')
  @Roles('admin', 'client_admin')
  async deactivate(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<EndUsersService['deactivate']> {
    if (user.role === 'client_admin') {
      const existing = await this.endUsersService.findOne(id);
      if (existing.clientId !== user.clientId) {
        throw new ForbiddenException('Cannot deactivate an end user from another client');
      }
    }
    return this.endUsersService.deactivate(id);
  }
}
