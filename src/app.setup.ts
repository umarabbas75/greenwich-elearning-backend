import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';

export const CORS_ORIGINS = [
  'https://greenwich-elearning.vercel.app',
  'https://greenwich-elearning.vercel.app/user',
  'https://www.greenwichtc-elearning.com',
  'https://greenwichtc-elearning.com',
  'https://www.greenwichtc-elearning.com/',
  'http://localhost:3001',
  'http://localhost:3000',
];

/**
 * Shared app configuration for both the long-running local server (main.ts) and
 * the cached serverless handler (serverless.ts), so the two entry points cannot
 * drift apart.
 */
export function configureApp(app: INestApplication): INestApplication {
  app.enableCors({
    origin: CORS_ORIGINS,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
    }),
  );

  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  return app;
}
