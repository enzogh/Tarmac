import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import { AppModule } from './app.module';

const crashAlertPrisma = new PrismaClient();

async function reportCrashToAlerts(title: string, reason: unknown) {
  const raw = reason instanceof Error ? reason.stack || reason.message : String(reason);
  const compact = raw.replace(/\s+/g, ' ').trim();
  const message = `${title}: ${compact.slice(0, 900)}`;

  try {
    await crashAlertPrisma.alert.create({
      data: {
        severity: 'critical',
        message,
      },
    });
  } catch (error) {
    console.error('Failed to persist crash alert', error);
  }
}

process.on('unhandledRejection', (reason) => {
  void reportCrashToAlerts('Unhandled promise rejection', reason);
});

process.on('uncaughtException', (error) => {
  void reportCrashToAlerts('Uncaught exception', error);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: true, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`Tarmac API running on :${port}`);
}

bootstrap();
