# Frontend progress display — course, module, chapter, lesson, quiz

Last updated: 2026-08-06
Audience: frontend engineers touching progress UI, backend engineers building endpoints that feed it.

This doc is a direct read of the current codebase (not a design spec). Every
claim below is tied to a real file. Where the backend behaviour matters but
lives outside this repo, it's cross-referenced to `docs/course-progress-freeze-at-completion.md`,
which is the authoritative doc for that piece and was written together with
the backend team.

---

## 1. TL;DR — the mental model

```
Course
 └─ Module        (aka "unit" in some UI copy)
     └─ Chapter    (aka "element")
         ├─ Section  ×N   (aka "lesson" — the actual reading/video/interactive content)
         └─ Quiz  (0 or 1 per chapter — separate from Assessment)

Course
 └─ Assessment  ×N  (independent of modules/chapters — a final/graded exam, gated on course completion)

Course
 └─ Forms / Policies  (checklist-style requirements, gate content access, not counted in %)
```

There are **four independent progress tracks** that all render on the same
course card / sidebar / report, and it's easy to conflate them:

| Track                 | Unit of completion                                    | Where it's computed                                                                | Gates what                                                                              |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **Content progress**  | `Section.isCompleted` (a row per learner per section) | FE derives `% = completedSections / totalSections` from counts the backend returns | Sequential chapter/module unlocking                                                     |
| **Chapter quiz**      | `QuizProgress.isPassed` per chapter                   | Backend (`getChapterQuizzesReport`)                                                | Advancing past a chapter that has a quiz; contributes 1 "unit" to the sidebar ring      |
| **Course assessment** | `AssessmentAttempt.isPassed`                          | Backend (`/course-assessment/student/assessments/:courseId`)                       | Nothing structural — it's a capstone exam, usually unlocked once course content is done |
| **Forms / Policies**  | `isComplete` per form/policy item                     | Backend, returned on the assigned-course row                                       | Access to course **content** (not counted into the `%` at all)                          |

The **percentage number you see on a course card is never computed by
multiplying/dividing frontend-side model relationships** — it's a single
`percentage` field the backend hands over on `getAllAssignedCourses`. Almost
everywhere else (module ring, chapter bar, sidebar chapter header), the FE
_does_ compute the ratio itself from `_count` fields the backend attaches to
each row. Both patterns coexist; see § 4.

---

## 2. The five backend endpoints that carry progress, and who reads them

This table is reproduced (with FE consumer detail added) from
`docs/course-progress-freeze-at-completion.md`, which lists these as the five
places the backend "freezes" progress at 100% for certified completers:

| #   | Endpoint                                                            | Backend method           | FE consumer(s)                                                                                                                          | UI it drives                                                                                              |
| --- | ------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1   | `GET /courses/report/:courseId/:userId`                             | `getCourseReport`        | `Grades.tsx`, `ChapterSectionsBreakdown.tsx`, `PDFReport.tsx`                                                                           | Full per-chapter report page + downloadable PDF                                                           |
| 2   | `GET /courses/getAllAssignedCourses/:userId`                        | `getAllAssignedCourses`  | `SingleCourse.tsx`, `CourseProgressGraph.tsx`, dashboard `page.tsx` stats, `Grades.tsx` (form/policy status), `useIsCourseCompleted.ts` | Course cards (`%`, badges, expiry), dashboard "Total/In progress/Completed/Avg" tiles, progress bar chart |
| 3   | `GET /courses/getUserChapterProgress/:userId/:courseId/:chapterId`  | `getUserChapterProgress` | Chapter detail views                                                                                                                    | Single-chapter `%`                                                                                        |
| 4   | `GET /courses/user/allModules/:courseId`                            | `getAllUserModules`      | `CourseContent.tsx` (studentCourses "Course content" tab), `useIsCourseCompleted.ts`                                                    | Module progress ring, chapter progress bar, lock/unlock sequencing                                        |
| 5   | `GET /courses/user/module/chapter/allSections/:chapterId/:courseId` | `getAllUserSections`     | `[...slug]/page.tsx` (lesson player), `SideBarAllSection.tsx`, `quiz/[...slug]/page.tsx`                                                | Section list, chapter header `%`, reading gate, per-section lock icons                                    |

Two more endpoints exist alongside these and are **not** part of the content
track:

| Endpoint                                               | FE consumer                                                     | UI                                                                                              |
| ------------------------------------------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `GET /quizzes/getChapterQuizzesReport/:chapterId`      | `[...slug]/page.tsx`, `SideBarAllSection.tsx`                   | `quizPassedChapter`, "Quiz pending/passed" badges, gates last-section → next-chapter transition |
| `GET /course-assessment/student/assessments/:courseId` | `CourseAssessmentSummary.tsx`, `SingleCourse.tsx`, `Grades.tsx` | Assessment card/sidebar chip, PDF assessment section                                            |

