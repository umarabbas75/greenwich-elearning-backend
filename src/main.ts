import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

/**
 * Local / long-running server entry point. Vercel does not use this file —
 * see serverless.ts for the cached serverless handler. Shared configuration
 * lives in app.setup.ts so the two entry points stay in sync.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(process.env.PORT ?? 3333);
}
bootstrap();
