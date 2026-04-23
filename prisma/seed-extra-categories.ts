import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const extraCategories = [
    {
      name: 'Tablets',
      description: 'Android, iPadOS and Windows tablets',
      displayOrder: 6,
      subCategories: ['Android Tablets', 'iPads', 'Kids Tablets'],
    },
    {
      name: 'Desktop Components',
      description: 'Core PC parts and upgrade components',
      displayOrder: 7,
      subCategories: ['Processors', 'Motherboards', 'Graphics Cards'],
    },
    {
      name: 'Storage Devices',
      description: 'Fast and reliable internal and external storage',
      displayOrder: 8,
      subCategories: ['SSD', 'HDD', 'Memory Cards'],
    },
  ];

  let createdCategoryCount = 0;
  let createdSubCategoryCount = 0;
  let updatedSubCategoryCount = 0;

  for (const category of extraCategories) {
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

    for (const [index, subCategoryName] of category.subCategories.entries()) {
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

  console.log(
    `Seeded extra categories: ${extraCategories.length} (${createdCategoryCount} created, ${extraCategories.length - createdCategoryCount} updated)`,
  );
  console.log(
    `Seeded extra subcategories: ${createdSubCategoryCount + updatedSubCategoryCount} (${createdSubCategoryCount} created, ${updatedSubCategoryCount} updated)`,
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
