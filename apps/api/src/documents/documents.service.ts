import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { R2Service } from '../r2/r2.service';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  async createForAsset(
    assetId: string,
    file: Express.Multer.File,
    r2Key: string,
    clientId: string,
    uploadedByUserId: string,
    inspectionId?: string,
  ): Promise<
    Prisma.AssetDocumentGetPayload<{
      include: { uploadedBy: { select: { id: true; fullName: true } } };
    }>
  > {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);

    return this.prisma.assetDocument.create({
      data: {
        assetId,
        inspectionId: inspectionId ?? null,
        clientId,
        originalName: file.originalname,
        storagePath: r2Key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedByUserId,
      },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    });
  }

  async createForInspection(
    inspectionId: string,
    file: Express.Multer.File,
    r2Key: string,
    uploadedByUserId: string,
  ): Promise<
    Prisma.AssetDocumentGetPayload<{
      include: { uploadedBy: { select: { id: true; fullName: true } } };
    }>
  > {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      select: { assetId: true, asset: { select: { clientId: true } } },
    });
    if (!inspection) throw new NotFoundException(`Inspection ${inspectionId} not found`);
    return this.prisma.assetDocument.create({
      data: {
        assetId: inspection.assetId,
        inspectionId,
        clientId: inspection.asset.clientId,
        originalName: file.originalname,
        storagePath: r2Key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedByUserId,
      },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    });
  }

  async findByAsset(assetId: string): Promise<
    Prisma.AssetDocumentGetPayload<{
      include: { uploadedBy: { select: { id: true; fullName: true } } };
    }>[]
  > {
    return this.prisma.assetDocument.findMany({
      where: { assetId },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findByInspection(inspectionId: string): Promise<
    Prisma.AssetDocumentGetPayload<{
      include: { uploadedBy: { select: { id: true; fullName: true } } };
    }>[]
  > {
    return this.prisma.assetDocument.findMany({
      where: { inspectionId },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<import('@prisma/client').AssetDocument> {
    const doc = await this.prisma.assetDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return doc;
  }

  async delete(id: string, requestingClientId: string, role: string): Promise<void> {
    const doc = await this.findOne(id);
    if (role !== 'admin' && doc.clientId !== requestingClientId) {
      throw new ForbiddenException('Cannot delete document from another client');
    }
    // Delete from R2 — ignore errors if the object is already gone
    await this.r2.delete(doc.storagePath).catch(() => undefined);
    await this.prisma.assetDocument.delete({ where: { id } });
  }
}
