import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import type { Response } from 'express';
import { InspectionsService } from './inspections.service';
import { R2Service } from '../r2/r2.service';
import { CreateInspectionDto } from './dto/create-inspection.dto';
import { CompleteInspectionDto } from './dto/complete-inspection.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inspections')
export class InspectionsController {
  constructor(
    private readonly inspectionsService: InspectionsService,
    private readonly r2: R2Service,
  ) {}

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user')
  findAll(
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<InspectionsService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' ? (user.clientId ?? undefined) : clientId;
    return this.inspectionsService.findAll(effectiveClientId, status);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user')
  findOne(@Param('id') id: string): ReturnType<InspectionsService['findOne']> {
    return this.inspectionsService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator')
  create(
    @Body() dto: CreateInspectionDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InspectionsService['create']> {
    return this.inspectionsService.create(dto, user.sub);
  }

  @Patch(':id/cancel')
  @Roles('admin', 'manager', 'operator')
  cancel(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InspectionsService['cancel']> {
    return this.inspectionsService.cancel(id, user.sub);
  }

  @Patch(':id/complete')
  @Roles('admin', 'manager', 'operator')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteInspectionDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InspectionsService['complete']> {
    return this.inspectionsService.complete(id, dto, user.sub);
  }

  @Post(':id/photos')
  @Roles('admin', 'manager', 'operator')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are accepted'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ key: string }> {
    if (!file) throw new BadRequestException('No file uploaded');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const key = `inspections/${id}/${unique}${extname(file.originalname)}`;
    await this.r2.upload(key, file.buffer, file.mimetype);
    return { key };
  }

  @Get('photos/:inspectionId/:filename')
  @Roles('admin', 'manager', 'operator', 'client_user')
  async servePhoto(
    @Param('inspectionId') inspectionId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): Promise<void> {
    const key = `inspections/${inspectionId}/${filename}`;
    try {
      const stream = await this.r2.getStream(key);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      stream.pipe(res);
    } catch {
      throw new NotFoundException('Photo not found');
    }
  }
}
