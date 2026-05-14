import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { seedStorefrontContent } from './seed-storefront-content';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@futuretechnology.local';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin@123456';
  const name = process.env.ADMIN_NAME ?? 'Super Admin';
  const categories = [
    { name: 'Smartphones', description: 'Android and iOS smartphones', displayOrder: 1 },
    { name: 'Laptops', description: 'Gaming, business and ultrabook laptops', displayOrder: 2 },
    { name: 'Accessories', description: 'Chargers, cables, cases and peripherals', displayOrder: 3 },
    { name: 'Networking', description: 'Routers, switches and connectivity devices', displayOrder: 4 },
    { name: 'Wearables', description: 'Smart watches and fitness devices', displayOrder: 5 },
  ];
  const subCategoryMap: Record<string, string[]> = {
    Smartphones: ['Android Phones', 'iPhones', 'Feature Phones'],
    Laptops: ['Gaming Laptops', 'Business Laptops', 'Student Laptops'],
    Accessories: ['Phone Cases', 'Chargers', 'Data Cables'],
    Networking: ['Wi-Fi Routers', 'Network Switches', 'Range Extenders'],
    Wearables: ['Smart Watches', 'Fitness Bands', 'Earbuds'],
  };

  const hashed = await bcrypt.hash(password, 10);

  const user = await prisma.user.upsert({
    where: { email },
    create: {
      email,
      name,
      password: hashed,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
    update: {
      name,
      password: hashed,
      role: UserRole.SUPER_ADMIN,
      isActive: true,
    },
  });

  let createdCategoryCount = 0;
  let createdSubCategoryCount = 0;
  let updatedSubCategoryCount = 0;
  for (const category of categories) {
    let categoryId: number;
    const existingCategory = await prisma.category.findFirst({
      where: { name: category.name },
      select: { id: true },
    });

    if (existingCategory) {
      await prisma.category.update({
        where: { id: existingCategory.id },
        data: {
          description: category.description,
          displayOrder: category.displayOrder,
          isActive: true,
        },
      });
      categoryId = existingCategory.id;
    } else {
      const createdCategory = await prisma.category.create({
        data: {
          name: category.name,
          description: category.description,
          displayOrder: category.displayOrder,
          isActive: true,
        },
        select: { id: true },
      });
      categoryId = createdCategory.id;
      createdCategoryCount++;
    }

    const subCategoryNames = subCategoryMap[category.name] ?? [];
    for (const [index, subCategoryName] of subCategoryNames.entries()) {
      const displayOrder = index + 1;
      const existingSubCategory = await prisma.subCategory.findFirst({
        where: {
          categoryId,
          name: subCategoryName,
        },
        select: { id: true },
      });

      if (existingSubCategory) {
        await prisma.subCategory.update({
          where: { id: existingSubCategory.id },
          data: { isActive: true, displayOrder },
        });
        updatedSubCategoryCount++;
        continue;
      }

      await prisma.subCategory.create({
        data: {
          name: subCategoryName,
          categoryId,
          displayOrder,
          isActive: true,
        },
      });
      createdSubCategoryCount++;
    }
  }

  console.log(`Seeded admin user: ${user.email} (role: ${user.role})`);
  console.log(`Seeded categories: ${categories.length} (${createdCategoryCount} created, ${categories.length - createdCategoryCount} updated)`);
  console.log(`Seeded subcategories: ${createdSubCategoryCount + updatedSubCategoryCount} (${createdSubCategoryCount} created, ${updatedSubCategoryCount} updated)`);
  console.log('Use these credentials to log in to the admin panel (set ADMIN_EMAIL / ADMIN_PASSWORD in .env to override defaults).');

  await seedStorefrontContent(prisma);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
