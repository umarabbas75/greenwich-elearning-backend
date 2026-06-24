Course Versioning (Pattern 1) — Implementation Plan

1. Decisions locked in

Approach A (live = draft). Admin keeps editing the existing live tree exactly as today. Publish is an explicit action that materialises a snapshot. No frontend rewrite for the editor. (Approach B — versioned editing surface — was rejected as out of proportion.)

Materialised snapshot rows, not JSON. Cheap reads, identical query shape to live tables, lets us reuse 90% of the existing service code via small parameter swaps.

Snapshot taken on first activation. When UserCourse.isActive first flips false → true (toggleCourseStatus, src/course/course.service.ts:3021), enrolledVersionId is set to the latest PUBLISHED version. Inactive/unassigned enrollments float.

Pin policy. Existing in-progress learners stay on their version forever (or until admin manually migrates them). New enrollments pin to the latest published version at activation. Pattern 2 still protects certified completers on top.

Scope = Module → Chapter → Section → ChapterQuiz only. That's the only subtree whose shape changes can move the % denominator. Assessments already snapshot themselves via AttemptQuestionSnapshot. Assignments are course-scoped and don't drag %. Forms, policies, feedback forms tracked separately. All explicitly out of scope.

2. Architecture

flowchart LR
subgraph editing [Editing Surface]
Course[Course]
Module[Module]
Chapter[Chapter]
Section[Section]
Quiz[Quiz]
end

subgraph versioned [Versioned Snapshot]
CV[CourseVersion]
CVM[CourseVersionModule]
CVC[CourseVersionChapter]
CVS[CourseVersionSection]
CVQ[CourseVersionQuiz]
end

subgraph enrollment [Enrollment & Progress]
UC["UserCourse (enrolledVersionId)"]
UCP["UserCourseProgress (live sectionId)"]
CC[CourseCompletion]
end

Course -->|"publish()"| CV
Module -->|"snapshot"| CVM
Chapter -->|"snapshot"| CVC
Section -->|"snapshot"| CVS
Quiz -->|"snapshot"| CVQ

UC -->|"pinned at first activation"| CV
UCP -.->|"sourceSectionId match"| CVS
CC -.-> UC

