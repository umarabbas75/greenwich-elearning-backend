# Automated Engagement Reminders

**Status:** Implemented (backend). Pending: prod migration + FE sync (see §7).
**Owner:** Backend (Umar). **Date:** 2026-06-07.

This document explains the low-engagement reminder feature end-to-end: what it
does, why each decision was made, how it's built, what you must configure, and
exactly what the frontend needs to do to sync up.

---

## 1. What this feature does (plain English)

Students who enroll in a course but go quiet now get an automated nudge. There
are **two situations** we detect, and each gets **both** an in-app notification
(the bell) **and** an email:

| Type | Who it targets | When it fires |
| --- | --- | --- |
| **NEVER_STARTED** | Enrolled, course activated for them, but they've **never opened it** (zero activity) | The course has been active for them ≥ **3 days** (default) |
| **STALLED** | Was making progress, then **stopped** | No activity for ≥ **7 days** (default) |

A scheduled job (Vercel Cron) runs once a day, finds these students, and sends
the reminders. Nobody is spammed: each student gets **at most one reminder per
course per cooldown window** (3 days for never-started, 7 for stalled).

---

## 2. Why we built it this way (key decisions)

| Decision | Why |
| --- | --- |
| **Both in-app + email** | An absent student won't see a bell notification until they return; email reaches them where they are. The in-app copy is the permanent record and the dedupe anchor. |
| **Email via Resend** | Lightweight transactional provider; the domain `greenwichtc-elearning.com` is already verified there. Sender: `noreply@greenwichtc-elearning.com`. |
| **Vercel Cron → HTTP endpoint** | The app runs on Vercel **serverless** — there is no always-on process, so an in-process `@nestjs/schedule` cron would **not fire reliably**. Vercel Cron hitting a secured endpoint is the native fit. |
| **Two distinct reminder types** | "Never started" and "stalled" are different problems and need different copy/tone. |
| **No `lastActiveAt` column** | We derive engagement from existing activity tables (see §4) instead of adding write overhead to every user action. |
| **Cadence encoded in `dedupeKey`, no new table** | Reuses the notifications partial-unique index (`userId, dedupeKey`) that already exists for idempotency — re-runs are safe and we add zero new tables. |

### The "start line" decision (important)
Engagement is measured from **when the admin activates a course for a specific
student** (`UserCourse.isActive` flips `false→true`), **not** from when the
course was assigned. There are three independent activation flags in the system,
and conflating them would mis-target reminders:

| Flag | Meaning | Used as |
| --- | --- | --- |
| `Course.isActive` | Course is published in the catalogue | Gate |
| `UserCourse.isActive` | Admin unlocked this course **for this student** | Gate + start line |
| `User.status` | Account can log in at all (`active`/`inactive`) | Gate |

We added a new nullable column **`UserCourse.activatedAt`**, set on the first
activation, and the sweep measures from `COALESCE(activatedAt, updatedAt)` so it
works for historical rows too.

We also **only remind `User.status = 'active'` accounts** — an inactive account
can't log in (the admin hasn't activated it or has revoked it), so a reminder
would be pointless.

---

## 3. How it works (flow)

```
Vercel Cron (daily 09:00 UTC)
   │  GET /api/v1/internal/cron/engagement-reminders
   │  Authorization: Bearer <CRON_SECRET>   (Vercel attaches this automatically)
   ▼
CronSecretGuard  ── rejects if secret missing/wrong (fails closed)
   ▼
EngagementService.runSweep()
   ├─ findNeverStarted()  ── one set-based SQL query
   ├─ findStalled()       ── one set-based SQL query
   └─ for each candidate:
        1. write in-app Notification  (createMany, skipDuplicates → idempotent)
        2. send email via Resend      (best-effort; failure never blocks step 1)
```

