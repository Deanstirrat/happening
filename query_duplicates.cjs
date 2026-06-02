const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  try {
    // Query for PUBLISHED events on 2026-04-09 (SF timezone = UTC-7)
    // Today starts at 2026-04-09T07:00:00Z and ends at 2026-04-10T07:00:00Z
    const events = await prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        startDate: {
          gte: new Date('2026-04-09T07:00:00Z'),
          lt: new Date('2026-04-10T07:00:00Z'),
        },
      },
      include: {
        source: {
          select: {
            name: true,
          },
        },
      },
      orderBy: [
        { title: 'asc' },
        { startDate: 'asc' },
        { venueName: 'asc' },
      ],
    });

    console.log(`\n=== TOTAL EVENTS FOR 2026-04-09: ${events.length} ===\n`);

    for (const event of events) {
      console.log(`ID: ${event.id}`);
      console.log(`Title: ${event.title}`);
      console.log(`Start Date: ${event.startDate.toISOString()}`);
      console.log(`Venue: ${event.venueName || 'N/A'}`);
      console.log(`Source: ${event.source.name}`);
      console.log(`Source URL: ${event.sourceUrl}`);
      console.log(`Dedupe Hash: ${event.dedupeHash}`);
      console.log('---');
    }

    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

main();
