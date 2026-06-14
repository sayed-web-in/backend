import 'dotenv/config';
import {
  PrismaClient,
  HeaderBrandMode,
  FooterLinkSection,
} from '@prisma/client';

const BRAND_NAME = process.env.SEED_BRAND_NAME?.trim() || 'Future Technology';

/**
 * Seeds top bar, header brand (text), footer copy + quick/customer links.
 * Safe to re-run: updates first rows by `findFirst` (no hard-coded ids).
 */
export async function seedStorefrontContent(prisma: PrismaClient): Promise<void> {
  let topBar = await prisma.topBarConfig.findFirst({ orderBy: { id: 'asc' } });
  if (!topBar) {
    topBar = await prisma.topBarConfig.create({
      data: {
        phoneLabel: '09678-664664',
        phoneHref: 'tel:09678664664',
        isPhoneShown: true,
      },
    });
  } else {
    await prisma.topBarConfig.update({
      where: { id: topBar.id },
      data: {
        phoneLabel: '09678-664664',
        phoneHref: 'tel:09678664664',
        isPhoneShown: true,
      },
    });
  }

  await prisma.topBarLink.deleteMany({ where: { topBarId: topBar.id } });
  await prisma.topBarLink.createMany({
    data: [
      {
        topBarId: topBar.id,
        label: 'Blog',
        href: '/blog',
        displayOrder: 1,
        isActive: true,
      },
      {
        topBarId: topBar.id,
        label: 'Service Center',
        href: '/service-center',
        displayOrder: 2,
        isActive: true,
      },
      {
        topBarId: topBar.id,
        label: 'Store Location',
        href: '/locations',
        displayOrder: 3,
        isActive: true,
      },
    ],
  });

  const existingHeader = await prisma.headerBrandConfig.findFirst({
    orderBy: { id: 'asc' },
  });
  if (!existingHeader) {
    await prisma.headerBrandConfig.create({
      data: {
        mode: HeaderBrandMode.TEXT,
        brandName: BRAND_NAME,
        brandLogoUrl: '',
        proprietorName: 'MD SYEDUL ISLAM',
        isActive: true,
      },
    });
  } else {
    await prisma.headerBrandConfig.update({
      where: { id: existingHeader.id },
      data: {
        mode: HeaderBrandMode.TEXT,
        brandName: BRAND_NAME,
        brandLogoUrl: '',
        proprietorName: 'MD SYEDUL ISLAM',
        isActive: true,
      },
    });
  }

  let footer = await prisma.footerConfig.findFirst({ orderBy: { id: 'asc' } });
  if (!footer) {
    footer = await prisma.footerConfig.create({
      data: {
        description:
          'Your trusted destination for the latest electronics, smartphones, laptops, and accessories in Bangladesh.',
        address: 'Dhaka, Bangladesh',
        phone: '+880 1XXX-XXXXXX',
        email: 'info@futuretechnology.local',
        hours: 'Sat - Thu: 10:00 - 20:00',
        copyrightText: `${BRAND_NAME}. All rights reserved.`,
        isActive: true,
      },
    });
  } else {
    await prisma.footerConfig.update({
      where: { id: footer.id },
      data: {
        description:
          'Your trusted destination for the latest electronics, smartphones, laptops, and accessories in Bangladesh.',
        address: 'Dhaka, Bangladesh',
        phone: '+880 1XXX-XXXXXX',
        email: 'info@futuretechnology.local',
        hours: 'Sat - Thu: 10:00 - 20:00',
        copyrightText: `${BRAND_NAME}. All rights reserved.`,
        isActive: true,
      },
    });
  }

  await prisma.footerLink.deleteMany({ where: { footerId: footer.id } });
  await prisma.footerLink.createMany({
    data: [
      {
        footerId: footer.id,
        section: FooterLinkSection.QUICK,
        label: 'Products',
        href: '/products',
        displayOrder: 1,
        isActive: true,
      },
      {
        footerId: footer.id,
        section: FooterLinkSection.QUICK,
        label: 'Categories',
        href: '/categories',
        displayOrder: 2,
        isActive: true,
      },
      {
        footerId: footer.id,
        section: FooterLinkSection.QUICK,
        label: 'Brands',
        href: '/brands',
        displayOrder: 3,
        isActive: true,
      },
      {
        footerId: footer.id,
        section: FooterLinkSection.QUICK,
        label: 'Track Order',
        href: '/track-order',
        displayOrder: 4,
        isActive: true,
      },
      {
        footerId: footer.id,
        section: FooterLinkSection.QUICK,
        label: 'Compare',
        href: '/compare',
        displayOrder: 5,
        isActive: true,
      },
      {
        footerId: footer.id,
        section: FooterLinkSection.CUSTOMER,
        label: 'My Account',
        href: '/account',
        displayOrder: 1,
        isActive: true,
      },
      {
        footerId: footer.id,
        section: FooterLinkSection.CUSTOMER,
        label: 'My Orders',
        href: '/account/orders',
        displayOrder: 2,
        isActive: true,
      },
      {
        footerId: footer.id,
        section: FooterLinkSection.CUSTOMER,
        label: 'Cart',
        href: '/cart',
        displayOrder: 3,
        isActive: true,
      },
      {
        footerId: footer.id,
        section: FooterLinkSection.CUSTOMER,
        label: 'Privacy Policy',
        href: '/privacy',
        displayOrder: 4,
        isActive: true,
      },
      {
        footerId: footer.id,
        section: FooterLinkSection.CUSTOMER,
        label: 'Terms & Conditions',
        href: '/terms',
        displayOrder: 5,
        isActive: true,
      },
    ],
  });

  const marketing = await prisma.storefrontMarketingConfig.findFirst({
    orderBy: { id: 'asc' },
  });
  if (!marketing) {
    await prisma.storefrontMarketingConfig.create({
      data: {
        gtmContainerId: '',
        publicSiteUrl: '',
        gtmCurrency: 'BDT',
        metaPixelId: '',
      },
    });
  } else {
    await prisma.storefrontMarketingConfig.update({
      where: { id: marketing.id },
      data: { gtmCurrency: 'BDT' },
    });
  }

  console.log(
    `Storefront content seeded (brand: "${BRAND_NAME}", top bar links, footer links).`,
  );
}

async function runStandalone(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await seedStorefrontContent(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  runStandalone().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
