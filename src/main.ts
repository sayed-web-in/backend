import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const corsOrigins =
    process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()).filter(Boolean) ??
    [];
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    credentials: true,
  });
  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  const msg = `Server listening on http://localhost:${port}`;
  console.log(`\x1b[37m${msg}\x1b[0m`);
}
bootstrap();