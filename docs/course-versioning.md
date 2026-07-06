# Course Versioning (Structure-Freeze, Content-Live)

Course versioning protects in-progress learners from progress regression when admins **add or remove** curriculum structure. The live `Course / Module / Chapter / Section / Quiz` tree remains the admin editing surface; structural edits **auto-publish** a lightweight manifest that new enrollments pin to.

**Content is never frozen.** Section HTML, quiz text, and other field edits always flow from the live tables to every learner. Only membership (which modules/chapters/sections/quizzes count toward progress) is pinned per enrollment.

## Concepts

| Term | Meaning |
|------|---------|
| **Live tree** | What admins edit (`modules`, `chapters`, `sections`, `quizzes`) |
| **CourseVersion** | One published structural manifest at a point in time |
| **manifest** | JSON on `CourseVersion`: ordered source IDs only (~few KB) |
| **sectionCount** | Active section count at publish time (O(1) progress denominator) |
| **enrolledVersionId** | FK on `UserCourse` — pins a learner to a specific version |

### Manifest shape

```json
{
  "modules": [
    {
      "sourceId": "<live-module-id>",
      "order": 0,
      "chapters": [
        {
          "sourceId": "<live-chapter-id>",
          "order": 0,
          "sectionIds": ["<live-section-id>", "..."],
          "quizIds": ["<live-quiz-id>"]
        }
      ]
    }
  ]
}
```

Learner reads batch-fetch live content by ID and assemble the tree in manifest order.

## Admin workflow

### 1. Edit the live tree (unchanged)

Create/update/reorder modules, chapters, sections in the admin UI as today.

### 2. Auto-publish on structural changes

**Adding or removing** a module, chapter, section, or quiz automatically publishes a new version when the structural fingerprint changes.

Affected admin endpoints:

- `POST /api/v1/courses/module`
- `POST /api/v1/courses/chapter`
- `POST /api/v1/courses/section`
- `DELETE /api/v1/courses/module/:id`
- `DELETE /api/v1/courses/chapter/:id`
- `DELETE /api/v1/courses/section/:id`
- Quiz assign/unassign/delete paths

Responses include `publishedVersion: { versionNumber, versionId }` when publish succeeds.

**No-op guard:** if the sorted set of active module/chapter/section/quiz IDs is unchanged, publish is skipped (prevents duplicate version spam).

Content-only edits and within-chapter reorders update live only — **no new version**.

### 3. Manual publish (optional)

```http
POST /api/v1/courses/:courseId/versions/publish
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{ "changeNotes": "Republish after structural reconciliation" }
```

### 4. List versions

```http
GET /api/v1/courses/:courseId/versions
```

Returns version history with `sectionCount` and enrollment counts.

### 5. Archive a version (only when unused)

```http
POST /api/v1/courses/:courseId/versions/:versionId/archive
```

Blocked if any enrollment is pinned to that version, or if it is still `isLatest`.

### 6. Prune orphan versions

```http
POST /api/v1/courses/versions/prune-orphans
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{ "courseId": "<optional-course-uuid>" }
```

Deletes versions with **zero enrollments** that are **not** `isLatest`. Safe to run periodically — manifests are tiny so storage stays flat.

CLI equivalent: `scripts/prune-orphan-course-versions.ts`

## Enrollment pinning

- **First activation** (`UserCourse.isActive` false → true): `enrolledVersionId` is set to the latest `PUBLISHED` version with `isLatest=true`.
- **Already pinned**: never changed automatically (even on deactivate/reactivate).
- **Never activated**: floats on live tree until activation.

## What learners see

All learner read paths consult `enrolledVersionId` first:

- **Pinned** → manifest membership + **live content** by source ID (stable denominator, fresh content)
- **Null** → live tree (legacy / not yet activated)

Progress rows (`UserCourseProgress`) use live `sectionId`, which matches manifest `sectionIds`.

Certified completers are additionally protected by Pattern 2 (freeze at completion).

## Read path (performance)

Learner reads **never write**. `resolveCurriculumTree` loads one manifest row and batch-fetches live sections/chapters/quizzes — no sync-on-read, no snapshot duplication.

Denominator: `sectionCount` on the pinned version (no tree walk).

## Delete guard

Because content is read live, rows referenced by **any** version manifest are **archived**, not hard-deleted:

- Referenced by manifest → `isArchived = true` (kept as content source for pinned learners)
- Not referenced → hard delete allowed

Already-archived sections can be permanently removed only when no manifest references them.

## Migration rollout

1. Migration `20260706120000_course_version_manifest` — add `manifest`, `sectionCount`
2. `scripts/backfill-course-version-manifests.ts` — populate manifests from legacy snapshot rows
3. Deploy application code
4. `scripts/audit-course-version-manifest-parity.ts` — verify section-set parity
5. Migration `20260706130000_drop_course_version_snapshot_tables` — drop heavy tables
6. `VACUUM (FULL, ANALYZE)` in Neon SQL editor to reclaim disk

## Out of scope

- Pattern 2 completion-freeze — unaffected, still keys off `courseCompletion`
- Assessment attempt snapshots — per-attempt, separate mechanism
