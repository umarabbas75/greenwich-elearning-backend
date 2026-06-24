# Course progress: freeze at completion

Last updated: 2026-06-21

## TL;DR

When admin adds a new section/chapter to an existing course, the denominator
of `completed_sections / total_sections` grows, dragging certified completers
below 100% on every progress UI (course card, sidebar, chapter header).
Real incident: 10 NEBOSH IGC completers dropped to 95.65–98.26% after a
"Case Study" chapter was added, including users who had already received their
certificate and submitted course feedback.

We shipped **Pattern 2 — Freeze at Completion**. Once a learner has
`CourseCompletion.courseCompletedAt` set, every aggregate percentage we expose
to that learner returns **100** and the response gains `isCompleted: true` +
`completedAt`. Per-section `isCompleted` booleans stay truthful so the FE can
render "New content" pills (Pattern C, see below) on sections added after
completion.

This document captures the incident, the fix, the rationale, what's still open,
and the future roadmap (Pattern C indicator + Pattern 1 course versioning).

---

## Incident timeline

1. Client reported "user `aliharis694@gmail.com` shows 97% but completed the
   course; same problem on `ahmedhasan6263@gmail.com` and many others".
2. First hypothesis: regression from the recent
   `20260620000000_cascade_delete_section_progress` migration / orphan
   cleanup. Investigated. Ruled out — that migration only takes percentages
   *down* when stale rows existed, and it post-clamps at 100%.
3. Real cause confirmed by client: "admin added one more chapter named Case
   Study". Pure denominator-growth arithmetic:

   ```
   before:  31 / 31 = 100%
   after:   31 / 32 = 96.875%   →  rounds to 97%
   ```

4. Researched industry practice (Moodle, Docebo, LearnUpon, Brightspace,
   Coursera, edX, Open edX, iQualify, Rustici Content Controller, LMSPedia,
   eLeaP). All converge on the same framework, summarized below.

---

## Industry-best-practice framework (research summary)

Every serious LMS draws a hard line between two kinds of content change:

| Type                      | Examples                                                                      | Existing-progress behaviour                                                       |
| ------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Minor / non-structural    | Typo fix, broken link, image swap, clarifying paragraph                       | Progress preserved silently.                                                      |
| Major / structural        | New chapter, new module, new learning objective, regulatory change, removed graded item | Treated as a **new course version**. Existing learners stay on v1 by their LMS's choice; new learners get v2. |

**Adding a "Case Study" chapter is unambiguously a major / structural change.**

Four canonical patterns the industry uses, with their trade-offs:

- **Pattern 1 — Course Versioning** (the gold standard): snapshot the
  curriculum at enrollment / completion; learners' progress is calculated
  against *their* version. Used by Coursera, edX, Open edX, Rustici Content
  Controller, LearnUpon, Brightspace. Highest fidelity, highest implementation
  cost (schema-level change).
- **Pattern 2 — Freeze-at-completion + "Course updated" notice** (the
  pragmatic default): once a learner's `courseCompletedAt` fires, displayed
  progress is locked at 100% and the certificate is permanent. New content
  shows up as supplementary, never drags the bar down. LinkedIn Learning,
  Khan Academy, Salesforce Trailhead. The Moodle/Docebo "retain learner
  progress" toggle defaults here for additive changes.
- **Pattern 3 — Soft re-open**: drop completed learners back to in-progress
  (e.g. 97%); certificate keeps its date; UI says "additional content
  available". Some Moodle deployments. Honest but feels like a regression.
- **Pattern 4 — Separate addendum course**: don't touch the original course;
  publish a sibling like "NEBOSH IGC — 2026 Update" and optionally auto-assign
  to past completers. Used by enterprise compliance platforms (KnowBe4,
  Cornerstone) and is the standard SCORM/xAPI approach for regulatory deltas.

**Hard rules** every source agrees on:

