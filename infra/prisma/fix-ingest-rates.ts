/**
 * One-time correction script — fixes INGEST ledger events posted with amountPaise = 0.
 *
 * Background: the inbound service was looking up rate code 'INGEST' which doesn't exist
 * in the rate card. The actual codes are 'INGEST_LAPTOP' and 'INGEST_PERIPHERAL'.
 * This caused every inbound event to be silently posted with unitRatePaise = 0.
 *
 * This script finds all affected INGEST events (amountPaise = 0 AND unitRatePaise = 0),
 * looks up the correct rate that was effective at the time of each event, and posts a
 * positive correction entry for the missing amount.
 *
 * Safe to run multiple times — skips events that already have a correction entry.
 *
 * Usage: pnpm db:fix-ingest-rates
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Starting INGEST rate correction...\n');

  // Find all INGEST events with zero amount that don't already have a correction
  const zeroIngestEvents = await prisma.eventLedger.findMany({
    where: {
      eventType: 'INGEST',
      amountPaise: BigInt(0),
      unitRatePaise: BigInt(0),
    },
    include: {
      asset: { select: { id: true, category: true, serialNumber: true } },
    },
    orderBy: { occurredAt: 'asc' },
  });

  console.log(`Found ${zeroIngestEvents.length} INGEST events with ₹0 amount.`);

  if (zeroIngestEvents.length === 0) {
    console.log('Nothing to fix.');
    return;
  }

  // Find which of these already have a correction so we can skip them
  const alreadyCorrected = await prisma.eventLedger.findMany({
    where: {
      eventType: 'CORRECTION_INGEST',
      referenceType: 'ingest_rate_correction',
      referenceId: { in: zeroIngestEvents.map((e) => e.id) },
    },
    select: { referenceId: true },
  });
  const correctedIds = new Set(alreadyCorrected.map((e) => e.referenceId));
  console.log(`${correctedIds.size} already corrected — skipping those.\n`);

  const toFix = zeroIngestEvents.filter((e) => !correctedIds.has(e.id));
  console.log(`Will post corrections for ${toFix.length} events.\n`);

  let fixed = 0;
  let skipped = 0;

  for (const event of toFix) {
    const category = event.asset.category;
    const rateCode = category === 'peripheral' ? 'INGEST_PERIPHERAL' : 'INGEST_LAPTOP';

    // Look up the rate that was effective at the time the original event occurred
    const rate = await prisma.rateCardItem.findFirst({
      where: {
        code: rateCode,
        effectiveFrom: { lte: event.occurredAt },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: event.occurredAt } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (!rate) {
      console.warn(
        `  SKIP — no ${rateCode} rate found effective at ${event.occurredAt.toISOString()} for asset ${event.asset.serialNumber}`,
      );
      skipped++;
      continue;
    }

    await prisma.eventLedger.create({
      data: {
        eventType: 'CORRECTION_INGEST',
        asset: { connect: { id: event.assetId } },
        client: { connect: { id: event.clientId } },
        quantity: 1,
        unitRatePaise: rate.unitRatePaise,
        amountPaise: rate.unitRatePaise,
        occurredAt: event.occurredAt,
        createdBy: 'system:ingest-rate-correction',
        referenceId: event.id,
        referenceType: 'ingest_rate_correction',
        notes: `Correction for INGEST event posted at ₹0 due to missing rate code. Asset: ${event.asset.serialNumber}, rate: ${rateCode} @ ₹${Number(rate.unitRatePaise) / 100}`,
      },
    });

    console.log(
      `  FIXED — ${event.asset.serialNumber} (${category}) → +₹${Number(rate.unitRatePaise) / 100} [${rateCode}]`,
    );
    fixed++;
  }

  console.log(`\nDone. Fixed: ${fixed}, Skipped: ${skipped}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