Read paths consult UserCourse.enrolledVersionId first. Set → join versioned tables. Null (legacy / not yet activated) → fall back to live tree (today's behaviour).

3. Schema additions

New tables in prisma/schema.prisma (paralleling the live shape, copying every field that affects display or progress):

CourseVersion(id, courseId, versionNumber Int, status [DRAFT|PUBLISHED|ARCHIVED], publishedAt?, publishedByAdminId?, changeNotes?, isLatest Bool, createdAt, updatedAt) — unique [courseId, versionNumber], partial unique [courseId] where isLatest = true.

CourseVersionModule(id, versionId, sourceModuleId?, title, description, orderIndex Int) — sourceModuleId is nullable + SET NULL on delete so live deletions don't destroy snapshots.

CourseVersionChapter(id, versionId, versionModuleId, sourceChapterId?, title, description, pdfFile?, orderIndex Int, hasQuiz Bool)

CourseVersionSection(id, versionId, versionChapterId, sourceSectionId?, title, description, shortDescription?, type SectionType, orderIndex Int, itemLabel?, categoryLabel?, categories String[], maxPerCategory Int, isActive Bool, questionText?, imageUrl?, allowMultipleSelection Bool, items Json?, options Json?, config Json?) — full content snapshot so deleted-from-live sections still render for pinned learners.

CourseVersionQuiz(id, versionId, versionChapterId, sourceQuizId?, question, answer, options Json) — chapter quizzes only.

Modifications to existing tables:

UserCourse: add enrolledVersionId String? + FK to CourseVersion(id) ON DELETE RESTRICT.

Section, Chapter, Module: add isArchived Boolean @default(false) — used by edit safeguards (see §6).

Migration file: prisma/migrations/<ts>\_course_versioning_v1/migration.sql plus a follow-up data migration script scripts/backfill-course-versions.ts (run once, idempotent) that:

For every Course, create CourseVersion(versionNumber=1, status=PUBLISHED, isLatest=true).

Snapshot the live tree into CourseVersion\* rows preserving sourceXId.

For every UserCourse with isActive=true OR with any UserCourseProgress row OR with CourseCompletion, set enrolledVersionId = v1.id.

4. New CourseVersionService and module

New module at src/course-version/:

course-version.service.ts — core logic.

course-version.controller.ts — admin endpoints.

course-version.module.ts — Nest module.

Core service methods:

snapshotLiveTree(courseId, tx?) — internal helper. Reads live Module/Chapter/Section/Quiz tree, writes CourseVersion\* rows inside a single transaction. Returns the new CourseVersion.

publishNewVersion(adminId, courseId, changeNotes?) — wraps snapshotLiveTree, assigns next versionNumber, sets isLatest=true, demotes previous isLatest. Returns the published version.

getVersionForRead(userCourse) — returns either the pinned CourseVersion (with relations) or null (fall back to live).

pinEnrollmentToLatest(userCourseId, tx) — invoked from toggleCourseStatus on the first activation transition.

migrateLearnerToVersion(adminId, userCourseId, targetVersionId) — admin-only escape hatch for force-migrating a single learner (deferred to phase 6).

listVersions(courseId) — admin endpoint to see the version history.

archiveVersion(adminId, versionId) — set status=ARCHIVED. Cannot archive a version that any active enrollment is pinned to.

Admin endpoints (all AuthGuard('jwt'), admin-only):

POST /courses/:courseId/versions/publish — publish current live tree as new version.

GET /courses/:courseId/versions — list versions with enrollment counts.

POST /courses/:courseId/versions/:versionId/archive — archive a version.

5. Hook into enrollment activation

In src/course/course.service.ts, toggleCourseStatus (line ~3021):

const isFirstActivation =
isActive && !userCourse.isActive && !userCourse.activatedAt;
// existing block sets activatedAt; we extend it
if (isFirstActivation && !userCourse.enrolledVersionId) {
await this.courseVersionService.pinEnrollmentToLatest(userCourse.id, tx);
}

Pinning is idempotent (no-op if enrolledVersionId already set). If no PUBLISHED version exists (transient state pre-backfill), log a warning and continue with enrolledVersionId = null (legacy fallback path).

6. Edit safeguards on the live tree

The live tree stays editable as today, but we add three guardrails so admin actions cannot corrupt a pinned enrollment's read path. All in src/course/course.service.ts:

deleteSection — if CourseVersionSection.sourceSectionId = :id exists, block hard delete; instead set Section.isArchived = true (UI still shows it in editor with a strikethrough). Hard delete remains allowed for never-published sections.

deleteChapter, deleteModule — same rule.

deleteQuiz, unAssignQuiz — same rule against CourseVersionQuiz.sourceQuizId.

createSection / updateSection — unchanged. New sections show up in the live tree (and in the editor preview) but only in the next published version's snapshot.

This is the key invariant: once published, a version's content is immutable from the admin's perspective. Existing enrollments cannot have their denominator pulled out from under them, even by a delete.

7. Read-path rewrites (the five endpoints already touched by Pattern 2)

For each, the structural change is the same — instead of reading the live course.modules → chapters → sections graph, when enrolledVersionId is set, read the version.modules → chapters → sections graph and join UserCourseProgress by sectionId IN (versionSection.sourceSectionId, …). Pattern 2's freeze logic stacks on top unchanged.

Concretely in src/course/course.service.ts:

getAllUserModules (Site 4) — switch tree source to versioned when pinned.

getAllUserSections (Site 5) — switch section list; chapter quizzes pulled from CourseVersionQuiz.

getAllAssignedCourses (Site 2) — switch denominator (sections count) to versioned counts.

getUserChapterProgress (Site 3) — load chapter from version, switch section count.

getCourseReport (Site 1) — admin learner report, switch tree to that learner's pinned version (so admin sees what learner sees).

Implementation pattern (single helper to avoid 5x duplication):

private async resolveCurriculumTree(userId: string, courseId: string) {
const uc = await this.prisma.userCourse.findUnique({
where: { userId_courseId: { userId, courseId } },
select: { enrolledVersionId: true },
});
if (!uc?.enrolledVersionId) {
return { mode: 'live' as const };
}
const version = await this.prisma.courseVersion.findUnique({
where: { id: uc.enrolledVersionId },
include: { modules: { include: { chapters: { include: { sections: true, quizzes: true } } } } },
});
return { mode: 'versioned' as const, version };
}

Each of the 5 sites is ~20 lines of swap. UserCourseProgress lookups remain by live sectionId (which equals sourceSectionId on the snapshot row).

Quiz endpoints in src/quiz/quiz.service.ts (getAllAssignQuizzes, getChapterQuizzesReport) get the same treatment.

8. Pattern C ("New content available") lights up for free

Once enrollments are version-pinned, the diff latest_version.sections − pinned_version.sections is the exact set of new content. The summarizeNewSinceCompletion helper sketched in the doc becomes trivial — same query, change s.createdAt > completedAt to s.id NOT IN pinned_version_section_ids. Plumb into the same five endpoints. Documented as a fast-follow, not part of this rollout.

9. Backwards compatibility

All read paths fall back to live tree when enrolledVersionId IS NULL. So mid-deploy and for never-activated enrollments, behaviour is unchanged.

The backfill script (step 3) sets enrolledVersionId for every active/started enrollment before the new code lights up — so by deploy time, every learner who could be affected is already pinned.

No frontend changes required for v1 of this feature. New admin endpoints (/versions/publish, etc.) are additive. Optional FE: a "Publish new version" button on the admin course detail page.

10. Rollout sequence

Each phase is a separate deployable PR.

PR 1 — Schema + migration + backfill. Adds tables, adds enrolledVersionId nullable, runs scripts/backfill-course-versions.ts. No service changes yet. Read paths untouched. Verify in staging that every course has a v1 PUBLISHED isLatest=true and every started enrollment is pinned.

PR 2 — CourseVersionService + admin publish endpoints. New module, snapshot logic, publish/list/archive routes. Still no read-path changes. Smoke test: publish v2 of a test course, verify snapshot rows match live tree.

PR 3 — Activation hook. Wire pinEnrollmentToLatest into toggleCourseStatus. Any newly-activated enrollment now gets pinned.

PR 4 — Read-path rewrites. All five service methods + quiz methods. Pattern 2 freeze logic preserved on top. Most regression-prone PR; ship with the audit script re-run and spot-check of aliharis694@gmail.com and ahmedhasan6263@gmail.com.

PR 5 — Edit safeguards. Block hard-delete of versioned-referenced rows; introduce isArchived semantics. Admin UX nudge: clear error message ("This section is part of v1, mark as archived instead").

PR 6 — Pattern C diff helper + optional migrateLearnerToVersion admin tool. Fast-follow; not blocking.

11. Validation

Re-run scripts/\_audit-completion-mismatch.ts after PR 4 — expect zero rows.

New read-only diagnostic scripts/\_audit-version-coverage.ts to list any enrollment with isActive=true AND enrolledVersionId IS NULL (should be empty after backfill + activation hook).

Manual: publish v2 of a course (add a chapter), confirm an existing learner's % unchanged, confirm a fresh learner sees v2.

Manual: try to hard-delete a section that's referenced by v1 — expect 409 Conflict with the archive nudge.

12. Docs

Append a "Pattern 1 shipped" section to docs/course-progress-freeze-at-completion.md and add a new docs/course-versioning.md covering: admin publish flow, what to do when you want to "edit a published version" (answer: you don't — publish a new one), how to force-migrate a learner, troubleshooting (enrolledVersionId null after backfill, etc.).

13. Explicitly out of scope (named so we don't drift)

Versioning course-level forms, policies, feedback forms — separate concern, no progress impact.

Versioning Assessments — already snapshotted per-attempt.

Versioning Assignments — course-scoped, no % impact.

Multiple drafts in flight — one live tree = one draft. Sufficient.

Per-learner bulk migration UI — add later if/when admin asks.

Frontend "version picker" — not needed for v1; admin only sees publish/list.
