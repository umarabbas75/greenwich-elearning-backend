import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();

     // global prefix
     app.setGlobalPrefix('api/v1');
  await app.listen(3333);
}
bootstrap();