- **Certificates are sacred** — once issued, a certificate must not silently
  invalidate. (edX partner docs literally say: "Verify learners who had
  certificates before these changes still have them afterward.")
- **Distinguish completion event from live percentage** — they are different
  signals and shouldn't be coupled. Completion = permanent fact-of-record.
  Percentage = live "where are you" UI hint.
- **Test with a sample learner before pushing structural changes.**
- **Provide an admin toggle for "retain progress / reset progress" at update
  time** — LearnUpon, Docebo, Moodle, Brightspace all expose this.

**The chosen path:** Pattern 2 now (universally agreed minimum), Pattern C
"New content" indicator next (LinkedIn Learning / Trailhead style), Pattern 1
course versioning as a separate scoped initiative.

---

## What we shipped (Pattern 2)

### The rule, applied uniformly

If the learner has a `CourseCompletion` row with `courseCompletedAt != null`
for that course:

- Every aggregate percentage we expose to that learner returns **100**.
- The response gains `isCompleted: true` and `completedAt` top-level fields.
- Per-section `isCompleted` booleans **stay truthful** so the FE can render
  "New" / "Locked" badges on sections added after completion.
- Admin telemetry endpoints stay raw — admins need to see who actually
  consumed the new content.

### The helper

```ts
// src/course/course.service.ts
/** True iff the learner has been certified-complete on this course. */
private async isCourseFrozen(
  userId: string,
  courseId: string,
): Promise<boolean> {
  const completion = await this.prisma.courseCompletion.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { courseCompletedAt: true },
  });
  return !!completion?.courseCompletedAt;
}
```

For sites that already fetch the row (Site 2, Site 4, Site 5 below), we reuse
the result instead of re-querying.

### The five patched sites

| #   | Service method                                              | Endpoint                                                                  | Drives                              |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------- |
| 1   | `getCourseReport`                                           | `GET /courses/report/:courseId/:userId`                                   | Course report page (per chapter)    |
| 2   | `getAllAssignedCourses`                                     | `GET /courses/getAllAssignedCourses/:userId`                              | Dashboard course cards              |
| 3   | `getUserChapterProgress`                                    | `GET /courses/getUserChapterProgress/:userId/:courseId/:chapterId`        | Chapter detail percentage           |
| 4   | `getAllUserModules`                                         | `GET /courses/user/allModules/:courseId`                                  | Course-content page (sidebar bars)  |
| 5   | `getAllUserSections`                                        | `GET /courses/user/module/chapter/allSections/:chapterId/:courseId`       | Section reader (header signal only) |

#### Site 1 — `getCourseReport`

- Added `courseCompletion` lookup to existing `Promise.all`.
- When frozen: every chapter's `progress` is forced to `'100.00'`. Contribution
  is rebased to `(totalSectionsInChapter * 100) / totalSectionsInCourse` so
  contributions sum to ~100% across chapters even when new chapters were added
  after completion.
- Response carries top-level `isCompleted` + `completedAt`.

#### Site 2 — `getAllAssignedCourses`

- Reuses the existing `completedAtByCourse` map (already fetched for the
  post-completion access window).
- When frozen: `percentage: 100`, `_count.userCourseProgress` is clamped to
  `sectionsCount` so the raw "31/32" tooltip doesn't betray the 100%.
- Each course in the response carries `isCompleted` + `completedAt`.

#### Site 3 — `getUserChapterProgress`

- Promoted to a single `Promise.all` with the completion lookup.
- When frozen: `percentage: 100`.
- Response data carries `isCompleted` + `completedAt`.

#### Site 4 — `getAllUserModules` (the Course Content page)

- The FE computes module/chapter % from raw `_count.UserCourseProgress` /
  `_count.sections`. When frozen we **clamp every chapter's and module's
  `_count.UserCourseProgress` to `_count.sections`**, so the FE-side ratio is
  always 100% for completers without changing the FE math.
- Response carries top-level `isCompleted` + `completedAt`.

#### Site 5 — `getAllUserSections` (the section reader)

- Per-section `isCompleted` flags **kept truthful** (a new "Case Study"
  section still returns `isCompleted: false`).
- Response gains top-level `isCompleted` + `completedAt` so the FE has a
  clean signal it can read in the same response. The FE chapter-header
  override (100% · N/N) is gated on this signal.

### Frontend contract (additive only)

Every response shape that previously carried `percentage` now also carries:

```jsonc
{
  "percentage": 100,            // already existed; frozen at 100 for completers
  "isCompleted": true,          // NEW — drives the green "Completed" badge
  "completedAt": "2026-05-12T…" // NEW — when they earned it
}
```

`getAllUserSections` and `getAllUserModules` add the same two top-level fields
(`isCompleted` / `completedAt`) outside `data`.

Per-section `isCompleted: boolean` flags are unchanged — they keep driving the
green checks vs lock icons in the section list. The FE's `useIsCourseCompleted`
hook ORs three signals (`getAllUserSections.isCompleted`,
`getAllUserModules.isCompleted`, `getAllAssignedCourses[i].isCompleted`) so
the chapter-header freeze works regardless of which response lands first.

### Read-only audit script

[`scripts/_audit-completion-mismatch.ts`](../scripts/_audit-completion-mismatch.ts).
Lists every certified completer (`courseCompletedAt IS NOT NULL`) whose live
progress is below 100%. Pure read; safe in any env.

```bash
yarn ts-node -r tsconfig-paths/register scripts/_audit-completion-mismatch.ts
```

Pre-deploy run found **10 affected users on NEBOSH IGC** (95.65–98.26%).
Post-deploy: still shows the same raw numbers (audit reports DB truth, not
display values). All 10 should now see 100% / Completed in the UI without a
data backfill.

Useful as a forever tool: every time admin adds a chapter, rerun it to see
who's about to be "frozen up" by the next render.

### Validation matrix (certified completer, post-deploy)

| UI element                       | Backend source                       | Expected            |
| -------------------------------- | ------------------------------------ | ------------------- |
| Dashboard course card %          | `getAllAssignedCourses`              | **100%** + badge    |
| Course Content sidebar chapter % | `getAllUserModules` (clamped counts) | **100%**            |
| Course Content unit %            | `getAllUserModules` (clamped counts) | **100%**            |
| Section reader sidebar header    | `getAllUserSections` + FE override   | **100% · N/N**      |
| Section list rows                | `getAllUserSections` (per-section)   | New section locked  |
| Chapter detail %                 | `getUserChapterProgress`             | **100%**            |
| Course Report per-chapter %      | `getCourseReport`                    | **100.00** each     |
| Admin dashboard "Completed"      | `admin-dashboard.service`            | unchanged (raw)     |

---

## Frontend changes (already shipped)

Implemented by the FE team in parallel with the backend nudges:

- New hook `src/lib/course/useIsCourseCompleted.ts` ORs the three backend
  sources listed above. React Query cache dedupes them with existing
  page-level fetches.
- `SideBarAllSection.tsx` accepts `isCourseCompleted` prop. When true, the
  chapter header reads `100% · N/N` (N = sections + chapter quiz if present);
  per-section flags below are unchanged.
- Wired into the lesson player (`[...slug]/page.tsx`) and quiz player
  (`quiz/[...slug]/page.tsx`), desktop sidebar + mobile drawer.

---

## Things explicitly out of scope and why

- **Admin telemetry freeze.** The admin dashboard's "completed sections"
  counters and engagement cohorts intentionally stay raw — admins need to know
  who actually consumed the new content.
- **In-progress (non-completed) learners.** Pattern 2 only protects certified
  completers. A learner mid-course who was at `30 / 31 = 97%` will now show
  `30 / 32 = 94%` after admin adds a section. The full fix for this is course
  versioning (Pattern 1), tracked below.
- **Renaming `ForumThread` → `Topic` / `ForumComment` → `Post`.** Separate
  initiative; not relevant here.

---

## Future work

### Pattern C — `newSinceCompletion` indicator (next on the list)

**Why.** Pattern 2 keeps the certificate honest but renders new chapters at
100% even when the learner has never opened them. Pattern C surfaces new
content as **discoverable but optional** — no percentage drag, learner is
invited but not coerced. LinkedIn Learning / Salesforce Trailhead pattern.

**No DB migration required.** `Section.createdAt` is already populated;
comparing against `CourseCompletion.courseCompletedAt` is enough.

**Response shape (additive):**

```jsonc
{
  "percentage": 100,
  "isCompleted": true,
  "completedAt": "2026-05-12T…",
  "newSinceCompletion": {
    "newChapters": 1,
    "newSections": 1,
    "addedAt": "2026-06-15T…"
  }
}
```

**Implementation sketch (≈ 1 day):**

1. New helper `summarizeNewSinceCompletion(userId, courseId)` returning the
   block above, or `null` when not frozen / nothing new.

   ```sql
   SELECT COUNT(DISTINCT s.id)        AS new_sections,
          COUNT(DISTINCT s."chapterId") AS new_chapters,
          MAX(s."createdAt")            AS added_at
     FROM "sections" s
     JOIN "chapters" c ON c.id = s."chapterId"
     JOIN "modules"  m ON m.id = c."moduleId"
    WHERE m."courseId"  = :courseId
      AND s."createdAt" > :courseCompletedAt
   ```

2. Plumb into `getCourseReport`, `getAllAssignedCourses`, `getAllUserModules`,
   `getAllUserSections` alongside the existing `isCompleted` flag.
3. FE renders "Course updated — 1 new chapter (optional)" banner on the course
   card and a "New" pill on the affected chapter / section.
4. Optional: `engagement_reminder` email template "There's new content in
   {courseTitle}" — respects existing reminder cooldowns. Out of scope for
   the data plumbing.

**Migration path.** Pure additive. FE picks up `newSinceCompletion` at its own
pace; no breaking change.

### Pattern 1 — Course Versioning (real long-term answer)

**Why.** Pattern 2 protects certificates and Pattern C surfaces new content,
but neither solves the **in-progress learner** case. A student halfway through
a course should see consistent denominators throughout their enrollment, even
if admin adds chapters mid-flight. The industry answer is per-enrollment
course snapshots.

**Schema sketch:**

```prisma
model CourseVersion {
  id          String   @id @default(uuid())
  courseId    String
  versionTag  String   // "v1.0", "v1.1", "v2.0"
  createdAt   DateTime @default(now())
  publishedAt DateTime?
  isLive      Boolean  @default(false)
  changelog   String?
  // Snapshot of the curriculum tree at publish time (modules → chapters → sections).
  // Either materialized rows in CourseVersionModule/Chapter/Section
  // or a JSON snapshot column. Materialized rows are queryable; JSON is cheaper.
  course      Course   @relation(fields: [courseId], references: [id])
  enrollments UserCourse[]
  @@unique([courseId, versionTag])
}

model UserCourse {
  // existing fields…
  enrolledVersionId String?       // null = float to live version
  enrolledVersion   CourseVersion? @relation(...)
}
```

**Behaviour:**

- Admin clicks "Add chapter" on a course that has active enrollments.
  Modal asks: *"Apply to in-progress learners (will increase their
  denominator) or only to new enrollments?"* — exactly the
  LearnUpon/Docebo/Moodle "retain progress / reset progress" toggle.
