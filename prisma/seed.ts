import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? 'admin@futuretechnology.local';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin@123456';
  const name = process.env.ADMIN_NAME ?? 'Super Admin';

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

  console.log(`Seeded admin user: ${user.email} (role: ${user.role})`);
  console.log('Use these credentials to log in to the admin panel (set ADMIN_EMAIL / ADMIN_PASSWORD in .env to override defaults).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
