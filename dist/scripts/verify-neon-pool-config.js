"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
dotenv.config();
function auditUrl(name, url) {
    if (!url)
        return { name, present: false };
    const parsed = new URL(url.replace(/^postgresql:/, 'http:'));
    return {
        name,
        present: true,
        host: parsed.hostname,
        isPoolerHost: parsed.hostname.includes('-pooler') ||
            parsed.hostname.includes('pooler'),
        pgbouncerParam: parsed.searchParams.get('pgbouncer'),
    };
}
async function main() {
    const dbUrl = process.env.DATABASE_URL;
    const directUrl = process.env.DIRECT_DATABASE_URL;
    const db = auditUrl('DATABASE_URL', dbUrl);
    const direct = auditUrl('DIRECT_DATABASE_URL', directUrl);
    console.log('\nNeon pool configuration audit\n');
    console.log(JSON.stringify({
        DATABASE_URL: {
            host: db.host,
            isPoolerHost: db.isPoolerHost,
            pgbouncer: db.pgbouncerParam,
        },
        DIRECT_DATABASE_URL: {
            host: direct.host,
            isPoolerHost: direct.isPoolerHost,
        },
    }, null, 2));
    const errors = [];
    const warnings = [];
    if (!db.present) {
        errors.push('DATABASE_URL is not set');
    }
    else {
        if (!db.isPoolerHost) {
            warnings.push('DATABASE_URL is not a *-pooler* host (OK for local direct dev; production/Vercel should use the pooler endpoint)');
        }
        if (db.isPoolerHost && db.pgbouncerParam !== 'true') {
            errors.push('DATABASE_URL uses the pooler host but is missing pgbouncer=true (required for Prisma transaction mode / advisory locks)');
        }
    }
    if (!direct.present) {
        warnings.push('DIRECT_DATABASE_URL is not set (needed for prisma migrate deploy)');
    }
    else if (direct.isPoolerHost) {
        errors.push('DIRECT_DATABASE_URL must use the non-pooler Neon host (no -pooler in hostname)');
    }
    if (errors.length) {
        console.error('\nFAILED checks:');
        errors.forEach((e) => console.error('  ✗', e));
        process.exit(1);
    }
    if (warnings.length) {
        console.warn('\nWarnings:');
        warnings.forEach((w) => console.warn('  !', w));
    }
    if (!dbUrl)
        return;
    const prisma = new client_1.PrismaClient({ datasources: { db: { url: dbUrl } } });
    const lockKey = `verify-neon-pool-${Date.now()}`;
    try {
        await prisma.$transaction(async (tx) => {
            const [{ locked }] = await tx.$queryRaw(client_1.Prisma.sql `SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS locked`);
            if (!locked)
                throw new Error('unexpected: fresh lock not granted');
            await tx.$queryRaw `SELECT 1 AS ok`;
        }, { timeout: 15000, maxWait: 5000 });
        console.log('\n✓ pg_try_advisory_xact_lock + interactive $transaction succeeded on DATABASE_URL');
        const idx = await prisma.$queryRaw(client_1.Prisma.sql `SELECT indexdef FROM pg_indexes WHERE indexname = 'course_versions_one_latest_per_course'`);
        if (idx.length === 0) {
            throw new Error('MISSING partial unique index course_versions_one_latest_per_course — the single-isLatest invariant is UNPROTECTED. Re-apply migration 20260623120000_course_versioning_v1.');
        }
        console.log('✓ partial unique index course_versions_one_latest_per_course present');
    }
    finally {
        await prisma.$disconnect();
    }
    console.log(`
Vercel production checklist (Neon console + project env):
  1. DATABASE_URL → host ends with -pooler.<region>.aws.neon.tech
  2. Query string includes pgbouncer=true (Prisma ↔ Neon transaction pooling)
  3. Do NOT use Neon "Session mode" pool string for the app — use Transaction mode / pooler URL
  4. DIRECT_DATABASE_URL → same branch, host WITHOUT -pooler (migrations only)
  5. Re-run this script after changing env vars: yarn ts-node -r tsconfig-paths/register scripts/verify-neon-pool-config.ts
`);
}
main().catch((err) => {
    console.error('\nVerifier failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
//# sourceMappingURL=verify-neon-pool-config.js.map