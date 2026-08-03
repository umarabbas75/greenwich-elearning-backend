# Assigned-courses API — performance spec (Tier 2 & 3)

Backend work for `GET /courses/getAllAssignedCourses/:id`.

**Implementation:** `src/course/course.service.ts:3840-4113` · **Controller:** `src/course/course.controller.ts:357-364`

Frontend Tier 1 (query-key consolidation + opt-in `staleTime`) is already shipped; no
frontend change is required for Tier 2. Tier 3 adds endpoints and *then* migrates callers.

---

## Context

This endpoint has **13 in-app call sites**. Only **2** render the data it returns:
`/studentCourses` (via `SingleCourse`) and the admin `ContinueWhereYouLeft` widget.
The other 11 read between one and five scalar fields.

Note on measurement: a `304 Not Modified` on this route is browser revalidation only —
the server still executes the full query to produce it. 304s are not evidence of caching
on the backend side.

---

# Tier 2 — make the existing endpoint cheaper

No API contract change, no frontend change. Do these first.

## 2.1 Add a `select` to the Course include *(biggest win, ~1 line)*

`course.service.ts:3848` currently uses `include: { course: { include: {...} } }` with no
`select`, so Prisma returns **every** Course scalar. That includes three `Json[]` columns
(`assessments`, `resources`, `syllabus`) and five long-form rich-text columns (`overview`,
`description`, `syllabusOverview`, `resourcesOverview`, `tutorInfo`).

No list surface renders any of them.

> **Extra urgency:** those rich-text columns are exactly where legacy base64-inlined images
> live (see the `useQuillImageUpload` fix). A single legacy course can add hundreds of KB
> to this response — multiplied by every assigned course, on all 13 surfaces.

Replace the bare `include` with an explicit `select` of the fields actually consumed:

```
id, title, image, duration, validityDays, trainerName/tutorName
```

Everything else on Course should be opt-in. Keep the existing nested relations as they are
for now — 2.2 and 2.3 handle those.

**Verification:** `docs/`-side consumers were audited; no call site reads the JSON blob
columns off this payload.

## 2.2 Stop spreading raw relations

`course.service.ts:4049` does `return { ...course, ... }`, which re-emits the hydrated
`courseForms[]`, `Policy[]` (with nested `items[]` and `completions[]`), `modules[]`, and
`LastSeenSection[]` arrays **alongside** the derived `formStatus` / `policyStatus` /
`latestLastSeenSection` computed from them.

Every consumer reads only the derived summaries. Emitting both roughly doubles response size.

Build the response object explicitly instead of spreading. Fields to keep:

```
id, title, image, duration,
percentage, isCompleted, completedAt, isActive, isPaid, expired, expiresAt,
formStatus, policyStatus, policyItemStatus, feedbackForm,
latestLastSeenSection, canAccessContent
```

## 2.3 Kill the modules→chapters→sections fan-out

```ts
modules: { select: { chapters: { select: { _count: { select: { sections: true } } } } } }
```

This reads **every module and every chapter of every assigned course** purely to `reduce()`
them into one integer, `sectionsCount` (`:4014-4018`) — the progress denominator.

It is also fetched unconditionally but only *used* when `enrolledVersionId` is null;
version-pinned enrolments already get this in O(1) from `CourseVersion.sectionCount`
(`:3938-3947`), so for those the entire fan-out is fetched and discarded.

**Fix:** denormalise a `sectionCount Int` onto `Course`, maintained on section
create/delete/archive (the same places that already touch `CourseVersion.sectionCount`).
Then drop the `modules` include entirely and read `course.sectionCount` as the fallback.

This is the change that makes 2.4's first two indexes unnecessary.

## 2.4 Add missing indexes

Postgres does not auto-index foreign keys. Currently missing:

| Table | Column | Why it matters |
|---|---|---|
| `modules` | `courseId` | seq-scanned by the 2.3 fan-out |
| `chapters` | `moduleId` | seq-scanned by the 2.3 fan-out |
| `user_form_completions` | `courseFormId` | seq-scanned by the forms include |

If 2.3 lands, the first two stop being hot — but they are cheap and worth adding regardless.
The third is needed either way.

## 2.5 Add `orderBy` + consider pagination

The outer `findMany` has no `orderBy`, so row order is not stable across requests. Add a
deterministic sort. Pagination is optional today (learners have few courses) but the endpoint
has no upper bound by design.

---

# Tier 3 — new endpoints

