import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as pactum from 'pactum';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { BodyDto, LoginDto } from 'src/dto';

describe('App e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
      }),
    );
    await app.init();
    await app.listen(3333);

    prisma = app.get(PrismaService);
    pactum.request.setBaseUrl('http://localhost:3333/api/v1');
  });

  afterAll(async () => {
    await app.close();
  });
  describe('User', () => {
    const dto: LoginDto = {
      email: 'admin@gmail.com',
      password: '123',
    };
    const createUserDto: BodyDto = {
      email: 'user2@gmail.com',
      password: '123',
      firstName: 'asad',
      lastName: 'khan',
      phone: '+923352825068',
      role: 'user',
    };

    describe('create user', () => {
      it('should throw if no body provided', async () => {
        await pactum
          .spec()
          .post('/auth/login')
          .withBody(dto)
          .stores('userAt', 'access_token');

        return pactum
          .spec()
          .post('/users/')
          .withBody(createUserDto)
          .withHeaders({
            Authorization: 'Bearer $S{userAt}',
          })
          .expectStatus(201);
      });
    });
  });

  describe('Auth', () => {
    const dto: LoginDto = {
      email: 'admin@gmail.com',
      password: '123',
    };

    describe('Sign-in', () => {
      it('should throw if email empty', () => {
        return pactum
          .spec()
          .post('/auth/login')
          .withBody({
            password: dto.password,
          })
          .expectStatus(400);
      });
      it('should throw if password empty', () => {
        return pactum
          .spec()
          .post('/auth/login')
          .withBody({
            email: dto.email,
          })
          .expectStatus(400);
      });
      it('should throw if no body provided', () => {
        return pactum.spec().post('/auth/login').expectStatus(400);
      });
      it('should signup', () => {
        return pactum
          .spec()
          .post('/auth/login')
          .withBody(dto)
          .expectStatus(201)
          .inspect();
      });
    });
  });
});
