import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { allowedOrigins } from './common/allowed-origins';
import { requestContext } from './common/request-context';
import { DEFAULT_WORKSPACE_ID } from './workspaces/default-workspace';

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

// After an uncaught exception the process state is unknown (half-applied
// writes, a listener gone): record it, then exit and let Docker restart a
// clean API (restart: unless-stopped in docker-compose.yml).
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception, exiting', error);
  const exit = () => process.exit(1);
  setTimeout(exit, 3_000).unref();
  void reportCrashToAlerts('Uncaught exception', error).finally(exit);
});

// Baseline hardening headers on every API response (the API only serves
// JSON, so it never needs to be framed or sniffed as anything else).
function securityHeaders(_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use(securityHeaders);
  app.enableCors({ origin: allowedOrigins(), credentials: true });
  app.use(cookieParser());
  app.use((_req: unknown, _res: unknown, next: () => void) => requestContext.run(next));
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
