"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv = require("dotenv");
const client_1 = require("@prisma/client");
dotenv.config();
const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
const prisma = new client_1.PrismaClient({ datasources: { db: { url } } });
(async () => {
    const rows = await prisma.$queryRaw(client_1.Prisma.sql `SELECT indexname, tablename FROM pg_indexes WHERE indexname IN ('sections_chapterId_idx','quizzes_chapterId_idx') ORDER BY indexname`);
    console.log('Existing chapterId indexes:', JSON.stringify(rows));
})().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
//# sourceMappingURL=_check-idx.js.map