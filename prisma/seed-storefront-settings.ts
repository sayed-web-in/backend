import 'dotenv/config';
import { PrismaClient, HeaderBrandMode } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const topBar = await prisma.topBarConfig.upsert({
    where: { id: 1 },
    update: {
      phoneLabel: '',
      phoneHref: '',
      isPhoneShown: true,
    },
    create: {
      id: 1,
      phoneLabel: '',
      phoneHref: '',
      isPhoneShown: true,
    },
  });

  await prisma.topBarLink.deleteMany({ where: { topBarId: topBar.id } });

  await prisma.headerBrandConfig.upsert({
    where: { id: 1 },
    update: {
      mode: HeaderBrandMode.TEXT,
      brandName: '',
      brandLogoUrl: '',
      isActive: true,
    },
    create: {
      id: 1,
      mode: HeaderBrandMode.TEXT,
      brandName: '',
      brandLogoUrl: '',
      isActive: true,
    },
  });

  const footer = await prisma.footerConfig.upsert({
    where: { id: 1 },
    update: {
      description: '',
      address: '',
      phone: '',
      email: '',
      hours: '',
      copyrightText: '',
      isActive: true,
    },
    create: {
      id: 1,
      description: '',
      address: '',
      phone: '',
      email: '',
      hours: '',
      copyrightText: '',
      isActive: true,
    },
  });

  await prisma.footerLink.deleteMany({ where: { footerId: footer.id } });

  console.log('Storefront settings seeded with blank values.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
