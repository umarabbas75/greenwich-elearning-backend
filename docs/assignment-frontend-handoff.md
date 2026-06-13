# Assignments — Frontend / Backend Handoff

> **Owner:** Backend.
> **Status:** All items in this doc are implemented and live in `main`.
> Run `npx prisma migrate deploy` once before pointing the FE at a new env.
>
> This doc is the source of truth for the assignment module after the
> multi-file + grading + notifications/email rollout. Where it disagrees with
> earlier ad-hoc messages in chat, **this doc wins**.

---

## 1. What changed at a glance

| Area | Before | After |
| ---- | ------ | ----- |
| Admin uploads on assignment | 1 file (`assignmentFileUrl/Name/Type`) | **Up to 5 files** via `assignmentFiles[]` |
| Student uploads on submission | 1 file (`fileUrl/Name/Type`) | **Up to 5 files** via `submissionAttachments[]` |
| Available-assignments list | Bare assignment rows | Each row enriched with the student's submission summary |
| Grading | Status + score + feedback (no notifications) | Same fields, **plus** in-app + email notifications fired |
| Lifecycle notifications | None | Created / Submitted / Graded events with email mirror |

Old single-file fields are still accepted on input and still returned on output (mirroring the first attachment) so anything you didn't migrate keeps working during rollout.

---

## 2. Data shapes

### 2.1 File / attachment shape

The same shape is used everywhere a file is sent or returned:

```ts
type AssignmentFileType = 'pdf' | 'docx';

interface AssignmentFile {
  fileUrl: string;
  fileName?: string | null;
  fileType: AssignmentFileType;
}
```

- Allowed types: `pdf`, `docx` (no other types).
- `fileUrl` and `fileType` are required per file.
- `fileName` is optional (used for display + downloads).
- Max **5** files per array.

### 2.2 Assignment (admin-created)

```ts
interface Assignment {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  courseId: string;
  course?: { title: string };
  assignedToAdminId: string;
  createdByAdminId: string;
  dueAt: string | null;          // ISO timestamp
  maxPoints: number | null;
  allowResubmissions: boolean;
  maxAttempts: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;

  /** Up to 5 admin-uploaded materials, in display order. */
  assignmentFiles: AssignmentFile[];

  /** @deprecated First file only — kept for backward compatibility. */
  assignmentFileUrl: string | null;
  assignmentFileName: string | null;
  assignmentFileType: AssignmentFileType | null;
}
```

### 2.3 Submission (student)

```ts
type AssignmentSubmissionStatus =
  | 'submitted'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'returned';

interface AssignmentSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  assignedToAdminId: string;
  reviewedByAdminId: string | null;
  status: AssignmentSubmissionStatus;
  feedback: string | null;
  score: number | null;            // marks awarded by admin
  submittedAt: string;
  gradedAt: string | null;
  createdAt: string;
  updatedAt: string;

  /** Up to 5 student-uploaded files, in display order. */
  submissionAttachments: AssignmentFile[];

  /** @deprecated First file only — kept for backward compatibility. */
  fileUrl: string;
  fileName: string | null;
  fileType: AssignmentFileType;
}
```

### 2.4 Available-assignment row (enriched)

`GET /assignments/available` returns assignments **with the student's
submission summary inlined** so the list page doesn't need per-row status
calls:

```ts
interface AvailableAssignment extends Assignment {
  submissionStatus: AssignmentSubmissionStatus | null; // null = not started
  lastSubmissionDate: string | null;                   // ISO or null
  attemptsUsed: 0 | 1;                                 // see note in §3.4
  bestScore: number | null;
}
```

> ⚠️ The DB enforces one submission per `(assignmentId, studentId)`, so
> `attemptsUsed` is currently `0` or `1`. It exists for forward compatibility
> with multi-attempt resubmissions; treat it as a number ≥ 0.

---

## 3. API endpoints

All endpoints require a logged-in user (`Authorization: Bearer <token>`)
unless noted. Response envelope is the standard project shape:

```ts
{ message: string; statusCode: number; data: T; }
```

### 3.1 `POST /assignments/create` *(admin)*

Create an assignment with up to 5 files attached.

**Request:**

