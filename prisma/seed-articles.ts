import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type SeedArticle = {
  title: string;
  content: string;
  isActive?: boolean;
};

const articles: SeedArticle[] = [
  {
    title: 'Authentic Moobile Phones, Laptops, Gadgets in Bangladesh',
    content:
      '<p>Looking for real mobile phones, laptops, and gadgets in Bangladesh? Choose Future Technology for trusted tech products. We offer official and authentic devices with proper warranty support and transparent pricing.</p><p>From flagship smartphones to reliable student laptops, our catalog is curated for daily users, gamers, creators, and professionals. Buy online or visit our outlet for hands-on support.</p>',
    isActive: true,
  },
  {
    title: 'Popular Gaming Phone Laptop Retail & Online Shop in Bangladesh',
    content:
      '<p>Welcome to Future Technology, a reliable online and physical store for Bangladesh\'s latest and authentic gaming devices. Find high-refresh gaming phones, RTX-powered laptops, and premium peripherals for pro-level performance.</p><p>We help you choose based on budget and use case with clear specs, after-sales service, and fast nationwide delivery.</p>',
    isActive: true,
  },
  {
    title: 'Best Laptop & MacBook Shop in Bangladesh',
    content:
      '<p>Future Technology is one of the top destinations in Bangladesh for laptops and MacBooks. Whether you are a freelancer, office professional, student, or gamer, we maintain options across all price segments.</p><p>Get expert guidance, verified configuration, and smooth service support so you can buy with confidence.</p>',
    isActive: true,
  },
  {
    title: 'Conclusion: Where to Buy Genuine Tech in Bangladesh',
    content:
      '<p>Future Technology offers strong value on smartphones, laptops, Apple products, accessories, and everyday gadgets in Bangladesh. Explore our online store for updated pricing, official products, and dependable support.</p>',
    isActive: true,
  },
];

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

async function main() {
  let created = 0;
  let updated = 0;

  for (const row of articles) {
    const slug = slugify(row.title);
    const existing = await prisma.article.findUnique({
      where: { slug },
      select: { id: true },
    });

    if (existing) {
      await prisma.article.update({
        where: { id: existing.id },
        data: {
          title: row.title,
          content: row.content,
          isActive: row.isActive ?? true,
        },
      });
      updated++;
      continue;
    }

    await prisma.article.create({
      data: {
        title: row.title,
        slug,
        content: row.content,
        isActive: row.isActive ?? true,
      },
    });
    created++;
  }

  console.log(`Seeded articles: ${articles.length} (${created} created, ${updated} updated)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