---

## 3. Data key glossary

These are the exact field names the frontend reads. Casing is copied verbatim
from the source files — **note the inconsistency** flagged in § 8.

### Course level (`getAllAssignedCourses` row)

| Key                                         | Type             | Meaning                                                                                 |
| ------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------- |
| `percentage`                                | `number`         | 0–100, backend-computed, frozen at 100 once `CourseCompletion.courseCompletedAt` is set |
| `isCompleted`                               | `boolean`        | NEW field added for the freeze fix; drives the green "Completed" badge                  |
| `completedAt`                               | `string \| null` | ISO timestamp of certification                                                          |
| `expired`                                   | `boolean`        | Learner-only, post-completion access window elapsed                                     |
| `expiresAt`                                 | `string \| null` | Set once completed; null until then                                                     |
| `canAccessContent`                          | `boolean`        | Gates whether the course card links to content at all                                   |
| `canAccessPolicies`                         | `boolean`        | —                                                                                       |
| `formStatus.totalForms` / `.completedForms` | `number`         | Course-requirement forms checklist                                                      |
| `policyStatus` / `policyItemStatus`         | `object`         | Policy checklist, same shape idea                                                       |

Sources: `src/app/(dashboard)/_components/dashboard/CourseProgressGraph.tsx:40`, `src/app/(studentDashboard)/studentCourses/_components/SingleCourse.tsx:33-82`.

### Module level (`getAllUserModules` row)

| Key                                                | Meaning                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `_count.UserCourseProgress`                        | Count of completed section-progress rows for this module (numerator) |
| `_count.sections`                                  | Total sections in the module (denominator)                           |
| `chapters[]`                                       | Nested chapter rows, same `_count` shape                             |
| top-level `isCompleted` (response, not per-module) | Freeze signal consumed by `useIsCourseCompleted`                     |

FE derives everything else. **Note the clamp** — `calculateProgress` cannot
render past 100% even if the numerator exceeds the denominator (e.g. stale
progress on an archived section inflating `_count.UserCourseProgress` past
`_count.sections`); it silently rounds down to 100 instead:

```35:39:src/app/(studentDashboard)/studentCourses/[courseId]/_components/CourseContent.tsx
  const calculateProgress = (completed: any, total: any) => {
    const raw = (completed * 100) / total;
    if (isNaN(raw)) return 0;
    return Math.min(100, Math.max(0, Number(raw.toFixed(0))));
  };
```

That clamp only protects the **displayed percentage**, though — it does not
protect the boolean completion checks a few lines below (`isSectionsDone`,
§ "Chapter level" above), which do an unclamped `done >= sections` comparison
on the exact same two `_count` fields. See § 8 for why that distinction
matters.

### Chapter level (same `getAllUserModules` payload, nested)

| Key                         | Meaning                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `_count.sections`           | Sections in this chapter                                                                                                                                            |
| `_count.UserCourseProgress` | Learner's completed sections in this chapter                                                                                                                        |
| `_count.quizzes`            | >0 means this chapter **has** a quiz (the only reliable "has quiz" signal — `QuizProgress` being empty is ambiguous between "no quiz" and "quiz not attempted yet") |
| `QuizProgress[0].isPassed`  | Whether the learner passed the chapter's quiz                                                                                                                       |

Derived FE booleans, all in `CourseContent.tsx`:

```42:60:src/app/(studentDashboard)/studentCourses/[courseId]/_components/CourseContent.tsx
  const isSectionsDone = (c: any) => {
    const sections = c?._count?.sections ?? 0;
    const done = c?._count?.UserCourseProgress ?? 0;
    return sections > 0 && done >= sections;
  };

  const hasQuiz = (c: any) => (c?._count?.quizzes ?? 0) > 0;

  const quizPending = (c: any) => hasQuiz(c) && isSectionsDone(c) && c?.QuizProgress?.[0]?.isPassed !== true;

  const isChapterCompleted = (chapter: any) => {
    if (!isSectionsDone(chapter)) return false;
    if (!hasQuiz(chapter)) return true;
    return chapter?.QuizProgress?.[0]?.isPassed === true;
  };
```

**Rule to remember:** a chapter is only "complete" once all its sections are
done _and_, if it has a quiz, that quiz is passed. Sections-only ≠ chapter
complete when a quiz exists.

### Section (lesson) level (`getAllUserSections` row)