```json
{
  "title": "Week 1 Essay",
  "description": "Optional",
  "instructions": "Optional",
  "courseId": "uuid",
  "assignedToAdminId": "uuid-admin-who-reviews",
  "dueAt": "2026-06-30T23:59:59.000Z",
  "maxPoints": 100,
  "allowResubmissions": true,
  "maxAttempts": 1,
  "assignmentFiles": [
    { "fileUrl": "https://…/brief.pdf", "fileName": "brief.pdf", "fileType": "pdf" },
    { "fileUrl": "https://…/rubric.docx", "fileName": "rubric.docx", "fileType": "docx" }
  ]
}
```

- `assignmentFiles` is optional; omit if no files.
- The legacy single-file fields (`assignmentFileUrl/Name/Type`) are still
  accepted as a fallback. If both are sent, `assignmentFiles` wins.
- Triggers an **`ASSIGNMENT_CREATED`** notification + email to every active
  student enrolled in the course (creator excluded). See §5.

**Response data:** the created `Assignment` (with `assignmentFiles` array).

### 3.2 `POST /assignments/admin/update` *(admin, owner only)*

Edit an assignment. **Files are replaced as a whole array.**

```json
{
  "assignmentId": "uuid",
  "title": "…optional fields…",
  "assignmentFiles": [
    { "fileUrl": "…", "fileName": "new-brief.pdf", "fileType": "pdf" }
  ]
}
```

- Send `assignmentFiles` → replaces all files.
- Send `assignmentFiles: []` → removes all files.
- **Omit** `assignmentFiles` → files are not touched (only other fields update).
- No notifications fire on update (intentional — avoids spam on minor edits).

### 3.3 `POST /assignments/submit` *(student)*

Submit up to 5 files. One submission per student per assignment.

```json
{
  "assignmentId": "uuid",
  "submissionAttachments": [
    { "fileUrl": "https://…/essay.pdf", "fileName": "essay.pdf", "fileType": "pdf" },
    { "fileUrl": "https://…/appendix.docx", "fileName": "appendix.docx", "fileType": "docx" }
  ]
}
```

- At least **1** file required, **5** max.
- `submissionFiles` is accepted as an alias of `submissionAttachments` (older
  FE builds). Legacy `fileUrl/fileName/fileType` also still work.
- Extra fields like `courseId` / `assignedToAdminId` in the body are
  **ignored** — the server derives both from the assignment.
- Triggers an **`ASSIGNMENT_SUBMITTED`** notification + email to the
  assigned-to admin. See §5.

**Response data:** the created `AssignmentSubmission` (with
`submissionAttachments`).

### 3.4 `GET /assignments/available` *(student)*

Returns the student's assignments with submission summary inlined.

```json
{
  "data": [
    {
      "id": "…",
      "title": "Week 1 Essay",
      "courseId": "…",
      "course": { "title": "Intro to X" },
      "dueAt": "2026-06-30T23:59:59.000Z",
      "maxPoints": 100,
      "allowResubmissions": true,
      "maxAttempts": 1,
      "assignmentFiles": [ … ],
      "submissionStatus": "submitted",
      "lastSubmissionDate": "2026-06-13T14:52:51.000Z",
      "attemptsUsed": 1,
      "bestScore": null
    }
  ]
}
```

The previous N+1 pattern (one `/assignments/:id/status` call per row) is no
longer needed. You can remove the per-row enrichment hook. Keep a thin
`normalizeAvailableAssignment` fallback for legacy data if you want, but it
shouldn't be hit on a fresh response.

### 3.5 `GET /assignments/admin/created` *(admin)*

Returns assignments the admin created, ordered newest first. Each row
includes `assignmentFiles` and `course.title`.

### 3.6 `GET /assignments/:id` *(any user)*

Single assignment detail. Includes `assignmentFiles` and `course.title`.

### 3.7 `GET /assignments/:id/status` *(student)*

Student-side detail. Returns:

```json
{
  "data": {
    "assignment": { /* with assignmentFiles */ },
    "submission": { /* with submissionAttachments, or null */ },
    "isSubmitted": true,
    "status": "approved",
    "isOverdue": false
  }
}
```

### 3.8 `GET /assignments/:id/submissions` *(admin reviewer or creator)*

Returns the assignment + all submissions + a status histogram. Each
submission includes `student` (id/firstName/lastName/email) and
`submissionAttachments`.

```json
{
  "data": {
    "assignment": { /* with assignmentFiles */ },
    "submissions": [ /* with submissionAttachments */ ],
    "statistics": {
      "total": 12, "submitted": 4, "inReview": 2,
      "approved": 5, "rejected": 1, "returned": 0
    }
  }
}
```

