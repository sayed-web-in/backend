import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

type SeedFaq = {
  question: string;
  answer: string;
  displayOrder: number;
  isActive?: boolean;
};

const faqs: SeedFaq[] = [
  {
    question: 'What is Future Technology?',
    answer:
      '<p>Future Technology is a multi-branded tech hub in Bangladesh where you can buy genuine smartphones, laptops, accessories, and smart gadgets with transparent pricing.</p>',
    displayOrder: 1,
    isActive: true,
  },
  {
    question: 'Does Future Technology sell original products?',
    answer:
      '<p>Yes. We focus on brand-new authentic devices and verify each product before delivery so customers receive official products and proper warranty support.</p>',
    displayOrder: 2,
    isActive: true,
  },
  {
    question: 'Can I shop both online and from physical stores?',
    answer:
      '<p>Yes, you can order online and also visit our physical outlets. We maintain the same quality promise in both channels with after-sales support.</p>',
    displayOrder: 3,
    isActive: true,
  },
  {
    question: 'Do you provide home delivery outside Dhaka?',
    answer:
      '<p>We deliver across Bangladesh through trusted courier partners. Delivery time can vary by location, but we always share tracking details after dispatch.</p>',
    displayOrder: 4,
    isActive: true,
  },
  {
    question: 'How can I get support after purchase?',
    answer:
      '<p>You can contact our support team with invoice details. We guide you for warranty claims, diagnostics, and service process as quickly as possible.</p>',
    displayOrder: 5,
    isActive: true,
  },
];

async function main() {
  let created = 0;
  let updated = 0;

  for (const row of faqs) {
    const existing = await prisma.faq.findFirst({
      where: { question: row.question },
      select: { id: true },
    });

    if (existing) {
      await prisma.faq.update({
        where: { id: existing.id },
        data: {
          answer: row.answer,
          displayOrder: row.displayOrder,
          isActive: row.isActive ?? true,
        },
      });
      updated++;
      continue;
    }

    await prisma.faq.create({
      data: {
        question: row.question,
        answer: row.answer,
        displayOrder: row.displayOrder,
        isActive: row.isActive ?? true,
      },
    });
    created++;
  }

  console.log(`Seeded FAQs: ${faqs.length} (${created} created, ${updated} updated)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
