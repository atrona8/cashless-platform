// Point d'entrée de l'API centrale (SPECIFICATION §2).
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX, loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