Optional `?status=approved|submitted|…` query param filters submissions.

### 3.9 `GET /assignments/my` *(student)*

All of the student's submissions across assignments, with
`submissionAttachments`, ordered newest first.

### 3.10 `GET /assignments/assigned` *(admin)*

Submissions queued for the calling admin (their reviewer queue), with
`submissionAttachments`. Optional `?status=…` filter.

### 3.11 `POST /assignments/review` *(admin reviewer)*

Grade or update a submission.

```json
{
  "submissionId": "uuid",
  "status": "approved",
  "score": 92,
  "feedback": "Great work — minor formatting issues."
}
```

- All fields except `submissionId` are optional. Fields you omit keep their
  previous value.
- `status` is one of: `submitted | in_review | approved | rejected | returned`.
- `gradedAt` is set automatically when status is `approved` or `rejected`.
- `score` is **not** validated against `maxPoints` server-side. The FE should
  enforce that range in the UI.
- Triggers an **`ASSIGNMENT_GRADED`** notification + email to the student on
  **any** review call (including a status change to `in_review`). See §5.

**Response data:** the updated submission with `submissionAttachments`.

---

## 4. Validation rules (all client + server enforced)

| Rule | Limit |
| ---- | ----- |
| Max files per `assignmentFiles` array | 5 |
| Max files per `submissionAttachments` array | 5 |
| Min files for a submission | 1 |
| Allowed file types | `pdf`, `docx` |
| Required per file | `fileUrl`, `fileType` |

The server returns a `403` with a descriptive message on violation, e.g.
`"A maximum of 5 assignment files is allowed"` or `"At least 1 submission
file is required"`. Surface the message to the user.

---

## 5. Notifications + email mirrors

The assignment module is wired into the existing notification + email
infrastructure (same pipeline as assessments). Each event creates an in-app
notification row **and** sends an email to the same recipient. Email is
best-effort; if it fails the in-app notification still lands.

### 5.1 Events

| Event | Trigger | Recipient(s) | `NotificationType` |
| ----- | ------- | ------------ | ------------------ |
| New assignment available | `POST /assignments/create` | All active students enrolled in the course (creator excluded) | `ASSIGNMENT_CREATED` |
| Submission ready to review | `POST /assignments/submit` | The submission's `assignedToAdminId` | `ASSIGNMENT_SUBMITTED` |
| Submission status changed | `POST /assignments/review` | The submission's student (grading admin excluded) | `ASSIGNMENT_GRADED` |

`ASSIGNMENT_GRADED` fires on **any** status change — including a transition
to `in_review`. The FE can rely on it for both "your submission is being
reviewed" and "your submission has been graded" copy.

### 5.2 Notification payloads (for bell rendering)

The bell payload follows the same envelope as other notifications. Use
`type` + `payload` to render. (See `docs/notifications-contract.md` for the
generic shape.)

```ts
// type === 'ASSIGNMENT_CREATED'
payload: {
  assignmentId: string;
  assignmentTitle: string;
  courseId: string;
  courseTitle: string;
  dueAt: string | null;     // ISO
}

// type === 'ASSIGNMENT_SUBMITTED'
payload: {
  assignmentId: string;
  assignmentTitle: string;
  submissionId: string;
  studentId: string;
  studentName: string;
}

// type === 'ASSIGNMENT_GRADED'
payload: {
  assignmentId: string;
  assignmentTitle: string;
  submissionId: string;
  submissionStatus: AssignmentSubmissionStatus;
  score: number | null;
  maxPoints: number | null;
  feedback: string | null;
}
```

`referenceId` is the assignment id (created) or submission id (submitted /
graded), so click-through routing can do:

- `ASSIGNMENT_CREATED` → `/assignments/{assignmentId}`
- `ASSIGNMENT_SUBMITTED` → `/admin/assignments/{assignmentId}/submissions`
- `ASSIGNMENT_GRADED` → `/assignments/{assignmentId}` (or to the submission
  detail page if you have one)

### 5.3 Email CTAs

Email templates link to the same routes as the bell. Confirmed routes the
backend builds links to:

| Route | Used by |
| ----- | ------- |
| `/assignments/{assignmentId}` | `ASSIGNMENT_CREATED`, `ASSIGNMENT_GRADED` |
| `/admin/assignments/{assignmentId}/submissions` | `ASSIGNMENT_SUBMITTED` |

