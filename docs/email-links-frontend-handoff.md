# Email & Notification Links — Frontend Handoff

> **For the backend team.** This is the canonical list of every route the
> frontend exposes for email CTAs and bell-notification routing. Every link
> in this doc is implemented, authenticated-aware, and survives a cold
> start (user clicks email → not logged in → login → bounce back to target).
>
> Use this as the source of truth when authoring email templates. Where a
> path here disagrees with the previous handoff, **this one wins**.

---

## 1. Quick checklist (FE responses to your "FE must" items)

| BE asked | FE status                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Feedback deep-link auto-opens form + strips param | **Changed.** We replaced the modal with a dedicated route. Use `/studentCourses/{courseId}/feedback` (see §2). Old `?feedbackCourseId=` links still work — the studentCourses page silently 302s them to the new route. |
| `/studentCourses/{courseId}` exists | Live. Lands on the course detail page (overview / syllabus / grades / resources). |
| `/forum/{threadId}` works after login | Live at `/forum/<threadId>` (Next dynamic segment is `[forumThreadId]`; the URL shape is what you'd expect). |
| `/assessment/grade/{attemptId}` for admins | Live. |
| Login preserves return URL | Live. Middleware sends an unauth'd user to `/login?from=<encoded path+query>`; the login form pushes back to `from` on success. |
| Bell routes match email routes | Live. The bell uses the same paths in this doc — see §7. |
| Signup sends `selfRegistered: true` | Live. Public `/signUp` POSTs `{ ..., selfRegistered: true }`. |
| Password-reset UI accepts email OTP | Live. 3-step flow at `/forgot-password` → request → verify code → reset. |

So all eight items are green except the feedback link, which got upgraded. Everything is wired and waiting for the BE template changes in §6.

---

## 2. Feedback deep-link — **canonical URL changed**

**New canonical:**

```
/studentCourses/{courseId}/feedback
```

It is a real Next.js route — `src/app/(studentDashboard)/studentCourses/[courseId]/feedback/page.tsx` — not a modal toggle. Why this is better:

- Stable URL = shareable + bookmarkable.
- Survives auth bounces cleanly (middleware preserves the full path + query via `?from=`).
- Refresh-safe: if the learner has already submitted, the page shows an
  "Already submitted — thank you" state instead of letting them double-submit.
- Works for unknown / unauthorized course IDs with a friendly "we couldn't
  find that course" empty state.

**Backward compatibility.** The old shape

```
/studentCourses?feedbackCourseId={courseId}
```

is still honoured — the studentCourses index page detects the query param and `router.replace`s to the new route. Older emails in mailboxes continue to work. New templates should use the new shape.

**Where this URL is used:**

| Surface                          | Should link to                                       |
| -------------------------------- | ---------------------------------------------------- |
| Feedback request email (on completion) | `/studentCourses/{courseId}/feedback`         |
| Feedback reminder email (cron)         | `/studentCourses/{courseId}/feedback`         |
| Bell: `COURSE_FEEDBACK_REQUIRED`       | `/studentCourses/{courseId}/feedback`         |
| In-app banner CTA                      | `/studentCourses/{courseId}/feedback`         |
| Completed-course card "Feedback required" | `/studentCourses/{courseId}/feedback`      |

Recommended email copy (paste into the template):

```
Hi {firstName}, you finished {courseTitle} — would you mind sharing a few
words about your experience? It takes about 2 minutes:

  https://www.greenwichtc-elearning.com/studentCourses/{courseId}/feedback
```

---

## 3. Canonical route map

Every URL the BE can put in an email or notification today. All are protected by the middleware unless explicitly noted.

### Student-facing

| Purpose                                | Path                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| My courses (list)                      | `/studentCourses`                                                   |
| Course detail (overview + tabs)        | `/studentCourses/{courseId}`                                        |
| **Course feedback form**               | `/studentCourses/{courseId}/feedback`                               |
| Course requirements form               | `/studentCourses/{courseId}/course-form-page?…`                     |
| Course policies                        | `/studentCourses/{courseId}/policies?…`                             |
| Course content (player)                | `/studentNewCourse/{courseId}` (and module/section sub-paths)       |
| Assessment (take / resume)             | `/studentNewCourse/assessment/{courseId}?assessmentId={assessmentId}` |
| My assignments                         | `/student-assignments`                                              |
| My assessments                         | `/student-assessments`                                              |
| Forum index                            | `/forum`                                                            |
| Forum thread                           | `/forum/{threadId}`                                                 |
| Settings                               | `/setting`                                                          |
| Contact us (form)                      | `/contact-us`                                                       |

### Admin-facing

| Purpose                                | Path                                                                |
| -------------------------------------- | ------------------------------------------------------------------- |
| Admin home                             | `/`                                                                 |
| Analytics dashboard                    | `/analytics`                                                        |
| Users                                  | `/user`                                                             |
| Courses                                | `/course`                                                           |
| Quizzes                                | `/quiz`                                                             |
| Assignments                            | `/assignments`                                                      |
| Assessments (list)                     | `/assessment`                                                       |
| **Grade an attempt**                   | `/assessment/grade/{attemptId}`                                     |
| **Feedback submissions**               | `/feedback`                                                         |
| Contact messages (admin inbox)         | `/contact-us`                                                       |
| Forms                                  | `/forms`                                                            |
| Settings                               | `/setting`                                                          |

### Auth / public

| Purpose                | Path                  | Auth?       |
| ---------------------- | --------------------- | ----------- |
| Login                  | `/login`              | public      |
| Login w/ return URL    | `/login?from=<encoded path+query>` | public |
| Forgot password (OTP)  | `/forgot-password`    | public      |
| Set new password (forced) | `/set-new-password` | session, gated |
| Public signup          | `/signUp`             | public      |
| Public marketing home  | `/home`               | public      |
| Public course detail   | `/publicCourses/{courseId}` | public |
| Payment                | `/payment`            | public-ish  |

> Anything not on this list is internal-only — please don't put it in an email.

---

## 4. Auth + deep-link contract

Every email link assumes the recipient may be logged out. The FE middleware (already shipped) does this:

1. Unauthenticated request to any protected page → `307` to `/login?from=<urlencoded original path+query>`.
2. On successful login, the form reads `from` from `useSearchParams()` and `router.push(from)`. Falls back to `/` if absent.
3. If a session exists but is forced into `mustChangePassword`, the user is pinned to `/set-new-password` first; after they pick a password, the gate releases and normal routing resumes.

So **the BE doesn't need to do anything special** for deep-link emails — just link to the canonical path. Login bounce is automatic.

The one tip we'd ask: **don't URL-encode the path again on the BE side** when assembling the link. Just emit the literal path; the user's click goes straight to it, and only the middleware redirect to `/login` adds an encoded `from=`.

---

## 5. Suggested admin link targets (BE asked)

These are the admin-specific pages BE mentioned wanting to point emails at:

| Email                                  | Current target          | Recommended target |
| -------------------------------------- | ----------------------- | ------------------ |
| **New feedback submission** (to admin) | `/`                     | `/feedback`        |
| **Contact-us message** (to admin)      | `/`                     | `/contact-us`      |
| Assessment submitted by learner (to admin) | `/assessment/grade/{attemptId}` (already deep-linked, good) | — |

The admin Feedback page (`/feedback`) supports row-level filters (`?courseId=...`) if you want to deep-link straight to a submission view. Drop the query for now; we can pin a specific submission later by adding `?submissionId=…` if useful.

---

## 6. Per-email link audit (what to keep / change in your templates)

| Email                          | Current link                                    | Keep / change?                                                              |
| ------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------- |
| Feedback request (on completion) | `/studentCourses?feedbackCourseId={courseId}` | **Change** → `/studentCourses/{courseId}/feedback`                          |
| Feedback reminder (cron)       | `/studentCourses?feedbackCourseId={courseId}`   | **Change** → `/studentCourses/{courseId}/feedback`                          |
| Feedback received (to student) | `/studentCourses`                               | Keep — or upgrade to `/studentCourses/{courseId}` for context              |
| Course completed (to student)  | `/studentCourses`                               | **Recommended** → `/studentCourses/{courseId}/feedback` (combines "yay you finished" with the next required action) |
| Engagement: never started      | `/studentCourses/{courseId}`                    | Keep                                                                        |
| Engagement: stalled            | `/studentCourses/{courseId}`                    | Keep                                                                        |
| Forum new thread               | `/forum/{threadId}`                             | Keep                                                                        |
| Forum new comment              | `/forum/{threadId}`                             | Keep                                                                        |
| Assessment submitted (to admin)| `/assessment/grade/{attemptId}`                 | Keep                                                                        |
| Assessment graded (to student) | `/studentCourses`                               | **Upgrade** → `/studentCourses/{courseId}` (lands on the course's Grades tab — the score is visible in-page) |
| Welcome (self-signup)          | `/`                                             | Keep                                                                        |
| Password reset                 | No link — 6-digit OTP in body                   | Keep — works with our `/forgot-password` UI                                 |
| Footer "Visit your dashboard"  | `/`                                             | Keep                                                                        |
| **New feedback submission** (to admin) | `/`                                     | **Change** → `/feedback`                                                    |
| **Contact-us message** (to admin)      | `/`                                     | **Change** → `/contact-us`                                                  |

There's nothing in this table the FE doesn't already handle — flip the templates whenever you have a quiet moment.

---

## 7. Bell-notification routing (already matches above)

The bell uses the **exact same paths** as the corresponding emails — so any future template change here ports across the bell automatically.

| `NotificationType`           | Path                                            |
| ---------------------------- | ----------------------------------------------- |
| `COURSE_FEEDBACK_REQUIRED`   | `/studentCourses/{referenceId}/feedback`        |
| `ENGAGEMENT_REMINDER`        | `/studentCourses/{referenceId}`                 |
| `ASSESSMENT_SUBMITTED`       | `/assessment/grade/{referenceId}`               |
| `ASSESSMENT_GRADED`          | `/studentCourses` (will upgrade alongside the email — see §6) |
| `FORUM_THREAD` / `FORUM_COMMENT` | `/forum/{threadId}`                         |

`referenceId` = the BE-stored notification reference (course / attempt / thread).

---

## 8. What FE does **not** need from BE

To save a round of "do we send the URL?" questions:

- **Email submit payloads** (feedback, progress, heartbeats, etc.) **never** include URLs. The BE composes them from `APP_BASE_URL` + the canonical paths in §3.
- **Notification creation** is purely BE-side. The FE doesn't push notification rows.
- **Email content** (subject, copy, HTML) is owned by the BE template.
- **Logo / branding** in emails — Cloudinary URL is held by the BE config (`BRAND.logoUrl` or equivalent). FE doesn't ship asset URLs to the BE.

If you ever need an absolute URL to a page from the FE for a different reason (e.g. social share), `BRAND.website` on the FE constants matches yours.

---

## 9. Open items / nice-to-haves

These are not blockers — flagged so we can pick them up when relevant.

1. **Assessment Graded deep-link.** The student-facing surface for a graded attempt is the **Grades tab of the course detail page** (`/studentCourses/{courseId}` then the Grades tab). We can add a `?tab=grades&attemptId={id}` query handler if you want emails to land directly on a specific attempt. Low priority — the in-page UI surfaces the score either way.
2. **Engagement reminders for stalled course-form / policy steps.** Currently emails point at `/studentCourses/{courseId}`. If you ever want to target the requirements step specifically: `/studentCourses/{courseId}/course-form-page?courseId={courseId}&courseTitle={title}&returnUrl=/studentCourses` is the canonical URL.
3. **Receipt-on-feedback email.** If you ever want to thank the learner with a link, prefer `/studentCourses/{courseId}` over `/studentCourses` so they land in context.

---

## 10. Environment / config alignment

| Item             | Owner    | Notes                                                       |
| ---------------- | -------- | ----------------------------------------------------------- |
| `APP_BASE_URL`   | Backend  | Staging vs prod — FE has no input here.                     |
| `BRAND.website`  | Backend  | Should match `APP_BASE_URL` for production. FE's `BRAND_COMPANY_NAME` is the human-readable name only. |
| `RESEND_API_KEY`, `MAIL_FROM` | Backend | FE doesn't interact. |
| Logo URL in emails | Backend (Cloudinary) | FE doesn't ship this. |

If staging gets its own domain (e.g. `staging.greenwichtc-elearning.com`), please:

1. Set `APP_BASE_URL` on staging accordingly.
2. Ensure `BRAND.website` on the BE matches.

The FE doesn't need a corresponding env var — every link in this doc is path-only and is hosted under whichever origin the user is already on.

---

## 11. FE files that own these flows (for your reference)

| Concern                                      | File                                                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Auth bounce + `from=` preservation           | `src/middleware.ts`                                                                         |
| Login `from` consumer                        | `src/app/(auth)/login/_components/LoginAuthForm.tsx`                                        |
| Forgot-password OTP UI                       | `src/app/(auth)/forgot-password/_components/ForgotPasswordForm.tsx`                         |
| Public signup (`selfRegistered: true`)       | `src/app/(public)/signUp/sign-up-form.tsx`                                                  |
| Feedback route                               | `src/app/(studentDashboard)/studentCourses/[courseId]/feedback/page.tsx`                    |
| Feedback canonical URL helper                | `feedbackRoute(courseId)` in `src/lib/feedback/constants.ts`                                |
| Legacy `?feedbackCourseId=` redirect         | `src/app/(studentDashboard)/studentCourses/page.tsx`                                        |
| Bell routing rules                           | `src/app/(dashboard)/_components/Notification.tsx` (`routeFor`)                             |
| Pending-feedback banner                      | `src/app/(studentDashboard)/_components/PendingFeedbackBanner.tsx`                          |

---

**Net:** the only template change the BE needs to ship is `/studentCourses/{courseId}/feedback` for feedback emails, plus the two admin deep-link upgrades (`/feedback`, `/contact-us`). Everything else in your doc is already green on our side.
