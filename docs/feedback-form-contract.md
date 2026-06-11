# Course Feedback — Frontend ↔ Backend contract

**Status:** Frontend implemented (UI, payload shape, admin viewer, global nudges). Backend changes required as listed below.
**Owner:** Frontend (Appal). **Date:** 2026-06-11.

This document is the single source of truth for the course-feedback feature
after the LMS overhaul. It covers the new learner-facing form, how the
frontend forces completion, the admin viewer, and exactly what the backend
needs to support.

---

## 1. What changed (TL;DR)

| Area                | Before                                                | After                                                                                            |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Learner form        | 19 NEBOSH-style questions, 4-point Likert             | **18 LMS questions, 5-point Likert** + free-text section + overall rating + location + signature |
| Trigger             | Only the "Give feedback" button on completed cards    | Card CTA **plus** global persistent banner **plus** bell notification                            |
| Required by default | `false` on new courses                                | **`true`** on new courses (admins can opt out)                                                   |
| Admin viewer        | None — only `feedbackSubmissions` in PurgeUserModal   | Full **/feedback** page: list + filters + detail drawer + per-course aggregate + CSV export      |
| Notification type   | n/a                                                   | **`COURSE_FEEDBACK_REQUIRED`** (mirrors the `ENGAGEMENT_REMINDER` shape)                         |

---

## 2. Submission payload

### Endpoint (unchanged path, wider body)

```
POST /assignments/course/:courseId/feedback
Authorization: Bearer <student JWT>
Content-Type: application/json
```

### Body

```jsonc
{
  "formVersion": "lms-elearning-v1-2026-06",
  "formData": {
    // ── Section 1 ────────────────────────────────────────────────────────
    "learnerName": "Jane Smith",
    "courseTitle": "NEBOSH IGC — E-learning",
    "trainerName": "Tayyab Shah",
    "completionDate": "2026-06-11",
    "location": "Islamabad, Pakistan",
    "email": "jane@example.com",     // optional ("" allowed)

    // ── Section 2 — 18 × Likert (string "1".."5") ─────────────────────────
    "objectivesClear": "5",
    "contentRelevant": "5",
    "lmsEasyToUse": "4",
    "materialsAccurate": "5",
    "videosEffective": "4",
    "structureLogical": "5",
    "paceAppropriate": "4",
    "assessmentsReflectContent": "5",
    "instructionsClear": "5",
    "tutorSupportProfessional": "5",
    "tutorFeedbackTimely": "4",
    "technicalSupportAvailable": "4",
    "engagingInteractive": "4",
    "knowledgeImproved": "5",
    "confidentInApplication": "5",
    "metExpectations": "5",
    "overallSatisfied": "5",
    "wouldRecommend": "5",

    // ── Section 3 ───────────────────────────────────────────────────────
    "likedMost": "The case studies were realistic and applicable.",
    "improvements": "More interactive checkpoints between videos.",
    "technicalIssues": "Occasional buffering on the final module.",
    "futureTopics": "ISO 45001 internal auditor pathway.",
    "otherComments": "Thank you!",

    // ── Section 4 ───────────────────────────────────────────────────────
    "overallRating": "very_good",   // excellent | very_good | good | fair | poor

    // ── Section 5 ───────────────────────────────────────────────────────
    "signature": "Jane Smith",
    "signedDate": "2026-06-11"
  }
}
```

### Backend responsibilities on submit

1. **Persist** the payload as-is plus server-side metadata: `userId`,
   `courseId`, `submittedAt` (UTC ISO), the user's `email`, and the request
   `formVersion`.
2. **Compute and store**:
   - `meanRating` — average of the 18 Likert numbers (1..5).
   - Per-question `mean` for the aggregate endpoint (denormalised or
     computed on read; FE is happy either way).
3. **Idempotency**: a learner should be allowed to submit **once per
   `(userId, courseId)`**. Second POST → `409 Conflict` with
   `{ message: "Feedback already submitted." }`.
4. **Clear the pending-feedback notification** and pending row for that
   `(user, course)` so subsequent `/pending/me` returns no longer include it
   and the bell row gets `readAt` set automatically.
5. **Validation**: reject if any of the 18 Likert keys is missing or not in
   `["1","2","3","4","5"]`, or `overallRating` is missing.

### Versioning

`formVersion` travels in every payload (`lms-elearning-v1-2026-06` today).
When the form changes again, bump the version, keep storing the new shape
verbatim, and the admin detail drawer will still render historic submissions
because it falls back through `formData` keys.

---

## 3. Pending-feedback endpoints (new)

### 3.1 Status for one course (already exists; needs schema confirmation)

```
GET /assignments/course/:courseId/feedback-status
200 → { data: { isCompleted: boolean, isRequired: boolean, submittedAt?: string } }
```

Used by the completed-course card (`SingleCourse.tsx`). If feedback is
required and not completed, the card renders the bold amber **"Feedback
required"** CTA.

