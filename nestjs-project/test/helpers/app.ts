import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';
import { useInternalEndpointForPresignedUrls } from '../../src/test/storage';

export interface TestApp {
  app: INestApplication<App>;
  dataSource: DataSource;
  throttlerStorage: ThrottlerStorageService;
}

/** Boots AppModule with the same globals as main.ts. */
export async function createTestApp(): Promise<TestApp> {
  useInternalEndpointForPresignedUrls();
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication<INestApplication<App>>();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );
  await app.init();

  return {
    app,
    dataSource: moduleFixture.get(DataSource),
    throttlerStorage:
      moduleFixture.get<ThrottlerStorageService>(ThrottlerStorage),
  };
}

/** Registers a user, confirms it directly in the DB and returns an access token. */
export async function registerConfirmedUser(
  { app, dataSource }: TestApp,
  email: string,
  password = 'password123',
): Promise<{ accessToken: string; userId: string }> {
  const register = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password })
    .expect(201);
  const userId = (register.body as { id: string }).id;
  await dataSource.query('UPDATE users SET is_confirmed = true WHERE id = $1', [
    userId,
  ]);
  const login = await request(app.getHttpServer())
    .post('/auth/login')
    .send({ email, password })
    .expect(200);
  return {
    accessToken: (login.body as { access_token: string }).access_token,
    userId,
  };
}

/** supertest types bodies as `any`; tests read them through explicit shapes. */
export function bodyOf<T>(res: { body: unknown }): T {
  return res.body as T;
}

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
}

export interface UploadPartBody {
  part_number: number;
  url: string;
}

export interface VideoUploadBody {
  id: string;
  public_id: string;
  status: string;
  upload: {
    part_size: number;
    part_count: number;
    expires_at: string;
    url_expires_at: string;
    parts: UploadPartBody[];
  };
}

export interface UploadSessionBody {
  uploaded_parts: { part_number: number; size: number }[];
  parts: UploadPartBody[];
}

export interface VideoBody {
  id: string;
  public_id: string;
  title: string;
  status: string;
  size_bytes: number;
  duration_seconds: number | null;
  metadata: Record<string, unknown> | null;
  has_thumbnail: boolean;
  failure_reason: string | null;
  processing_run: number;
}
