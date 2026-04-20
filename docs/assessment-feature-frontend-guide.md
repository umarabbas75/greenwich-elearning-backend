# Assessment Feature — Frontend Integration Guide

> **Base URL**: `https://<your-api>/api/v1`
> **Auth**: All requests require `Authorization: Bearer <token>` header.
> **Admin token** = obtained from admin login. **Student token** = obtained from user login.

---

## Changelog

| Date | Changes |
|------|---------|
| 2026-04-04 | Initial release |
| 2026-04-04 | **BREAKING (pre-release)**: MATCHING `studentAnswer.rightId` now uses pair ID, not text. Added `categories[]` to MATCHING student-facing snapshot. See [Blocker 1](#blocker-1--matching-rightid-now-uses-pair-id) and [Blocker 2](#blocker-2--matching-categories-is-confirmed-and-shipped). Clarified isEligible logic, attempts[] shape, pagination, VISUAL_ACTIVITY answer format, notification routing. |
| 2026-04-08 | Added **[How the assessment feature works](#how-the-assessment-feature-works-architecture--behaviour)** (architecture, gates, bookmarked URLs, submit validation). Aligned finalize rules and UI notes with current backend. |
| 2026-04-15 | **Timer enforcement**: `timeLimitMinutes` is snapshotted as `snapshotTimeLimitMin` per attempt; backend enforces deadline + **60s grace** on submit; new status **`EXPIRED`** for attempts never submitted after the window; responses include computed **`timeInfo`** (see [Assessment timer](#assessment-timer-server--student-ui)). |

---

## How the assessment feature works (architecture & behaviour)

This section is the **high-level backend story** for product and frontend. Everything below still applies; the rest of the document is the **API cookbook**.

### What it is for

The assessment feature is the **formal end-of-course exam** for a **course**: a **question bank** (reusable questions), one or more **assessment** definitions per course, **student attempts** with **immutable question snapshots**, optional **admin grading** for written questions, and a **course completion** record that can point at the learner’s best attempt and certificate URL.

It is **separate** from: lesson sections, chapter quizzes (`Quiz` / `QuizProgress`), and assignments.

### Main database concepts

| Concept | Role |
|--------|------|
| **QuestionCategory** | Groups questions within a **course** (e.g. “Risk assessment”). Unique per `(courseId, name)`. |
| **Question** | A single bank item: `type`, `text`, `content` JSON (options, correct answers, etc.), `maxMarks`, `difficulty`, `isActive`. |
| **Assessment** | Exam paper for a **course**: title, `mode` (**MANUAL** or **AUTOMATIC**), `passingPercentage`, optional `maxAttempts` (`null` = unlimited), optional `timeLimitMinutes` (`null` = **no** time limit; when set, see [Assessment timer](#assessment-timer-server--student-ui)), `isActive`. |
| **AssessmentQuestion** | **MANUAL mode only**: ordered list of which bank questions appear, with optional `marksOverride`. |
| **AUTOMATIC mode** | No roster table for the admin pick-list; at **start attempt** the server builds a paper from `autoConfig` (counts per category / difficulty + `totalQuestions`) by drawing from active questions in the bank. |
| **AssessmentAttempt** | One **sitting** of the exam for one student: `status`, scores, timestamps. Settings at creation are **snapshotted** (`snapshotPassingPct`, etc.) so later edits to the assessment do not change old attempts. |
| **AttemptQuestionSnapshot** | Frozen copy of each question as shown in that attempt (`questionContent` **includes** correct answers for grading). Holds `studentAnswer`, auto `systemScore`, optional `adminScore` / `finalScore`, feedback. |
| **CourseCompletion** | One row per `(userId, courseId)`; links optional `bestAttemptId`, certificate URL, pass timestamps. Updated when an attempt is **finalized** (see below). |

**Why snapshots?** Once an attempt starts, question text and correct answers are fixed for that attempt even if an admin edits or deactivates the bank question later.

### Assessment modes (MANUAL vs AUTOMATIC)

- **MANUAL** — Admin attaches specific bank questions in order (`AssessmentQuestion`). Everyone who starts an attempt gets **that ordered set** (unless questions were removed from the roster before the attempt).
- **AUTOMATIC** — Admin configures `autoConfig` (`totalQuestions`, `byCategory`, `byDifficulty`). Each **new** attempt may get a **different random subset** from the bank (subject to pool size checks at start). **Do not cache** question lists between users or between attempts.

### Who can start an attempt (student gates)

When `POST /course-assessment/student/attempts/start` runs, the server checks, in order:

1. **Assessment exists** and **`isActive`**.
2. **Enrollment** — `UserCourse` for `(userId, courseId)` with `isActive: true`.
3. **Course content done** — count of `UserCourseProgress` rows for that user and course is **≥** total count of **sections** in the course (all modules/chapters). This is the same rule as `isEligible` on the list endpoint.
4. **Attempt budget** — number of existing attempts for this assessment is **&lt;** `maxAttempts` when `maxAttempts` is not `null`.
5. **No duplicate in-flight attempt** — there must be **no** row with `status = IN_PROGRESS` for this user + assessment.

The list endpoint `GET .../student/assessments/:courseId` pre-computes **`canStart`**, **`remainingAttempts`**, and **`inProgressAttemptId`** so the UI can disable “Start” without guessing.

### Assessment timer (server + student UI)

- **`timeLimitMinutes` on the assessment** is copied to **`snapshotTimeLimitMin`** on the attempt when it starts. If it is **`null`**, there is **no timer** (same as unlimited time).
- The **frontend** should run a **visible countdown** and call **`POST .../attempts/:id/submit`** when the countdown reaches **zero** (send whatever answers are filled in).
- The **backend** rejects submit when `now > startedAt + snapshotTimeLimitMin × 60s + 60s grace`. The grace period is a **fixed server constant** (60 seconds), not configurable per assessment.
- Attempts that were **never submitted** and are past that window become **`EXPIRED`** (see state machine). Expiry is applied **on demand** when the student list, resume, or admin detail is loaded — there is **no cron job**.
- **`timeInfo`** on **`startAttempt`** and **`GET .../attempts/:id`** gives server-derived fields so the UI can seed a countdown without trusting only the client clock:
  - `timeLimitSeconds`, `startedAtMs`, `deadlineMs`, `remainingSeconds` (floored, ≥ 0), `graceSeconds` (always `60` when `timeInfo` is present).
- List responses (`attempts[]`) include **`snapshotTimeLimitMin`**, per-row **`timeInfo`** when `status === IN_PROGRESS` and a limit exists, and **`isExpired`** when `status === EXPIRED`.

### Attempt status (what happens after submit)

See [§2 Attempt Status State Machine](#2-attempt-status-state-machine). In short:

- **Submit** sends **all answers in one request** (no per-question save API).
- If every scored question is auto-gradeable → **`AUTO_GRADED`** immediately with marks.
- If any included answer needs human marking (short/long text) → **`SUBMITTED`**.
- Admin uses **`PATCH .../grade`** → **`GRADED`** (preview).
- **`POST .../finalize`** → **`FINALIZED`** and student notification; also drives **course completion** bookkeeping.

**Finalize** may be called when the attempt is **`SUBMITTED`**, **`AUTO_GRADED`**, or **`GRADED`** (the service recalculates totals from snapshots).

### Submit payload rule (important)

`SubmitAttemptDto` requires **`answers` to be a non-empty array** (`ArrayMinSize(1)`). Each element is `{ snapshotId, studentAnswer }`. Snapshots **not** listed in `answers` are treated as unanswered (0 marks) — but you must still send **at least one** snapshot entry to pass validation.

### Bookmarked URLs / coming back later

- A completed attempt is **not** `IN_PROGRESS`. Calling **`POST .../attempts/:id/submit` again** on that id fails with **“This attempt is not in progress”** (or a **time expired** message if the attempt was marked **`EXPIRED`**).
- Opening a saved URL does **not** by itself create a new attempt. If the app calls **`startAttempt`** again, the backend may create a **new** attempt **only if** `maxAttempts` allows it (`null` = unlimited). Otherwise the student gets **“Maximum attempts (N) reached”**.
- If they abandoned mid-exam and the **time limit + grace** has passed, the next load of the list or **`GET .../attempts/:id`** marks the attempt **`EXPIRED`**. **`startAttempt`** can then succeed again (subject to **`maxAttempts`**). While still within the window, **`IN_PROGRESS`** still blocks **`startAttempt`** until they **submit** or time runs out.

### Out of scope / not enforced in backend today

- **Pagination** on admin/student list endpoints — full lists.
- **Per-question autosave** — only full submit.

---

## Responses to Frontend Feedback

### 🔴 Blocker 1 — MATCHING: rightId now uses pair ID

**Fixed in backend.** The `studentAnswer.rightId` field now uses the **pair's `id`**, not the text string.

Each pair in the `content` object has a unique `id` that identifies both the left item and its correct right item:

```json
// content (admin creates)
{
  "pairs": [
    { "id": "p1", "left": "Integration of safety systems", "right": "Strong and active leadership" },
    { "id": "p2", "left": "Effective upward communication", "right": "Worker involvement" },
    { "id": "p3", "left": "Accessing competent advice", "right": "Assessment and review" }
  ]
}
```

The student sees (after stripping):
```json
{
  "pairs": [{ "id": "p1", "left": "Integration of safety systems" }, ...],
  "categories": [
    { "id": "p2", "text": "Worker involvement" },        // shuffled
    { "id": "p1", "text": "Strong and active leadership" },
    { "id": "p3", "text": "Assessment and review" }
  ]
}
```

Student submits:
```json
// studentAnswer — rightId is the pair ID of the category they matched to
{
  "pairs": [
    { "leftId": "p1", "rightId": "p1" },   // correct
    { "leftId": "p2", "rightId": "p3" },   // wrong
    { "leftId": "p3", "rightId": "p2" }    // wrong
  ]
}
```

**Scoring**: a match is correct when `leftId === rightId`. Partial marks apply.

---

### 🔴 Blocker 2 — MATCHING: categories[] is confirmed and shipped

**Fixed in backend.** The student-facing `questionContent` for MATCHING now always includes a `categories` array alongside the stripped `pairs`. The categories are **shuffled on every request** so the correct order is never implied.

```json
// What student receives in questionSnapshot.questionContent:
{
  "pairs": [
    { "id": "p1", "left": "Integration of safety systems" },
    { "id": "p2", "left": "Effective upward communication" },
    { "id": "p3", "left": "Accessing competent advice" }
  ],
  "categories": [
    { "id": "p3", "text": "Assessment and review" },      // shuffled
    { "id": "p1", "text": "Strong and active leadership" },
    { "id": "p2", "text": "Worker involvement" }
  ]
}
```

Render left `pairs` on one side, render `categories` on the other side. Student drags/selects a `category.id` as the `rightId` for each left item.

---

### 🟡 Issue 3 — Resume: attempts[] shape confirmed

`GET /student/assessments/:courseId` returns `attempts[]` with this shape per item:

```json
{
  "id": "attempt-uuid",
  "status": "IN_PROGRESS",
  "startedAt": "2026-04-04T...",
  "submittedAt": null,
  "finalizedAt": null,
  "marksObtained": null,
  "totalMarks": 60,
  "percentage": null,
  "isPassed": null,
  "snapshotTimeLimitMin": 90,
  "isExpired": false,
  "timeInfo": {
    "timeLimitSeconds": 5400,
    "startedAtMs": 1712236800000,
    "deadlineMs": 1712242200000,
    "remainingSeconds": 1200,
    "graceSeconds": 60
  }
}
```

`status` may be `IN_PROGRESS | SUBMITTED | AUTO_GRADED | GRADED | FINALIZED | EXPIRED`. **`timeInfo`** is **`null`** unless `status === IN_PROGRESS` and `snapshotTimeLimitMin` is set. **`isExpired`** is **`true`** when `status === EXPIRED` (no resume).

**Resume flow**: find the item where `status === "IN_PROGRESS"`, take its `id`, then call `GET /student/attempts/:id` to load the full attempt with all snapshots. Use **`timeInfo.remainingSeconds`** from either the list row or **`GET`** response to drive the countdown.

---

### 🟡 Issue 4 — ASSESSMENT_GRADED: resolving courseId

The notification payload contains `referenceId = attemptId`. To deep-link the student back to their course assessment:

Call `GET /course-assessment/student/attempts/:attemptId` — the response includes the attempt object which contains `assessmentId`. From the assessment you can resolve `courseId`. However this is two calls.

**Simpler option we recommend**: extract `courseId` from wherever the student is already navigating (they're logged in, their enrolled courses are loaded). Use the `referenceId` (attemptId) to call `GET /student/attempts/:id` which returns enough data to link to the right page.

There is **no server-side metadata field** on the notification beyond `referenceId`. If you need zero extra calls, let us know and we will add a `metadata Json?` column to Notification in a follow-up migration.

---

### 🟡 Issue 5 — isEligible: exact definition

`isEligible: true` when the count of `UserCourseProgress` rows for `(userId, courseId)` is **≥ the total number of `Section` records** in that course (across all modules and chapters).

In other words: every section must appear in the student's progress table at least once. There is no percentage threshold — it is all-or-nothing.

**For the "X more chapters to unlock" message**: you can calculate it yourself using:
- Total sections: available from `GET /courses/:id` (section count per chapter)
- Completed sections: your app already tracks this via the existing progress API

We do not currently expose a `completedSectionCount` / `totalSectionCount` in the assessment response. If you want that added to the `GET /student/assessments/:courseId` response, raise a follow-up ticket.

---

### 🟡 Issue 6 — VISUAL_ACTIVITY single-select answer format

**Always use `selectedOptionIds` (array)** regardless of `allowMultiple`. This keeps the answer format consistent and avoids branching logic on your side.

```json
// allowMultiple: false — single correct answer
{ "selectedOptionIds": ["b"] }

// allowMultiple: true — multiple correct answers
{ "selectedOptionIds": ["a", "c"] }
```

The backend handles scoring correctly for both cases when given an array.

---

### 🟡 Issue 7 — Pagination

**No pagination in this release.** All list endpoints (`GET /admin/questions`, `GET /admin/assessments`, `GET /admin/attempts`) return the full result set. There are no `page`, `limit`, `total`, or cursor params.

If question banks grow large, we will add `?page=1&limit=50` in a follow-up. For now, render the full list.

---

### 🟢 Suggestion 8 — PATCH confirmed

Both `PATCH /admin/attempts/:id/grade` and `PATCH /admin/assessments/:id/questions/reorder` are **PATCH** (partial update). No PUT endpoints exist in this feature.

---

### 🟢 Suggestion 9 — Admin notification routing

There is **no expected URL pattern from the backend**. The `referenceId` in the notification is an `attemptId`. Route the admin however your app is structured — `/assessment/grade/:attemptId` is fine.

---

## Table of Contents

0. [How the assessment feature works (architecture & behaviour)](#how-the-assessment-feature-works-architecture--behaviour)
1. [Question Types Reference](#1-question-types-reference)
2. [Attempt Status State Machine](#2-attempt-status-state-machine)
3. [Admin Flows](#3-admin-flows)
   - [Question Bank](#31-question-bank)
   - [Assessment Management](#32-assessment-management)
   - [Grading](#33-grading)
4. [Student Flows](#4-student-flows)
5. [Notification Integration](#5-notification-integration)
6. [Important UI Rules](#6-important-ui-rules)

---

## 1. Question Types Reference

There are **9 question types**. Each type has a specific `content` structure (sent by admin when creating a question) and a `studentAnswer` structure (sent by student when answering).

### SINGLE_CHOICE
Admin selects exactly one correct answer from options.
```json
// content (admin creates)
{
  "options": [
    { "id": "a", "text": "Option A" },
    { "id": "b", "text": "Option B" },
    { "id": "c", "text": "Option C" }
  ],
  "correctOptionId": "b"
}

// studentAnswer
{ "selectedOptionId": "b" }
```
**UI**: Radio buttons. **Auto-graded**: full marks or 0.

---

### MULTIPLE_CHOICE
Multiple correct answers possible.
```json
// content
{
  "options": [
    { "id": "a", "text": "Option A" },
    { "id": "b", "text": "Option B" },
    { "id": "c", "text": "Option C" }
  ],
  "correctOptionIds": ["a", "c"]
}

// studentAnswer
{ "selectedOptionIds": ["a", "b"] }
```
**UI**: Checkboxes. **Auto-graded**: Jaccard similarity score (partial marks possible).

---

### TRUE_FALSE
```json
// content
{ "correctAnswer": true }

// studentAnswer
{ "answer": true }
```
**UI**: True / False toggle or radio. **Auto-graded**: full marks or 0.

---

### FILL_IN_THE_BLANK
Student picks one word from a given word bank.
```json
// content
{
  "sentence": "Reducing the likelihood of fines are ___ reasons to manage safely.",
  "wordBank": ["financial", "moral", "legal"],
  "correctAnswer": "financial"
}

// studentAnswer
{ "selectedWord": "financial" }
```
**UI**: Display the sentence with a blank; show the word bank as buttons/chips. **Auto-graded**: case-insensitive match.

---

### SHORT_ANSWER
Student types a short written response. Admin grades manually.
```json
// content — empty, no answer key
{}

// studentAnswer
{ "text": "A manager can delegate responsibility but not accountability." }
```
**UI**: Single-line text input. **Manually graded by admin**.

---

### LONG_ANSWER
Extended written response. Admin grades manually.
```json
// content — empty
{}

// studentAnswer
{ "text": "Detailed explanation here..." }
```
**UI**: Textarea. **Manually graded by admin**.

---

### ORDERING
Student arranges items in the correct order.
```json
// content
{
  "items": [
    { "id": "1", "text": "Make sure the injured person is looked after" },
    { "id": "2", "text": "Preserve the scene of the accident" },
    { "id": "3", "text": "Report the accident" },
    { "id": "4", "text": "Assemble the investigation team" }
  ],
  "correctOrder": ["1", "2", "3", "4"]
}

// studentAnswer
{ "orderedIds": ["2", "1", "3", "4"] }
```
**UI**: Drag-and-drop list. **Auto-graded**: positional match, partial marks.

---

### MATCHING
Student matches left-side items to right-side categories. Both sides are identified by pair ID.

```json
// content (admin creates)
{
  "pairs": [
    { "id": "p1", "left": "Integration of safety systems", "right": "Strong and active leadership" },
    { "id": "p2", "left": "Effective upward communication", "right": "Worker involvement" },
    { "id": "p3", "left": "Accessing competent advice", "right": "Assessment and review" }
  ]
}

// studentAnswer — rightId is the pair ID of the category they selected
{
  "pairs": [
    { "leftId": "p1", "rightId": "p1" },
    { "leftId": "p2", "rightId": "p2" },
    { "leftId": "p3", "rightId": "p3" }
  ]
}
```
**UI**: Two columns — drag from left to match with right, or use dropdowns. **Auto-graded**: correct when `leftId === rightId`, partial marks.

**What student receives in the snapshot** (`right` is stripped, `categories` is added and shuffled):
```json
{
  "pairs": [
    { "id": "p1", "left": "Integration of safety systems" },
    { "id": "p2", "left": "Effective upward communication" },
    { "id": "p3", "left": "Accessing competent advice" }
  ],
  "categories": [
    { "id": "p3", "text": "Assessment and review" },
    { "id": "p1", "text": "Strong and active leadership" },
    { "id": "p2", "text": "Worker involvement" }
  ]
}
```
Render `pairs` on the left, `categories` (shuffled) on the right. Student submits `rightId` = the `id` of the category they matched.

---

### VISUAL_ACTIVITY
An image with clickable option buttons (single or multiple correct).
```json
// content
{
  "imageUrl": "https://storage.example.com/diagram.png",
  "options": [
    { "id": "a", "text": "Policy" },
    { "id": "b", "text": "Planning" },
    { "id": "c", "text": "Leadership" }
  ],
  "allowMultiple": false
}

// studentAnswer — always an array, even for single-select
{ "selectedOptionIds": ["b"] }
```
**UI**: Display image; show options as buttons below. **Auto-graded**: same as SINGLE_CHOICE or MULTIPLE_CHOICE based on `allowMultiple`.

> Always send `selectedOptionIds` as an **array** regardless of `allowMultiple`. Single-select: array with one item. Multi-select: array with multiple items.

> ⚠️ `isCorrect` is stripped from options before sending to student. Only `{ id, text }` is returned per option.

---

## 2. Attempt Status State Machine

```
                ┌─────────────┐
                │  IN_PROGRESS │  ← student starts attempt
                └──────┬──────┘
         never submitted + past time limit + grace
                       ▼
                ┌─────────────┐
                │   EXPIRED   │  ← not submitted in time (on-demand expiry on read)
                └─────────────┘

                ┌─────────────┐
                │  IN_PROGRESS │
                └──────┬──────┘
                       │ student submits (within deadline + grace)
                       ▼
          ┌────────────────────────┐
          │                        │
          ▼                        ▼
   ┌────────────┐         ┌──────────────┐
   │ AUTO_GRADED│         │  SUBMITTED   │  ← has manual questions
   │ (all auto) │         └──────┬───────┘
   └─────┬──────┘                │ admin grades + finalizes
         │                       ▼
         │                ┌────────────┐
         │                │   GRADED   │  ← admin saved scores (preview)
         │                └─────┬──────┘
         │                      │ admin clicks "Finalize"
         └──────────┬───────────┘
                    ▼
             ┌────────────┐
             │  FINALIZED │  ← student can see final result
             └────────────┘
```

**Key rules for frontend**:
- `IN_PROGRESS` → show the assessment quiz UI; run countdown from **`timeInfo.remainingSeconds`**
- `EXPIRED` → show “This attempt expired”; **no** resume; grey out in history lists
- `SUBMITTED` → show "Waiting for admin to grade" message
- `AUTO_GRADED` → show results immediately (all questions were auto-gradeable)
- `GRADED` → admin-only state, means admin is reviewing
- `FINALIZED` → show full results to student (scores, feedback, pass/fail)

---

## 3. Admin Flows

### 3.1 Question Bank

#### Create a Category
```
POST /course-assessment/admin/questions/categories
Auth: Admin token

Body:
{
  "courseId": "uuid",
  "name": "Risk Assessment"
}

Response: { message, statusCode, data: { id, name, courseId, ... } }
```

#### List Categories for a Course
```
GET /course-assessment/admin/questions/categories/:courseId
Auth: Admin token
```

#### Update Category
```
PATCH /course-assessment/admin/questions/categories/:id
Body: { "name": "Updated Name" }
```

#### Delete Category
```
DELETE /course-assessment/admin/questions/categories/:id
⚠️ Fails if the category has active questions. Deactivate questions first.
```

---

#### Create a Question
```
POST /course-assessment/admin/questions
Auth: Admin token

Body:
{
  "courseId": "uuid",
  "categoryId": "uuid",
  "type": "SINGLE_CHOICE",            // see QuestionType enum
  "difficulty": "MEDIUM",             // EASY | MEDIUM | HARD
  "text": "What is meant by hazard?",
  "imageUrl": "https://...",          // optional
  "content": { ... },                 // see section 1 for shapes
  "maxMarks": 2
}
```

#### List Questions (with filters)
```
GET /course-assessment/admin/questions?courseId=uuid&categoryId=uuid&difficulty=EASY&type=SINGLE_CHOICE&isActive=true
```

#### Update Question
```
PATCH /course-assessment/admin/questions/:id
Body: any subset of { categoryId, type, difficulty, text, imageUrl, content, maxMarks, isActive }
```

#### Deactivate or Permanently Delete a Question
```
DELETE /course-assessment/admin/questions/:id
DELETE /course-assessment/admin/questions/:id?permanent=true

Without ?permanent=true  → Soft delete: sets isActive=false. Question stays in the DB,
                           existing attempts referencing it are unaffected.
                           Removed from inactive assessment rosters automatically.

With ?permanent=true     → Hard delete: removes the row from the database entirely.
                           ⚠️ Blocked if the question has been used in any student attempt
                           (even a partial one). In that case deactivate instead.
                           Also removes it from all assessment rosters first.
```

**UI recommendation**: show a "Deactivate" button by default. Only show "Permanently Delete" in a confirmation dialog with a warning.

---

### 3.2 Assessment Management

#### Create Assessment
```
POST /course-assessment/admin/assessments
Auth: Admin token

// MANUAL mode — admin will pick questions manually
{
  "courseId": "uuid",
  "title": "Managing Safely – Assessment 1",
  "description": "End of course assessment",
  "mode": "MANUAL",
  "passingPercentage": 60,
  "timeLimitMinutes": 90,       // optional — shown to student, not enforced
  "maxAttempts": 3              // optional — null = unlimited
}

// AUTOMATIC mode — system picks questions from bank
{
  "courseId": "uuid",
  "title": "Managing Safely – Assessment 1",
  "mode": "AUTOMATIC",
  "passingPercentage": 60,
  "maxAttempts": 2,
  "autoConfig": {
    "totalQuestions": 30,
    "byCategory": [
      { "categoryId": "uuid1", "count": 10 },
      { "categoryId": "uuid2", "count": 10 },
      { "categoryId": "uuid3", "count": 10 }
    ],
    "byDifficulty": [
      { "difficulty": "EASY", "count": 10 },
      { "difficulty": "MEDIUM", "count": 10 },
      { "difficulty": "HARD", "count": 10 }
    ]
  }
}
```

> ⚠️ A new assessment is created as **inactive** (draft). You must activate it separately.

#### List Assessments for a Course
```
GET /course-assessment/admin/assessments?courseId=uuid
Returns all assessments with attempt counts and active status.
```

#### Get Single Assessment
```
GET /course-assessment/admin/assessments/:id
Returns full detail including question list (MANUAL mode) and attempt statistics.
```

#### Update Assessment
```
PATCH /course-assessment/admin/assessments/:id
Body: any subset of { title, description, passingPercentage, timeLimitMinutes, maxAttempts, autoConfig }
```

#### Activate Assessment
```
POST /course-assessment/admin/assessments/:id/activate
⚠️ Atomically deactivates all other assessments for this course and activates this one.
⚠️ MANUAL mode: must have at least 1 question added first.
```

#### Deactivate Assessment
```
POST /course-assessment/admin/assessments/:id/deactivate
Students with IN_PROGRESS attempts are not affected (their snapshot is already captured).
```

---

#### Add Question to Manual Assessment
```
POST /course-assessment/admin/assessments/:id/questions
Body:
{
  "questionId": "uuid",
  "orderIndex": 1,        // optional
  "marksOverride": 3      // optional — overrides the question's default maxMarks
}
```

#### Remove Question from Assessment
```
DELETE /course-assessment/admin/assessments/:assessmentId/questions/:questionId
⚠️ Blocked if the assessment has FINALIZED attempts.
```

#### Reorder Questions
```
PATCH /course-assessment/admin/assessments/:id/questions/reorder
Body:
{
  "questions": [
    { "questionId": "uuid1", "orderIndex": 0 },
    { "questionId": "uuid2", "orderIndex": 1 }
  ]
}
```

---

### 3.3 Grading

#### List All Attempts for a Course
```
GET /course-assessment/admin/attempts?courseId=uuid&status=SUBMITTED&userId=uuid
Auth: Admin token

Filters (all optional):
- status: IN_PROGRESS | SUBMITTED | AUTO_GRADED | GRADED | FINALIZED | EXPIRED
- userId: filter by a specific student

Returns attempt list with student info and score summaries.
```

#### Get Attempt Detail (with all answers)
```
GET /course-assessment/admin/attempts/:id
Returns full attempt including all question snapshots, student answers, and current scores.
Admin sees the correct answers (questionContent is NOT stripped for admin).
```

#### Save Grades (per question, not final)
```
PATCH /course-assessment/admin/attempts/:id/grade
Body:
{
  "scores": [
    {
      "snapshotId": "uuid",
      "adminScore": 1.5,
      "adminFeedback": "Good answer but missed one point"
    },
    {
      "snapshotId": "uuid2",
      "adminScore": 0
    }
  ]
}

- adminScore must be <= maxMarks for that question
- This is NOT final — admin can call this endpoint multiple times
- Returns a preview of total marks and percentage
```

#### Finalize Grade (publishes result to student)
```
POST /course-assessment/admin/attempts/:id/finalize
Auth: Admin token
```

- Allowed when attempt status is **`SUBMITTED`**, **`AUTO_GRADED`**, or **`GRADED`** (not `IN_PROGRESS`).
- Sets `finalScore = adminScore ?? systemScore` for each snapshot.
- Calculates final `marksObtained`, `percentage`, and `isPassed` vs `snapshotPassingPct`.
- Updates **`CourseCompletion`** (best-attempt pointer and timestamps).
- Sends **`ASSESSMENT_GRADED`** notification to the student.
- Attempt **`status`** becomes **`FINALIZED`**.
- Admin can call **`PATCH .../grade`** again after finalize to correct mistakes, then **`POST .../finalize`** again.

#### Set Certificate URL
```
POST /course-assessment/admin/attempts/:attemptId/certificate?userId=uuid&courseId=uuid
Body: { "certificateUrl": "https://storage.example.com/cert-123.pdf" }
```

---

## 4. Student Flows

### Check Assessment Availability
```
GET /course-assessment/student/assessments/:courseId
Auth: Student token

Response:
{
  "data": [
    {
      "assessment": {
        "id": "uuid",
        "title": "Managing Safely – Assessment 1",
        "passingPercentage": 60,
        "timeLimitMinutes": 90,
        "maxAttempts": 3
      },
      "isEligible": true,           // false if course content not yet completed
      "remainingAttempts": 2,       // null = unlimited
      "canStart": true,             // false if not eligible, maxAttempts reached, or IN_PROGRESS exists
      "inProgressAttemptId": null,  // set if student has an active attempt for this assessment
      "attempts": [...]             // past attempt summaries
    },
    ...                             // additional active assessments for the same course
  ]
}
```

**Frontend logic**:
- If `data.length === 0` → no active assessments for this course
- For each assessment entry:
  - If `isEligible === false` → show "Complete the course first"
  - If `inProgressAttemptId` is set → show "Resume" button linking to that attempt (use **`timeInfo`** on the matching **`attempts[]`** row for “X min left” if needed)
  - In **`attempts[]`**, if **`isExpired`** → show “This attempt expired” (no resume)
  - If `canStart === false && remainingAttempts === 0` → show "No more attempts available"
  - If `canStart === true` → show "Start Assessment" button

---

### Start an Attempt
```
POST /course-assessment/student/attempts/start
Auth: Student token

Body: { "assessmentId": "uuid" }   ⚠️ Changed: was courseId, now assessmentId

Response: {
  "data": {
    "id": "attempt-uuid",
    "status": "IN_PROGRESS",
    "snapshotTitle": "...",
    "snapshotPassingPct": 60,
    "timeInfo": {
      "timeLimitSeconds": 5400,
      "startedAtMs": 1712236800000,
      "deadlineMs": 1712242200000,
      "remainingSeconds": 5380,
      "graceSeconds": 60
    },
    "totalMarks": 60,
    "questionSnapshots": [
      {
        "id": "snapshot-uuid",
        "orderIndex": 0,
        "questionType": "SINGLE_CHOICE",
        "questionText": "What is a hazard?",
        "questionImageUrl": null,
        "questionContent": {
          "options": [{ "id": "a", "text": "..." }, ...]
          // ⚠️ correctOptionId is REMOVED — student cannot see correct answer
        },
        "maxMarks": 2,
        "isAnswered": false,
        "isLocked": false,
        "studentAnswer": null
      },
      ...
    ]
  }
}
```

`timeInfo` is **`null`** when the assessment has no time limit (`snapshotTimeLimitMin` null).

---

### Resume an In-Progress Attempt
```
GET /course-assessment/student/attempts/:id
Auth: Student token

Same response shape as start (attempt fields + `questionSnapshots` + `timeInfo`). Correct answers are still hidden.
```

---

### Submit Assessment (with all answers)
```
POST /course-assessment/student/attempts/:id/submit
Auth: Student token

Body:
{
  "answers": [
    { "snapshotId": "snapshot-uuid-1", "studentAnswer": { "selectedOptionId": "b" } },
    { "snapshotId": "snapshot-uuid-2", "studentAnswer": { "answer": true } },
    { "snapshotId": "snapshot-uuid-3", "studentAnswer": { "text": "My short answer here" } }
  ]
}

- All answers are submitted in one request — there is no mid-attempt save
- The `answers` array must contain **at least one** `{ snapshotId, studentAnswer }` entry (API validation). Include one entry per question you want to score; omitting a snapshot leaves that question unanswered (0 marks).
- `studentAnswer` shape depends on `questionType` (see Section 1 — Question Types reference)
- If all questions are auto-gradeable → status becomes AUTO_GRADED, results shown immediately
- If any answered question is SHORT_ANSWER or LONG_ANSWER → status becomes SUBMITTED, waiting for admin

**Timer behaviour**:
- When the visible countdown reaches **0**, call **`POST .../submit` immediately** with whatever answers the student entered; show a message such as “Time is up — submitting your answers”.
- If the server responds with **HTTP 400** and a message like **“Time limit exceeded…”**, show that the attempt could not be submitted in time (e.g. network failure after the grace window). If the attempt was already marked **`EXPIRED`** (e.g. another tab loaded first), submit may return **400** with wording that the attempt can no longer be submitted.
```

**After submit, check `data.status`**:
- `AUTO_GRADED` → show score, percentage, isPassed immediately
- `SUBMITTED` → show "Your assessment is being reviewed by an instructor"

---

### View Attempt History
```
GET /course-assessment/student/attempts?courseId=uuid
Auth: Student token

Returns all attempts with scores. For FINALIZED attempts, shows finalScore and adminFeedback per question.
```

---

### View Completion Record (Certificate)
```
GET /course-assessment/student/completion/:courseId
Auth: Student token

Response:
{
  "data": {
    "isPassed": true,
    "assessmentPassedAt": "2026-04-04T...",
    "certificateUrl": "https://storage.example.com/cert.pdf",
    "bestAttempt": {
      "id": "uuid",
      "percentage": 85,
      "isPassed": true
    }
  }
}
```

---

## 5. Notification Integration

Assessment notifications use the **existing** `GET /api/v1/notifications` endpoint. The response now includes `type` and `referenceId` fields:

```json
{
  "id": "uuid",
  "userId": "...",
  "threadId": null,
  "type": "ASSESSMENT_SUBMITTED",   // or ASSESSMENT_GRADED
  "referenceId": "attempt-uuid",    // the attemptId
  "message": "A student has submitted the assessment: Managing Safely – Assessment 1",
  "isRead": false,
  "thread": null
}
```

**Frontend logic**:
- If `type === "ASSESSMENT_SUBMITTED"` → admin notification, link to `/admin/attempts/:referenceId`
- If `type === "ASSESSMENT_GRADED"` → student notification, link to `/student/attempts/:referenceId`
- If `type === "FORUM_COMMENT"` or `"FORUM_THREAD"` → existing forum behavior (thread is not null)

---

## 6. Important UI Rules

| Rule | Detail |
|------|--------|
| **Correct answers hidden from student** | `correctOptionId`, `correctOptionIds`, `correctAnswer`, `correctOrder`, `isCorrect` are stripped from all student-facing responses. Never shown until FINALIZED. |
| **Locked questions** | Once `isLocked=true`, the answer UI must be disabled. Backend will reject re-answers. |
| **Assessment lock** | Prefer the API’s **`canStart`** flag (it bundles eligibility, attempt limit, and in-progress state). Roughly: need `isEligible`, no `inProgressAttemptId`, and remaining attempts if capped. |
| **Active assessments** | **Activating** an assessment (`POST .../activate`) deactivates other assessments for that course. The student list returns **all** `isActive` assessments for the course (usually **one**; handle an array). |
| **AUTOMATIC mode** | Each student gets a unique question set. Do not cache or reuse the question list between users. |
| **Time limit** | `timeLimitMinutes` is **informational only** — show it to the student as "Estimated time: X minutes". The backend does NOT enforce it yet. |
| **Admin can override auto-grades** | For MCQ questions, show the auto-calculated score to admin but allow them to change it via `/grade`. |
| **Finalize is reversible** | Admin can call `/grade` again after `/finalize` to correct a mistake, then `/finalize` again. |
| **CourseCompletion** | Only created/updated when `isPassed=true`. Show certificate UI only when `completion.certificateUrl` is not null. |
