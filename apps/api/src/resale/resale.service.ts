import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Asset, ResaleListing } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { resaleListingCreatedEmail } from '../mail/templates/resale-listing-created';
import type { CreateResaleListingDto } from './dto/create-resale-listing.dto';
import type { UpdateResaleStatusDto } from './dto/update-resale-status.dto';

// Notified as an FYI when a listing is created — mirrors disposal's
// approver roles, but this is informational only: resale has no approval
// gate (per Dhanesh, 2026-09-01).
const RESALE_NOTIFY_ROLES = ['manager', 'admin'];

// ResaleListing has no Prisma relation fields to Asset/Client/User (plain
// FK-shaped columns only, mirroring EventSuppression/RuralPincode), so we
// attach the related asset ourselves instead of using `include`.
export type ResaleListingWithAsset = ResaleListing & { asset: Asset };

// listed -> sold, cancelled ; sold/cancelled are terminal.
const RESALE_TRANSITIONS: Record<string, string[]> = {
  listed: ['sold', 'cancelled'],
  sold: [],
  cancelled: [],
};

@Injectable()
export class ResaleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly assetStatusHistory: AssetStatusHistoryService,
    private readonly users: UsersService,
    private readonly mail: MailService,
  ) {}

  async findAll(
    clientId?: string,
    filters?: { status?: string; assetSearch?: string; fromDate?: string; toDate?: string },
  ): Promise<ResaleListingWithAsset[]> {
    const toDateFilter = filters?.toDate
      ? (() => {
          const d = new Date(filters.toDate as string);
          if (!(filters.toDate as string).includes('T')) d.setDate(d.getDate() + 1);
          return d;
        })()
      : null;

    // ResaleListing has no Prisma relation to Asset (see class-level comment),
    // so an asset search resolves matching asset ids first, then filters
    // resaleListing.assetId against that set.
    let assetIdFilter: string[] | null = null;
    if (filters?.assetSearch) {
      const matchingAssets = await this.prisma.asset.findMany({
        where: {
          OR: [
            { serialNumber: { contains: filters.assetSearch, mode: 'insensitive' } },
            { model: { contains: filters.assetSearch, mode: 'insensitive' } },
            { manufacturer: { contains: filters.assetSearch, mode: 'insensitive' } },
            { assetTag: { contains: filters.assetSearch, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      assetIdFilter = matchingAssets.map((a) => a.id);
    }

    const listings = await this.prisma.resaleListing.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(filters?.status ? { status: filters.status as never } : {}),
        ...(assetIdFilter ? { assetId: { in: assetIdFilter } } : {}),
        ...(filters?.fromDate || toDateFilter
          ? {
              listedAt: {
                ...(filters?.fromDate ? { gte: new Date(filters.fromDate) } : {}),
                ...(toDateFilter ? { lt: toDateFilter } : {}),
              },
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.attachAssets(listings);
  }

  async findOne(id: string): Promise<ResaleListingWithAsset> {
    const listing = await this.prisma.resaleListing.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException(`Resale listing ${id} not found`);
    const asset = await this.prisma.asset.findUnique({ where: { id: listing.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${listing.assetId} not found`);
    return { ...listing, asset };
  }

  async findByAsset(assetId: string, clientId?: string): Promise<ResaleListingWithAsset[]> {
    const listings = await this.prisma.resaleListing.findMany({
      where: clientId ? { assetId, clientId } : { assetId },
      orderBy: { createdAt: 'desc' },
    });
    return this.attachAssets(listings);
  }

  async create(
    dto: CreateResaleListingDto,
    createdByUserId: string,
  ): Promise<ResaleListingWithAsset> {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

    if (asset.clientId !== dto.clientId) {
      throw new BadRequestException(
        `Asset ${dto.assetId} does not belong to client ${dto.clientId}`,
      );
    }

    if (asset.currentStatus !== 'in_storage') {
      throw new BadRequestException(
        `Asset ${dto.assetId} must be in_storage to list for resale (current status: ${asset.currentStatus})`,
      );
    }

    // Non-billable inventory movement (same philosophy as US-INV-03 location
    // moves): no ledger event is posted here, unlike disposal/retrieval/deployment.
    const [listing, updatedAsset] = await this.prisma.$transaction(async (tx) => {
      const createdListing = await tx.resaleListing.create({
        data: {
          clientId: dto.clientId,
          assetId: dto.assetId,
          listedPricePaise:
            dto.listedPricePaise !== undefined ? BigInt(dto.listedPricePaise) : undefined,
          notes: dto.notes,
          status: 'listed',
          createdByUserId,
        },
      });
      const asset = await tx.asset.update({
        where: { id: dto.assetId },
        data: { currentStatus: 'for_resale' },
      });
      await this.assetStatusHistory.record(
        {
          assetId: dto.assetId,
          clientId: dto.clientId,
          fromStatus: 'in_storage',
          toStatus: 'for_resale',
          sourceModule: 'resale',
        },
        tx,
      );
      return [createdListing, asset] as const;
    });

    await this.audit.log({
      userId: createdByUserId,
      action: 'resale.create',
      entity: 'ResaleListing',
      entityId: listing.id,
      newValue: { assetId: dto.assetId, listedPricePaise: dto.listedPricePaise, status: 'listed' },
    });

    const notifyEmails = await this.users.findEmailsByRoles(RESALE_NOTIFY_ROLES);
    if (notifyEmails.length > 0) {
      const { subject, html, text } = resaleListingCreatedEmail({
        assetLabel: `${asset.manufacturer} ${asset.model} (${asset.serialNumber})`,
        listedPricePaise: listing.listedPricePaise,
      });
      for (const to of notifyEmails) {
        void this.mail.send({ to, subject, html, text });
      }
    }

    return { ...listing, asset: updatedAsset };
  }

  async updateStatus(
    id: string,
    dto: UpdateResaleStatusDto,
    updatedByUserId: string,
  ): Promise<ResaleListingWithAsset> {
    const listing = await this.findOne(id);

    const allowed = RESALE_TRANSITIONS[listing.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition resale listing from '${listing.status}' to '${dto.status}'`,
      );
    }

    const now = new Date();

    const [updated, asset] = await this.prisma.$transaction(async (tx) => {
      const result = await tx.resaleListing.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.status === 'sold' && {
            soldAt: now,
            ...(dto.soldPricePaise !== undefined && {
              soldPricePaise: BigInt(dto.soldPricePaise),
            }),
          }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
        },
      });

      // 'sold' moves the asset to a terminal 'sold' status so it drops out of
      // active-asset views. 'cancelled' reverts the asset to in_storage — the
      // resale attempt was abandoned.
      let updatedAsset = await tx.asset.findUnique({ where: { id: listing.assetId } });
      if (dto.status === 'sold') {
        const fromStatus = updatedAsset?.currentStatus ?? null;
        updatedAsset = await tx.asset.update({
          where: { id: listing.assetId },
          data: { currentStatus: 'sold' },
        });
        await this.assetStatusHistory.record(
          {
            assetId: listing.assetId,
            clientId: listing.clientId,
            fromStatus,
            toStatus: 'sold',
            sourceModule: 'resale',
          },
          tx,
        );
      }
      if (dto.status === 'cancelled') {
        const fromStatus = updatedAsset?.currentStatus ?? null;
        updatedAsset = await tx.asset.update({
          where: { id: listing.assetId },
          data: { currentStatus: 'in_storage' },
        });
        await this.assetStatusHistory.record(
          {
            assetId: listing.assetId,
            clientId: listing.clientId,
            fromStatus,
            toStatus: 'in_storage',
            sourceModule: 'resale',
          },
          tx,
        );
      }
      if (!updatedAsset) throw new NotFoundException(`Asset ${listing.assetId} not found`);

      return [result, updatedAsset] as const;
    });

    await this.audit.log({
      userId: updatedByUserId,
      action: 'resale.updateStatus',
      entity: 'ResaleListing',
      entityId: id,
      oldValue: { status: listing.status },
      newValue: { status: dto.status, soldPricePaise: dto.soldPricePaise },
    });

    return { ...updated, asset };
  }

  private async attachAssets(listings: ResaleListing[]): Promise<ResaleListingWithAsset[]> {
    if (listings.length === 0) return [];
    const assetIds = [...new Set(listings.map((l) => l.assetId))];
    const assets = await this.prisma.asset.findMany({ where: { id: { in: assetIds } } });
    const assetById = new Map(assets.map((a) => [a.id, a]));
    return listings.map((listing) => {
      const asset = assetById.get(listing.assetId);
      if (!asset) throw new NotFoundException(`Asset ${listing.assetId} not found`);
      return { ...listing, asset };
    });
  }
}
