import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { DEFAULT_WORKSPACE_ID } from './workspaces/default-workspace';

const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'https://tarmac.casterot.com'];

const crashAlertPrisma = new PrismaClient();

async function reportCrashToAlerts(title: string, reason: unknown) {
  const raw = reason instanceof Error ? reason.stack || reason.message : String(reason);
  const compact = raw.replace(/\s+/g, ' ').trim();
  const message = `${title}: ${compact.slice(0, 900)}`;

  try {
    await crashAlertPrisma.alert.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
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
  const allowedOrigins = (process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean)) ?? DEFAULT_ALLOWED_ORIGINS;
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.use(cookieParser());
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