| Key                                                         | Meaning                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `id`, `title`, `type`, `orderIndex`                         | Identity + ordering (`sortSectionsByOrderIndex` sorts by `orderIndex`, falls back to `createdAt`) |
| `isCompleted`                                               | Per-section boolean — **always truthful**, even for a certified/frozen learner (see § 6)          |
| top-level `isCompleted` / `completedAt` (sibling of `data`) | The freeze signal for this response                                                               |
| `chapter.quizzes`                                           | Non-empty array ⇒ chapter has a quiz (used directly in the lesson player, not `_count`)           |

Type: `LearnerChapterSection` in `src/lib/course/sortSectionsByOrderIndex.ts:2-22`.

### Course report level (`getCourseReport` — the richest payload; types in `src/lib/course/course-report.ts`)

| Key (module)                          | Meaning                                                                                |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| `status`                              | `'not_opened' \| 'opened' \| 'in_progress' \| 'completed'`                             |
| `chaptersCompleted` / `chaptersTotal` | Rollup counts                                                                          |
| `timeSpentSeconds`                    | Sum across chapters                                                                    |
| `totalAttempts`                       | Sum of **interactive section** verify tries across the module (excludes quiz attempts) |
| `completedAt` / `moduleCompletedAt`   | —                                                                                      |

| Key (chapter)                          | Meaning                                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `status`                               | Same enum; derived client-side via `getReportChapterStatus` if backend omits it                           |
| `progress`                             | `string \| number`, 0–100, this chapter's own completion %                                                |
| `contribution`                         | This chapter's weighted share of the _whole course's_ 100% (chapters sum to ~100 across the course)       |
| `sectionsCompleted` / `sectionsTotal`  | —                                                                                                         |
| `quiz`                                 | Flat summary: `{ attempts, isPassed, score, passingCriteria, firstAttemptAt, lastAttemptAt }` — new shape |
| `_count.QuizAnswer` / `_count.quizzes` | Legacy quiz shape, still supported as a fallback                                                          |
| `QuizProgress[0]`                      | Legacy quiz shape, fallback source for `quiz`                                                             |
| `totalAttempts`                        | Sum of interactive section attempts in _this chapter only_                                                |

| Key (section, nested under chapter)                     | Meaning                                                                                                                                      |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`, `openedAt`, `completedAt`, `timeSpentSeconds` | —                                                                                                                                            |
| `totalAttempts`                                         | `number` for interactive types (`MATCH_AND_LEARN`, `VISUAL_ACTIVITY`, `ORDERING`, `MATCHING`); `null` for `DEFAULT` (reading/video) sections |

All the report-level helpers (`getChapterQuizSummary`, `chapterHasQuiz`,
`getReportChapterStatus`, `getReportModuleStatus`, `formatQuizGradeForReport`,
`formatQuizCorrectForReport`, `formatQuizAttemptsForReport`,
`formatChapterSectionAttemptsForReport`, `getChapterCompletedAt`,
`getCourseCompletedAt`, …) live in `src/lib/course/course-report.ts` and
`src/lib/course/course-report-display.ts`, and are the **single source of
truth** for turning this payload into displayable strings — every report UI
(`Grades.tsx`, `ChapterSectionsBreakdown.tsx`, `PDFReport.tsx`) imports from
there instead of re-deriving.

### Quiz level

| Key                      | Source                                            | Meaning                                                                             |
| ------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `containQuizzes`         | `chapter?.quizzes?.length > 0`                    | Local boolean computed from the sections payload's embedded `chapter.quizzes` array |
| `quizReport.isPassed`    | `GET /quizzes/getChapterQuizzesReport/:chapterId` | Whether the learner passed this chapter's quiz                                      |
| `chapterQuizOutstanding` | `containQuizzes && !quizPassedChapter`            | Blocks the "last section → next chapter" transition                                 |
| `PASS_PERCENTAGE`        | `src/constants/quiz.ts`                           | Passing threshold constant used across quiz UI                                      |

### Assessment level (`StudentAssessmentAvailability`, `src/components/assessment/CourseAssessmentSummary.tsx:10-38`)

| Key                                                                 | Meaning                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `assessment.passingPercentage`, `.timeLimitMinutes`, `.maxAttempts` | Static config                                                                |
| `isEligible`                                                        | Whether the learner has cleared the prerequisite (usually course completion) |
| `canStart`                                                          | Server-computed "safe to start now"                                          |
| `inProgressAttemptId`                                               | Resume target                                                                |
| `remainingAttempts`                                                 | `null` = unlimited                                                           |
| `attempts[].status`                                                 | `IN_PROGRESS \| SUBMITTED \| AUTO_GRADED \| GRADED \| FINALIZED \| EXPIRED`  |
| `attempts[].percentage`, `.isPassed`                                | Per-attempt result                                                           |

---

## 4. Methodology, level by level

### 4.1 Course card `%` (dashboard, course list)

Straight passthrough of the backend's `percentage` field — no client math.
This is intentional: it's the one place where the backend has already applied
the completion freeze (see § 6), so re-deriving the ratio client-side would
reintroduce the exact bug that freeze fixed.

```39:41:src/app/(dashboard)/_components/dashboard/CourseProgressGraph.tsx
          percentage: typeof item?.percentage === 'number' ? item.percentage : 0,
          course: item?.title ?? 'Untitled course',
