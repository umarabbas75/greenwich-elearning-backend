# Admin Dashboard — Frontend Handoff

Backend for the admin analytics dashboard is live. This doc lists every endpoint, its
query params, and its exact response shape so the FE can build against it directly.

## Conventions

- **Base URL:** all paths are prefixed `/api/v1`. Full base: `/api/v1/admin/dashboard`.
- **Auth:** **admin only.** Every endpoint requires the admin JWT
  (`Authorization: Bearer <token>`). A **student** token → `403`; **no token** → `401`.
  (Same token you get from `POST /auth/login` for a user whose `role === 'admin'`.)
- **Envelope:** every response is `{ message, statusCode, data }`. Shapes below describe `data`.
- **Pagination:** list endpoints use **keyset cursor** pagination. Response has
  `{ data: [...], nextCursor }`. Pass `?cursor=<nextCursor>&limit=N` for the next page;
  `nextCursor: null` means no more pages. `limit` defaults vary (noted per endpoint), clamped to ≤100.
- **Dates:** all timestamps are ISO 8601 UTC strings. Date-range filters (`from`/`to`) accept ISO strings.
- **Counts:** numeric.

---

## 1. Overview — KPI cards

`GET /admin/dashboard/overview` — no params.

```jsonc
{
  "users": {
    "total": 29, "active": 23, "inactive": 6, "admins": 2, "students": 27,
    "pendingFirstLogin": 0,   // admin-created accounts not yet through first-login pw change
    "newThisWeek": 11
  },
  "courses": { "active": 5 },
  "enrollments": {
    "active": 25,               // UserCourse.isActive = true (unlocked for the student)
    "assignedNotActivated": 4,  // assigned but admin hasn't activated yet
    "paid": 1
  },
  "logins": { "today": 7, "last7Days": 7 },
  "activeLearners": { "today": 12, "last7Days": 17 },  // distinct users with ANY activity
  "completions": { "total": 0, "passed": 0 },
  "engagementReminders": { "sentLast7Days": 0, "neverStartedTotal": 0, "stalledTotal": 0 }
}
```

Use for the top KPI card row. Single cheap call.

---

## 2. Logins

### 2.1 `GET /admin/dashboard/logins/today` — who logged in today
```jsonc
{
  "totalLogins": 8,        // total login events today (a user can appear more than once)
  "distinctUsers": 4,
  "logins": [
    { "userId": "…", "name": "umar abbas", "email": "…",
      "at": "2026-06-08T19:18:58.643Z", "ip": "::1",
      "device": { "os": "macOS", "browser": "Chrome" } }
  ]
}
```

### 2.2 `GET /admin/dashboard/logins/trend?days=7` — daily login chart
```jsonc
{ "days": 7,
  "series": [ { "date": "2026-06-08T00:00:00.000Z", "logins": 9, "distinctUsers": 4 } ] }
```
Note: only days **with** logins appear. The FE should zero-fill missing days across the range for a continuous chart.

### 2.3 `GET /admin/dashboard/logins?cursor&limit` — paginated recent logins (default limit 30)
```jsonc
{ "data": [ { "id": "…", "userId": "…", "name": "…", "email": "…",
             "at": "…", "ip": "::1", "device": { "os": "Windows", "browser": "Edge" } } ],
  "nextCursor": "…" }
```

### 2.4 `GET /admin/dashboard/logins/breakdown?days=30` — device/browser breakdown
```jsonc
{ "days": 30, "totalLogins": 9,
  "byOs":      [ { "label": "macOS", "count": 3 }, { "label": "Windows", "count": 1 } ],
  "byBrowser": [ { "label": "Chrome", "count": 2 }, { "label": "Firefox", "count": 2 } ] }
```
Good for pie/bar charts. `"Unknown"` = login had no user-agent (e.g. server-side/cURL calls).

---

## 3. Activity

### 3.1 `GET /admin/dashboard/activity?days=5&cursor&limit&userId` — unified activity feed
"Which user did which activity." Spans 8 signals. `days` default 5, `limit` default 50.
Optional `userId` to scope to one learner.
```jsonc
{ "days": 5,
  "data": [
    { "userId": "…", "name": "Muhammad Ahmed Hasan", "email": "…",
      "type": "SECTION_PROGRESS",          // see types below
      "courseId": "…", "courseTitle": "NEBOSH…",
      "detail": null,                       // type-specific extra (status / excerpt / etc.)
      "at": "2026-06-08T17:23:37.761Z" }
  ],
  "nextCursor": "2026-06-08T17:20:00.000Z"  // ISO timestamp cursor (pass as ?cursor=)
}
```
**`type` values:** `SECTION_PROGRESS`, `SECTION_VIEW`, `QUIZ` (detail `passed`/`attempted`),
`ASSESSMENT` (detail = attempt status), `ASSIGNMENT` (detail = submission status),
`FORUM_THREAD` (detail = title), `FORUM_COMMENT` (detail = excerpt), `COURSE_COMPLETED`.
> Cursor here is an **ISO timestamp** (not an id). Just echo `nextCursor` back as `?cursor=`.

### 3.2 `GET /admin/dashboard/activity/daily-active?days=7` — DAU trend
```jsonc
{ "days": 7,
  "series": [ { "date": "2026-06-04T00:00:00.000Z", "activeUsers": 12 } ] }
```
Zero-fill missing days on the FE.

---

## 4. Completions

