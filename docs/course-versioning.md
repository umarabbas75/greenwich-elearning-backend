# Course Versioning (Pattern 1)

Full course versioning protects in-progress learners from progress regression when admins add or change curriculum content. The live `Course / Module / Chapter / Section / Quiz` tree remains the admin editing surface; structural edits **auto-publish** an immutable snapshot that new enrollments pin to.

## Concepts

| Term | Meaning |
|------|---------|
| **Live tree** | What admins edit today (`modules`, `chapters`, `sections`, `quizzes`) |
| **CourseVersion** | One published snapshot of the live tree at a point in time |
| **enrolledVersionId** | FK on `UserCourse` — pins a learner to a specific version |
| **source*Id** | On each `CourseVersion*` row, the live row id at publish time |

## Admin workflow

### 1. Edit the live tree (unchanged)

Create/update/reorder modules, chapters, sections in the admin UI as today.

### 2. Auto-publish on structural changes

**Adding or removing** a module, chapter, or section automatically publishes a new version — no separate publish step, no Postman.

Affected admin endpoints:

- `POST /api/v1/courses/module`
- `POST /api/v1/courses/chapter`
- `POST /api/v1/courses/section`
- `DELETE /api/v1/courses/module/:id`
- `DELETE /api/v1/courses/chapter/:id`
- `DELETE /api/v1/courses/section/:id`

Responses include `publishedVersion: { versionNumber, versionId }` when publish succeeds.

Content-only edits (section text, reorder within a chapter) do **not** auto-publish — pinned learners keep their snapshotted copy until the next structural change.

### 3. Manual publish (optional)

```http
POST /api/v1/courses/:courseId/versions/publish
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{ "changeNotes": "Republish after content-only edits" }
```

Use when you need a new version without changing structure (rare).

### 4. List versions

```http
GET /api/v1/courses/:courseId/versions
```

Returns version history with enrollment counts per version.

### 5. Archive a version (only when unused)

```http
POST /api/v1/courses/:courseId/versions/:versionId/archive
```

Blocked if any enrollment is pinned to that version, or if it is still `isLatest`.

## Enrollment pinning

- **First activation** (`UserCourse.isActive` false → true): `enrolledVersionId` is set to the latest `PUBLISHED` version with `isLatest=true`.
- **Already pinned**: never changed automatically (even on deactivate/reactivate).
- **Never activated**: floats on live tree until activation.

## What learners see

All learner read paths consult `enrolledVersionId` first:

- Pinned → versioned tree (stable denominator)
- Null → live tree (legacy / not yet activated)

Progress rows (`UserCourseProgress`) still use live `sectionId`, which matches `CourseVersionSection.sourceSectionId`.

Certified completers are additionally protected by Pattern 2 (freeze at completion).

## Edit safeguards

Deleting a module/chapter/section/quiz that appears in any published version **archives** it instead of hard-deleting:

- Response message explains why
- Pinned learners keep seeing the snapshotted content
- New publishes omit archived live rows

## Force-migrate a learner (admin escape hatch)

```http
POST /api/v1/courses/enrollments/migrate-version
Authorization: Bearer <admin-jwt>

{
  "userCourseId": "<uuid>",
  "targetVersionId": "<uuid>"
}
```

Use sparingly — changes the learner's denominator to the target version's section set.

## Pattern C: new content indicator

When a learner is pinned to an older version and a newer version exists, read endpoints may include:

```json
"newSinceCompletion": {
  "newChapters": 1,
  "newSections": 1,
  "addedAt": "2026-06-15T…"
}
```

Diff = sections in latest version not present in pinned version.

## One-time backfill

Run after deploying schema migration:

```bash
yarn ts-node -r tsconfig-paths/register scripts/backfill-course-versions.ts
yarn ts-node -r tsconfig-paths/register scripts/backfill-course-versions.ts --dry-run
```

For every course: creates v1 from live tree, pins all started enrollments.

## Validation scripts

```bash
# Certified completers with live % < 100 (expect 0 after Pattern 2)
yarn ts-node -r tsconfig-paths/register scripts/_audit-completion-mismatch.ts

# Active enrollments missing version pin (expect 0 after backfill)
yarn ts-node -r tsconfig-paths/register scripts/_audit-version-coverage.ts
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| Learner sees new chapter they shouldn't | `enrolledVersionId` null | Run backfill; confirm activation hook fired |
| Admin can't delete section | Referenced by published version | Expected — archived automatically; new version published for new learners |
| No published version on publish | Course never backfilled | Run `backfill-course-versions.ts` or publish manually |
| Progress stuck below 100% for in-progress user | Denominator from live tree | Confirm enrollment is pinned; check version section count |

## Out of scope

- Assessments (already snapshotted per attempt via `AttemptQuestionSnapshot`)
- Assignments (course-scoped, no progress denominator impact)
- Forms, policies, feedback forms

## Files

- [prisma/schema.prisma](../prisma/schema.prisma) — `CourseVersion*` models
- [src/course-version/](../src/course-version/) — publish, pin, resolve logic
- [src/course/course.service.ts](../src/course/course.service.ts) — learner read rewrites
- [scripts/backfill-course-versions.ts](../scripts/backfill-course-versions.ts) — one-time migration