```

Dashboard summary tiles (`Total Courses`, `In Progress`, `Completed`,
`Avg Progress`) are pure client-side aggregation over that same array:

```37:42:src/app/(dashboard)/page.tsx
  const totalCourses = coursesData?.length || 0;
  const activeCourses = coursesData?.filter((c: any) => c.percentage > 0 && c.percentage < 100).length || 0;
  const completedCourses = coursesData?.filter((c: any) => c.percentage === 100).length || 0;
  const avgProgress =
    coursesData?.reduce((acc: number, c: any) => acc + (c.percentage || 0), 0) / totalCourses || 0;
```

`ContinueWhereYouLeft` and `CourseProgressGraph` on the same dashboard page
deliberately **share the same React Query key** (`assignedCoursesKey`) as this
stats block — a prior version used a separate key and produced 3 duplicate
fetches that never invalidated when progress changed. Any new dashboard widget
reading assigned courses should reuse `assignedCoursesKey(userId)`.

### 4.2 Module progress ring (`CourseContent.tsx`, studentCourses "Course content" tab)

Client-computed ratio from raw counts (this is the endpoint the freeze doc
calls Site 4 — the backend clamps `_count.UserCourseProgress` to `_count.sections`
for a certified learner so this same client formula still lands on 100):

```90:93:src/app/(studentDashboard)/studentCourses/[courseId]/_components/CourseContent.tsx
          const moduleCompleted = index > 0 && isModuleCompleted(mArray?.[index - 1]);
          const isModuleDisabled = freeRoam ? false : index > 0 ? !moduleCompleted : false;
          const progress = calculateProgress(item?._count?.UserCourseProgress, item?._count?.sections);
```

Rendered as an animated SVG ring (`strokeDashoffset` driven by `pct`) plus a
`{pct}%` label in the accordion header.

### 4.3 Chapter progress bar (same file)

Same `calculateProgress` helper, applied per chapter, plus the
`isChapterCompleted` gate for the green-check vs. play icon and for whether
the _next_ chapter unlocks:

```179:187:src/app/(studentDashboard)/studentCourses/[courseId]/_components/CourseContent.tsx
                        const chapterProgress = calculateProgress(
                          chapter?._count?.UserCourseProgress,
                          chapter?._count?.sections,
                        );
                        const isCompleted = chapterProgress >= 100 && isChapterCompleted(chapter);
                        const chapterQuizPending = quizPending(chapter);
                        const chapterQuizPassed =
                          hasQuiz(chapter) &&
                          isSectionsDone(chapter) &&
                          chapter?.QuizProgress?.[0]?.isPassed === true;
```

A small `ClipboardList` / `ClipboardCheck` badge next to the chapter title
communicates "Quiz pending" / "Quiz passed" independently of the percentage
bar — the percentage bar only reflects _sections_, not the quiz.

### 4.4 Lesson player sidebar header (`SideBarAllSection.tsx`)

This is the "N/N · X%" chip shown while a learner is inside a chapter. It
folds the chapter quiz into the denominator as **one extra unit**:

```33:41:src/app/(coursePage)/studentNewCourse/_components/SideBarAllSection.tsx
  const sectionsCompleted = (allSections ?? []).filter((s: any) => s?.isCompleted).length;
  const sectionsTotal = (allSections ?? []).filter((s: any) => s?.title).length;
  const allSectionsDone = sectionsTotal > 0 && sectionsCompleted >= sectionsTotal;
  const totalCount = sectionsTotal + (hasQuiz ? 1 : 0);
  const completedCount = isCourseCompleted ? totalCount : sectionsCompleted + (hasQuiz && quizPassed ? 1 : 0);
  const rawPercentage = isCourseCompleted ? 100 : (completedCount * 100) / totalCount;
  const percentage: any = isNaN(rawPercentage)
    ? 0
    : Math.min(100, Math.max(0, parseInt(String(rawPercentage))));
