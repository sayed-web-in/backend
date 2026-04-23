import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const rows = [
  {
    title: '24/7 Customer Support',
    description:
      '<p>Our team is ready around the clock to help with any questions or issues.</p>',
    icon: 'HEADSET',
    displayOrder: 1,
  },
  {
    title: 'Official Product',
    description:
      '<p>We sell original products that come from trusted and verified sources.</p>',
    icon: 'SHIELD_CHECK',
    displayOrder: 2,
  },
  {
    title: 'Fastest Delivery',
    description:
      '<p>We process orders quickly and deliver to your doorstep with trusted partners.</p>',
    icon: 'TRUCK',
    displayOrder: 3,
  },
  {
    title: 'Store Pickup',
    description:
      '<p>Pick up your order from our outlet if you prefer direct collection.</p>',
    icon: 'STORE',
    displayOrder: 4,
  },
  {
    title: 'Trusted Warranty',
    description:
      '<p>Warranty-backed devices and responsive after-sales service for confidence.</p>',
    icon: 'BADGE_CHECK',
    displayOrder: 5,
  },
  {
    title: 'ISO 9001:2015 Certified',
    description:
      '<p>Our ISO 9001:2015 certification means we follow a quality-first process.</p>',
    icon: 'CHECK_CIRCLE',
    displayOrder: 6,
  },
] as const;

async function main() {
  let created = 0;
  let updated = 0;

  for (const row of rows) {
    const existing = await prisma.shortFeature.findFirst({
      where: { title: row.title },
      select: { id: true },
    });

    if (existing) {
      await prisma.shortFeature.update({
        where: { id: existing.id },
        data: {
          description: row.description,
          icon: row.icon,
          displayOrder: row.displayOrder,
          isActive: true,
        },
      });
      updated++;
      continue;
    }

    await prisma.shortFeature.create({
      data: {
        title: row.title,
        description: row.description,
        icon: row.icon,
        displayOrder: row.displayOrder,
        isActive: true,
      },
    });
    created++;
  }

  console.log(
    `Seeded short features: ${rows.length} (${created} created, ${updated} updated)`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
