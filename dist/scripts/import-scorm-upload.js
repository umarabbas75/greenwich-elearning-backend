"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const core_1 = require("@nestjs/core");
const client_1 = require("@prisma/client");
const app_module_1 = require("../src/app.module");
const prisma_service_1 = require("../src/prisma/prisma.service");
const scorm_service_1 = require("../src/scorm/scorm.service");
dotenv.config();
function parseArg(name) {
    const prefix = `--${name}=`;
    const hit = process.argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : undefined;
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function main() {
    const zipPath = process.argv.slice(2).find((a) => !a.startsWith('-'));
    if (!zipPath) {
        console.error('Usage: yarn script:import-scorm-upload <path-to.zip> [--title=...] [--courseId=...] [--wait]');
        process.exit(1);
    }
    const buf = (0, fs_1.readFileSync)(zipPath);
    const sha256 = (0, crypto_1.createHash)('sha256').update(buf).digest('hex');
    const title = parseArg('title');
    const courseId = parseArg('courseId');
    const wait = process.argv.includes('--wait');
    const completeOn = parseArg('completeOn') === 'passed' ? 'passed' : 'completed';
    if (!courseId && !title) {
        console.error('--title is required when creating a new course (no --courseId)');
        process.exit(1);
    }
    const app = await core_1.NestFactory.createApplicationContext(app_module_1.AppModule, {
        logger: ['error', 'warn'],
    });
    try {
        const prisma = app.get(prisma_service_1.PrismaService);
        const scorm = app.get(scorm_service_1.ScormService);
        const admin = await prisma.user.findFirst({
            where: { role: client_1.Role.admin, deletedAt: null },
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
        const pkg = created.data;
        console.log('Import job started (SCORM Cloud upload).');
        console.log('packageId:', pkg.id);
        console.log('courseId:', pkg.courseId);
        console.log('zipSha256:', sha256);
        if (!wait) {
            console.log(`Poll: GET /api/v1/scorm/packages/${pkg.id}/import-status (admin JWT)`);
            return;
        }
        const deadline = Date.now() + 10 * 60 * 1000;
        let lastStatus = pkg.status;
        while (Date.now() < deadline) {
            await sleep(5000);
            const statusRes = await scorm.getImportStatus(pkg.id, admin.id);
            const row = statusRes.data;
            if (row.status !== lastStatus) {
                console.log('status:', row.status, row.importWarning ? `(warning: ${row.importWarning})` : '');
                lastStatus = row.status;
            }
            if (row.status === client_1.ScormPackageStatus.READY) {
                console.log('Import READY.');
                return;
            }
            if (row.status === client_1.ScormPackageStatus.FAILED) {
                console.error('Import FAILED — see package row for failureReason');
                process.exit(1);
            }
        }
        console.log('Timed out waiting for READY — poll import-status manually.');
    }
    finally {
        await app.close();
    }
}
main().catch((err) => {
    console.error(err);
    process.exit(1);
});
//# sourceMappingURL=import-scorm-upload.js.map