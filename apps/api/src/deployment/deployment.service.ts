import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import { CourierZoneService } from '../logistics/courier-zone.service';
import type { CreateDeploymentOrderDto } from './dto/create-deployment-order.dto';
import type { UpdateDeploymentStatusDto } from './dto/update-deployment-status.dto';

@Injectable()
export class DeploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
    private readonly courierZone: CourierZoneService,
  ) {}

  /**
   * List all deployment orders, optionally filtered by clientId.
   * Results include the related asset and endUser records.
   */
  findAll(
    clientId?: string,
  ): Prisma.PrismaPromise<
    Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>[]
  > {
    return this.prisma.deploymentOrder.findMany({
      where: clientId ? { clientId } : {},
      include: { asset: true, endUser: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * Get a single deployment order by id.
   * Throws NotFoundException when not found.
   */
  async findOne(id: string): Promise<
    Prisma.DeploymentOrderGetPayload<{
      include: {
        asset: true;
        endUser: true;
        createdByUser: { select: { id: true; fullName: true } };
      };
    }>
  > {
    const order = await this.prisma.deploymentOrder.findUnique({
      where: { id },
      include: {
        asset: true,
        endUser: true,
        createdByUser: { select: { id: true, fullName: true } },
      },
    });
    if (!order) throw new NotFoundException(`Deployment order ${id} not found`);
    return order;
  }

  /**
   * Create a deployment order and post the corresponding ledger events
   * for the bundle type, courier zone, and any optional add-ons.
   * Also marks the asset as deployed.
   * Everything runs inside a single Prisma transaction.
   */
  async create(
    dto: CreateDeploymentOrderDto,
    createdByUserId: string,
  ): Promise<Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>> {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

    if (asset.clientId !== dto.clientId) {
      throw new BadRequestException(
        `Asset ${dto.assetId} does not belong to client ${dto.clientId}`,
      );
    }

    const occurredAt = new Date();
    const bundleType = dto.bundleType ?? 'standard';

    // Resolve all rate cards before entering the transaction so that a missing
    // rate code surfaces as a clear error before any DB writes happen.
    const bundleRateCode = bundleType === 'full_prep' ? 'FULL_PREP' : 'PICK_PACK';
    const bundleRate = await this.rateCard.findEffectiveAt(bundleRateCode, occurredAt);
    const bundleUnitRate = bundleRate ? bundleRate.unitRatePaise : BigInt(0);

    // Courier zone is derived server-side from the delivery pincode — never
    // trust a client-supplied zone for billing.
    const courierZone = await this.courierZone.resolveZone(dto.deliveryAddress.pincode);
    const courierCodeMap = {
      intra_state: 'COURIER_CITY',
      inter_state: 'COURIER_INTERSTATE',
      rural: 'COURIER_RURAL',
    } as const;
    const courierCode = courierCodeMap[courierZone];
    const courierRate = await this.rateCard.findEffectiveAt(courierCode, occurredAt);
    const courierUnitRate = courierRate ? courierRate.unitRatePaise : BigInt(0);

    let labelingUnitRate = BigInt(0);
    if (dto.requiresLabeling) {
      const labelingRate = await this.rateCard.findEffectiveAt('LABELING', occurredAt);
      labelingUnitRate = labelingRate ? labelingRate.unitRatePaise : BigInt(0);
    }

    let repackingUnitRate = BigInt(0);
    if (dto.requiresRepacking) {
      const repackingRate = await this.rateCard.findEffectiveAt('REPACKING', occurredAt);
      repackingUnitRate = repackingRate ? repackingRate.unitRatePaise : BigInt(0);
    }

    return this.prisma.$transaction(async (tx) => {
      // Create the deployment order record
      const order = await tx.deploymentOrder.create({
        data: {
          clientId: dto.clientId,
          assetId: dto.assetId,
          endUserId: dto.endUserId ?? null,
          bundleType,
          deliveryAddress: dto.deliveryAddress as object,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          courierZone,
          requiresLabeling: dto.requiresLabeling ?? false,
          requiresRepacking: dto.requiresRepacking ?? false,
          notes: dto.notes ?? null,
          createdByUserId,
          status: 'pending',
        },
        include: { asset: true, endUser: true },
      });

      // Mark asset as deployed and record the end user if provided
      await tx.asset.update({
        where: { id: dto.assetId },
        data: {
          currentStatus: 'deployed',
          ...(dto.endUserId ? { currentEndUserId: dto.endUserId } : {}),
        },
      });

      // Post bundle ledger event (FULL_PREP or PICK_PACK)
      const bundleEvent = await this.ledger.create({
        eventType: bundleRateCode,
        asset: { connect: { id: dto.assetId } },
        client: { connect: { id: dto.clientId } },
        quantity: 1,
        unitRatePaise: bundleUnitRate,
        amountPaise: bundleUnitRate,
        occurredAt,
        createdBy: createdByUserId,
        referenceId: order.id,
        referenceType: 'deployment_order',
      });

      // Post courier ledger event
      await this.ledger.create({
        eventType: courierCode,
        asset: { connect: { id: dto.assetId } },
        client: { connect: { id: dto.clientId } },
        quantity: 1,
        unitRatePaise: courierUnitRate,
        amountPaise: courierUnitRate,
        occurredAt,
        createdBy: createdByUserId,
        referenceId: order.id,
        referenceType: 'deployment_order',
      });

      // Post labeling ledger event if requested
      if (dto.requiresLabeling) {
        await this.ledger.create({
          eventType: 'LABELING',
          asset: { connect: { id: dto.assetId } },
          client: { connect: { id: dto.clientId } },
          quantity: 1,
          unitRatePaise: labelingUnitRate,
          amountPaise: labelingUnitRate,
          occurredAt,
          createdBy: createdByUserId,
          referenceId: order.id,
          referenceType: 'deployment_order',
        });
      }

      // Post repacking ledger event if requested
      if (dto.requiresRepacking) {
        await this.ledger.create({
          eventType: 'REPACKING',
          asset: { connect: { id: dto.assetId } },
          client: { connect: { id: dto.clientId } },
          quantity: 1,
          unitRatePaise: repackingUnitRate,
          amountPaise: repackingUnitRate,
          occurredAt,
          createdBy: createdByUserId,
          referenceId: order.id,
          referenceType: 'deployment_order',
        });
      }

      // If FULL_PREP: suppress component INGEST and INSPECT ledger events for this asset
      if (bundleType === 'full_prep') {
        const componentEvents = await tx.eventLedger.findMany({
          where: {
            assetId: dto.assetId,
            eventType: { in: ['INGEST', 'INSPECT', 'INGEST_LAPTOP', 'INGEST_PERIPHERAL'] },
          },
          select: { id: true },
        });
        for (const evt of componentEvents) {
          await tx.eventSuppression
            .create({
              data: {
                suppressedEventId: evt.id,
                suppressedByEventId: bundleEvent.id,
                assetId: dto.assetId,
                clientId: dto.clientId,
              },
            })
            .catch(() => {
              // suppressedEventId is @unique — ignore if already suppressed
            });
        }
      }

      await this.audit.log({
        userId: createdByUserId,
        action: 'deployment.create',
        entity: 'DeploymentOrder',
        entityId: order.id,
        newValue: { assetId: dto.assetId, endUserId: dto.endUserId ?? null, status: 'pending' },
      });

      return order;
    });
  }

  /**
   * Update the status of a deployment order.
   * Sets phase timestamps automatically:
   *   picking     -> processedAt
   *   dispatched  -> dispatchedAt
   *   delivered   -> deliveredAt
   */
  async updateStatus(
    id: string,
    dto: UpdateDeploymentStatusDto,
    updatedByUserId: string,
  ): Promise<Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>> {
    const order = await this.findOne(id);

    const DEPLOYMENT_TRANSITIONS: Record<string, string[]> = {
      pending: ['in_transit', 'cancelled'],
      in_transit: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
    };

    const allowed = DEPLOYMENT_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition deployment order from '${order.status}' to '${dto.status}'`,
      );
    }

    const now = new Date();
    const timestampPatch: Record<string, Date> = {};
    if (dto.status === 'in_transit') timestampPatch.dispatchedAt = now;
    if (dto.status === 'delivered') timestampPatch.deliveredAt = now;

    const updated = await this.prisma.deploymentOrder.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.trackingNumber !== undefined && { trackingNumber: dto.trackingNumber }),
        ...(dto.courierName !== undefined && { courierName: dto.courierName }),
        ...(dto.actualCarrierCostPaise !== undefined && {
          actualCarrierCostPaise: BigInt(dto.actualCarrierCostPaise),
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...timestampPatch,
      },
      include: { asset: true, endUser: true },
    });

    await this.audit.log({
      userId: updatedByUserId,
      action: 'deployment.updateStatus',
      entity: 'DeploymentOrder',
      entityId: id,
      oldValue: { status: order.status },
      newValue: { status: dto.status, trackingNumber: dto.trackingNumber },
    });

    return updated;
  }

  /** Update only the courier zone of an order (no ledger correction). */
  async updateZone(
    id: string,
    courierZone: 'intra_state' | 'inter_state' | 'rural',
    updatedByUserId: string,
  ): Promise<Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>> {
    const order = await this.findOne(id);
    const updated = await this.prisma.deploymentOrder.update({
      where: { id },
      data: { courierZone },
      include: { asset: true, endUser: true },
    });
    await this.audit.log({
      userId: updatedByUserId,
      action: 'deployment.updateZone',
      entity: 'DeploymentOrder',
      entityId: id,
      oldValue: { courierZone: order.courierZone },
      newValue: { courierZone },
    });
    return updated;
  }

  /** Update only the tracking number of an order. */
  async updateTracking(
    id: string,
    trackingNumber: string,
    updatedByUserId: string,
  ): Promise<Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>> {
    await this.findOne(id);
    const updated = await this.prisma.deploymentOrder.update({
      where: { id },
      data: { trackingNumber },
      include: { asset: true, endUser: true },
    });
    await this.audit.log({
      userId: updatedByUserId,
      action: 'deployment.updateTracking',
      entity: 'DeploymentOrder',
      entityId: id,
      newValue: { trackingNumber },
    });
    return updated;
  }

  /**
   * Find all deployment orders for a given asset.
   */
  findByAsset(
    assetId: string,
  ): Prisma.PrismaPromise<
    Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>[]
  > {
    return this.prisma.deploymentOrder.findMany({
      where: { assetId },
      include: { asset: true, endUser: true },
      orderBy: { requestedAt: 'desc' },
    });
  }
}
