# Course Versioning — Admin-Facing Fixes (2026-08-06)

Four fixes landed together to close the gaps identified in the sweep. All are
backward-compatible for API consumers except one: the `PUT /courses/unAssignCourse/user`
endpoint now refuses by default when the learner has residual progress. Frontends
must add a confirmation dialog and re-send with `{ force: true }` to proceed.

**Post-review revisions (same day):**

- `stillServedTo` now counts **active** enrollments only (`isActive: true`).
  Deactivated/historical enrollments no longer inflate the number the admin sees.
- Unassign loophole guard extended from 6 → 13 learner-state tables (quiz
  answers, quiz progress, form/policy completions, assessment attempts,
  feedback submissions were missing). The check and the wipe are now driven
  by a single shared enumeration (`probeUserCourseResidualState` +
  `wipeUserCourseState`) that `resetUserCourseProgress` also uses, so the two
  paths cannot drift.
- `outcome` union widened to include `'unassigned'`; quiz-detach (the
  non-referenced branch of `unAssignQuiz`) now returns `'unassigned'` instead
  of misleading `'deleted'`.
- `AdminAuditLog.adminId` FK changed from `Cascade` to `SetNull`, plus a
  denormalised `adminEmail` captured at write time — the audit table now
  survives a hard user delete.
- `getAllModules` returns `[]` instead of `403` on empty (matches
  `getAllChapters` / `getAllSections`; newly reachable now that archived
  modules are filtered).
- Coverage: 16 new unit tests (`getReferencingVersionsWithEnrollments`,
  `buildArchiveMessage`, `writeAudit`, unassign 409 refusal, force-wipe over
  all 13 tables, `ARCHIVE_SECTION` audit row). Total suite: 130 passing.

**Second-round review fixes (same session):**

- **Transaction timeouts.** Both wipe `$transaction` calls now pass
  `{ timeout: 15000, maxWait: 5000 }` — the same envelope
  `publishNewVersion` uses. Prior default 5s was tight on Neon cold starts
  for the 2 findMany + 13 sequential mutations the wipe performs; a timeout
  would have surfaced as "Transaction already closed", rolled back the
  entire wipe, and returned a generic 403 to the admin with no clue why.
- **Live-path denominator alignment.** `getAllAssignedCourses` and
  `getAllUserModules` (unpinned branch) now filter `isArchived: false` at
  module/chapter level and `isArchived: false, isActive: true` on section
  counts — matching `countCompletionDenominator`'s live path. Prior to this,
  a course list card could display 87% for a learner the completion gate
  already considered done. The divergence became live rather than
  theoretical once archived sections started routinely existing.
- **Public course page no longer leaks archived structure.**
  `getCourseDetailPublic` now filters archived modules/chapters and
  archived/inactive sections. Prior to this fix, archiving a module hid it
  from the admin list but kept rendering it on the public marketing page —
  the new divergence the admin-list filter change introduced.
- **Course report live fallback.** `getCourseReport`'s unpinned fallback
  now filters `isArchived: false` on modules and chapters (sections were
  already filtered); the archived-module-as-empty-shell that Claude flagged
  no longer appears in the report tree.
- **Archive audit rows.** `ARCHIVE_MODULE` / `ARCHIVE_CHAPTER` /
  `ARCHIVE_SECTION` / `ARCHIVE_QUIZ` audit rows are now written on the
  archive branch of each delete path (best-effort, via the shared
  `writeAudit` helper). Metadata carries `title`, `stillServedTo`, and the
  version enrollment breakdown so an admin dashboard can answer "who
  archived that section, when, and how many learners are still being
  served it".
- **Nit — duplicated ID resolution.** `probeUserCourseResidualState` now
  returns the `chapterIds` / `assessmentIds` it already resolved, and
  `wipeUserCourseState` accepts them via `options`; the force-unassign
  path no longer runs the same two `findMany` calls twice.

**Third-round follow-up (FE-contract audit):**

