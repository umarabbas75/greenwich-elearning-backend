# Admin Dashboard — Analytics & Overview Plan

## Context

The admin dashboard currently shows nothing of substance. This is a brand-new system, so
admins need a **high-level, real-time overview of what's happening**: who's logging in, who's
active, who's completing courses, who's stalling, what automated emails went out, and what
security events (password changes/resets) occurred. The goal is situational awareness — surface
the good (completions, active learners) and the bad (stalled cohorts, never-started, failed
sends) at a glance, with drill-downs and filters.

This is **read-mostly**: a new `admin-dashboard` module exposing aggregate + list endpoints,
plus a small amount of **instrumentation** to make two currently-invisible things queryable
(engagement emails sent, password changes).

### What we already have (verified)
17 queryable signals exist. Highlights:
- **`login_events`** (userId, ipAddress, userAgent, createdAt) — every successful login. Indexed `(userId, createdAt desc)` and `(createdAt desc)`. *(5 rows live — tracking is fresh.)*
- **`section_time_spent`** (userId, courseId, totalSeconds, lastHeartbeatAt) — time-on-platform via heartbeats.
- **Activity signals** with timestamps: `user_course_progress`, `last_seen_section`, `quiz_progress`, `assessment_attempts`, `assignment_submissions`, `forum_threads`, `forum_comments`, completion/form/policy tables.
- **`course_completions`** (userId, courseId, isPassed, assessmentPassedAt, certificateUrl). *(0 rows live.)*
- **`user_courses`** (isActive, isPaid, activatedAt) — enrollment + activation.
- **`notifications`** with `type=ENGAGEMENT_REMINDER` + `payload.reminderType` + dedupeKey — the in-app half of reminders.
- **`password_resets`** (consumedAt = when a forgot-password reset completed).
- **`users`** (role admin|user, status active|inactive, createdAt, deletedAt, `mustChangePassword`).

### Constraints (verified)
- **Admin-only guard:** `@UseGuards(AuthGuard('jwt'))` → `JwtAdminStrategy` enforces `role==='admin'`. (`cJwt` = both roles; `uJwt` = user only.)
- **Neon `connection_limit=1`:** queries run **sequentially** — no `$transaction([])`, no parallel awaits. Prefer few fat aggregate queries (`COUNT(*) FILTER (...)`, `GROUP BY`) over N+1.
- **Raw SQL not auto-retried:** wrap `$queryRaw` in [withDbRetry](src/utils/with-db-retry.ts) `{mode:'read'}`.
- **Response envelope:** `{ message, statusCode, data }`. **PrismaService is @Global** (inject anywhere).

### Two gaps to close (small instrumentation)
| Ask | Today | Fix |
| --- | --- | --- |
| "logs for which users we send low-engagement emails and which not" | Engagement emails only hit `console`/MailService logs; not queryable. Notification rows exist but don't record email **delivery** success/failure. | Add an **`EmailLog`** table written by `MailService` (recipient, type, status, providerId, error, createdAt). |
| "which users changed the password" | `password_resets.consumedAt` covers forgot-password, but the **force-change-on-first-login** flow writes no audit; `User` has no `passwordChangedAt`. | Add **`User.passwordChangedAt`** + write a row to a lightweight **`SecurityEvent`** log on every password change (reset, force-change, admin change). |

---

## Proposed dashboard surface (I've made the calls; trim as you like)

### Module: `src/admin-dashboard/` — all routes `@UseGuards(AuthGuard('jwt'))`, base `GET /api/v1/admin/dashboard/...`

### 1. `GET /overview` — KPI cards (single fat query, cheap)
- Users: total, active, inactive, admins, **pending first password change** (`mustChangePassword=true`), new this week.
- Courses: total active.
- Enrollments: active vs assigned-but-not-activated.
- **Logins today** + last 7 days.
- **Active learners** today + last 7 days (distinct users with any activity).
- Course completions to date.
- Engagement reminders sent (last 7 days, split never-started/stalled).
- Returns one object of counts. Implemented as a few `COUNT(*) FILTER (WHERE ...)` statements run sequentially.

### 2. `GET /logins` — "who logged in"
- `GET /logins/today` → count + list (user, time, ip, device) of today's logins.
- `GET /logins?from&to&cursor&limit` → paginated recent logins with daily-count series for the chart.
- `GET /logins/trend?days=7` → daily login counts (last N days) for a sparkline/bar chart.

