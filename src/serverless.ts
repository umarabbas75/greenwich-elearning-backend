import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

/**
 * Vercel entry point.
 *
 * The bootstrapped Nest app is cached on the module scope so warm invocations
 * reuse the existing DI container instead of re-running NestFactory.create,
 * which constructs every feature module and re-scans decorator metadata.
 * Only cold starts pay the bootstrap cost.
 *
 * The in-flight promise is cached (rather than the resolved app) so concurrent
 * requests arriving during a cold start all await the same bootstrap instead
 * of each kicking off their own.
 *
 * Vercel's Node runtime invokes the exported handler as (req, res), which is
 * exactly the Express application signature — so the underlying Express
 * instance is used directly and no Lambda-style event adapter is involved.
 */
const expressApp = express();

let bootstrapPromise: Promise<void> | undefined;

async function bootstrapApp(): Promise<void> {
  const app = await NestFactory.create(
    AppModule,
    new ExpressAdapter(expressApp),
  );

  configureApp(app);

  // init() wires up the app without binding a port; app.listen() is for
  // long-running servers and does not apply to a serverless invocation.
  await app.init();
}

export default async function handler(
  req: express.Request,
  res: express.Response,
) {
  if (!bootstrapPromise) {
    bootstrapPromise = bootstrapApp().catch((err) => {
      // Don't cache a failed bootstrap; let the next invocation retry.
      bootstrapPromise = undefined;
      throw err;
    });
  }

  await bootstrapPromise;

  return expressApp(req, res);
}