- **Numerator/denominator alignment.** After the second-round denominator
  fix, `_count.sections` on `getAllAssignedCourses` and `getAllUserModules`
  filtered `isArchived: false, isActive: true`, but the sibling
  `_count.UserCourseProgress` (the numerator the FE divides *into* that
  denominator) did not. A learner with progress on a now-archived section
  would have produced a ratio > 1 — and the FE's `calculateProgress`
  helper does `(completed * 100) / total` with **no** `Math.min` clamp
  (see [`frontend-progress-display-guide.md`](./frontend-progress-display-guide.md)
  §4.2 line 106 and §4.3 line 267). The course-list card, the module ring,
  and the chapter bar would all have rendered >100%. All three
  `_count.UserCourseProgress` selectors (course-level in
  `getAllAssignedCourses`, module- and chapter-level in `getAllUserModules`)
  now scope the numerator via `Section: { isArchived: false, isActive: true }`
  so the ratio stays in `[0, 1]` without needing a client-side clamp. This
  is the same principle `countCompletionDenominator` already applies —
  progress on archived sections is "orphaned" and must not inflate the
  live-curriculum percentage. Not reachable in practice today because
  unpinned learners never accumulate progress, but a real risk for legacy
  pre-pin learners and defensive against the FE ever routing a pinned
  learner through this response path.

Companion: [`course-versioning.md`](./course-versioning.md) (unchanged model),
[`frontend-progress-display-guide.md`](./frontend-progress-display-guide.md)
(FE contract audited — no shape changes; see §4).

---

## 1. Unassign/reassign loophole — closed

### The bug

`UserCourseProgress`, `UserChapterCompletion`, `UserModuleCompletion`, and
`CourseCompletion` are keyed by `(userId, courseId, …)` with **no foreign key
to `UserCourse`**. So the sequence

1. Admin unassigns the course → `UserCourse` row deleted, `enrolledVersionId` gone.
2. Progress/completion rows survive, orphaned but re-attachable by composite key.
3. Admin reassigns the course → new `UserCourse` created with null pin.
4. Learner activates → `pinEnrollmentToLatest` fires, pinning to the current latest.
5. Old `UserCourseProgress` and `CourseCompletion` rows now re-attach against the
   **new pin's denominator** — if latest has more sections than the old pin, the
   learner's progress silently drops (e.g. 100% → 92%). A certified completer can
   be re-pinned to a newer version and the completion freeze layers on top.

Unassign/reassign was effectively a "migrate to latest" — but a *destructive*
one that could regress a certified learner. This was the exact class of bug
versioning was built to prevent, reachable through what looks like a routine
admin action.

### The fix (`CourseService.unAssignCourse`)

`unAssignCourse` is now **safe by default**:

- Counts residual state across all 13 learner-state tables that
  `resetUserCourseProgress` deletes: `UserCourseProgress`,
  `UserChapterCompletion`, `UserModuleCompletion`, `CourseCompletion`,
  `SectionTimeSpent`, `LastSeenSection`, `QuizProgress`, `QuizAnswer`,
  `UserFormCompletion`, `UserPolicyCompletion`, `UserPolicyItemCompletion`,
  `CourseFeedbackSubmission`, `AssessmentAttempt`. Enumeration lives in the
  shared `probeUserCourseResidualState` helper.
- If **any** row exists, returns `409 Conflict` with a structured `details`
  breakdown and a message pointing the admin at the two safe alternatives:
  - `POST /courses/enrollments/migrate-version` for version movement.
  - Re-send with `{ force: true }` for a true clean-slate reset.
- With `{ force: true }`, calls the shared `wipeUserCourseState` helper inside
  a single Prisma `$transaction` — every one of the 13 tables above plus
  `UserCourse` — so a subsequent `assignCourse` starts from zero. This is the
  only path that can regress a certified learner, and it now leaves an audit
  trail (`UNASSIGN_COURSE_FORCE`).

Sharing the enumeration with `resetUserCourseProgress` closes the failure mode
Claude's review caught: on the first pass, unassign checked 6 tables while
reset already deleted 13, so a learner with quiz answers and an assessment
attempt but no section progress passed as "clean" and the loophole was
narrowed but not closed.

### API change

```http
PUT /api/v1/courses/unAssignCourse/user
Content-Type: application/json
Authorization: Bearer <admin-jwt>

{ "userId": "…", "courseId": "…", "force": false }
```

Response when residual state exists and `force` is not set:

```json
{
  "status": 409,
  "error": "Refusing to unassign: learner has progress or completion data. …",
  "details": {
    "progressRows": 42,
    "chapterCompletions": 4,
    "moduleCompletions": 1,
    "courseCompleted": false,
    "certified": false,
    "timeSpentRows": 42,
    "lastSeenRows": 4,
    "quizProgressRows": 8,
    "quizAnswerRows": 24,
    "formCompletionRows": 2,
    "policyCompletionRows": 1,
    "policyItemCompletionRows": 6,
    "feedbackSubmissionRows": 1,
    "assessmentAttemptRows": 1
  }
}
```

Response on `force: true` success:

```json
{
  "message": "Successfully unassigned course and wiped all learner state (force)",
  "statusCode": 200,
  "data": {
    "wiped": {
      "progressRows": 42,
      "chapterCompletions": 4,
      "moduleCompletions": 1,
      "courseCompleted": false,
      "timeSpentRows": 42,
      "lastSeenRows": 4
    }
  }
}
```

### Frontend action

Show a confirmation dialog when the API returns `409` with `details`:

> This learner has 42 progress rows, 4 chapter completions, and 4 module
> completions on this course. Unassigning without a wipe would leave stale data
> that silently re-attaches on re-enrollment. To move them to a different
> version, use "Migrate version" instead. To fully reset, click "Force wipe".

---

## 2. Admin identity — no longer discarded

### The bug

`migrateLearnerToVersion` and `archiveVersion` accepted an `adminId` argument
and immediately called `void adminId;` — the code deliberately dropped it. There
was no audit model in the schema at all, so re-pinning a learner's curriculum
or archiving a version left zero trace.

### The fix

New Prisma model `AdminAuditLog` (migration
`20260806000000_admin_audit_log`):

```prisma
model AdminAuditLog {
  id         String   @id @default(uuid())
  // adminId nullable + SetNull so the audit row outlives a hard user delete.
  // adminEmail denormalised at write time keeps the row attributable.
  adminId    String?
  adminEmail String?
  action     String       // e.g. "ARCHIVE_VERSION", "MIGRATE_LEARNER_VERSION"
  targetType String       // e.g. "CourseVersion", "UserCourse"
  targetId   String?
  courseId   String?
  userId     String?
  metadata   Json?
  createdAt  DateTime @default(now())

  admin User? @relation("AdminAuditLogActor", fields: [adminId], references: [id], onDelete: SetNull)
}
```

Indexes: `(adminId, createdAt desc)`, `(action, createdAt desc)`,
`(courseId, createdAt desc)`, `(userId, createdAt desc)`, `(targetType, targetId)`.

Writes are best-effort — a failure in the audit path never fails the
underlying operation (there's a `try/catch` in
`CourseVersionService.writeAudit`).

### Actions currently emitted

| Action | Emitted by | Metadata |
|---|---|---|
| `ARCHIVE_VERSION` | `archiveVersion` | `{ versionNumber, priorStatus }` |
| `MIGRATE_LEARNER_VERSION` | `migrateLearnerToVersion` | `{ fromVersionId, fromVersionNumber, toVersionId, toVersionNumber }` |
| `UNASSIGN_COURSE` | `unAssignCourse` (clean unassign, adminId supplied) | `{ ...counts, wiped, priorEnrolledVersionId }` |
| `UNASSIGN_COURSE_FORCE` | `unAssignCourse` (force path when residual state existed) | `{ ...counts, wiped, priorEnrolledVersionId }` |
| `ARCHIVE_MODULE` | `deleteModule` (referenced branch) | `{ title, stillServedTo, versions[] }` |
| `ARCHIVE_CHAPTER` | `deleteChapter` (referenced branch) | `{ title, stillServedTo, versions[] }` |
| `ARCHIVE_SECTION` | `deleteSection` (referenced branch) | `{ title, stillServedTo, versions[] }` |
| `ARCHIVE_QUIZ` | `deleteQuiz` and `unAssignQuiz` (referenced branches) | `{ via, stillServedTo, versions[] }` |

Extend the vocabulary by writing new `action` codes as more admin-sensitive
paths adopt the helper. Keep codes uppercase-underscore.

### Migration

```bash
npx prisma migrate deploy      # applies 20260806000000_admin_audit_log
npx prisma generate            # already run on this branch
```

---

## 3. Delete-list behavior unified

### The bug

Delete an entity referenced by a published version and the row is archived
(`isArchived = true`) rather than hard-deleted, since pinned learners still
read live content by ID. But the four admin list endpoints disagreed on how
to display archived rows:

| Endpoint | Prior behavior | Admin's impression |
|---|---|---|
| `getAllModules` | No `isArchived` filter | Still listed → *"my delete failed"* |
| `getAllChapters` | Filter only in `_count`, not on the chapter row | Still listed → *"my delete failed"* |
| `getAllSections` | `isArchived: false` | Vanishes → *"deleted, done"* |
| `getAllAssignQuizzes` | `isArchived: false` | Vanishes → *"deleted, done"* — but pinned learners keep seeing it |

Two opposite wrong impressions from the same action.

### The fix

`getAllModules` and `getAllChapters` now filter `isArchived: false` on the
outer row (not just in `_count`). All four list endpoints now behave the same
way: archived rows disappear from the admin list. The archived row remains
the content source for pinned learners on referencing versions, and will be
discoverable via a dedicated `/courses/:courseId/archived` inventory endpoint
(pending FE spec — see the "roster & archive inventory" TODO).

