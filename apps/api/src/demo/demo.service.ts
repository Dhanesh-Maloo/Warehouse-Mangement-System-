import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as argon2 from 'argon2';

const DEMO_CLIENT_SLUG = 'demo-techflow';
const DEMO_USER_SUFFIX = '@demo.local';
const DEMO_LOCATION_PREFIX = 'DEMO-';

function daysAgo(n: number, hourOffset = 9): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hourOffset, 0, 0, 0);
  return d;
}

@Injectable()
export class DemoService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Status ──────────────────────────────────────────────────────────────────

  async getStatus(): Promise<{ seeded: boolean; assetCount: number; userCount: number }> {
    const client = await this.prisma.client.findFirst({ where: { slug: DEMO_CLIENT_SLUG } });
    if (!client) return { seeded: false, assetCount: 0, userCount: 0 };
    const [assetCount, userCount] = await Promise.all([
      this.prisma.asset.count({ where: { clientId: client.id } }),
      this.prisma.user.count({ where: { email: { endsWith: DEMO_USER_SUFFIX } } }),
    ]);
    return { seeded: true, assetCount, userCount };
  }

  // ─── Seed ────────────────────────────────────────────────────────────────────

  async seed(): Promise<{ message: string }> {
    const existing = await this.prisma.client.findFirst({ where: { slug: DEMO_CLIENT_SLUG } });
    if (existing) throw new ConflictException('Demo data already exists. Remove it first.');

    const admin = await this.prisma.user.findFirst({ where: { role: 'admin' } });
    if (!admin) throw new ConflictException('No admin user found. Run db:seed first.');

    const passwordHash = await argon2.hash('Demo@1234', { type: argon2.argon2id });

    // 1. Client
    const client = await this.prisma.client.create({
      data: {
        name: 'Techflow Solutions',
        slug: DEMO_CLIENT_SLUG,
        gstin: '27AABCT9999A1Z3',
        billingAddress: {
          line1: '42 Techflow Park',
          city: 'Pune',
          state: 'Maharashtra',
          pincode: '411001',
        },
        contactName: 'Rohan Mehta',
        contactEmail: 'rohan@techflow.in',
        contactPhone: '+91 9876543210',
        committedMonthlyAmountPaise: BigInt(4_275_000),
        isActive: true,
      },
    });

    // 2. Users
    const [manager, op1, op2, clientUser1] = await Promise.all([
      this.prisma.user.create({
        data: {
          email: `manager${DEMO_USER_SUFFIX}`,
          passwordHash,
          fullName: 'Priya Sharma',
          role: 'manager',
          status: 'active',
        },
      }),
      this.prisma.user.create({
        data: {
          email: `operator1${DEMO_USER_SUFFIX}`,
          passwordHash,
          fullName: 'Ankit Rao',
          role: 'operator',
          status: 'active',
        },
      }),
      this.prisma.user.create({
        data: {
          email: `operator2${DEMO_USER_SUFFIX}`,
          passwordHash,
          fullName: 'Divya Nair',
          role: 'operator',
          status: 'active',
        },
      }),
      this.prisma.user.create({
        data: {
          email: `client1${DEMO_USER_SUFFIX}`,
          passwordHash,
          fullName: 'Suresh Kumar',
          role: 'client_user',
          status: 'active',
          clientId: client.id,
        },
      }),
    ]);
    void clientUser1;

    // 3. Locations
    const locationData = [
      { name: `${DEMO_LOCATION_PREFIX}Zone-D Bin-01`, zoneCode: 'D', binCode: '01', capacity: 20 },
      { name: `${DEMO_LOCATION_PREFIX}Zone-D Bin-02`, zoneCode: 'D', binCode: '02', capacity: 20 },
      { name: `${DEMO_LOCATION_PREFIX}Zone-D Bin-03`, zoneCode: 'D', binCode: '03', capacity: 15 },
      { name: `${DEMO_LOCATION_PREFIX}Zone-E Bin-01`, zoneCode: 'E', binCode: '01', capacity: 25 },
      { name: `${DEMO_LOCATION_PREFIX}Zone-E Bin-02`, zoneCode: 'E', binCode: '02', capacity: 25 },
    ];
    const locations = await Promise.all(
      locationData.map((l) => this.prisma.location.create({ data: l })),
    );

    // 4. End Users
    const endUserData = [
      {
        name: 'Arjun Mehta',
        employeeId: 'EMP-001',
        email: 'arjun@techflow.in',
        city: 'Pune',
        country: 'India',
      },
      {
        name: 'Sneha Iyer',
        employeeId: 'EMP-002',
        email: 'sneha@techflow.in',
        city: 'Chennai',
        country: 'India',
      },
      {
        name: 'Rahul Gupta',
        employeeId: 'EMP-003',
        email: 'rahul@techflow.in',
        city: 'Delhi',
        country: 'India',
      },
      {
        name: 'Kavya Reddy',
        employeeId: 'EMP-004',
        email: 'kavya@techflow.in',
        city: 'Hyderabad',
        country: 'India',
      },
      {
        name: 'Vikram Singh',
        employeeId: 'EMP-005',
        email: 'vikram@techflow.in',
        city: 'Bengaluru',
        country: 'India',
      },
      {
        name: 'Pooja Nair',
        employeeId: 'EMP-006',
        email: 'pooja@techflow.in',
        city: 'Mumbai',
        country: 'India',
      },
      {
        name: 'Amit Joshi',
        employeeId: 'EMP-007',
        email: 'amit@techflow.in',
        city: 'Pune',
        country: 'India',
      },
      {
        name: 'Lakshmi Priya',
        employeeId: 'EMP-008',
        email: 'lakshmi@techflow.in',
        city: 'Chennai',
        country: 'India',
      },
    ];
    const endUsers = await Promise.all(
      endUserData.map((eu) => this.prisma.endUser.create({ data: { ...eu, clientId: client.id } })),
    );

    // 5. Rate card lookup
    const rateCards = await this.prisma.rateCardItem.findMany({ where: { effectiveTo: null } });
    const rPaise = (code: string, fallback: bigint): bigint =>
      rateCards.find((r) => r.code === code)?.unitRatePaise ?? fallback;

    // 6. Assets
    type AssetDef = {
      serial: string;
      model: string;
      mfr: string;
      cat: 'laptop' | 'monitor' | 'peripheral';
      status: 'deployed' | 'in_storage' | 'in_inspection' | 'returning' | 'disposed';
      locIdx: number | null;
      grade: 'A' | 'B' | 'C' | 'D' | null;
      euIdx: number | null;
    };
    const assetDefs: AssetDef[] = [
      {
        serial: 'DEMO-LP-001',
        model: 'ThinkPad X1 Carbon',
        mfr: 'Lenovo',
        cat: 'laptop',
        status: 'deployed',
        locIdx: null,
        grade: 'A',
        euIdx: 0,
      },
      {
        serial: 'DEMO-LP-002',
        model: 'MacBook Pro 14"',
        mfr: 'Apple',
        cat: 'laptop',
        status: 'deployed',
        locIdx: null,
        grade: 'A',
        euIdx: 1,
      },
      {
        serial: 'DEMO-LP-003',
        model: 'EliteBook 840 G10',
        mfr: 'HP',
        cat: 'laptop',
        status: 'deployed',
        locIdx: null,
        grade: 'B',
        euIdx: 2,
      },
      {
        serial: 'DEMO-LP-004',
        model: 'Latitude 5540',
        mfr: 'Dell',
        cat: 'laptop',
        status: 'deployed',
        locIdx: null,
        grade: 'A',
        euIdx: 3,
      },
      {
        serial: 'DEMO-LP-005',
        model: 'XPS 15 9530',
        mfr: 'Dell',
        cat: 'laptop',
        status: 'deployed',
        locIdx: null,
        grade: 'A',
        euIdx: 4,
      },
      {
        serial: 'DEMO-LP-006',
        model: 'ThinkPad L14 Gen4',
        mfr: 'Lenovo',
        cat: 'laptop',
        status: 'deployed',
        locIdx: null,
        grade: 'B',
        euIdx: 5,
      },
      {
        serial: 'DEMO-LP-007',
        model: 'ZBook Fury 16 G10',
        mfr: 'HP',
        cat: 'laptop',
        status: 'deployed',
        locIdx: null,
        grade: 'A',
        euIdx: 6,
      },
      {
        serial: 'DEMO-LP-008',
        model: 'Surface Laptop 5',
        mfr: 'Microsoft',
        cat: 'laptop',
        status: 'deployed',
        locIdx: null,
        grade: 'A',
        euIdx: 7,
      },
      {
        serial: 'DEMO-LP-009',
        model: 'ThinkPad E14 Gen5',
        mfr: 'Lenovo',
        cat: 'laptop',
        status: 'in_storage',
        locIdx: 0,
        grade: 'A',
        euIdx: null,
      },
      {
        serial: 'DEMO-LP-010',
        model: 'Inspiron 15 3530',
        mfr: 'Dell',
        cat: 'laptop',
        status: 'in_storage',
        locIdx: 0,
        grade: 'B',
        euIdx: null,
      },
      {
        serial: 'DEMO-LP-011',
        model: 'ProBook 450 G10',
        mfr: 'HP',
        cat: 'laptop',
        status: 'in_storage',
        locIdx: 1,
        grade: 'A',
        euIdx: null,
      },
      {
        serial: 'DEMO-MN-001',
        model: 'UltraSharp U2723D 27"',
        mfr: 'Dell',
        cat: 'monitor',
        status: 'in_storage',
        locIdx: 2,
        grade: 'A',
        euIdx: null,
      },
      {
        serial: 'DEMO-MN-002',
        model: 'Pro Display XDR',
        mfr: 'Apple',
        cat: 'monitor',
        status: 'in_storage',
        locIdx: 2,
        grade: 'A',
        euIdx: null,
      },
      {
        serial: 'DEMO-PR-001',
        model: 'MX Keys S Keyboard',
        mfr: 'Logitech',
        cat: 'peripheral',
        status: 'in_storage',
        locIdx: 3,
        grade: 'A',
        euIdx: null,
      },
      {
        serial: 'DEMO-PR-002',
        model: 'MX Master 3S Mouse',
        mfr: 'Logitech',
        cat: 'peripheral',
        status: 'in_storage',
        locIdx: 3,
        grade: 'A',
        euIdx: null,
      },
      {
        serial: 'DEMO-LP-012',
        model: 'Spectre x360 14"',
        mfr: 'HP',
        cat: 'laptop',
        status: 'in_inspection',
        locIdx: 4,
        grade: null,
        euIdx: null,
      },
      {
        serial: 'DEMO-LP-013',
        model: 'IdeaPad Slim 5 16"',
        mfr: 'Lenovo',
        cat: 'laptop',
        status: 'in_inspection',
        locIdx: 4,
        grade: null,
        euIdx: null,
      },
      {
        serial: 'DEMO-PR-003',
        model: 'Jabra Evolve2 85',
        mfr: 'Jabra',
        cat: 'peripheral',
        status: 'in_inspection',
        locIdx: 4,
        grade: null,
        euIdx: null,
      },
      {
        serial: 'DEMO-LP-014',
        model: 'ThinkPad T14s Gen4',
        mfr: 'Lenovo',
        cat: 'laptop',
        status: 'returning',
        locIdx: null,
        grade: 'B',
        euIdx: null,
      },
      {
        serial: 'DEMO-MN-003',
        model: 'P2422H 24" Monitor',
        mfr: 'Dell',
        cat: 'monitor',
        status: 'returning',
        locIdx: null,
        grade: 'A',
        euIdx: null,
      },
      {
        serial: 'DEMO-LP-015',
        model: 'EliteBook 745 G5',
        mfr: 'HP',
        cat: 'laptop',
        status: 'disposed',
        locIdx: null,
        grade: 'D',
        euIdx: null,
      },
      {
        serial: 'DEMO-PR-004',
        model: 'USB-C Hub (2020)',
        mfr: 'Anker',
        cat: 'peripheral',
        status: 'disposed',
        locIdx: null,
        grade: 'D',
        euIdx: null,
      },
    ];

    const createdAssets = await Promise.all(
      assetDefs.map((d) =>
        this.prisma.asset.create({
          data: {
            serialNumber: d.serial,
            model: d.model,
            manufacturer: d.mfr,
            category: d.cat,
            clientId: client.id,
            currentStatus: d.status,
            currentLocationId: d.locIdx !== null ? locations[d.locIdx].id : null,
            conditionGrade: d.grade,
            currentEndUserId: d.euIdx !== null ? endUsers[d.euIdx].id : null,
          },
        }),
      ),
    );

    // 7. Expected Deliveries
    const delivery1 = await this.prisma.expectedDelivery.create({
      data: {
        clientId: client.id,
        purchaseOrderRef: 'PO-DEMO-2026-001',
        expectedArrivalDate: daysAgo(60),
        status: 'completed',
        notes: 'Initial onboarding batch — Q1 2026',
        items: {
          create: [
            {
              category: 'laptop',
              model: 'ThinkPad X1 Carbon',
              manufacturer: 'Lenovo',
              quantity: 5,
              receivedQuantity: 5,
            },
            {
              category: 'laptop',
              model: 'MacBook Pro 14"',
              manufacturer: 'Apple',
              quantity: 3,
              receivedQuantity: 3,
            },
            {
              category: 'peripheral',
              model: 'MX Keys S Keyboard',
              manufacturer: 'Logitech',
              quantity: 2,
              receivedQuantity: 2,
            },
          ],
        },
      },
    });

    const delivery2 = await this.prisma.expectedDelivery.create({
      data: {
        clientId: client.id,
        purchaseOrderRef: 'PO-DEMO-2026-002',
        expectedArrivalDate: daysAgo(30),
        status: 'partially_received',
        notes: 'Q2 expansion — monitors and headsets',
        items: {
          create: [
            {
              category: 'monitor',
              model: 'UltraSharp U2723D 27"',
              manufacturer: 'Dell',
              quantity: 3,
              receivedQuantity: 2,
            },
            {
              category: 'peripheral',
              model: 'Jabra Evolve2 85',
              manufacturer: 'Jabra',
              quantity: 5,
              receivedQuantity: 3,
            },
          ],
        },
      },
    });

    await this.prisma.expectedDelivery.create({
      data: {
        clientId: client.id,
        purchaseOrderRef: 'PO-DEMO-2026-003',
        expectedArrivalDate: new Date(Date.now() + 2 * 86_400_000),
        status: 'pending',
        notes: 'Upcoming: 5 Latitude laptops for new hires',
        items: {
          create: [
            {
              category: 'laptop',
              model: 'Latitude 5540',
              manufacturer: 'Dell',
              quantity: 5,
              receivedQuantity: 0,
            },
          ],
        },
      },
    });

    // 8. GRNs
    const grnAssets1 = createdAssets.filter((a) =>
      [
        'DEMO-LP-001',
        'DEMO-LP-002',
        'DEMO-LP-003',
        'DEMO-LP-004',
        'DEMO-LP-005',
        'DEMO-LP-006',
        'DEMO-LP-007',
        'DEMO-LP-008',
        'DEMO-LP-009',
        'DEMO-PR-001',
      ].includes(a.serialNumber),
    );
    await this.prisma.goodsReceivedNote.create({
      data: {
        expectedDeliveryId: delivery1.id,
        grnNumber: 'GRN-202604-0001',
        receivedAt: daysAgo(60),
        receivedByUserId: op1.id,
        receivingLocationId: locations[0].id,
        courierRef: 'BLR-56789',
        deviceCount: grnAssets1.length,
        assets: { create: grnAssets1.map((a) => ({ assetId: a.id })) },
      },
    });

    const grnAssets2 = createdAssets.filter((a) =>
      ['DEMO-MN-001', 'DEMO-MN-002', 'DEMO-PR-002'].includes(a.serialNumber),
    );
    await this.prisma.goodsReceivedNote.create({
      data: {
        expectedDeliveryId: delivery2.id,
        grnNumber: 'GRN-202605-0001',
        receivedAt: daysAgo(30),
        receivedByUserId: op2.id,
        receivingLocationId: locations[2].id,
        courierRef: 'PNQ-12345',
        deviceCount: grnAssets2.length,
        assets: { create: grnAssets2.map((a) => ({ assetId: a.id })) },
      },
    });

    // 9. Inspections — completed for deployed assets
    for (const asset of createdAssets.slice(0, 8)) {
      const def = assetDefs[createdAssets.indexOf(asset)];
      await this.prisma.inspection.create({
        data: {
          assetId: asset.id,
          type: 'inbound',
          status: 'completed',
          startedAt: daysAgo(57),
          startedByUserId: op1.id,
          completedAt: daysAgo(55),
          completedByUserId: op1.id,
          conditionGrade: def.grade ?? 'A',
          scratchesOnCasing: false,
          lidClosingOk: true,
          scratchesOnScreen: false,
          keyboardIssues: false,
          missingFeet: false,
          chargerDamage: false,
          allAccessoriesPresent: true,
          webcamOk: true,
          speakersOk: true,
          bluetoothOk: true,
          batteryCharges: true,
          screenOk: true,
          keyboardOk: true,
          trackpadOk: true,
          portsOk: true,
          powersOnOk: true,
          imagesUploaded: true,
          sanitization: true,
          factoryReset: true,
          slaMinutes: 480,
        },
      });
    }
    // Open inspections — index 1 is 28 days old (breached SLA)
    const openInspAssets = createdAssets.filter((a) => a.currentStatus === 'in_inspection');
    const inspAges = [2, 28, 5];
    for (let i = 0; i < openInspAssets.length; i++) {
      await this.prisma.inspection.create({
        data: {
          assetId: openInspAssets[i].id,
          type: 'inbound',
          status: 'in_progress',
          startedAt: daysAgo(inspAges[i]),
          startedByUserId: op2.id,
        },
      });
    }

    // 10. Deployment orders
    const deployedAssets = createdAssets.filter((a) => a.currentStatus === 'deployed');
    for (let i = 0; i < Math.min(deployedAssets.length, 6); i++) {
      const asset = deployedAssets[i];
      const eu = endUsers[i % endUsers.length];
      await this.prisma.deploymentOrder.create({
        data: {
          clientId: client.id,
          assetId: asset.id,
          endUserId: eu.id,
          bundleType: i % 3 === 0 ? 'full_prep' : 'standard',
          deliveryAddress: {
            line1: `${i + 1} Tech Park`,
            city: eu.city ?? 'Pune',
            state: 'Maharashtra',
            pincode: '411001',
          },
          contactName: eu.name,
          contactPhone: '+91 9876543210',
          courierZone: i % 2 === 0 ? 'intra_state' : 'inter_state',
          trackingNumber: `TRK-DEMO-${String(i + 1).padStart(4, '0')}`,
          courierName: i % 2 === 0 ? 'BlueDart' : 'FedEx',
          status: 'delivered',
          createdByUserId: manager.id,
          requestedAt: daysAgo(50),
          processedAt: daysAgo(49),
          dispatchedAt: daysAgo(48),
          deliveredAt: daysAgo(45),
        },
      });
    }
    // One pending deployment
    const pendingDeployAsset = createdAssets.find(
      (a) => a.currentStatus === 'in_storage' && a.category === 'laptop',
    );
    if (pendingDeployAsset) {
      await this.prisma.deploymentOrder.create({
        data: {
          clientId: client.id,
          assetId: pendingDeployAsset.id,
          bundleType: 'standard',
          deliveryAddress: {
            line1: '7 Baner Road',
            city: 'Pune',
            state: 'Maharashtra',
            pincode: '411045',
          },
          contactName: 'New Hire',
          contactPhone: '+91 9123456789',
          courierZone: 'intra_state',
          status: 'pending',
          createdByUserId: manager.id,
        },
      });
    }

    // 11. Retrieval requests
    const returningAssets = createdAssets.filter((a) => a.currentStatus === 'returning');
    for (const [i, asset] of returningAssets.entries()) {
      await this.prisma.retrievalRequest.create({
        data: {
          clientId: client.id,
          assetId: asset.id,
          bundleType: 'standard',
          pickupAddress: {
            line1: '12 MG Road',
            city: 'Bengaluru',
            state: 'Karnataka',
            pincode: '560001',
          },
          contactName: endUsers[4].name,
          contactPhone: '+91 9765432100',
          courierZone: 'inter_state',
          requiresPostInspection: true,
          status: 'in_transit',
          trackingNumber: `RTR-DEMO-${String(i + 1).padStart(4, '0')}`,
          requestedAt: daysAgo(5),
          initiatedAt: daysAgo(4),
          createdByUserId: op2.id,
        },
      });
    }

    // 12. Disposal requests
    const disposedAssets = createdAssets.filter((a) => a.currentStatus === 'disposed');
    for (const [i, asset] of disposedAssets.entries()) {
      await this.prisma.disposalRequest.create({
        data: {
          clientId: client.id,
          assetId: asset.id,
          disposalType: i === 0 ? 'certified_blanco' : 'non_certified',
          status: 'completed',
          notes: 'End-of-life — beyond economical repair',
          createdByUserId: manager.id,
          approvedByUserId: admin.id,
          approvedAt: daysAgo(15),
          completedAt: daysAgo(10),
        },
      });
    }
    const pendingDisposalAsset = createdAssets.find(
      (a) => a.currentStatus === 'in_storage' && a.category === 'peripheral',
    );
    if (pendingDisposalAsset) {
      await this.prisma.disposalRequest.create({
        data: {
          clientId: client.id,
          assetId: pendingDisposalAsset.id,
          disposalType: 'non_certified',
          status: 'pending',
          notes: 'Damaged hub — awaiting approval',
          createdByUserId: op1.id,
        },
      });
    }

    // 13. Ledger entries
    const ingestLaptopPaise = rPaise('INGEST_LAPTOP', BigInt(4800));
    const ingestPeriphPaise = rPaise('INGEST_PERIPHERAL', BigInt(1400));
    const inspPaise = rPaise('INSPECT', BigInt(19000));
    const pickPaise = rPaise('PICK_PACK', BigInt(12800));
    const courCityPaise = rPaise('COURIER_CITY', BigInt(150000));
    const courInterPaise = rPaise('COURIER_INTERSTATE', BigInt(250000));
    const storLaptopPaise = rPaise('STORAGE_LAPTOP', BigInt(11400));
    const retrPaise = rPaise('RETRIEVAL', BigInt(19000));

    type LedgerRow = Parameters<typeof this.prisma.eventLedger.create>[0]['data'];
    const ledgerRows: LedgerRow[] = [];

    // Ingest for first 15 assets (received in delivery 1 + 2)
    for (const asset of createdAssets.slice(0, 15)) {
      const isPeriph = asset.category === 'peripheral';
      ledgerRows.push({
        eventType: isPeriph ? 'INGEST_PERIPHERAL' : 'INGEST_LAPTOP',
        assetId: asset.id,
        clientId: client.id,
        quantity: 1,
        unitRatePaise: isPeriph ? ingestPeriphPaise : ingestLaptopPaise,
        amountPaise: isPeriph ? ingestPeriphPaise : ingestLaptopPaise,
        occurredAt: daysAgo(60),
        createdBy: op1.id,
      });
    }
    // Inspect + pick + courier for deployed assets
    for (const [i, asset] of createdAssets.slice(0, 8).entries()) {
      const cCity = i % 2 === 0;
      ledgerRows.push(
        {
          eventType: 'INSPECT',
          assetId: asset.id,
          clientId: client.id,
          quantity: 1,
          unitRatePaise: inspPaise,
          amountPaise: inspPaise,
          occurredAt: daysAgo(55),
          createdBy: op1.id,
        },
        {
          eventType: 'PICK_PACK',
          assetId: asset.id,
          clientId: client.id,
          quantity: 1,
          unitRatePaise: pickPaise,
          amountPaise: pickPaise,
          occurredAt: daysAgo(50),
          createdBy: op1.id,
        },
        {
          eventType: cCity ? 'COURIER_CITY' : 'COURIER_INTERSTATE',
          assetId: asset.id,
          clientId: client.id,
          quantity: 1,
          unitRatePaise: cCity ? courCityPaise : courInterPaise,
          amountPaise: cCity ? courCityPaise : courInterPaise,
          occurredAt: daysAgo(50),
          createdBy: op1.id,
        },
      );
    }
    // Monthly storage
    for (const asset of createdAssets.filter((a) => a.currentStatus === 'in_storage')) {
      ledgerRows.push({
        eventType: 'STORAGE_MONTHLY',
        assetId: asset.id,
        clientId: client.id,
        quantity: 1,
        unitRatePaise: storLaptopPaise,
        amountPaise: storLaptopPaise,
        occurredAt: daysAgo(20),
        createdBy: admin.id,
      });
    }
    // Retrieval
    for (const asset of createdAssets.filter((a) => a.currentStatus === 'returning')) {
      ledgerRows.push({
        eventType: 'RETRIEVAL',
        assetId: asset.id,
        clientId: client.id,
        quantity: 1,
        unitRatePaise: retrPaise,
        amountPaise: retrPaise,
        occurredAt: daysAgo(5),
        createdBy: op2.id,
      });
    }

    for (const row of ledgerRows) {
      await this.prisma.eventLedger.create({ data: row });
    }

    // 14. Audit log samples
    await this.prisma.auditLog.create({
      data: {
        userId: admin.id,
        action: 'CREATE',
        entity: 'client',
        entityId: client.id,
        newValue: { name: 'Techflow Solutions' },
        ipAddress: '127.0.0.1',
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: manager.id,
        action: 'UPDATE',
        entity: 'asset',
        entityId: createdAssets[0].id,
        oldValue: { status: 'in_storage' },
        newValue: { status: 'deployed' },
        ipAddress: '127.0.0.1',
      },
    });
    await this.prisma.auditLog.create({
      data: {
        userId: op1.id,
        action: 'CREATE',
        entity: 'inspection',
        entityId: createdAssets[0].id,
        newValue: { type: 'inbound' },
        ipAddress: '127.0.0.1',
      },
    });

    return {
      message: `Demo seeded: "${client.name}" — ${createdAssets.length} assets, ${ledgerRows.length} ledger entries.`,
    };
  }

  // ─── Teardown ─────────────────────────────────────────────────────────────

  async teardown(): Promise<{ message: string }> {
    const client = await this.prisma.client.findFirst({ where: { slug: DEMO_CLIENT_SLUG } });
    if (!client) return { message: 'No demo data found.' };

    // Drop ledger immutability trigger so cascades can delete ledger rows
    await this.prisma.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS trg_prevent_ledger_mutation ON events_ledger;`,
    );

    try {
      await this.prisma.auditLog.deleteMany({
        where: { user: { email: { endsWith: DEMO_USER_SUFFIX } } },
      });
      await this.prisma.storageAccrualRun.deleteMany({ where: { clientId: client.id } });
      await this.prisma.disposalRequest.deleteMany({ where: { clientId: client.id } });
      await this.prisma.retrievalRequest.deleteMany({ where: { clientId: client.id } });
      await this.prisma.deploymentOrder.deleteMany({ where: { clientId: client.id } });
      await this.prisma.inspectionPhoto.deleteMany({
        where: { inspection: { asset: { clientId: client.id } } },
      });
      await this.prisma.inspection.deleteMany({
        where: { asset: { clientId: client.id } },
      });
      await this.prisma.eventLedger.deleteMany({ where: { clientId: client.id } });
      await this.prisma.grnAsset.deleteMany({
        where: { asset: { clientId: client.id } },
      });
      await this.prisma.goodsReceivedNote.deleteMany({
        where: { expectedDelivery: { clientId: client.id } },
      });
      await this.prisma.expectedDeliveryItem.deleteMany({
        where: { delivery: { clientId: client.id } },
      });
      await this.prisma.expectedDelivery.deleteMany({ where: { clientId: client.id } });
      await this.prisma.asset.deleteMany({ where: { clientId: client.id } });
      await this.prisma.endUser.deleteMany({ where: { clientId: client.id } });
      await this.prisma.user.deleteMany({ where: { email: { endsWith: DEMO_USER_SUFFIX } } });
      await this.prisma.location.deleteMany({
        where: { name: { startsWith: DEMO_LOCATION_PREFIX } },
      });
      await this.prisma.client.delete({ where: { id: client.id } });
    } finally {
      // Always reinstall the trigger
      await this.prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
        RETURNS TRIGGER LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'events_ledger is append-only: UPDATE and DELETE are not permitted';
          RETURN NULL;
        END;
        $$;
      `);
      await this.prisma.$executeRawUnsafe(`
        CREATE TRIGGER trg_prevent_ledger_mutation
        BEFORE UPDATE OR DELETE ON events_ledger
        FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
      `);
    }

    return { message: 'Demo data removed and ledger trigger reinstalled.' };
  }
}