- "New enrollments only" → backend creates `CourseVersion v2`, marks it live,
  leaves existing `UserCourse.enrolledVersionId = v1`. Their progress queries
  resolve against v1. **Their denominator is fixed.**
- "Apply to everyone" → existing behaviour, only Pattern 2 protects the
  already-certified.
- New enrollment → `enrolledVersionId = current live version`.
- All progress, completion, and certificate queries resolve through
  `enrolledVersion → CourseVersionModule/Chapter/Section`. The live `Course`
  tree becomes the editing surface; the snapshot is the read surface for
  enrolled learners.

**Migration plan:**

1. Schema-only migration adding `CourseVersion` + `enrolledVersionId`
   (nullable). All existing courses become `v1.0` with all current
   enrollments pinned to it.
2. Move read queries to consult the snapshot (additive — fall back to live
   tree when `enrolledVersionId IS NULL`).
3. Wire admin "Add chapter / new version" flow.
4. Tighten `enrolledVersionId` to NOT NULL.

**Effort estimate.** 1–2 weeks for a careful implementation: schema +
backfill + dual-read + admin UI + reconciliation script. Worth scoping
properly when the client signals more rigorous curriculum control is needed.

---

## Pattern 1 shipped — Course Versioning

**Status:** Implemented (see [docs/course-versioning.md](./course-versioning.md)).

