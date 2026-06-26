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
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import type { Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

const DOCS_DIR = join(process.cwd(), 'uploads', 'documents');

function pdfUploadInterceptor(subDir: string): ReturnType<typeof FileInterceptor> {
  return FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        const dest = join(DOCS_DIR, subDir);
        mkdirSync(dest, { recursive: true });
        cb(null, dest);
      },
      filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
        cb(null, `${unique}${extname(file.originalname)}`);
      },
    }),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (_req, file, cb) => {
      if (file.mimetype !== 'application/pdf') {
        cb(new BadRequestException('Only PDF files are accepted'), false);
      } else {
        cb(null, true);
      }
    },
  });
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post('assets/:assetId/documents')
  @Roles('admin', 'manager', 'operator')
  @UseInterceptors(pdfUploadInterceptor('assets'))
  uploadForAsset(
    @Param('assetId') assetId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DocumentsService['createForAsset']> {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.documentsService.createForAsset(assetId, file, user.clientId ?? 'system', user.sub);
  }

  @Get('assets/:assetId/documents')
  @Roles('admin', 'manager', 'operator', 'client_user')
  listForAsset(@Param('assetId') assetId: string): ReturnType<DocumentsService['findByAsset']> {
    return this.documentsService.findByAsset(assetId);
  }

  @Post('inspections/:inspectionId/documents')
  @Roles('admin', 'manager', 'operator')
  @UseInterceptors(pdfUploadInterceptor('inspections'))
  async uploadForInspection(
    @Param('inspectionId') inspectionId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DocumentsService['createForInspection']> {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.documentsService.createForInspection(inspectionId, file, user.sub);
  }

  @Get('inspections/:inspectionId/documents')
  @Roles('admin', 'manager', 'operator', 'client_user')
  listForInspection(
    @Param('inspectionId') inspectionId: string,
  ): ReturnType<DocumentsService['findByInspection']> {
    return this.documentsService.findByInspection(inspectionId);
  }

  @Get('documents/:id/download')
  @Roles('admin', 'manager', 'operator', 'client_user')
  async download(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const doc = await this.documentsService.findOne(id);
    if (!existsSync(doc.storagePath)) {
      throw new NotFoundException('File not found on disk');
    }
    res.setHeader('Content-Disposition', `attachment; filename="${doc.originalName}"`);
    res.setHeader('Content-Type', 'application/pdf');
    res.sendFile(doc.storagePath);
  }

  @Delete('documents/:id')
  @Roles('admin', 'manager', 'operator')
  delete(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DocumentsService['delete']> {
    return this.documentsService.delete(id, user.clientId ?? '', user.role);
  }
}