**Idempotency / cadence:** each reminder's `dedupeKey` is
`engagement:<type>:<courseId>:<userId>:<bucket>` where `bucket` is a time window
(`floor(epochDays / cooldownDays)`). Re-running the cron in the same window
produces the same key → the insert is skipped → no duplicate. Next window → new
key → a fresh reminder if the student is still disengaged.

---

## 4. How "engagement" is detected

A student counts as **active in a course** if they have any of these, joined to
the course:

| Signal | Table |
| --- | --- |
| Progressed through a section | `UserCourseProgress` |
| Opened/viewed a section | `LastSeenSection` |
| Attempted a quiz | `quiz_progress` (→ chapters → modules → course) |
| Started/submitted an assessment | `assessment_attempts` (→ assessments → course) |
| Submitted an assignment | `assignment_submissions` (→ assignments → course) |

- **NEVER_STARTED** = enrolled + course active for them + account active + not
  completed + **none** of the above + activated ≥ X days ago.
- **STALLED** = same gates, but the **most recent** of the above is older than N
  days.

The two sets are disjoint by construction (stalled requires activity;
never-started requires none), so no student gets both in one run.

---

## 5. What was built / changed (backend)

### New files
| File | Purpose |
| --- | --- |
| `src/engagement/engagement.service.ts` | Detection (raw SQL) + dispatch (notification + email) |
| `src/engagement/engagement.controller.ts` | Cron endpoint (`GET` + `POST`) |
| `src/engagement/engagement.module.ts` | Wiring |
| `src/engagement/engagement.constants.ts` | Config keys, defaults, dedupe-key/cooldown logic |
| `src/engagement/cron-secret.guard.ts` | Machine-to-machine auth via `CRON_SECRET` |
| `src/mail/mail.service.ts` | Resend wrapper; best-effort, never throws |
| `src/mail/mail.module.ts` | Wiring |
| `src/mail/mail.types.ts` | `ReminderType` enum + mail interfaces |
| `src/mail/templates/engagement-reminder.template.ts` | Professional email copy (HTML + text) |
| `prisma/migrations/20260607120000_engagement_reminders/migration.sql` | Enum value, indexes, `activatedAt` + backfill |

### Edited files
| File | Change |
| --- | --- |
| `prisma/schema.prisma` | Added `NotificationType.ENGAGEMENT_REMINDER`; `UserCourse.activatedAt`; activity indexes |
| `src/course/course.service.ts` | `toggleCourseStatus` now stamps `activatedAt` on first activation |
| `src/app.module.ts` | Registered `EngagementModule` |
| `vercel.json` | Added the cron schedule |
| `.env.example` | Documented all new env vars |
| `docs/notifications-contract.md` | Documented the new notification type for the FE |

### Dependency
- Added `resend`.

---

## 6. Configuration (env)

Set in **local `.env`** and **Vercel → Production + Preview**.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | ✅ | — | From resend.com → API keys (sending access). Without it, emails no-op; in-app still works. |
| `CRON_SECRET` | ✅ | — | Long random string (`openssl rand -hex 32`). Same value in all environments. Vercel sends it as a Bearer token automatically. |
| `MAIL_FROM` | — | `Greenwich Training & Consulting <noreply@greenwichtc-elearning.com>` | |
| `APP_BASE_URL` | — | `https://www.greenwichtc-elearning.com` | Base for course links in emails. |
| `ENGAGEMENT_NEVER_STARTED_DAYS` | — | 3 | Days after activation before a never-started nudge. |
| `ENGAGEMENT_STALLED_DAYS` | — | 7 | Days of inactivity before a stalled nudge. |
| `ENGAGEMENT_NEVER_STARTED_COOLDOWN_DAYS` | — | 3 | Min gap between repeat never-started reminders. |
| `ENGAGEMENT_STALLED_COOLDOWN_DAYS` | — | 7 | Min gap between repeat stalled reminders. |
| `ENGAGEMENT_BATCH_LIMIT` | — | 50 | Max candidates per type per run (serverless time bound). |
| `ENGAGEMENT_EMAIL_CONCURRENCY` | — | 5 | Parallel Resend sends per run. |

