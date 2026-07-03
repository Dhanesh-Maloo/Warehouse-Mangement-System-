import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
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
import { DocumentsService } from './documents.service';
import { R2Service } from '../r2/r2.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

const pdfInterceptor = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
      cb(new BadRequestException('Only PDF files are accepted'), false);
    } else {
      cb(null, true);
    }
  },
});

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class DocumentsController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly r2: R2Service,
  ) {}

  @Post('assets/:assetId/documents')
  @Roles('admin', 'manager', 'operator', 'editor')
  @UseInterceptors(pdfInterceptor)
  async uploadForAsset(
    @Param('assetId') assetId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DocumentsService['createForAsset']> {
    if (!file) throw new BadRequestException('No file uploaded');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const r2Key = `documents/assets/${unique}${extname(file.originalname)}`;
    await this.r2.upload(r2Key, file.buffer, file.mimetype);
    return this.documentsService.createForAsset(assetId, file, r2Key, user.clientId ?? 'system', user.sub);
  }

  @Get('assets/:assetId/documents')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  listForAsset(@Param('assetId') assetId: string): ReturnType<DocumentsService['findByAsset']> {
    return this.documentsService.findByAsset(assetId);
  }

  @Post('inspections/:inspectionId/documents')
  @Roles('admin', 'manager', 'operator', 'editor')
  @UseInterceptors(pdfInterceptor)
  async uploadForInspection(
    @Param('inspectionId') inspectionId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DocumentsService['createForInspection']> {
    if (!file) throw new BadRequestException('No file uploaded');
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const r2Key = `documents/inspections/${unique}${extname(file.originalname)}`;
    await this.r2.upload(r2Key, file.buffer, file.mimetype);
    return this.documentsService.createForInspection(inspectionId, file, r2Key, user.sub);
  }

  @Get('inspections/:inspectionId/documents')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  listForInspection(
    @Param('inspectionId') inspectionId: string,
  ): ReturnType<DocumentsService['findByInspection']> {
    return this.documentsService.findByInspection(inspectionId);
  }

  @Get('documents/:id/download')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  async download(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const doc = await this.documentsService.findOne(id);
    try {
      const stream = await this.r2.getStream(doc.storagePath);
      res.setHeader('Content-Disposition', `attachment; filename="${doc.originalName}"`);
      res.setHeader('Content-Type', 'application/pdf');
      stream.pipe(res);
    } catch {
      throw new NotFoundException('File not found in storage');
    }
  }

  // Delete is intentionally admin/manager/operator only — editors never delete.
  @Delete('documents/:id')
  @Roles('admin', 'manager', 'operator')
  delete(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DocumentsService['delete']> {
    return this.documentsService.delete(id, user.clientId ?? '', user.role);
  }
}