**What shipped:**

- Materialised `CourseVersion / CourseVersionModule / CourseVersionChapter / CourseVersionSection / CourseVersionQuiz` tables
- `UserCourse.enrolledVersionId` pins enrollments at first activation
- Admin endpoints: `POST .../versions/publish`, `GET .../versions`, `POST .../versions/:id/archive`
- All five learner read sites + quiz reads consult pinned version when set
- Edit safeguards: version-referenced rows archive instead of hard-delete
- Pattern C data plumbing: `newSinceCompletion` block on read endpoints when learner is on an older version
- Scripts: `backfill-course-versions.ts`, `_audit-version-coverage.ts`

**Deploy order:** schema migration → backfill script → app deploy.

---

## What this incident taught us (process)

- **Distinguish completion event from live percentage.** They are different
  signals. Coupling them led directly to this bug.
- **Audit before you migrate.** A read-only "who's affected" query takes 10
  minutes to write and tells you the blast radius before you touch anything.
- **Per-section flags are valuable signal.** Resist the temptation to cascade
  freezes all the way down — you lose the only piece of data that distinguishes
  "old, completed" from "new, untouched".
- **Industry norms exist for a reason.** Spending 20 minutes reading how
  Moodle / Docebo / LearnUpon / edX handle the same problem before designing
  a fix is always cheap.

---

## File index

- [src/course/course.service.ts](../src/course/course.service.ts) — helper +
  Sites 1-5 patches.
- [scripts/_audit-completion-mismatch.ts](../scripts/_audit-completion-mismatch.ts) —
  read-only diagnostic.
- [docs/course-versioning.md](./course-versioning.md) — Pattern 1 full reference.
- [src/course-version/](../src/course-version/) — versioning service + admin API.
- [scripts/backfill-course-versions.ts](../scripts/backfill-course-versions.ts) —
  one-time v1 backfill.
- [scripts/_audit-version-coverage.ts](../scripts/_audit-version-coverage.ts) —
  unpinned active enrollment audit.
- Plan archive:
  `~/.cursor/plans/freeze_progress_at_completion_01c5d753.plan.md`