Only **three** endpoints total, not one per surface. Sites with near-identical needs
collapse cleanly; 13 endpoints would mean 13 invalidation paths to keep in sync.

Re-measure after Tier 2 before building these — the fat endpoint may already be fast
enough for several of the scalar-only surfaces.

## A. `GET /courses/assigned/:userId/summary`

**Serves 7 of 13 call sites.**

```jsonc
[
  {
    "id": "…",
    "title": "…",
    "image": "…",
    "percentage": 42.5,
    "isCompleted": false,
    "isActive": true,   // admin surfaces only
    "isPaid": true      // admin surfaces only
  }
]
```

One query, one join. **No** forms, policies, modules, JSON blobs, or last-seen data.

| Call site | Fields it needs |
|---|---|
| `student-assessments/page.tsx` | `id`, `title`, `percentage` |
| `(dashboard)/page.tsx` | `percentage` only (shares the cache entry with the two widgets below — one fetch serves all three) |
| `CourseProgressGraph.tsx` | `id`, `title`, `percentage` |
| `ViewUserCoursesModal.tsx` | `image`, `title`, `percentage`, `isActive`, `isPaid` |
| `AssignCoursesModal.tsx` | `id` only |
| `useIsCourseCompleted.ts` | `id`, `isCompleted` |
| `useStudentHasAssessmentsNav.ts` | `id` only |

## B. `GET /courses/assigned/:userId/:courseId`

**Serves 3 call sites.** Returns a single assigned-course row:

```jsonc
{
  "id": "…", "title": "…", "trainerName": "…",
  "formStatus": { "totalForms": 3, "completedForms": 1, "forms": [ /* … */ ] },
  "policyStatus": { /* … */ },
  "policyItemStatus": { "completedItems": 2, "totalItems": 5 },
  "feedbackForm": { "isRequired": true, "isCompleted": false }
}
```

`formStatus.forms[]` rows must include `formId`, `formName`, `isComplete`, `courseFormId`,
and `description` — note the last two are consumed by `course-form-page` but are absent from
the current `AssignedCourseFormRow` type in `src/lib/course-forms/assigned-courses.ts`.

| Call site | Currently does |
|---|---|
| `studentCourses/[courseId]/feedback/page.tsx` | fetch all → `.find()` → read `title`, `trainerName`, `feedbackForm` |
| `studentCourses/[courseId]/_components/Grades.tsx` | fetch all → `.find()` → read `formStatus`, `policyStatus`, `policyItemStatus` |
| `studentCourses/[courseId]/course-form-page/page.tsx` | fetch all → `.find()` → read `formStatus.forms` |

**This is the highest-value new endpoint.** All three fetch a learner's *entire* assigned-course
list — every JSON blob, every policy tree, ~17 SQL round trips — to `.find()` one course and
read one field off it. That is an architectural mismatch no amount of caching fixes.

## C. Keep the existing fat endpoint

For `/studentCourses` (via `SingleCourse`) and admin `ContinueWhereYouLeft` only — the two
surfaces that genuinely render the full card tree. Apply all of Tier 2 to it.

`ContinueWhereYouLeft` is the sole consumer of `latestLastSeenSection` anywhere in the app.

---

# Also worth doing (separate, smaller)

## Batch the assessment-availability fan-out

`src/lib/assessment/useStudentHasAssessmentsNav.ts` drives the **student nav**, so it runs on
every student page load. It fetches the full assigned-courses list just to extract `id[]`,
then fires **one `/course-assessment/student/assessments/:courseId` request per course**.

With endpoint A plus a batched
`GET /course-assessment/student/assessments?courseIds=a,b,c`, a learner with N courses goes
from **N+1 requests to 2**. A `TODO(perf)` marking this is in the hook.

## `/public/:id` variant

`course.service.ts:4115-4168` returns the whole `UserCourse` row because the `.map()` that
stripped it is commented out at `:4152`, and it ignores `isActive`. Cheap to tidy while nearby.

---

# Suggested order

1. **2.1 + 2.2** — pure payload reduction, no schema migration, no frontend change. Measure.
2. **2.4** — index migration. Measure.
3. **2.3** — needs a `sectionCount` migration + maintenance logic. Measure.
4. **B** — build and migrate the 3 single-course call sites.
5. **A** — build and migrate the 7 summary call sites.
6. Batched availability endpoint.

Steps 1-3 need no frontend changes at all and benefit all 13 existing callers.
