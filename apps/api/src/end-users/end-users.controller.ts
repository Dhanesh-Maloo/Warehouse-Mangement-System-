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

  /** GET /end-users — all roles; client_user is forced to their own clientId */
  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user')
  findAll(
    @Query('clientId') clientId?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<EndUsersService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' ? (user.clientId ?? undefined) : clientId;
    return this.endUsersService.findAll(effectiveClientId, search);
  }

  /** GET /end-users/:id — all roles */
  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user')
  findOne(@Param('id') id: string): ReturnType<EndUsersService['findOne']> {
    return this.endUsersService.findOne(id);
  }

  /** POST /end-users — admin, manager */
  @Post()
  @Roles('admin', 'manager')
  create(@Body() dto: CreateEndUserDto): ReturnType<EndUsersService['create']> {
    return this.endUsersService.create(dto);
  }

  /** PATCH /end-users/:id — admin, manager */
  @Patch(':id')
  @Roles('admin', 'manager')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateEndUserDto,
  ): ReturnType<EndUsersService['update']> {
    return this.endUsersService.update(id, dto);
  }

  /** DELETE /end-users/:id — soft delete (isActive=false), admin only */
  @Delete(':id')
  @Roles('admin')
  deactivate(@Param('id') id: string): ReturnType<EndUsersService['deactivate']> {
    return this.endUsersService.deactivate(id);
  }
}
