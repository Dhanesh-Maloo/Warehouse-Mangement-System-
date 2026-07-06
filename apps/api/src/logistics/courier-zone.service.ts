import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { stateForPincode } from './pincode-state-map';

export type CourierZone = 'intra_state' | 'inter_state' | 'rural';

const PINCODE_PATTERN = /^\d{6}$/;

@Injectable()
export class CourierZoneService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Resolve the courier zone for a delivery/pickup pincode.
   * Rural is checked first (a rural-listed pincode overrides the
   * state comparison), then intra vs inter state by comparing the
   * pincode's derived state to the warehouse's configured origin state.
   */
  async resolveZone(pincode: string): Promise<CourierZone> {
    const trimmed = pincode?.trim() ?? '';
    if (!PINCODE_PATTERN.test(trimmed)) {
      throw new BadRequestException(`Invalid pincode '${pincode}' — expected 6 digits`);
    }

    const rural = await this.prisma.ruralPincode.findUnique({ where: { pincode: trimmed } });
    if (rural) return 'rural';

    const destinationState = stateForPincode(trimmed);
    if (!destinationState) {
      throw new BadRequestException(
        `Cannot determine courier zone for pincode '${trimmed}' — unrecognised prefix. Use the manual zone override.`,
      );
    }

    const warehouseState = this.config.get<string>('WAREHOUSE_STATE');
    if (!warehouseState) {
      throw new BadRequestException(
        'WAREHOUSE_STATE is not configured — cannot auto-resolve courier zone',
      );
    }

    return destinationState.trim().toLowerCase() === warehouseState.trim().toLowerCase()
      ? 'intra_state'
      : 'inter_state';
  }

  listRuralPincodes(): ReturnType<PrismaService['ruralPincode']['findMany']> {
    return this.prisma.ruralPincode.findMany({ orderBy: { pincode: 'asc' } });
  }

  addRuralPincode(
    pincode: string,
    note: string | undefined,
    createdByUserId: string,
  ): ReturnType<PrismaService['ruralPincode']['create']> {
    if (!PINCODE_PATTERN.test(pincode)) {
      throw new BadRequestException(`Invalid pincode '${pincode}' — expected 6 digits`);
    }
    return this.prisma.ruralPincode.create({
      data: { pincode, note, createdByUser: createdByUserId },
    });
  }

  async removeRuralPincode(pincode: string): Promise<void> {
    await this.prisma.ruralPincode.delete({ where: { pincode } }).catch(() => {
      throw new BadRequestException(`Pincode '${pincode}' is not on the rural list`);
    });
  }
}