```

`isCourseCompleted` is the freeze override (§ 6) — when true, this header
short-circuits straight to `100% · N/N` regardless of the raw section/quiz
state, while the per-row icons below it stay truthful.

### 4.5 Section (lesson) completion itself — how a section becomes `isCompleted: true`

Two different completion mechanics depending on section `type`:

- **`DEFAULT`** (reading/video content): a **reading gate**. The learner must
  scroll the content to the bottom before the "Mark as complete" / "Continue"
  button unlocks:

  ```316:322:src/app/(coursePage)/studentNewCourse/[...slug]/page.tsx
    const defaultReadingGateActive =
      !freeRoam &&
      resolvedSectionKind === 'DEFAULT' &&
      !isLoading &&
      !showCourseReport &&
      !showChapterCompleteReport &&
      !selectedItem?.isCompleted;
  ```

  ```393:397:src/app/(coursePage)/studentNewCourse/[...slug]/page.tsx
  const mustReadToProceed =
    !freeRoam &&
    resolvedSectionKind === 'DEFAULT' &&
    !selectedItem?.isCompleted &&
    (isLoading || !readThroughSection);
  ```

  `freeRoam` (QA/demo allowlist, `useFreeRoam()`) bypasses this everywhere it
  appears — it's the one flag consistently threaded through every gate in this
  system.

- **Interactive types** (`MATCH_AND_LEARN`, `VISUAL_ACTIVITY`, `ORDERING`,
  `MATCHING`): the learner must **Check**/auto-verify their answer at least
  once. Every check calls `useSectionAttemptLogger` (see § 7) and, on success,
  flips the section to completed via the same mutation as `DEFAULT`.

Both paths converge on one mutation:

```583:601:src/app/(coursePage)/studentNewCourse/[...slug]/page.tsx
  const updateCourseProgress = () => {
    const payload = {
      courseId: courseId,
      chapterId: chapterId,
      sectionId: sectionId,
      moduleId: moduleId,
    };

    if (!selectedItem?.isCompleted) {
      updateProgress(payload);
      return;
    }

    if (isLastSection && chapterQuizOutstanding) {
      router.push(`/studentNewCourse/quiz/${courseId}/${chapterId}/${moduleId}`);
      return;
    }

    goToNextSection();
  };
