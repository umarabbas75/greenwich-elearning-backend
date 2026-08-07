# Course Versioning — Admin Feature Spec (roster, archive, migration tooling)

Backend work for the 8 items deliberately deferred in
[`course-versioning-admin-fixes.md`](./course-versioning-admin-fixes.md) (§ "Deliberately
out of scope"), sequenced against risk rather than built as one undifferentiated batch.

**Source of truth for model names below:** [`course-versioning-plan.md`](./course-versioning-plan.md)
(`CourseVersion`, `CourseVersionModule/Chapter/Section/Quiz`, `enrolledVersionId`,
`isArchived`, `source*Id`) and `course-versioning-admin-fixes.md` (`AdminAuditLog`, the
`outcome`/`stillServedTo`/`versionsReferencing` response fields, `unAssignCourse`'s
409-then-`force` pattern).

**Scope note:** this document is written from the frontend repo. I have not read the
backend source for these features — there is none yet, this is what's being specified.
Every "existing convention" cited below is cited from this repo (file\:line, verifiable);
every backend implementation detail (query shape, index needs, transaction boundaries) is
left to backend to decide, with the *contract* specified precisely enough that frontend can
build against it without renegotiating later. Where I'm inferring rather than citing, I've
said so.

---

## Cross-cutting conventions (apply to all endpoints below)

These aren't optional per-feature — they're why this doc exists instead of "add 8
endpoints, ship them."

### 1. Response envelope

Every endpoint in this app returns `{ message, statusCode, data }`. Keep doing that. Where
a feature below needs the archived/still-served vocabulary, reuse the exact fields already
shipped in `ResponseDto` — don't invent parallel ones:

```ts
outcome?: 'deleted' | 'archived';
stillServedTo?: number;
versionsReferencing?: Array<{ versionId: string; versionNumber: number; status: string; enrollmentCount: number }>;
```

The archive-inventory endpoint (§2) is *literally* "list of things with these three fields
already populated" — it's a list view over data the delete endpoints already compute
per-row today.

### 2. Real pagination, not this codebase's current pattern

Every existing admin table in this repo declares `manualPagination: true` but the query
fetches the entire table in one call and paginates client-side:

```107:107:src/app/(dashboard)/course/[courseId]/_components/ModuleTable.tsx
    pageCount: Math.ceil(data?.data?.length / 10),
```

Same shape in `ChapterTable.tsx`, `QuizTable.tsx`, `UserTable.tsx`. That's tolerable for a
course's module count (tens of rows). It is **not** tolerable for:

- **Roster** (§3) — every enrollment on a course. A popular course can have thousands.
- **Archive inventory** (§2) — grows monotonically forever, never shrinks.

Both need real `page`/`pageSize` (or cursor) params honored server-side, plus server-side
search and sort — not "return everything, let the browser slice it." Frontend will wire
`onPaginationChange` to an actual refetch for these two specifically; that wiring does not
exist anywhere in this codebase yet and is new work on the FE side, not a copy-paste of an
existing table.

### 3. Audit every admin-sensitive mutation, per-row not per-batch

`AdminAuditLog` (from `course-versioning-admin-fixes.md` §2) already exists with `action`,
`targetType`, `targetId`, `courseId`, `userId`, `metadata`. Extend the vocabulary rather
than adding a parallel logging path:

| New action | Emitted by | metadata |
|---|---|---|
| `RESTORE_ENTITY` | §1 restore endpoint | `{ entityType, priorIsArchived: true }` |
| `BULK_MIGRATE_LEARNER_VERSION` | §5, **once per learner moved**, not once per batch | `{ fromVersionId, fromVersionNumber, toVersionId, toVersionNumber, wouldRegress, forced }` |
| `RECONCILE_VERSION` | §7 if a reconcile mutates anything | `{ versionId, changesApplied }` |

Per-learner audit rows for bulk migration is not optional — see § 5.4.

### 4. Everything here is `AuthGuard('jwt')` + admin-only

Same as every other admin endpoint already listed in `course-versioning-plan.md` §4.

---

## Priority order

1. **§1 Restore endpoint** — trivial, unblocks a real admin pain point today, ships alone.
2. **§2 Archive inventory** — mechanical list view over data already computed; safe to
   build immediately after §1.
3. **§3 Roster** — same complexity class as §2, can build in parallel with it.
4. **§4 Manifest tree inspector** — backend-shaped problem (resolve titles server-side), no
   dependency on §1–3.
5. **§6 Coverage endpoint** — trivial single query, no urgency, slot in whenever.
6. **§7 Drift & reconcile** — ops tooling, lowest FE priority, can trail behind everything
   else.
7. **§5 Bulk migration with dry-run** — **last**, and not because it's least important.
   It's the same bug class `course-versioning-admin-fixes.md` §1 closed (reassignment
   silently regressing a certified learner) at N-learner scale. Ship it after the simpler
   endpoints have exercised the archive/audit conventions in production, not as the first
   thing built against them.