> ⚠️ **Resend free tier = 100 emails/day.** With batch 50 × 2 types = up to 100
> per run. Lower the batch or upgrade if your disengaged backlog is larger.

### Deploy step (separate from env)
Run the migration on prod: `npx prisma migrate deploy`. This adds the
`ENGAGEMENT_REMINDER` enum value, the `activatedAt` column (with a best-effort
backfill from `updatedAt` for existing active enrollments), and the indexes.

---

## 7. What the FRONTEND needs to do

The backend now writes notifications of type `ENGAGEMENT_REMINDER`. The bell
**already renders them** (unknown types fall back to `item.message`), so nothing
is broken. Two items to fully sync:

### 7.1 Required — make the reminder clickable
Add one case to the notification routing (`routeFor()` or equivalent):

```ts
case 'ENGAGEMENT_REMINDER':
  return `/studentCourses/${item.referenceId}`;   // referenceId = courseId
```

The backend sends:
- `type`: `"ENGAGEMENT_REMINDER"`
- `referenceId`: the **courseId**
- `payload`: `{ reminderType: 'never_started' | 'stalled', courseId, courseTitle }`
- `groupKey`: `engagement:<reminderType>:<courseId>` (existing group-collapse logic handles it — no work needed)

### 7.2 Required check — does `/studentCourses/:courseId` exist?
Both the **notification route above** and the **reminder email button** link to
`/studentCourses/<courseId>`.

- **If that route exists** → done.
- **If it does NOT** (the courses page is just `/studentCourses` with no ID) →
  tell the backend owner and we'll repoint both the email and the notification to
  the bare `/studentCourses`. (Note: the existing `ASSESSMENT_GRADED`
  notification routes to bare `/studentCourses`, which suggests the deep link may
  not exist yet — please confirm.)

### 7.3 Optional — nicer copy from payload
Default bell text is functional. To customize, render from `payload`:

```ts
payload.reminderType === 'never_started'
  ? `You haven't started ${payload.courseTitle} yet — let's get going.`
  : `Pick up where you left off in ${payload.courseTitle}.`;
```

### 7.4 Optional — `activatedAt` backfill (data/FE owns)
The migration already backfills `UserCourse.activatedAt = updatedAt` for existing
active enrollments, and the backend stamps it going forward. No FE action is
required unless you want a more accurate historical backfill.

### FE checklist
- [ ] Add `ENGAGEMENT_REMINDER` case to `routeFor()` → `/studentCourses/${referenceId}`
- [ ] Confirm `/studentCourses/:courseId` route exists (else notify backend)
- [ ] (Optional) Custom bell copy from `payload`

---

## 8. How to test

**Manual trigger (local or prod):**
```bash
curl -X POST https://<host>/api/v1/internal/cron/engagement-reminders \
  -H "Authorization: Bearer <CRON_SECRET>"
```
- Wrong/missing secret → `401`.
- Correct secret → `200` with a summary: counts of candidates / notified / emailed per type.

**Local without sending real email:** leave `RESEND_API_KEY` unset — the mail
service logs and no-ops, so you can still verify detection + in-app notifications.

**Verify in-app:** the reminder appears in `GET /notifications` with
`type=ENGAGEMENT_REMINDER` and the payload above.

---

## 9. Known limitations / future work
- **Lifetime cap** (e.g. "stop after 3 stalled reminders ever") is **not**
  implemented — would need a small `engagement_reminder_log` table. Current
  behavior reminds once per cooldown window indefinitely while disengaged.
- **Timezone-aware send** (9am local) is deferred; the cron fires at 09:00 UTC.
- **Unsubscribe link** is not included in v1 emails.
- **Email is best-effort:** if a send fails, the in-app notification still
  stands; the email is not retried within the same cooldown window.
