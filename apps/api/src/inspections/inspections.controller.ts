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
  ForbiddenException,
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

  private static isClientScoped(role: string): boolean {
    return role === 'client_user' || role === 'editor' || role === 'client_admin';
  }

  private async assertOwnsInspection(id: string, user: JwtPayload): Promise<void> {
    if (!InspectionsController.isClientScoped(user.role)) return;
    const inspection = await this.inspectionsService.findOne(id);
    if (inspection.asset.clientId !== user.clientId) {
      throw new ForbiddenException('Cannot act on an inspection from another client');
    }
  }

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<InspectionsService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.inspectionsService.findAll(effectiveClientId, status);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InspectionsService['findOne']> {
    await this.assertOwnsInspection(id, user);
    return this.inspectionsService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  create(
    @Body() dto: CreateInspectionDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InspectionsService['create']> {
    // Inspections have no clientId of their own — they inherit scope from the
    // referenced asset, so the service must check asset.clientId itself.
    const requestingClientId = InspectionsController.isClientScoped(user.role)
      ? (user.clientId ?? undefined)
      : undefined;
    return this.inspectionsService.create(dto, user.sub, requestingClientId);
  }

  @Patch(':id/cancel')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InspectionsService['cancel']> {
    await this.assertOwnsInspection(id, user);
    return this.inspectionsService.cancel(id, user.sub);
  }

  @Patch(':id/complete')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async complete(
    @Param('id') id: string,
    @Body() dto: CompleteInspectionDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InspectionsService['complete']> {
    await this.assertOwnsInspection(id, user);
    return this.inspectionsService.complete(id, dto, user.sub);
  }

  @Post(':id/photos')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
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
    @CurrentUser() user: JwtPayload,
  ): Promise<{ key: string }> {
    if (!file) throw new BadRequestException('No file uploaded');
    await this.assertOwnsInspection(id, user);
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const key = `inspections/${id}/${unique}${extname(file.originalname)}`;
    await this.r2.upload(key, file.buffer, file.mimetype);
    return { key };
  }

  @Get(':id/report')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async downloadReport(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    const requestingClientId = InspectionsController.isClientScoped(user.role)
      ? (user.clientId ?? undefined)
      : undefined;
    // Only persist an archived copy when someone with upload rights
    // downloads it (same role split as the document-upload endpoints) — a
    // plain client_user's own download shouldn't attribute the stored
    // document to them.
    const { stream, filename } = await this.inspectionsService.generateConditionReportPdf(
      id,
      requestingClientId,
      user.role === 'client_user' ? undefined : user.sub,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  }

  @Get('photos/:inspectionId/:filename')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async servePhoto(
    @Param('inspectionId') inspectionId: string,
    @Param('filename') filename: string,
    @Res() res: Response,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    await this.assertOwnsInspection(inspectionId, user);
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