---

## §1 — Restore endpoint

```
POST /courses/{section,chapter,module,quiz}/:id/restore
```

Sets `isArchived = false` on the target row. No body needed. Response:

```jsonc
{ "message": "Restored", "statusCode": 200, "data": { "id": "…", "isArchived": false } }
```

**Backend decision needed:** should restoring a row that a *newer* published version no
longer references be allowed silently, or should it warn ("this is back in the live tree
but not in the latest published version — publish a new version to include it for new
enrollments")? Recommend the warning — return it as a `data.note` string rather than
blocking, since the live tree is meant to stay freely editable per
`course-versioning-plan.md` §1 ("Approach A — live = draft").

**Frontend:** one "Restore" action added next to each archived row once §2 exists to show
them (there's no surface today where an admin can even see an archived row to restore it).
Reuses `ConfirmationModal` + the `useApiMutation` pattern already in `ModuleTable.tsx`
`ChapterTable.tsx` — no new component pattern needed.

---

## §2 — Archive inventory

```
GET /courses/:courseId/archived?page=1&pageSize=20&entityType=section&search=…
```

```jsonc
{
  "message": "OK",
  "statusCode": 200,
  "data": {
    "rows": [
      {
        "id": "…",
        "entityType": "section", // "module" | "chapter" | "section" | "quiz"
        "title": "…",
        "parentPath": "Module 2 › Chapter 4", // resolved server-side, see §4 rationale
        "archivedAt": "2026-07-01T00:00:00Z",
        "stillServedTo": 12,
        "versionsReferencing": [{ "versionId": "…", "versionNumber": 3, "status": "PUBLISHED", "enrollmentCount": 12 }]
      }
    ],
    "total": 143,
    "page": 1,
    "pageSize": 20
  }
}
```

`stillServedTo` / `versionsReferencing` here is the **same computation** as
`CourseVersionService.getReferencingVersionsWithEnrollments` (already built for the delete
response in `course-versioning-admin-fixes.md` §4) — this endpoint is that function run
across every archived row instead of one row at a time. If that method currently takes a
single `sourceId`, batch it (one query for all archived IDs, not N calls).

**Frontend:** new admin page/tab, table styled like the four existing entity tables
(`ModuleTable`, `ChapterTable`, `SectionTable`, `QuizTable`) with real pagination per the
cross-cutting note above. Row action: "Restore" (§1). Zero-`stillServedTo` rows and
`stillServedTo > 0` rows should be visually distinct — this is the whole point of the page
(the admin who thought "my delete failed" now sees exactly why and for whom).

---

## §3 — Roster

```
GET /courses/:courseId/enrollments?page=1&pageSize=20&sort=percentage:desc&search=…&versionFilter=…
```

```jsonc
{
  "data": {
    "rows": [
      {
        "userId": "…",
        "userLabel": "Jane Doe",
        "email": "jane@…",
        "enrolledVersionId": "…",
        "enrolledVersionNumber": 3,
        "isLatestVersion": false,
        "percentage": 78.5,
        "isCompleted": false,
        "certified": false,
        "isActive": true,
        "isPaid": true
      }
    ],
    "total": 2400,
    "page": 1,
    "pageSize": 20
  }
}
```

`isLatestVersion` (computed as `enrolledVersionId === course.latestPublishedVersionId`) is
the field that makes this page useful rather than decorative — it's what lets an admin spot
"these 400 learners are 2 versions behind" before deciding whether §5 is worth running.

**Frontend:** this is the page that makes `unAssignCourseModalAtom` /
`ForceUnassignCourseModal` (`src/app/(dashboard)/user/_components/ForceUnassignCourseModal.tsx`)
and course-status/payment-status actions in `ViewUserCoursesModal.tsx` discoverable
per-course instead of only per-user. Reasonable to reuse those same row actions here rather
than inventing new ones — the actions are identical, only the table's primary key
(course → learner, vs. today's user → course) flips.

---

## §4 — Manifest tree inspector

```
GET /courses/:courseId/versions/:versionId
```

```jsonc
{
  "data": {
    "versionId": "…",
    "versionNumber": 3,
    "status": "PUBLISHED",
    "publishedAt": "…",
    "modules": [
      {
        "id": "…", "title": "…", "orderIndex": 0,
        "chapters": [
          {
            "id": "…", "title": "…", "orderIndex": 0, "hasQuiz": true,
            "sections": [{ "id": "…", "title": "…", "type": "DEFAULT", "orderIndex": 0 }],
            "quizzes": [{ "id": "…", "question": "…", "orderIndex": 0 }]
          }
        ]
      }
    ]
  }
}
```

**Do this server-side, not client-side.** `CourseVersionSection`/`Quiz` rows already carry
full content (`course-versioning-plan.md` §3) — return the titled tree directly from one
query with nested `include`s, matching the shape `resolveCurriculumTree` already builds
internally per that doc's §7. Do **not** ship a flat list of IDs and expect frontend to
resolve titles with N follow-up requests — there is no existing pattern in this codebase
for that, and building one just for this feature is wasted effort when the backend already
has the joined data in hand.

**Frontend:** a read-only expandable tree, most similar in interaction to the existing
`SectionTable.tsx` drag-and-drop list but without the drag (versions are immutable — see
`course-versioning-plan.md` §6, "once published, a version's content is immutable").

---

## §5 — Bulk migration with dry-run

```
POST /courses/:courseId/enrollments/migrate-version
{ "userIds": ["…"], "targetVersionId": "…", "dryRun": true }
```

### 5.1 Dry-run response — must be reviewable, not a count

```jsonc
{
  "data": {
    "targetVersionNumber": 5,
    "results": [
      {
        "userId": "…",
        "userLabel": "Jane Doe",
        "fromVersionNumber": 3,
        "fromSectionCount": 12,
        "toSectionCount": 18,
        "currentPercentage": 100,
        "projectedPercentage": 66.7,
        "wouldRegress": true,
        "isCertified": true
      }
    ],
    "summary": { "total": 40, "wouldRegress": 3, "certifiedAndWouldRegress": 1 }
  }
}
```

A count ("40 learners would be migrated") is not a dry-run — it doesn't tell the admin
anything they can act on. `course-versioning-admin-fixes.md` §1 closed exactly this failure
mode for the single-learner case (100% → 92% on reassignment, silent); a bulk endpoint that
regresses to a summary count instead of a per-learner delta reopens the same hole at scale,
just with a "dry-run" label attached that implies safety it doesn't provide.

**Frontend requirement this drives:** the confirmation UI needs `results[]` to render
something like "3 of 40 selected learners would drop below their current %, including 1
certified completer — review before confirming," not a generic spinner-then-toast. This is
a new component, not a `ConfirmationModal` — closer in shape to
`ForceUnassignCourseModal.tsx`'s residual-data breakdown, but as a scrollable per-learner
list.

### 5.2 Real run — explicit opt-in per regressing learner

```jsonc
{ "userIds": ["…"], "targetVersionId": "…", "dryRun": false, "acceptRegressionFor": ["userId1"] }
```

Mirrors `unAssignCourse`'s 409-then-`{ force: true }` shape
(`course-versioning-admin-fixes.md` §1): any learner in `wouldRegress` who is **not** in
`acceptRegressionFor` should be skipped with a reason in the response, not silently
migrated. Learners with `wouldRegress: false` proceed without needing to appear in that
list.

### 5.3 Response

```jsonc
{
  "data": {
    "migrated": ["userId2", "userId3"],
    "skipped": [{ "userId": "userId1", "reason": "would_regress_not_accepted" }]
  }
}
```

### 5.4 Audit — one row per learner, not one per batch

Emit `BULK_MIGRATE_LEARNER_VERSION` (§ cross-cutting, above) once per migrated learner, with
`fromVersionId`/`toVersionId` in `metadata`. A single batch-level audit row is not
sufficient to answer "which learner regressed and when" six months from now — the same
reasoning that made `migrateLearnerToVersion`'s per-learner audit worth adding in
`course-versioning-admin-fixes.md` §2 applies identically here, just at N rows instead of 1.

**Frontend:** triggered from §3's roster (multi-select rows → "Migrate to version…"). Given
the risk profile, recommend this ships with a hard floor on batch size (e.g. reject
`userIds.length > 200` server-side) until it's been run in production a few times —
frontend can enforce the same limit client-side in the multi-select UI, but the server-side
check is the one that actually matters.

---

## §6 — Coverage endpoint

```
GET /courses/versions/coverage
```

```jsonc
{ "data": { "rows": [{ "courseId": "…", "courseTitle": "…", "activeEnrollmentsWithNullPin": 4 }] } }
```

Should be zero everywhere post-backfill per `course-versioning-plan.md` §11
(`scripts/_audit-version-coverage.ts` already exists as a read-only diagnostic script for
exactly this check). This endpoint is that script exposed as an admin page instead of
something someone has to remember to run manually.

**Frontend:** simple table, no pagination needed at expected row counts (one row per
course, not per enrollment). Non-zero rows are a bug signal, not routine data — style
accordingly (e.g. same treatment as the "still served to" destructive-styled toast added in
`deleteOutcomeToast.ts`).

---

## §7 — Drift & reconcile

```
GET /courses/:courseId/versions/drift
POST /courses/:courseId/versions/reconcile
```

Drift = live tree fingerprint vs. latest published `CourseVersion` snapshot. Given
`course-versioning-plan.md`'s "Approach A: live = draft" model, drift is *expected and
routine* whenever an admin edits content — it only becomes actionable when an admin thinks
they published something they didn't. Recommend the drift response be a boolean +
change-count, not a full diff (the manifest tree inspector in §4 already covers "what does
this version contain" if an admin needs to dig in):

```jsonc
{ "data": { "hasDrift": true, "changedSince": "2026-07-01T00:00:00Z", "changeCount": 3 } }
```

**Frontend:** a status badge on the course detail page ("3 unpublished changes") plus the
existing "Publish new version" action already scoped as optional FE in
`course-versioning-plan.md` §9. `reconcile` is CLI-only today per the admin-fixes doc's
"Deliberately out of scope" list — exposing it as a button is the *lowest*-priority item
in this entire document; recommend leaving it CLI-only unless a concrete admin need
surfaces.

---

## What frontend still needs from backend before any of this is buildable

1. Confirm `CourseVersion` exposes (or can cheaply compute) `isLatest` per course, so §3's
   `isLatestVersion` field doesn't require a second round-trip per row.
2. Confirm whether `getReferencingVersionsWithEnrollments` (used for §4 of the admin-fixes
   doc) can be batched across many source IDs in one query — §2 depends on this not being
   N queries for N archived rows.
3. Decide the hard batch-size ceiling for §5 before frontend builds the multi-select UI
   around it — changes the multi-select's max-selection behavior.

None of the above blocks §1/§2/§3/§6 from being scoped and estimated today.
