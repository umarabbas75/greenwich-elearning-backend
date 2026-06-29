# Section attempt tracking — API contract (backend)

**Status:** Backend implemented (2026-06-29). FE + BE aligned.

**Scope:** Aggregate retry count only — no per-attempt payload rows, no answer snapshots.

---

## 1. Problem

Interactive section types (`MATCH_AND_LEARN`, `VISUAL_ACTIVITY`, `ORDERING`, `MATCHING`) let learners **Check** or auto-verify answers before **Submit** marks the section complete. Today we track **time spent** (heartbeat) and **binary completion** (`UserCourseProgress`), but not **how many tries** it took.

Chapter quizzes already expose `quiz.attempts` on the course report. This feature mirrors that at **section** level with a single counter: `totalAttempts`.

---

## 2. What counts as one attempt

| Section type | When FE calls `POST /tracking/section-attempt` |
| ------------ | ---------------------------------------------- |
| `ORDERING` | Learner taps **Check order** |
| `VISUAL_ACTIVITY` | Learner taps **Check your answer** |
| `MATCH_AND_LEARN` | All items placed (auto-verify); one call per fill cycle |
| `MATCHING` | All dropdowns filled (auto-verify); one call per fill cycle |

**Rules:**

- **Submit** (mark section complete) does **not** add a separate attempt if Check / auto-verify already counted the successful try.
- **Reset** does not increment; the next Check / fill cycle does.
- **`DEFAULT`** sections: FE never calls this endpoint; report shows `—`.
- **After completion:** FE stops logging if `isCompleted === true` (count frozen at first pass).

**Body field `isCorrect`:** `true` when the verification passed, `false` when wrong. Stored for optional analytics; report only needs `totalAttempts` (count all tries, correct or not).

---

## 3. Endpoint

```
POST /api/v1/tracking/section-attempt
Authorization: Bearer <jwt>
Content-Type: application/json

{
  "sectionId": "<uuid>",
  "isCorrect": false
}
```

**Response (200):**

```json
{
  "message": "Section attempt recorded",
  "statusCode": 200,
  "data": {
    "totalAttempts": 3,
    "lastAttemptAt": "2026-06-29T18:57:00.000Z"
  }
}
```

- User from JWT — **never** accept `userId` in body.
- Resolve `sectionId` → chapter → module → course; reject if section missing or user not enrolled.
- **Only increment** for interactive section types listed above; return `400` for `DEFAULT` (or no-op with `totalAttempts: 0` — pick one and document).

**Idempotency:** Not required for v1. FE debounces rapid double-clicks with a short in-flight guard. Server should use atomic `UPDATE … SET totalAttempts = totalAttempts + 1`.

**Errors:** Same as heartbeat — FE swallows failures; `404`/`400` must not break the lesson UI.

---

## 4. Storage (recommended)

**Option A — extend existing progress (simplest):**

Add columns to a per-user-per-section row (new table or extend `section_time_spent`):

| Column | Type | Notes |
| ------ | ---- | ----- |
| `userId` | UUID | PK part |
| `sectionId` | UUID | PK part |
| `totalAttempts` | INT | default 0, increment on each POST |
| `firstAttemptAt` | TIMESTAMP | set on first increment |
| `lastAttemptAt` | TIMESTAMP | update each increment |

**Option B — separate aggregate table `section_activity_progress`:** same columns; join in report builder.

**Do not** add `section_activity_attempts` detail rows in v1.

**Course progress reset (admin):** zero `totalAttempts` for affected sections when learner progress is reset.

---

## 5. Course report API

Extend each object in `GET /courses/report/:courseId/:userId` → `data[].chapters[].sections[]`:

```json
{
  "id": "…",
  "title": "Formative Assessment 1.1",
  "type": "MATCH_AND_LEARN",
  "status": "completed",
  "completedAt": "2026-06-29T18:57:00.000Z",
  "timeSpentSeconds": 213,
  "totalAttempts": 4
}
```

Chapter and module roll-ups (sum of interactive section attempts in that scope):

```json
{
  "title": "Element 1",
  "timeSpentSeconds": 2100,
  "totalAttempts": 12,
  "quiz": { "attempts": 2 }
}
```

| Field | Type | Notes |
| ----- | ---- | ----- |
| `totalAttempts` (section) | `number \| null` | Omit or `null` for `DEFAULT`; `0` if never tried |
| `totalAttempts` (chapter / module) | `number` | Sum of interactive section attempts; quiz tries stay on `quiz.attempts` |

FE display: `formatSectionAttemptsForReport()` — interactive types show count, else `—`.

---

## 6. Frontend implementation (done)

| Piece | Location |
| ----- | -------- |
| Hook | `src/utils/hooks/useSectionAttemptLogger.ts` |
| Type guard | `src/lib/course/interactive-section-types.ts` |
| Lesson page wiring | `src/app/(coursePage)/studentNewCourse/[...slug]/page.tsx` |
| Activity callbacks | `onVerify` on ordering, visual, match-and-learn, matching components |
| Report UI | `ChapterSectionsBreakdown.tsx`, `PDFReport.tsx` |
| Types | `ReportSection.totalAttempts` in `course-report.ts` |

---

## 7. Parity with chapter quiz

| | Chapter quiz | Interactive section |
| --- | --- | --- |
| Entity | Chapter | Section |
| Counter | `quiz.attempts` | `sections[].totalAttempts` |
| Detail rows | `quiz_answers` | **Not in v1** |
| FE trigger | Submit quiz | Check / auto-verify |

---

## 8. Out of scope (v1)

- Quiz time per question / per chapter
- Server-side re-validation of ordering/matching answers
- Per-attempt JSON payload or answer history
- Attempt logging after section already completed (revisit / practice mode)

---

## 9. Test plan (backend)

1. POST with valid JWT + interactive `sectionId` → `totalAttempts` increments.
2. Second POST → `totalAttempts === 2`.
3. POST for `DEFAULT` section → 400 or no-op per chosen policy.
4. Report includes `totalAttempts` on section rows.
5. Admin reset progress → attempts zeroed for that user/section.
6. Unauthenticated POST → 401.
