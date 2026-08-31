/**
 * Idempotent seed script. Safe to run multiple times.
 *
 * Creates:
 *   - Postgres trigger that blocks UPDATE/DELETE on events_ledger
 *   - Esevel client record
 *   - Admin user (admin@ivalueindia.com) — password from SEED_ADMIN_PASSWORD env
 *   - Viewer user (viewer@esevel.com / Viewer@12345) — client_user role, Esevel only
 *   - 3 sample warehouse locations
 *
 * Usage: pnpm db:seed  (loads .env via dotenv-cli)
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function installLedgerTrigger(): Promise<void> {
  // Belt-and-suspenders guard: LedgerService already restricts the API surface,
  // but this trigger makes mutation impossible even via raw SQL.
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      RAISE EXCEPTION 'events_ledger is append-only: UPDATE and DELETE are not permitted';
      RETURN NULL;
    END;
    $$;
  `);

  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS trg_prevent_ledger_mutation ON events_ledger;`,
  );

  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER trg_prevent_ledger_mutation
    BEFORE UPDATE OR DELETE ON events_ledger
    FOR EACH ROW EXECUTE FUNCTION prevent_ledger_mutation();
  `);

  console.log('✓ events_ledger mutation trigger installed');
}

async function seedClient(): Promise<void> {
  const existing = await prisma.client.findFirst({ where: { slug: 'esevel' } });
  if (existing) {
    console.log(`✓ Client exists: Esevel (${existing.id})`);
    return;
  }

  const esevel = await prisma.client.create({
    data: {
      name: 'Esevel',
      slug: 'esevel',
      gstin: '29AABCE1234F1Z5',
      billingAddress: {
        line1: '1 Esevel Street',
        city: 'Singapore',
        country: 'SG',
        postal: '018989',
      },
      contactName: 'Esevel Operations',
      contactEmail: 'ops@esevel.com',
      contactPhone: '+6500000000',
      isActive: true,
    },
  });

  console.log(`✓ Created client: Esevel (${esevel.id})`);
}

async function seedAdminUser(): Promise<void> {
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error('SEED_ADMIN_PASSWORD env var is required to run seed');
  }

  const existing = await prisma.user.findUnique({
    where: { email: 'admin@ivalueindia.com' },
  });

  if (existing) {
    console.log('✓ Admin user exists: admin@ivalueindia.com');
    return;
  }

  const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });

  await prisma.user.create({
    data: {
      email: 'admin@ivalueindia.com',
      passwordHash,
      fullName: 'System Admin',
      role: 'admin',
      status: 'active',
    },
  });

  console.log('✓ Created admin user: admin@ivalueindia.com');
}

async function seedViewerUser(): Promise<void> {
  const existing = await prisma.user.findUnique({
    where: { email: 'viewer@esevel.com' },
  });

  if (existing) {
    console.log('✓ Viewer user exists: viewer@esevel.com');
    return;
  }

  // Look up the Esevel client to link the viewer to it
  const esevel = await prisma.client.findFirst({ where: { slug: 'esevel' } });
  if (!esevel) {
    throw new Error('Esevel client must be seeded before viewer user');
  }

  const passwordHash = await argon2.hash('Viewer@12345', { type: argon2.argon2id });

  await prisma.user.create({
    data: {
      email: 'viewer@esevel.com',
      passwordHash,
      fullName: 'Esevel Viewer',
      role: 'client_user',
      clientId: esevel.id,
      status: 'active',
    },
  });

  console.log('✓ Created viewer user: viewer@esevel.com (password: Viewer@12345)');
}

async function seedRateCard(): Promise<void> {
  const effectiveFrom = new Date('2026-06-17');

  const items = [
    {
      code: 'INGEST_LAPTOP',
      description: 'Receipt, Verification & WMS Recording (Laptop)',
      basis: 'per_device' as const,
      categoryApplies: 'laptop' as const,
      unitRatePaise: BigInt(4800),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'INGEST_PERIPHERAL',
      description: 'Receipt, Verification & WMS Recording (Peripheral)',
      basis: 'per_device' as const,
      categoryApplies: 'peripheral' as const,
      unitRatePaise: BigInt(1400),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'INSPECT',
      description: 'Device Inspection - visible damage check',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(19000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'PICK_PACK',
      description: 'Pick & Pack / Order Processing & Dispatch',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(12800),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'FULL_PREP',
      description: 'Device Setup & Outbound (bundled: receipt+inspect+pick_pack)',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(38000),
      isBundle: true,
      bundleComponentCodes: ['INGEST_LAPTOP', 'INSPECT', 'PICK_PACK'],
    },
    {
      code: 'COURIER_CITY',
      description: 'Courier Coordination - Intra-State (City Centre)',
      basis: 'per_shipment' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(150000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'COURIER_INTERSTATE',
      description: 'Courier Coordination - Inter-State',
      basis: 'per_shipment' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(250000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'COURIER_RURAL',
      description: 'Courier Coordination - Rural / Tier 3',
      basis: 'per_shipment' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(320000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'RETRIEVAL',
      description: 'Retrieval Request Processing & Asset Reconciliation',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(19000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'RETRIEVAL_FULL_CYCLE',
      description: 'Retrieval & Redeployment (full cycle bundled)',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(50000),
      isBundle: true,
      bundleComponentCodes: ['RETRIEVAL', 'INSPECT', 'PICK_PACK'],
    },
    {
      code: 'STORAGE_LAPTOP',
      description: 'Storage Fee - Laptop / Monitor',
      basis: 'monthly_per_device' as const,
      categoryApplies: 'laptop' as const,
      unitRatePaise: BigInt(11400),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'STORAGE_PERIPHERAL',
      description: 'Storage Fee - Peripheral',
      basis: 'monthly_per_device' as const,
      categoryApplies: 'peripheral' as const,
      unitRatePaise: BigInt(2800),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'DISPOSAL_NON_CERT',
      description: 'Non-Certified Disposal',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(45000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'DISPOSAL_CERTIFIED',
      description: 'Certified Data Destruction (Blanco)',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(55000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'DISPOSAL_ITAD',
      description: 'Retrieval + Disposal ITAD (full cycle bundled)',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(175000),
      isBundle: true,
      bundleComponentCodes: ['RETRIEVAL', 'DISPOSAL_CERTIFIED'],
    },
    {
      // Confirmed by Divya: certification is NOT included in Non-Certified
      // or ITAD Bundled disposal — it's a separate ₹550 + GST add-on per
      // the rate contract. Same price point as DISPOSAL_CERTIFIED, kept as
      // its own code so the ledger clearly shows it as an add-on line item.
      code: 'DISPOSAL_CERT_ADDON',
      description: 'Certification Add-on (wipe certificate + destruction certificate)',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(55000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'LABELING',
      description: 'Asset / Owner / Compliance Label Application',
      basis: 'per_label' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(4800),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'REPACKING',
      description: 'Re-Packing',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(14000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'REPAIR',
      description: 'Repair Handling (coordination only)',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(66500),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      // Retrieval's "Requires data wipe" checkbox requires choosing one of
      // these two tiers — same wording/pricing as the Disposal module's
      // non_certified/certified_blanco types, kept as separate rate codes so
      // retrieval-wipe revenue is distinguishable from disposal revenue.
      code: 'RETRIEVAL_WIPE_NON_CERT',
      description: 'Data Wipe - Non-Certified',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(45000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
    {
      code: 'RETRIEVAL_WIPE_CERTIFIED',
      description: 'Data Wipe - Certified Data Destruction (Blanco)',
      basis: 'per_device' as const,
      categoryApplies: 'any' as const,
      unitRatePaise: BigInt(55000),
      isBundle: false,
      bundleComponentCodes: [] as string[],
    },
  ];

  for (const item of items) {
    const existing = await prisma.rateCardItem.findFirst({
      where: { code: item.code, effectiveFrom },
    });

    if (existing) {
      console.log(`✓ Rate card item exists: ${item.code}`);
    } else {
      await prisma.rateCardItem.create({
        data: {
          code: item.code,
          description: item.description,
          basis: item.basis,
          categoryApplies: item.categoryApplies,
          unitRatePaise: item.unitRatePaise,
          effectiveFrom,
          effectiveTo: null,
          isBundle: item.isBundle,
          bundleComponentCodes: item.bundleComponentCodes,
        },
      });
      console.log(`✓ Created rate card item: ${item.code} (₹${Number(item.unitRatePaise) / 100})`);
    }
  }
}

async function seedLocations(): Promise<void> {
  const locations = [
    { name: 'A-001', zoneCode: 'A', binCode: '001', description: 'Zone A — Rack 1, Shelf 1' },
    { name: 'A-002', zoneCode: 'A', binCode: '002', description: 'Zone A — Rack 1, Shelf 2' },
    { name: 'B-001', zoneCode: 'B', binCode: '001', description: 'Zone B — Rack 1, Shelf 1' },
  ];

  for (const loc of locations) {
    const existing = await prisma.location.findUnique({
      where: { zoneCode_binCode: { zoneCode: loc.zoneCode, binCode: loc.binCode } },
    });

    if (existing) {
      console.log(`✓ Location exists: ${loc.name}`);
    } else {
      await prisma.location.create({ data: loc });
      console.log(`✓ Created location: ${loc.name}`);
    }
  }
}

async function seedHolidays(): Promise<void> {
  const holidays2026 = [
    { date: new Date('2026-01-01'), name: "New Year's Day" },
    { date: new Date('2026-01-14'), name: 'Makar Sankranti / Pongal' },
    { date: new Date('2026-01-26'), name: 'Republic Day' },
    { date: new Date('2026-03-08'), name: 'Maha Shivaratri' },
    { date: new Date('2026-03-21'), name: 'Holi' },
    { date: new Date('2026-04-02'), name: 'Ram Navami' },
    { date: new Date('2026-04-03'), name: 'Good Friday' },
    { date: new Date('2026-04-14'), name: 'Ambedkar Jayanti / Tamil New Year' },
    { date: new Date('2026-05-13'), name: 'Buddha Purnima' },
    { date: new Date('2026-06-05'), name: 'Id-ul-Fitr (Eid)' },
    { date: new Date('2026-08-12'), name: 'Bakrid / Eid al-Adha' },
    { date: new Date('2026-08-15'), name: 'Independence Day' },
    { date: new Date('2026-08-29'), name: 'Janmashtami' },
    { date: new Date('2026-09-02'), name: 'Ganesh Chaturthi' },
    { date: new Date('2026-10-02'), name: 'Gandhi Jayanti / Dussehra' },
    { date: new Date('2026-10-21'), name: 'Diwali' },
    { date: new Date('2026-10-22'), name: 'Govardhan Puja' },
    { date: new Date('2026-11-10'), name: 'Guru Nanak Jayanti' },
    { date: new Date('2026-12-25'), name: 'Christmas Day' },
  ];

  let created = 0;
  for (const h of holidays2026) {
    const existing = await prisma.holiday.findUnique({ where: { date: h.date } });
    if (!existing) {
      await prisma.holiday.create({
        data: { date: h.date, name: h.name, year: 2026 },
      });
      created++;
    }
  }
  console.log(`✓ Holidays: ${created} new, ${holidays2026.length - created} already exist`);
}

async function main(): Promise<void> {
  console.log('Running seed…\n');
  await installLedgerTrigger();
  await seedClient();
  await seedAdminUser();
  await seedViewerUser();
  await seedLocations();
  await seedRateCard();
  await seedHolidays();
  console.log('\nSeed complete.');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err: unknown) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
