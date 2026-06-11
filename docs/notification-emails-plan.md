# Notification Emails + Welcome Email — Plan

## Context

Today email is only sent for two things: engagement reminders (the sweep) and password-reset
OTPs. In-app notifications (the bell) fire for forum and assessment events but **never email
anyone** — so a student whose assessment was graded, or an admin who received a submission, only
finds out if they happen to open the app. We want to **mirror every in-app notification to email**
(to the recipient, and to the admin where applicable), and **send a welcome email when a user
self-registers**.

This builds directly on existing infrastructure: `MailService` (Resend), the `EmailLog` audit
table, and the central `NotificationService` write methods. The key design lever is that **all
in-app notifications already funnel through two methods** — `createNotification` (single) and
`createNotificationForMany` (fan-out) in [notification.service.ts](src/notifications/notification.service.ts).
That's the one place to add email, instead of touching all 4 trigger sites.

## What exists (verified)

**Notification trigger sites (all call the two central methods):**
| Event | Type | In-app recipient | File |
| --- | --- | --- | --- |
| New forum thread (admin activates) | `FORUM_THREAD` | all enrolled users (fan-out) | [forum-thread.service.ts:325](src/forum-thread/forum-thread.service.ts#L325) |
| New forum comment | `FORUM_COMMENT` | thread subscribers (fan-out) | [forum-comment.service.ts:48](src/forum-comment/forum-comment.service.ts#L48) |
| Student submits assessment | `ASSESSMENT_SUBMITTED` | the **admin** (`createdByAdminId`) | [course-assessment.service.ts:1031](src/course-assessment/course-assessment.service.ts#L1031) |
| Admin finalizes grading | `ASSESSMENT_GRADED` | the **student** (`attempt.userId`) | [course-assessment.service.ts:1330](src/course-assessment/course-assessment.service.ts#L1330) |

Note: each notification already targets the correct recipient (student or admin). So "email the
recipient" + "email the admin if applicable" is mostly already encoded — `ASSESSMENT_SUBMITTED`'s
recipient *is* the admin; `ASSESSMENT_GRADED`'s *is* the student.

**Infra to reuse:** `MailService` (best-effort, never throws, logs to `EmailLog`), the email-log
audit table, `EmailType` enum (extend it).

## Decisions needed (see end) before building
1. **Per-type opt-in vs all** — do we email for *every* notification type, or a chosen subset?
2. **"Email the admin too"** — for which events should admins get a copy beyond where they're
   already the recipient (e.g. should admins be CC'd on forum activity)?
3. **Self-registration detection** — the backend can't currently distinguish self-registered from
   admin-created users (one `POST /user` path). How do we tell them apart for the welcome email?

---

## Proposed design

### 1. Centralize email-on-notification in `NotificationService`

Add an optional `email` directive to the existing `createNotification` /
`createNotificationForMany` inputs. When present, after the in-app row is written, the service
resolves recipient email(s) and calls `MailService`. This is the single choke point — the 4
trigger sites just pass an `email: { template, ... }` block.

```ts
// notification.service.ts (shape)
interface CreateNotificationInput {
  userId: string; type; message; payload; ...
  email?: NotificationEmailSpec | null;   // NEW — when set, also email the recipient
}
```

- **Recipient resolution:** look up the target user's email by `userId` (single) or batch for
  fan-out. Skip if no email / soft-deleted / (optionally) inactive.
- **Best-effort + logged:** reuse MailService's never-throw contract; every send already lands in
  `EmailLog` (extend `EmailType` with `NOTIFICATION_FORUM_THREAD`, `NOTIFICATION_FORUM_COMMENT`,
  `NOTIFICATION_ASSESSMENT_SUBMITTED`, `NOTIFICATION_ASSESSMENT_GRADED` — or one
  `NOTIFICATION` type with the notification type in metadata).
- **Throttling:** forum fan-outs can hit many users; reuse the engagement sweep's batched,
  rate-limited send pattern (Resend ≈ 2 req/s) so a busy thread doesn't blow the rate limit or the
  serverless time budget. Fan-out emails should be capped/queued, not a synchronous blast.

### 2. New email templates

One template per notification type (subject + branded HTML + text), in
`src/mail/templates/`, following the existing `engagement-reminder.template.ts` structure (shared
layout, `#344e41` theme, logo). Each gets a deep link to the relevant page (thread, grading page,
student courses).

`MailService` gains `sendNotificationEmail(type, recipient, data)` that picks the right template.

### 3. "Email the admin if applicable"

Two interpretations — I recommend the narrow one:
- **(Recommended) Admins already are the recipient where it matters** (`ASSESSMENT_SUBMITTED`).
  No extra fan-out needed; just ensure that notification emails.
- **(Optional, if you want broader visibility)** Also send admins a copy of selected events (e.g.
  new forum threads/comments) — a separate "notify admins" helper that looks up `role = 'admin'`
  users (only 2 today) and emails them. Gate per-type so admins aren't spammed.

### 4. Welcome email on self-registration

**Blocker to resolve first:** there's a single `createUser` path
([user.service.ts](src/user/user.service.ts)) used by **both** admin-created and self-registered
users — the backend can't tell them apart today (we currently set `mustChangePassword: true`
assuming admin-created, which would be wrong for self-signup). Options:
- **(Recommended) Add a distinct self-register endpoint/flag** — a public `POST /auth/register`
  (or a `selfRegistered: true` flag in the body from the public signup form) so the backend knows
  the origin. Self-registered → welcome email + `mustChangePassword: false`. Admin-created →
  no welcome (or a different "an account was created for you" email) + `mustChangePassword: true`.
- **(Quick, leakier) Infer** from whether the request is authenticated as an admin (admin JWT
  present on the create call = admin-created; absent = self). Works only if the FE actually calls
  with/without the admin token consistently.

Welcome email: branded, "welcome to Greenwich, here's how to get started / log in", reuses the
template layout. Logged in `EmailLog` as `WELCOME`.

### 5. Files
- **Edit:** [notification.service.ts](src/notifications/notification.service.ts) (email directive +
  recipient resolution + batched send), [mail.service.ts](src/mail/mail.service.ts)
  (`sendNotificationEmail`, `sendWelcome`), [mail.types.ts](src/mail/mail.types.ts) (payloads),
  `prisma/schema.prisma` (`EmailType` enum values) + migration, the 4 trigger sites (pass `email`
  spec), the registration path (welcome + origin flag).
- **New:** `src/mail/templates/{forum-thread,forum-comment,assessment-submitted,assessment-graded,welcome}.template.ts`.
- **Reuse:** `MailService`/`EmailLog`/template layout/engagement batch-send throttle.

## Edge cases & guardrails
- **No double-spam:** email mirrors the in-app dedupe — if `createMany({skipDuplicates})` skipped a
  row (already notified), don't email for it. Email only freshly-inserted notifications (same
  pattern the engagement sweep uses).
- **Inactive/soft-deleted recipients:** skip (can't log in / gone).
- **Fan-out volume:** forum threads notify *all enrolled users* — at scale this is the one to
  watch. Batch + rate-limit; consider a per-user notification-email preference (mute) as a
  fast-follow so we don't train users to ignore us.
- **Self-send:** don't email the actor about their own action (e.g. the commenter shouldn't be
  emailed about their own comment) — the in-app fan-out already excludes the actor; mirror that.
- **Best-effort:** email failure never breaks the notification write or the originating action.

## Verification
1. Unit: each template renders (subject/html/text) for sample data.
2. Trigger each of the 4 events against a test user/admin → assert an `EmailLog` row (SENT) +
   in-app row both exist; assert the actor is NOT emailed.
3. Self-register a test account → welcome email + `EmailLog` `WELCOME`; admin-create → no welcome.
4. Fan-out: post a comment on a thread with N subscribers → N emails, batched under the rate limit.
5. Confirm dedupe: re-fire the same notification → no duplicate email.

---

## Decisions (LOCKED)
1. **Scope:** email on **all 4** notification types (graded, submitted, new thread, new comment).
2. **Admin copies:** **Yes** — CC admins on forum activity (`FORUM_THREAD`, `FORUM_COMMENT`) in
   addition to `ASSESSMENT_SUBMITTED` where the admin is already the recipient.
3. **Self-register detection:** **flag in the request body** — `POST /user` with
   `{ selfRegistered: true }` (sent by the public signup form) → welcome email +
   `mustChangePassword: false`. Without the flag (admin-created) → no welcome +
   `mustChangePassword: true` (current behavior).
4. **Notification-email preferences (mute):** **deferred** — fast-follow if forum fan-out emails
   prove noisy. Throttle/batch fan-out sends from day one regardless.