### 3.2 List pending for current user (new — powers the global banner)

```
GET /assignments/feedback/pending/me
200 → {
  data: Array<{
    courseId: string;
    courseTitle: string;
    completedAt: string;       // when the learner hit 100%
    requiredBy?: string;       // optional soft deadline
    daysOverdue?: number;      // 0 if not overdue yet
    trainerName?: string;
  }>
}
```

The FE banner queries this every page-load (`['pending-feedback-me', userId]`),
and submitting any feedback invalidates the same key. The endpoint **must**
return an empty array (not 404) when there are no pending items, so the
banner stays silent.

While this endpoint isn't deployed, the banner falls back to a client-side
filter over `getAllAssignedCourses` (any 100%-complete course where
`feedbackForm?.isRequired === true` and `feedbackForm?.isCompleted === false`).
For that fallback to work, please ensure `getAllAssignedCourses` returns
those two fields per course row — `feedbackForm.isRequired` and
`feedbackForm.isCompleted` — even if the new endpoint is still in flight.

---

## 4. Admin endpoints (new)

### 4.1 List submissions

```
GET /assignments/feedback/admin
       ?courseId=<id?>
       &from=<YYYY-MM-DD?>
       &to=<YYYY-MM-DD?>
       &search=<freetext?>     // matches learnerName, learnerEmail, courseTitle
       &page=<1-based>
       &limit=<int, default 20>
```

```jsonc
200 → {
  data: [
    {
      id: "<submissionId>",
      submittedAt: "2026-06-11T09:13:54Z",
      learnerId: "<userId>",
      learnerName: "Jane Smith",
      learnerEmail: "jane@example.com",
      courseId: "<courseId>",
      courseTitle: "NEBOSH IGC — E-learning",
      trainerName: "Tayyab Shah",
      location: "Islamabad, Pakistan",
      overallRating: "very_good",
      meanRating: 4.72              // 1..5
    }
  ],
  total: 137                         // total count for pagination
}
```

### 4.2 Detail

```
GET /assignments/feedback/admin/:submissionId
200 → { data: Submission }       // Submission = list-row fields + full formData (per §2)
```

Frontend renders this exactly as the original form (read-only), preserving
the question order from `RATING_KEYS` in `CourseFeedbackModal.tsx`. Older
NEBOSH-style submissions are tolerated: unknown question keys are listed
under Section 2 with a humanised label.

### 4.3 Aggregate

```
GET /assignments/feedback/admin/aggregate?courseId=<id?>
200 → {
  data: {
    count: 137,
    meanOverall: 4.51,                  // mean of `meanRating` across submissions
    overallDistribution: {              // counts per Section 4 bucket
      excellent: 60, very_good: 50, good: 20, fair: 5, poor: 2
    },
    perQuestion: [                      // one row per Section 2 question key
      { key: "objectivesClear", mean: 4.81, count: 137 },
      { key: "lmsEasyToUse",   mean: 4.10, count: 137 }
      // …
    ]
  }
}
```

Omit `courseId` → global stats. Used by the four tiles + the distribution
bar at the top of `/feedback`.

### 4.4 Authorisation

All four `…/feedback/admin*` endpoints must:

- Require **`role === 'admin'`** (same guard as `/users`, `/courses` admin
  endpoints).
- Return `403` (not `401`) when a non-admin token tries to hit them — the FE
  hides the sidebar entry but the API must still reject.

---

## 5. Notifications

### 5.1 New type

`NotificationType.COURSE_FEEDBACK_REQUIRED`

**Payload contract** (see `Notification.tsx` `CourseFeedbackRequiredPayload`):

```jsonc
{
  "courseId": "<courseId>",
  "courseTitle": "NEBOSH IGC — E-learning",
  "daysOverdue": 4              // optional; reasonable cap (e.g. 30)
}
```

**Required notification fields**

| Field         | Value                                                                |
| ------------- | -------------------------------------------------------------------- |
| `type`        | `COURSE_FEEDBACK_REQUIRED`                                           |
| `referenceId` | the `courseId` (FE deep-links via this)                              |
| `groupKey`    | `feedback:<courseId>` (one row even if multiple reminders are fired) |
| `dedupeKey`   | `feedback:<courseId>:<userId>:<bucket>` (see engagement-reminders)   |
| `message`     | fallback string for clients that don't yet know the payload          |

### 5.2 When to create

1. **On 100% course completion** — once a learner finishes a required-feedback
   course without yet submitting, write the notification (creates the bell
   row and shows the amber banner immediately on next page load).
