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
    uploadedByUserId: string,
    requestingClientId?: string,
    inspectionId?: string,
  ): Promise<
    Prisma.AssetDocumentGetPayload<{
      include: { uploadedBy: { select: { id: true; fullName: true } } };
    }>
  > {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    if (requestingClientId && asset.clientId !== requestingClientId) {
      throw new ForbiddenException('Cannot upload a document for an asset from another client');
    }

    return this.prisma.assetDocument.create({
      data: {
        assetId,
        inspectionId: inspectionId ?? null,
        clientId: asset.clientId,
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
    requestingClientId?: string,
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
    if (requestingClientId && inspection.asset.clientId !== requestingClientId) {
      throw new ForbiddenException(
        'Cannot upload a document for an inspection from another client',
      );
    }
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

  async createForRepair(
    repairRequestId: string,
    file: Express.Multer.File,
    r2Key: string,
    uploadedByUserId: string,
    requestingClientId?: string,
  ): Promise<
    Prisma.AssetDocumentGetPayload<{
      include: { uploadedBy: { select: { id: true; fullName: true } } };
    }>
  > {
    const repair = await this.prisma.repairRequest.findUnique({
      where: { id: repairRequestId },
      select: { assetId: true, clientId: true },
    });
    if (!repair) throw new NotFoundException(`Repair request ${repairRequestId} not found`);
    if (requestingClientId && repair.clientId !== requestingClientId) {
      throw new ForbiddenException(
        'Cannot upload a document for a repair request from another client',
      );
    }
    return this.prisma.assetDocument.create({
      data: {
        assetId: repair.assetId,
        repairRequestId,
        clientId: repair.clientId,
        originalName: file.originalname,
        storagePath: r2Key,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        uploadedByUserId,
      },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    });
  }

  async findByRepair(
    repairRequestId: string,
    requestingClientId?: string,
  ): Promise<
    Prisma.AssetDocumentGetPayload<{
      include: { uploadedBy: { select: { id: true; fullName: true } } };
    }>[]
  > {
    if (requestingClientId) {
      const repair = await this.prisma.repairRequest.findUnique({
        where: { id: repairRequestId },
        select: { clientId: true },
      });
      if (repair && repair.clientId !== requestingClientId) {
        throw new ForbiddenException(
          'Cannot view documents for a repair request from another client',
        );
      }
    }
    return this.prisma.assetDocument.findMany({
      where: { repairRequestId },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findByAsset(
    assetId: string,
    requestingClientId?: string,
  ): Promise<
    Prisma.AssetDocumentGetPayload<{
      include: { uploadedBy: { select: { id: true; fullName: true } } };
    }>[]
  > {
    if (requestingClientId) {
      const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
      if (asset && asset.clientId !== requestingClientId) {
        throw new ForbiddenException('Cannot view documents for an asset from another client');
      }
    }
    return this.prisma.assetDocument.findMany({
      where: { assetId },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findByInspection(
    inspectionId: string,
    requestingClientId?: string,
  ): Promise<
    Prisma.AssetDocumentGetPayload<{
      include: { uploadedBy: { select: { id: true; fullName: true } } };
    }>[]
  > {
    if (requestingClientId) {
      const inspection = await this.prisma.inspection.findUnique({
        where: { id: inspectionId },
        select: { asset: { select: { clientId: true } } },
      });
      if (inspection && inspection.asset.clientId !== requestingClientId) {
        throw new ForbiddenException('Cannot view documents for an inspection from another client');
      }
    }
    return this.prisma.assetDocument.findMany({
      where: { inspectionId },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
      orderBy: { uploadedAt: 'desc' },
    });
  }

  async findOne(
    id: string,
    requestingClientId?: string,
  ): Promise<import('@prisma/client').AssetDocument> {
    const doc = await this.prisma.assetDocument.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    if (requestingClientId && doc.clientId !== requestingClientId) {
      // 404, not 403 — SPEC.md US-PORT-02 requires that direct URL access to
      // another client's documents not confirm the record's existence.
      throw new NotFoundException(`Document ${id} not found`);
    }
    return doc;
  }

  async delete(id: string, requestingClientId?: string): Promise<void> {
    const doc = await this.findOne(id, requestingClientId);
    // Delete from R2 — ignore errors if the object is already gone
    await this.r2.delete(doc.storagePath).catch(() => undefined);
    await this.prisma.assetDocument.delete({ where: { id } });
  }
}
