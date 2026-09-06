"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toggleForumVote = exports.withVotedByMe = exports.parseVoteValue = void 0;
const client_1 = require("@prisma/client");
const with_db_retry_1 = require("../utils/with-db-retry");
function parseVoteValue(body) {
    const value = body && typeof body === 'object' && 'value' in body
        ? body.value
        : undefined;
    if (value === 0 || value === '0' || value === false)
        return 0;
    if (value === 1 || value === '1' || value === true)
        return 1;
    throw new Error('value must be 1 (like) or 0 (unlike)');
}
exports.parseVoteValue = parseVoteValue;
function withVotedByMe(row) {
    const { votes, ...rest } = row;
    return { ...rest, isVotedByMe: (votes?.length ?? 0) > 0 };
}
exports.withVotedByMe = withVotedByMe;
async function toggleForumVote(prisma, args) {
    const rows = args.threadId
        ? await voteThread(prisma, args.userId, args.threadId, args.value)
        : await voteComment(prisma, args.userId, args.commentId, args.value);
    const row = rows[0];
    if (!row?.found) {
        throw new Error(args.threadId ? 'Forum thread not found' : 'Forum comment not found');
    }
    if (!row.allowed) {
        throw new Error('Votes are not enabled for this category');
    }
    return {
        voteScore: Math.max(0, Number(row.voteScore ?? 0)),
        isVotedByMe: Boolean(row.isVotedByMe),
    };
}
exports.toggleForumVote = toggleForumVote;
function voteThread(prisma, userId, threadId, value) {
    const sql = value === 1
        ? client_1.Prisma.sql `
          WITH target AS (
            SELECT t.id, t."voteScore", COALESCE(c."allowVotes", true) AS allowed
            FROM "forum_threads" t
            LEFT JOIN "forum_categories" c ON c.id = t."categoryId"
            WHERE t.id = ${threadId}
          ),
          ins AS (
            INSERT INTO "forum_votes" (id, "userId", "threadId")
            SELECT gen_random_uuid()::text, ${userId}, ${threadId}
            FROM target
            WHERE target.allowed
            ON CONFLICT ("userId", "threadId") DO NOTHING
            RETURNING 1
          ),
          upd AS (
            UPDATE "forum_threads" t
            SET "voteScore" = t."voteScore" + 1
            WHERE t.id = ${threadId}
              AND EXISTS (SELECT 1 FROM ins)
            RETURNING t."voteScore"
          )
          SELECT
            EXISTS (SELECT 1 FROM target) AS found,
            COALESCE((SELECT allowed FROM target), false) AS allowed,
            COALESCE(
              (SELECT "voteScore" FROM upd),
              (SELECT "voteScore" FROM target)
            ) AS "voteScore",
            (
              EXISTS (SELECT 1 FROM ins)
              OR EXISTS (
                SELECT 1 FROM "forum_votes"
                WHERE "userId" = ${userId} AND "threadId" = ${threadId}
              )
            ) AS "isVotedByMe"
        `
        : client_1.Prisma.sql `
          WITH target AS (
            SELECT t.id, t."voteScore", COALESCE(c."allowVotes", true) AS allowed
            FROM "forum_threads" t
            LEFT JOIN "forum_categories" c ON c.id = t."categoryId"
            WHERE t.id = ${threadId}
          ),
          del AS (
            DELETE FROM "forum_votes"
            WHERE "userId" = ${userId} AND "threadId" = ${threadId}
            RETURNING 1
          ),
          upd AS (
            UPDATE "forum_threads" t
            SET "voteScore" = GREATEST(t."voteScore" - 1, 0)
            WHERE t.id = ${threadId}
              AND EXISTS (SELECT 1 FROM del)
            RETURNING t."voteScore"
          )
          SELECT
            EXISTS (SELECT 1 FROM target) AS found,
            COALESCE((SELECT allowed FROM target), false) AS allowed,
            COALESCE(
              (SELECT "voteScore" FROM upd),
              (SELECT "voteScore" FROM target)
            ) AS "voteScore",
            false AS "isVotedByMe"
        `;
    return (0, with_db_retry_1.withDbRetry)(() => prisma.$queryRaw(sql), { mode: 'write' });
}
function voteComment(prisma, userId, commentId, value) {
    const sql = value === 1
        ? client_1.Prisma.sql `
          WITH target AS (
            SELECT
              cm.id,
              cm."voteScore",
              COALESCE(c."allowVotes", true) AS allowed
            FROM "forum_comments" cm
            INNER JOIN "forum_threads" t ON t.id = cm."threadId"
            LEFT JOIN "forum_categories" c ON c.id = t."categoryId"
            WHERE cm.id = ${commentId}
          ),
          ins AS (
            INSERT INTO "forum_votes" (id, "userId", "commentId")
            SELECT gen_random_uuid()::text, ${userId}, ${commentId}
            FROM target
            WHERE target.allowed
            ON CONFLICT ("userId", "commentId") DO NOTHING
            RETURNING 1
          ),
          upd AS (
            UPDATE "forum_comments" cm
            SET "voteScore" = cm."voteScore" + 1
            WHERE cm.id = ${commentId}
              AND EXISTS (SELECT 1 FROM ins)
            RETURNING cm."voteScore"
          )
          SELECT
            EXISTS (SELECT 1 FROM target) AS found,
            COALESCE((SELECT allowed FROM target), false) AS allowed,
            COALESCE(
              (SELECT "voteScore" FROM upd),
              (SELECT "voteScore" FROM target)
            ) AS "voteScore",
            (
              EXISTS (SELECT 1 FROM ins)
              OR EXISTS (
                SELECT 1 FROM "forum_votes"
                WHERE "userId" = ${userId} AND "commentId" = ${commentId}
              )
            ) AS "isVotedByMe"
        `
        : client_1.Prisma.sql `
          WITH target AS (
            SELECT
              cm.id,
              cm."voteScore",
              COALESCE(c."allowVotes", true) AS allowed
            FROM "forum_comments" cm
            INNER JOIN "forum_threads" t ON t.id = cm."threadId"
            LEFT JOIN "forum_categories" c ON c.id = t."categoryId"
            WHERE cm.id = ${commentId}
          ),
          del AS (
            DELETE FROM "forum_votes"
            WHERE "userId" = ${userId} AND "commentId" = ${commentId}
            RETURNING 1
          ),
          upd AS (
            UPDATE "forum_comments" cm
            SET "voteScore" = GREATEST(cm."voteScore" - 1, 0)
            WHERE cm.id = ${commentId}
              AND EXISTS (SELECT 1 FROM del)
            RETURNING cm."voteScore"
          )
          SELECT
            EXISTS (SELECT 1 FROM target) AS found,
            COALESCE((SELECT allowed FROM target), false) AS allowed,
            COALESCE(
              (SELECT "voteScore" FROM upd),
              (SELECT "voteScore" FROM target)
            ) AS "voteScore",
            false AS "isVotedByMe"
        `;
    return (0, with_db_retry_1.withDbRetry)(() => prisma.$queryRaw(sql), { mode: 'write' });
}
//# sourceMappingURL=forum-vote.js.map