### 4.1 `GET /admin/dashboard/completions?courseId&from&to&passed&cursor&limit`
Filterable list (default limit 30). `passed` = `true`|`false`. `from`/`to` filter on pass date.
```jsonc
{ "data": [
    { "id": "…", "userId": "…", "name": "…", "email": "…",
      "courseId": "…", "courseTitle": "…", "isPassed": true,
      "passedAt": "…", "certificateUrl": "…" } ],
  "nextCursor": null }
```

### 4.2 `GET /admin/dashboard/completions/by-course` — per-course funnel
```jsonc
{ "courses": [
    { "courseId": "…", "title": "NEBOSH…",
      "enrolled": 21, "activated": 19, "started": 18, "completed": 0,
      "completionRatePct": 0 } ]   // completed / enrolled
}
```
Funnel chart: enrolled → activated → started → completed. Sorted by `enrolled` desc.

---

## 5. Engagement

### 5.1 `GET /admin/dashboard/engagement/cohorts` — live at-risk cohort sizes
```jsonc
{ "thresholds": { "neverStartedDays": 3, "stalledDays": 7 },
  "neverStarted": 2,   // enrolled, activated, zero activity past threshold
  "stalled": 7 }       // had activity, then quiet past threshold
```

### 5.2 `GET /admin/dashboard/engagement/sent?from&to&cursor&limit` — reminder send log
Who got a low-engagement email + delivery status (default limit 30).
```jsonc
{ "data": [
    { "id": "…", "userId": "…", "name": "…", "email": "…",
      "status": "SENT",                 // SENT | FAILED | SKIPPED
      "reminderType": "stalled",        // never_started | stalled
      "courseTitle": "…", "error": null, "at": "…" } ],
  "nextCursor": null }
```
`SKIPPED` = mail was disabled (no API key) when the sweep ran. `FAILED` → see `error`.

---

## 6. Security

### 6.1 `GET /admin/dashboard/security/password-events?from&to&cursor&limit`
Password change/reset history (default limit 30).
```jsonc
{ "data": [
    { "id": "…", "userId": "…", "name": "…", "email": "…",
      "kind": "PASSWORD_RESET_COMPLETED",  // | PASSWORD_CHANGED_FIRST_LOGIN | PASSWORD_CHANGED
      "at": "…" } ],
  "nextCursor": null }
```

### 6.2 `GET /admin/dashboard/security/pending-first-login` — accounts awaiting first-login pw change
```jsonc
{ "count": 0,
  "users": [ { "id": "…", "name": "…", "email": "…", "status": "active", "createdAt": "…" } ] }
```
(Capped at 200, newest first.)

### 6.3 `GET /admin/dashboard/security/recent-accounts?days=7` — newly created accounts
```jsonc
{ "days": 7, "count": 11,
  "users": [ { "id": "…", "name": "…", "email": "…", "role": "user",
               "status": "active", "pendingFirstLogin": false, "createdAt": "…" } ] }
```

---

## 7. Time-on-platform leaderboard

`GET /admin/dashboard/leaderboards/time?courseId&limit` — top users by active time (default limit 20).
Optional `courseId` to scope to one course.
```jsonc
{ "courseId": null,
  "leaderboard": [
    { "rank": 1, "userId": "…", "name": "umar test2", "email": "…",
      "totalSeconds": 3548, "totalHours": 1, "coursesTouched": 1 } ]
}
```
Time comes from section-view heartbeats (capped, so it reflects *active* time, not tab-open time).

---

## Endpoint quick-reference

| Method | Path | Key params |
| --- | --- | --- |
| GET | `/admin/dashboard/overview` | — |
| GET | `/admin/dashboard/logins/today` | — |
| GET | `/admin/dashboard/logins/trend` | `days` (def 7) |
| GET | `/admin/dashboard/logins` | `cursor`, `limit` (def 30) |
| GET | `/admin/dashboard/logins/breakdown` | `days` (def 30) |
| GET | `/admin/dashboard/activity` | `days` (def 5), `cursor`, `limit` (def 50), `userId` |
| GET | `/admin/dashboard/activity/daily-active` | `days` (def 7) |
| GET | `/admin/dashboard/completions` | `courseId`, `from`, `to`, `passed`, `cursor`, `limit` (def 30) |
| GET | `/admin/dashboard/completions/by-course` | — |
| GET | `/admin/dashboard/engagement/cohorts` | — |
| GET | `/admin/dashboard/engagement/sent` | `from`, `to`, `cursor`, `limit` (def 30) |
| GET | `/admin/dashboard/security/password-events` | `from`, `to`, `cursor`, `limit` (def 30) |
| GET | `/admin/dashboard/security/pending-first-login` | — |
| GET | `/admin/dashboard/security/recent-accounts` | `days` (def 7) |
| GET | `/admin/dashboard/leaderboards/time` | `courseId`, `limit` (def 20) |

## Notes & caveats
- **Completions read off `isPassed` + `assessmentPassedAt`.** `courseCompletedAt` isn't populated
  yet (known backend nuance), so "completed" currently means "passed the assessment".
- **Trend/DAU series omit empty days** — zero-fill on the FE for continuous charts.
- **`device.os/browser` = "Unknown"** when the login had no user-agent (server-side calls).
- **All data is live/real-time** (no caching). If `/overview` or `/activity` feel heavy at scale,
  ping backend — we can add a short cache or narrow default windows.
- Numbers reflect the current DB; e.g. completions are `0` until students start passing assessments.