### 3. `GET /activity` — "which user did which activity, today & last 5 days"
- A **unified activity feed**: one bounded `UNION ALL` across the activity signals (progress, last-seen, quiz, assessment submit/grade, assignment submit, forum post/comment, completion), each row → `{ userId, userName, type, courseId, courseTitle, occurredAt, detail }`, ordered by `occurredAt desc`, windowed to `now - 5 days`, capped + cursor-paginated.
- `GET /activity/daily-active?days=7` → distinct-active-users per day (DAU trend).
- `GET /activity/by-user/:userId?days=5` → one learner's recent activity timeline (reuses tracking endpoints where possible).

### 4. `GET /completions` — "how many users completed which courses, to date" (filterable)
- `GET /completions?courseId&from&to&passed=true|false&cursor&limit` → list of completions with user + course + passedAt + score.
- `GET /completions/by-course` → per-course rollup: enrolled / activated / started / completed counts + completion-rate %. The funnel that shows "good vs bad" per course.
- Note: `course_completions.courseCompletedAt` is currently never set (only `assessmentPassedAt`). We report off `isPassed` + `assessmentPassedAt`; flagged as a known nuance.

### 5. `GET /engagement` — reminder health & send log
- `GET /engagement/cohorts` → live counts of never-started vs stalled (reuses the engagement detection SQL, count-only).
- `GET /engagement/sent?type&from&to&cursor&limit` → **who got reminded**, when, which type, **email delivery status** (joins notifications + new `EmailLog`).
- `GET /engagement/not-reminded` → enrolled-but-not-yet-reminded (the inverse — "which not").

### 6. `GET /security` — account & password events
- `GET /security/password-events?from&to&cursor&limit` → password changes & resets (from `SecurityEvent`): who, when, which kind (forgot-reset / first-login / admin).
- `GET /security/pending-first-login` → accounts with `mustChangePassword=true` (admin-created, not yet onboarded).
- `GET /security/recent-accounts?days=7` → newly created accounts.

---

## Implementation phases

### Phase 1 — Read-only dashboard over existing data (NO migrations)
Build the `admin-dashboard` module: `/overview`, `/logins*`, `/activity*`, `/completions*`,
`/engagement/cohorts`, `/security/pending-first-login`, `/security/recent-accounts`.
Everything that's answerable **today** from existing tables. Ships value immediately, zero schema risk.

- New files: `src/admin-dashboard/{admin-dashboard.module,admin-dashboard.controller,admin-dashboard.service}.ts`, a `dashboard.queries.ts` for the raw SQL.
- Reuse: `AuthGuard('jwt')`, `withDbRetry`, the engagement detection SQL (extract count-only variant), tracking service for per-user drill-down.
- Wire module into [app.module.ts](src/app.module.ts).

### Phase 2 — Instrumentation for the two gaps (small migrations)
1. **`EmailLog`** table + write from [MailService](src/mail/mail.service.ts) on every send (success + failure, with Resend message id / error). Unlocks `/engagement/sent` delivery status and a global "email deliverability" view.
2. **`SecurityEvent`** table + `User.passwordChangedAt`; write on all three password-change paths (forgot-reset, force-change, any admin reset). Unlocks `/security/password-events`.
- Both additive, default-safe, backfill where sensible (e.g. `SecurityEvent` seeded from existing `password_resets.consumedAt`).

### Phase 3 — Polish (optional)
- CSV export for the list endpoints, configurable date presets, caching of `/overview` (short TTL) if it gets heavy, and a `courseCompletedAt` fix so completion timing is precise.

---

## Verification
1. **Build/migrate:** `prisma generate` + `migrate deploy` (Phase 2), `npm run build`, `tsc --noEmit`, lint.
2. **Auth:** hit each endpoint with a **user** JWT → expect 403; with an **admin** JWT → 200.
3. **Correctness:** cross-check `/overview` counts against direct DB counts (e.g. `users` non-deleted = 29 today). Seed a login + an activity row and confirm they appear in `/logins/today` and `/activity`.
4. **Performance:** confirm the unified `/activity` UNION stays bounded (5-day window + limit) and uses indexes; time it against prod-sized data.
5. **Engagement send log (Phase 2):** trigger the sweep, confirm `/engagement/sent` lists the reminded users with delivery status.

---

## Open decisions for you
1. **Scope now:** build **Phase 1 only** first (fast, no migrations), or **Phase 1 + 2** together (adds the email + password-change logs you specifically asked for)?
2. **Instrumentation depth:** for the audit log, a focused **`EmailLog` + `SecurityEvent`** (recommended), or a single generic **`AuditEvent`** table capturing many event types (more flexible, more upfront design)?
3. Anything on the surface above to **add or drop** — you mentioned "etc etc"; tell me if there's a specific cut you care most about (e.g. revenue/`isPaid`, per-course time-on-platform leaderboards, geographic/IP breakdown from login events).