If those routes don't match what the FE actually exposes, either:

1. Tell us and we'll update `src/mail/mail-paths.ts`, **or**
2. Add a redirect on the FE to the canonical URL.

### 5.4 Dedupe behavior (so you can predict what shows up)

| Event | Dedupe key | Effect |
| ----- | ---------- | ------ |
| `ASSIGNMENT_CREATED` | `assignment-created:<assignmentId>:<userId>` | Idempotent — recreating the same assignment doesn't double-notify |
| `ASSIGNMENT_SUBMITTED` | `assignment-submitted:<submissionId>` | One bell row per submission to the admin |
| `ASSIGNMENT_GRADED` | `assignment-graded:<submissionId>:<status>:<score>:<feedbackLen>` | Distinct review actions create new rows; accidental duplicates collapse |

### 5.5 Failure semantics

- Notification + email dispatch is wrapped in `safeNotify` — errors are
  logged but **never** fail the underlying API call.
- Email mirror only fires for recipients whose in-app row was actually
  inserted (dedupe-aware).
- Email service no-ops cleanly when `RESEND_API_KEY` is unset (local/dev).

---

## 6. Frontend migration checklist

- [ ] **Types**: switch to `assignmentFiles: AssignmentFile[]` and
  `submissionAttachments: AssignmentFile[]`. Drop direct reads of the legacy
  single-file fields once everything renders from the array.
- [ ] **Admin create/edit**: multi-file uploader (max 5, pdf/docx). Send the
  full array on every save; legacy fields are no longer needed.
- [ ] **Student submit**: multi-file uploader (1–5, pdf/docx). Send
  `submissionAttachments`. Show backend error message on validation failure.
- [ ] **Available list**: read `submissionStatus` / `lastSubmissionDate` /
  `attemptsUsed` / `bestScore` directly from the row. Remove the per-row
  status fetch hook.
- [ ] **Display**: render `assignmentFiles[]` on assignment detail; render
  `submissionAttachments[]` on student status, admin review modal, admin
  submissions table.
- [ ] **Grading UI**: enforce `score ≤ maxPoints` client-side; surface
  `feedback` as multiline text.
- [ ] **Bell + click-through**: handle the three new `NotificationType`s
  with the routes in §5.2.
- [ ] **Email link routes**: confirm `/assignments/{id}` and
  `/admin/assignments/{id}/submissions` exist (or tell us to update).

---

## 7. Open questions / future work

- **Multi-attempt resubmissions.** The schema enforces one submission per
  `(assignmentId, studentId)` today, so `allowResubmissions` and
  `maxAttempts` aren't actually exercised. If we need multi-attempt later,
  the submission model needs an `attemptNumber` and the unique index needs
  to relax. `attemptsUsed` in the available-list response is shaped to grow
  into this.
- **Server-side `score ≤ maxPoints` enforcement.** Currently FE-only.
  Cheap to add server-side if you'd like the safety net.
- **Per-assignment notification opt-out.** Today there's no preference
  model. If we add notification preferences (matching the assessment
  pattern), assignment events will inherit the same toggles.

---

## 8. Quick reference

### Field name decoder

| You'll see | What it is |
| ---------- | ---------- |
| `assignmentFiles` | Array of admin-uploaded materials (max 5). |
| `submissionAttachments` | Array of student-uploaded files in a submission (max 5). |
| `submissionFiles` | Alias for `submissionAttachments` accepted on `POST /assignments/submit`. Output is always `submissionAttachments`. |
| `assignmentFileUrl/Name/Type` | Legacy single-file fields on `Assignment`. Reflect the first attachment. |
| `fileUrl/fileName/fileType` (on submission) | Legacy single-file fields on `AssignmentSubmission`. Reflect the first attachment. |

### Notification type quick map

| Type | Recipient | Click → |
| ---- | --------- | ------- |
| `ASSIGNMENT_CREATED` | Student | `/assignments/{assignmentId}` |
| `ASSIGNMENT_SUBMITTED` | Reviewer admin | `/admin/assignments/{assignmentId}/submissions` |
| `ASSIGNMENT_GRADED` | Student | `/assignments/{assignmentId}` |

### Migrations to run

```bash
npx prisma migrate deploy
```

This applies, in order:

- `20260612120000_assignment_attachments` — admin attachments table
- `20260612130000_assignment_submission_attachments` — submission attachments table
- `20260613150000_assignment_notification_email_types` — new enum values