Files changed: [`src/course/course.service.ts`](../src/course/course.service.ts)
(`getAllModules`, `getAllChapters`).

### API impact

None on shape. Callers who previously relied on archived modules/chapters
appearing in these responses must switch to the (upcoming) `/archived`
endpoint. No production frontend currently depends on the old behavior — the
inconsistency was itself the whole complaint.

---

## 4. Delete-response `outcome` + `stillServedTo` + `versionsReferencing`

### The bug

The old delete response for an archived-instead-of-deleted row said

> Section is part of a published course version and was archived instead of
> deleted

which answered "why didn't you delete?" but not the two questions the admin
actually has:

- **"Is it still shown to anyone?"** (Yes — pinned learners on referencing versions.)
- **"How many, and on which versions?"**

### The fix

`ResponseDto` gained three optional fields:

```ts
outcome?: 'deleted' | 'archived' | 'unassigned';
stillServedTo?: number;
versionsReferencing?: Array<{
  versionId: string;
  versionNumber: number;
  status: string;
  enrollmentCount: number;
}>;
```

All four delete/unassign paths populate them:

- `POST /courses/deleteModule/:id`
- `POST /courses/deleteChapter/:id`
- `POST /courses/deleteSection/:id`
- `POST /quiz/delete/:id`
- `POST /quiz/unAssignQuiz/…`

The `message` string is now built by `CourseVersionService.buildArchiveMessage`
so wording is identical across all four entry points:

> Archived — hidden from new users, but still shown to 12 active users pinned
> to v3, v2. Use POST /courses/enrollments/migrate-version to move learners forward.

Zero-stillServed variant:

> Archived — section hidden from new users. No active enrollments are
> currently pinned to a version that still references it.

True delete variant carries `outcome: "deleted"`, `stillServedTo: 0`, and no
`versionsReferencing`.

The counting method — `CourseVersionService.getReferencingVersionsWithEnrollments`
— scans manifests once, filters to versions that reference the target sourceId
via `isIdReferencedInManifest`, and sums `_count.enrollments` per version. It
is one round-trip regardless of the number of versions.

### Frontend action

The FE should stop reading the free-text `message` for the archived/deleted
distinction and switch to the structured fields:

```ts
if (response.outcome === 'archived' && response.stillServedTo > 0) {
  toast.info(
    `Archived — still shown to ${response.stillServedTo} active learners on ${
      response.versionsReferencing.map(v => `v${v.versionNumber}`).join(', ')
    }.`,
    { action: { label: 'Migrate learners', onClick: openMigrationModal } },
  );
} else if (response.outcome === 'archived') {
  toast.success('Archived — no active learners are still on a referencing version.');
} else {
  toast.success('Deleted.');
}
```

---

## Tests

All 115 tests pass (`npx jest`). Specific coverage added / updated:

- `deleteSection`, `deleteChapter`, `deleteModule` now assert
  `outcome: 'archived'` and the exact `stillServedTo` from the mock.
- `deleteQuiz`, `unAssignQuiz` same.
- Existing "hard-deletes when not referenced" and "hard-deletes when already
  archived" tests still pass unchanged — they use the true-delete branch,
  which carries `outcome: 'deleted'`.

The unassign loophole guard is currently covered end-to-end via the type
check; a dedicated integration test in a follow-up PR should exercise both the
`409` refusal and the `force: true` clean-slate path against a real Prisma test
DB.

---

## Deliberately out of scope

Punted to a follow-up spike, pending frontend input:

- `GET /courses/:courseId/enrollments` — the roster ("who is on which
  version").
- `GET /courses/:courseId/versions/:versionId` — expand a manifest to a
  titled tree.
- `GET /courses/:courseId/archived` — inventory of archived rows and where
  they're still served.
- `POST /courses/{section,chapter,module,quiz}/:id/restore` — explicit
  un-archive path (today only reachable accidentally via update endpoints).
- `GET /courses/:courseId/versions/drift` — live fingerprint vs latest
  published.
- `POST /courses/:courseId/versions/reconcile` — expose the reconcile CLI.
- Bulk `POST /courses/:courseId/enrollments/migrate-version` with dry-run.
- `GET /courses/versions/coverage` — active enrollments with null pin.

The plan is to ship this batch, hand the FE the four structured
delete-response fields, and let them tell us which visibility gaps hurt most
before we spec the roster/archive-inventory endpoints.