```

`updateProgress` (`PUT /courses/updateUserChapter/Progress`) is a
`useApiMutation` whose `onSuccess` invalidates the caches that every progress
UI in this doc reads from — `getAllAssignedCourses`, the sections list, and
**both** module-list query keys (`get-all-modules` used by the lesson view and
`get-modules` used by the studentCourses overview), because a naming split
between those two call sites previously caused one of them to go stale:

```546:568:src/app/(coursePage)/studentNewCourse/[...slug]/page.tsx
  const { mutate: updateProgress, isLoading: updatingProgress } = useApiMutation<any>({
    endpoint: `/courses/updateUserChapter/Progress`,
    method: 'put',
    config: {
      onSuccess: () => {
        // Invalidate queries first
        queryClient.invalidateQueries({
          queryKey: ['get-all-assigned-courses'],
        });
        queryClient.invalidateQueries({
          queryKey: ['get-users-sections-list'],
        });
        queryClient.invalidateQueries({
          queryKey: ['get-all-modules', courseId],
        });
        queryClient.invalidateQueries({
          queryKey: ['get-modules', courseId],
        });
        if (containQuizzes) {
          queryClient.invalidateQueries({ queryKey: ['quiz-report', chapterId] });
        }
```

### 4.6 Chapter quiz

`containQuizzes` is read straight off the sections payload's embedded
`chapter.quizzes` array (not a `_count`, unlike the studentCourses content
tab — two different endpoints represent "has a quiz" two different ways):

```170:183:src/app/(coursePage)/studentNewCourse/[...slug]/page.tsx
  const containQuizzes = chapter?.quizzes?.length > 0 ? true : false;

  const { data: quizReport } = useApiGet<any, Error>({
    endpoint: `/quizzes/getChapterQuizzesReport/${chapterId}`,
    queryKey: ['quiz-report', chapterId],
    config: {
      enabled: Boolean(chapterId && containQuizzes),
      select: (data: any) => data?.data?.data,
    },
  });

  const quizPassedChapter = quizReport?.isPassed === true;
  const chapterQuizOutstanding = containQuizzes && !quizPassedChapter;
```

`chapterQuizOutstanding` is the single gate that decides whether finishing the
last section of a chapter routes to the quiz page or straight to the next
chapter (see `updateCourseProgress` above).

### 4.7 Course assessment (separate from chapter quizzes)

`CourseAssessmentSummary` renders a card (course list) or sidebar chip
(lesson player) from `/course-assessment/student/assessments/:courseId`. It
never touches the chapter/section progress numbers — it's purely
attempt/status driven:

```91:133:src/components/assessment/CourseAssessmentSummary.tsx
export function courseHasConfiguredAssessment(...)
...
function insightsFromAvailability(a: StudentAssessmentAvailability | null | undefined) {
  ...
  if (hasPassed) {
    statusLabel = bestPct > 0 ? `Passed · ${bestPct.toFixed(0)}%` : 'Passed';
    statusTone = 'success';
  } else if (inProgress) { ... }
```

`canOpenAssessmentTakingPage` centralizes the "can the learner actually start
or resume" check (`inProgressAttemptId` → `canStart` → attempts-remaining
fallback) — reused by the assessments-hub nav visibility hook mentioned in the
previous chat's todo list (`useStudentHasAssessmentsNav`).

### 4.8 Course report / grade sheet (`Grades.tsx` — used by both the student's own "My grades" and the admin's "View student" modal)

This is the most detailed progress view in the app and the one exported to
PDF. It layers five independent things on one page, per module/chapter:

1. Status pill — `getReportChapterStatus` / `getReportModuleStatus`
2. Progress bar — `row.progress` (chapter's own %, clamped `0-100`)
3. Contribution — `row.contribution` (this chapter's weighted share of the
   whole course), summed client-side via `calculateTotalContribution` to
   produce the header's "Overall Progress" bar — **this is the one place the
   course-level % is computed client-side rather than trusted verbatim**,
   specifically so the report page can show a live number even before
   `data?.isCompleted` lands:

   ```299:322:src/app/(studentDashboard)/studentCourses/[courseId]/_components/Grades.tsx
   const grades = data?.data;
   const userDetails = data?.user;

   // Function to calculate sum of contributions
   function calculateTotalContribution(data: any) {
     let sum = 0;
     for (const module of data) {
       for (const chapter of module.chapters) {
         sum += parseFloat(chapter.contribution);
       }
     }
     return sum;
   }

   const courseProgress = grades?.length > 0 ? calculateTotalContribution(grades) : 0;
   const courseStartDate = getCourseStartDate(data);
   const courseCompletedAt = getCourseCompletedAt(data);
   const courseIsCompleted = data?.isCompleted === true || courseProgress === 100;
   ```

4. Quiz Correct / Quiz Attempts / Grade — `formatQuizCorrectForReport`,
   `formatQuizAttemptsForReport`, `formatQuizGradeForReport`
5. Section Attempts (interactive retries) — `formatChapterSectionAttemptsForReport`
   / `formatModuleSectionAttemptsForReport` — **explicitly a different counter
   from quiz attempts**; see § 7.

Admin viewing a student reuses the exact same component and endpoints
(`isAdminViewingStudent = Boolean(userId && viewerId && userId !== viewerId)`),
just swaps the assessment-attempt source from the student-facing endpoint to
`/course-assessment/admin/attempts` + `/admin/assessments`.

---

## 5. Sequential locking — how "you must finish X before Y" is enforced

Locking is **entirely client-derived** from the same completion booleans above
— there's no separate "is this unlocked" field from the backend. Each level
looks at whether the _previous sibling_ is complete:

- **Modules**: `isModuleDisabled = index > 0 ? !isModuleCompleted(previousModule) : false` (`CourseContent.tsx:91`)
- **Chapters**: `isDisabled = isModuleDisabled || (i > 0 ? !isChapterCompleted(previousChapter) : false)` (`CourseContent.tsx:172-179`)
- **Sections**: gated by the reading gate / interactive-check gate above, plus
  `allSectionsDone` before the chapter quiz becomes reachable
  (`SideBarAllSection.tsx:225-260`)

`freeRoam` (a QA/demo user allowlist, `src/utils/hooks/useFreeRoam.ts`) is
checked at every one of these sites and bypasses locking without touching the
underlying completion data — it's a display-only override, exactly like the
completion freeze is a display-only override, but for the opposite direction
(open everything vs. show everything as done).

Clicking a locked chapter opens `LockedContentModal` with a reason
(`quiz_pending` vs `section_incomplete`), computed at click time from the
previous chapter's state:

```264:267:src/app/(studentDashboard)/studentCourses/[courseId]/_components/CourseContent.tsx
                        const prev = arr?.[i - 1];
                        const lockReason = quizPending(prev)
                          ? { type: 'quiz_pending', previousChapterTitle: prev?.title }
                          : { type: 'section_incomplete', previousChapterTitle: prev?.title };
```

---

## 6. The completion freeze (why % doesn't always equal `completed/total`)

Full writeup: [`docs/course-progress-freeze-at-completion.md`](./course-progress-freeze-at-completion.md).
One-paragraph summary because it changes how you should read every `%` in this
doc:

> Once a learner has a `CourseCompletion.courseCompletedAt` row, the backend
> freezes every aggregate percentage it serves _to that learner_ at 100 and
> adds `isCompleted` / `completedAt` to the response. This exists because
> adding a chapter to a course after learners finished it used to silently
> drag already-certified learners below 100% (a real incident: 10 completers
> dropped to 95–98%). Per-section `isCompleted` flags are **not** frozen — they
> stay truthful so a newly-added section still shows as new/unopened for a
> completed learner, just without dragging the header percentage down.

The frontend's contribution to this fix is a single hook that ORs the three
places the freeze signal can arrive from (whichever response lands first):

```12:47:src/lib/course/useIsCourseCompleted.ts
export function useIsCourseCompleted(
  courseId: string,
  userId: string | undefined,
  fromAllSections?: boolean,
) {
  const { data: modulesPayload } = useApiGet<any, Error>({
    endpoint: `/courses/user/allModules/${courseId}`,
    ...
    select: (res: any) => ({ isCompleted: res?.data?.isCompleted === true }),
  });

  const { data: assignedCoursesResponse } = useApiGet<any, Error>({
    endpoint: `/courses/getAllAssignedCourses/${userId}`,
    ...
  });

  return useMemo(() => {
    const fromModules = modulesPayload?.isCompleted === true;
    const fromAssigned = Boolean(
      assignedCoursesResponse?.data?.find((c: any) => c.id === courseId)?.isCompleted,
    );
    return Boolean(fromAllSections || fromModules || fromAssigned);
  }, [fromAllSections, modulesPayload?.isCompleted, assignedCoursesResponse, courseId]);
}
```

`fromAllSections` is passed in by the lesson player from the sections
response's own top-level `isCompleted` (Site 5 in the freeze doc), so all
three sources get checked without three redundant network calls beyond what
the page already fetches.

**Explicitly out of scope for the freeze:** admin-facing telemetry (raw
counts) and in-progress (non-completed) learners — a learner mid-course still
sees their denominator grow if admin adds a chapter. The long-term fix for
that is course versioning (Pattern 1 in the freeze doc), tracked separately
in `docs/course-versioning-admin-fixes.md` / `docs/course-versioning-admin-features-spec.md`.

---

## 7. Time and attempt tracking (separate from completion, but shown alongside it)

Two independent, fire-and-forget tracking mechanisms feed the "Time spent" /
"Quiz Attempts" / "Section Attempts" columns in `Grades.tsx`:

### 7.1 Time spent — heartbeat

`useSectionHeartbeat(sectionId)` (`src/utils/hooks/useSectionHeartbeat.ts`)
pings `POST /tracking/heartbeat` every 5s while the section tab is visible and
the learner isn't idle (60s of no pointer/key/scroll input). It measures
active time with `performance.now()` deltas (never `Date.now()`, to survive
sleep/NTP jumps) and integrates at visibility/focus **boundaries** rather than
sampling on a timer, so tab-flicking or laptop sleep can't over- or
under-count. The server is the final authority — it clamps whatever the
client proposes against its own wall clock. Report display:
`formatTimeSpentSeconds` in `course-report-display.ts`.

### 7.2 Attempt count — section-attempt endpoint

`useSectionAttemptLogger(sectionId, sectionType, { isCompleted })`
(`src/utils/hooks/useSectionAttemptLogger.ts`) posts to
`POST /tracking/section-attempt` exactly once per "Check"/auto-verify action
on the four interactive section types, and **stops logging once
`isCompleted === true`** (count is frozen at first pass). `DEFAULT` sections
never call this endpoint at all — their report `totalAttempts` is `null`, not
`0`, and the UI renders that as `—`.

This is a **completely different counter** from chapter quiz attempts
(`quiz.attempts`, tracked server-side per quiz submission) — full contract in
[`docs/section-attempt-tracking-contract.md`](./section-attempt-tracking-contract.md).
Don't conflate "Quiz Attempts" and "Section Attempts" columns in `Grades.tsx`
— they're intentionally separate because a chapter can have interactive
sections _and_ a quiz, and each needs its own retry signal.

---

## 8. Known inconsistencies to be careful of

- **`_count` field casing differs by response.** The freeze doc's own Site 2
  writeup refers to `_count.userCourseProgress` (lowercase `u`), while Site 4
  (`getAllUserModules`, actually consumed in `CourseContent.tsx`) is
  `_count.UserCourseProgress` (uppercase `U`). Always check the actual payload
  in the network tab for a given endpoint rather than assuming casing.
- **"Has a quiz" is represented two different ways** depending on which
  endpoint you're reading: `_count.quizzes > 0` (studentCourses content tab,
  `getAllUserModules`) vs. `chapter.quizzes?.length > 0` (lesson player,
  `getAllUserSections`). Both are correct for their own endpoint — just don't
  copy one chapter's helper into the other page verbatim.
- **Legacy vs. flat quiz shape** in the report API: `getChapterQuizSummary`
  prefers `chapter.quiz` (new flat shape) and falls back to
  `chapter.QuizProgress[0]` + `_count.quizzes` (legacy) only if the flat shape
  is entirely absent. New code should read the flat shape and treat the legacy
  fallback as read-only compatibility, not something to extend.
- **Percentage is sometimes trusted, sometimes recomputed.** Course cards
  trust `percentage` verbatim (correct — it carries the freeze). The course
  report header recomputes it client-side by summing `contribution` across
  chapters (also correct, for a different reason — see § 4.8). If you add a
  new "overall %" surface, decide deliberately which pattern it needs; don't
  default to recomputation just because it's more visible in the codebase.
- **The percentage clamp does not protect the completion booleans.**
  `calculateProgress` clamps its _display_ output to `[0, 100]` (§ 4.2), but
  `isSectionsDone` (§ "Chapter level") does a raw, unclamped
  `done >= sections` comparison on the same two `_count` fields. If the
  numerator (`_count.UserCourseProgress`) ever counted progress the
  denominator (`_count.sections`) excludes — e.g. a learner had completed a
  section that was later archived — `done >= sections` could be true even
  though the learner hasn't finished all _live_ sections. That boolean feeds
  `isChapterCompleted` → `isModuleCompleted`, which gate whether the next
  chapter/module unlocks (§ 5). So the real failure mode of a numerator/
  denominator scope mismatch on this endpoint isn't a cosmetic ">100%"
  render — it's **premature unlocking**: a learner skipping live content
  because stale archived-section progress satisfied the gate early. Backend
  closed the specific numerator-scoping gap on `getAllAssignedCourses` /
  `getAllUserModules` in the "Third-round follow-up" of
  `course-versioning-admin-fixes.md`; if a similar gap ever resurfaces
  elsewhere, this is the mechanism to check for, not the percentage display.
- **Admin telemetry stays raw on purpose.** If you're building an admin
  view of a learner's progress and it looks like it disagrees with what the
  learner sees, check whether the learner is a certified completer — the
  discrepancy is very likely the freeze working as intended, not a bug.

---

## 9. File map

| Concern                                              | File                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Course report types + pure helpers                   | `src/lib/course/course-report.ts`                                                                                                                                                     |
| Report display/formatting helpers                    | `src/lib/course/course-report-display.ts`                                                                                                                                             |
| Completion freeze hook                               | `src/lib/course/useIsCourseCompleted.ts`                                                                                                                                              |
| Section ordering                                     | `src/lib/course/sortSectionsByOrderIndex.ts`                                                                                                                                          |
| Interactive section type list                        | `src/lib/course/interactive-section-types.ts`                                                                                                                                         |
| Time-spent tracking                                  | `src/utils/hooks/useSectionHeartbeat.ts`                                                                                                                                              |
| Attempt tracking                                     | `src/utils/hooks/useSectionAttemptLogger.ts`                                                                                                                                          |
| Free-roam bypass                                     | `src/utils/hooks/useFreeRoam.ts`                                                                                                                                                      |
| Course card                                          | `src/app/(studentDashboard)/studentCourses/_components/SingleCourse.tsx`                                                                                                              |
| Course content tab (module/chapter progress)         | `src/app/(studentDashboard)/studentCourses/[courseId]/_components/CourseContent.tsx`                                                                                                  |
| Grade/report page + PDF                              | `src/app/(studentDashboard)/studentCourses/[courseId]/_components/{Grades,PDFReport,ChapterSectionsBreakdown,ReportDetailGrid}.tsx`                                                   |
| Lesson player (section completion, quiz routing)     | `src/app/(coursePage)/studentNewCourse/[...slug]/page.tsx`                                                                                                                            |
| Lesson player sidebar (chapter header %, lock icons) | `src/app/(coursePage)/studentNewCourse/_components/SideBarAllSection.tsx`                                                                                                             |
| Chapter quiz taking page                             | `src/app/(coursePage)/studentNewCourse/quiz/[...slug]/page.tsx`                                                                                                                       |
| Course assessment summary (card + sidebar)           | `src/components/assessment/CourseAssessmentSummary.tsx`                                                                                                                               |
| Dashboard stats + progress chart                     | `src/app/(dashboard)/page.tsx`, `src/app/(dashboard)/_components/dashboard/CourseProgressGraph.tsx`                                                                                   |
| Related docs                                         | `docs/course-progress-freeze-at-completion.md`, `docs/section-attempt-tracking-contract.md`, `docs/course-versioning-admin-fixes.md`, `docs/course-versioning-admin-features-spec.md` |