2. **As a periodic reminder** — extend the existing engagement-reminders
   cron (`docs/engagement-reminders.md`) with a third type:

   ```
   FEEDBACK_REMINDER  — completed but no feedback for ≥ 2 days, repeat every 3 days
                        until submitted or the lifetime cap of 4 reminders.
   ```

   Use the same Resend email pipeline; suggested copy:

   > **Subject:** A quick favour about your recent course
   >
   > Hi {first_name}, you finished **{courseTitle}** — would you mind sharing
   > a few words about your experience? It takes about 2 minutes:
   > <https://www.greenwichtc-elearning.com/studentCourses?feedbackCourseId={courseId}>

3. **On submission** — mark every `COURSE_FEEDBACK_REQUIRED` notification
   for that `(userId, courseId)` as `readAt = now` and stop firing further
   reminders.

### 5.3 Click-through

FE routing rule (already wired): clicking the bell row navigates to

```
/studentCourses?feedbackCourseId=<referenceId>
```

The `studentCourses` page auto-opens the feedback modal for that course on
mount and strips the query param so a refresh doesn't re-open it.

---

## 6. Admin "force completion" knobs (optional, recommended)

These are not required for the FE to function but unlock harder enforcement:

| Knob                                  | Behaviour                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `feedbackForm.isRequired = true`      | Already supported. FE shows the persistent banner + amber CTA + bell.                                                    |
| **Gate certificate download**         | BE refuses `GET /courses/:id/certificate` for the learner until feedback is submitted. (No FE work needed — just error.) |
| **Gate next-course assignment**       | When BE auto-assigns a follow-up course, hold it back if any earlier course has pending required feedback.               |
| **Lifetime cap on reminders**         | Suggest 4 reminders, then stop. The banner remains; only the bell + email taper off.                                     |

---

## 7. Data model suggestion

```
CourseFeedbackSubmission
  id                uuid pk
  userId            uuid fk
  courseId          uuid fk
  formVersion       text
  formData          jsonb           -- the body of `formData` verbatim
  meanRating        numeric(3,2)    -- precomputed; 1..5
  overallRating     enum(excellent, very_good, good, fair, poor)
  submittedAt       timestamptz default now()

  unique (userId, courseId)
  index  (courseId, submittedAt desc)
```

`formData` as `jsonb` keeps you forward-compatible with schema changes; the
two normalised columns (`meanRating`, `overallRating`) are what the admin
table/aggregate query off.

---

## 8. Migration plan (for existing NEBOSH-style submissions)

1. Keep the old rows untouched. They will already match the new shape
   loosely because:
   - The old form's Likert values (`strongly_agree`, etc.) are decoded by
     the admin detail drawer (`likertLabel()` in `FeedbackDetailDrawer.tsx`).
   - `overallRating` was not collected before — admins will see "—" for the
     overall column, which is fine.
2. Backfill `meanRating` for old rows by mapping
   `strongly_disagree→1 … strongly_agree→4`, then dividing by 4 and
   multiplying by 5 (or leave them blank — your call).
3. The list endpoint can keep returning historical rows; the FE filters and
   sorts work either way.

---

## 9. FE files of interest (for review)

| Concern                | File                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| Form definition        | `src/app/(studentDashboard)/studentCourses/_components/CourseFeedbackModal.tsx`                       |
| Global banner          | `src/app/(studentDashboard)/_components/PendingFeedbackBanner.tsx`                                    |
| Layout mount           | `src/app/(studentDashboard)/layout.tsx`                                                               |
| Card-level CTA         | `src/app/(studentDashboard)/studentCourses/_components/SingleCourse.tsx`                              |
| Bell notification      | `src/app/(dashboard)/_components/Notification.tsx`                                                    |
| Admin page             | `src/app/(dashboard)/feedback/page.tsx` + `_components/*.tsx`                                         |
| Sidebar entry          | `src/app/(dashboard)/_components/menu.ts`                                                             |
| Default required flag  | `src/app/(dashboard)/course/addCourse/page.tsx`, `…/FormFields/CourseFormsDropdown.tsx`               |
| Form version constant  | `FEEDBACK_FORM_VERSION` in `CourseFeedbackModal.tsx`                                                  |

---

## 10. BE checklist

- [ ] Accept the wider `formData` (§2) on `POST /assignments/course/:id/feedback`.
- [ ] Validate the 18 Likert keys + `overallRating`; persist `formVersion`.
- [ ] Compute & store `meanRating` and `overallRating`.
- [ ] Implement `GET /assignments/feedback/pending/me` (§3.2).
- [ ] Implement `GET /assignments/feedback/admin` (§4.1).
- [ ] Implement `GET /assignments/feedback/admin/:submissionId` (§4.2).
- [ ] Implement `GET /assignments/feedback/admin/aggregate` (§4.3).
- [ ] Add `COURSE_FEEDBACK_REQUIRED` to `NotificationType`; create on
      100%-completion when required + not submitted; clear on submission.
- [ ] Extend the engagement-reminder cron with the `FEEDBACK_REMINDER` type (§5.2).
- [ ] (Optional) Gate certificate download until feedback is submitted (§6).
