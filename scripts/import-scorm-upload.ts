/**
 * import-scorm-upload.ts
 *
 * Admin-style SCORM import via SCORM Cloud multipart upload (no public URL).
 * Use for packages over Cloudinary's ~10MB raw limit.
 *
 *   yarn script:import-scorm-upload /path/to/package.zip
 *   yarn script:import-scorm-upload /path/to/package.zip --title="My course"
 *   yarn script:import-scorm-upload /path/to/package.zip --courseId=<uuid>
 *   yarn script:import-scorm-upload /path/to/package.zip --wait
 *
 * Requires DATABASE_URL, SCORM Cloud creds, and at least one admin user in the DB.
 */

import * as dotenv from 'dotenv';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { Role, ScormPackageStatus } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScormService } from '../src/scorm/scorm.service';

dotenv.config();

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const zipPath = process.argv.slice(2).find((a) => !a.startsWith('-'));
  if (!zipPath) {
    console.error(
      'Usage: yarn script:import-scorm-upload <path-to.zip> [--title=...] [--courseId=...] [--wait]',
    );
    process.exit(1);
  }

  const buf = readFileSync(zipPath);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const title = parseArg('title');
  const courseId = parseArg('courseId');
  const wait = process.argv.includes('--wait');
  const completeOn =
    parseArg('completeOn') === 'passed' ? 'passed' : 'completed';

  if (!courseId && !title) {
    console.error('--title is required when creating a new course (no --courseId)');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  try {
    const prisma = app.get(PrismaService);
    const scorm = app.get(ScormService);
    const admin = await prisma.user.findFirst({
      where: { role: Role.admin, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (!admin) {
      console.error('No admin user found in the database');
      process.exit(1);
    }

    const created = await scorm.createPackageFromUpload(admin.id, buf, {
      courseId,
      zipSha256: sha256,
      completeOn,
      title,
      filename: zipPath.split('/').pop() || 'package.zip',
      description: parseArg('description'),
    });

    const pkg = created.data as {
      id: string;
      courseId: string;
      status: string;
    };
    console.log('Import job started (SCORM Cloud upload).');
    console.log('packageId:', pkg.id);
    console.log('courseId:', pkg.courseId);
    console.log('zipSha256:', sha256);

    if (!wait) {
      console.log(
        `Poll: GET /api/v1/scorm/packages/${pkg.id}/import-status (admin JWT)`,
      );
      return;
    }

    const deadline = Date.now() + 10 * 60 * 1000;
    let lastStatus = pkg.status;
    while (Date.now() < deadline) {
      await sleep(5000);
      const statusRes = await scorm.getImportStatus(pkg.id, admin.id);
      const row = statusRes.data as {
        status: ScormPackageStatus;
        importWarning?: string | null;
      };
      if (row.status !== lastStatus) {
        console.log(
          'status:',
          row.status,
          row.importWarning ? `(warning: ${row.importWarning})` : '',
        );
        lastStatus = row.status;
      }
      if (row.status === ScormPackageStatus.READY) {
        console.log('Import READY.');
        return;
      }
      if (row.status === ScormPackageStatus.FAILED) {
        console.error('Import FAILED — see package row for failureReason');
        process.exit(1);
      }
    }
    console.log('Timed out waiting for READY — poll import-status manually.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
