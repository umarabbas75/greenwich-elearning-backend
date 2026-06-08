# Platform Tracking — Frontend / Backend Contract

**Status:** Backend implemented, migrated, and live-tested end-to-end.
**Owner:** Backend. Hand this to the FE team.

Tracks three things:
1. **Login times** — when each user logs in.
2. **IP address** (+ user-agent) — captured at login.
3. **Time spent** — active seconds per section (lesson), rolled up to
   chapter / module / course.

All routes are under the global prefix `/api/v1` and use the standard envelope
`{ message, statusCode, data }`. All require the existing `cJwt` guard
(send the `Authorization: Bearer <jwt>` header).

---

## 1. Login + IP tracking — NO frontend work

This is **fully automatic**. The backend records a `LoginEvent` (timestamp, IP,
user-agent) on every successful `POST /auth/login`. The FE does not send or do
anything extra — IP is read server-side from the `x-forwarded-for` header that
Vercel sets.

The FE only consumes this via the report endpoints in §3.

---

## 2. Time-spent tracking — heartbeat (FE work required)

### The model
While a user has a **section (lesson)** open, the FE sends a periodic
"heartbeat" ping. The backend accrues active time from these pings.

### Endpoint
```
POST /api/v1/tracking/heartbeat
Authorization: Bearer <jwt>
Body: {
  "sectionId":      "<the section currently open>",
  "activeSeconds":  30,    // active time the CLIENT measured since its last ping
  "intervalSeconds": 30    // the client's ping cadence (used to size the cap)
}
```
Response:
```json
{ "message": "Heartbeat recorded", "statusCode": 200,
  "data": { "totalSeconds": 124 } }
```
`totalSeconds` is the running total for *that section*.

The user is taken from the JWT — never send a userId. The backend resolves the
section's chapter / module / course itself, so the FE only sends section +
timing.

### IMPORTANT — the client measures active time (`activeSeconds`)
The backend credits **`min(activeSeconds, serverGap, perPingCap)`**:
- `activeSeconds` — **you** measure this: the seconds the lesson was open AND
  the tab visible AND the user not idle, **since your last successful ping**.
- `serverGap` — real elapsed server time since your last ping (the backend's own
  clock). The `min` means you can never be credited more than real elapsed
  time, so a client can't inflate the total.
- `perPingCap` — `intervalSeconds × 3` (max 90s), a backstop on any single ping.

**Why this matters:** when the tab is hidden/idle you keep `activeSeconds` at 0
(or pause pinging), so an away period credits **0** — not the whole gap. This is
the fix for the old behaviour where a 2-minute absence wrongly added ~90s.

### How the FE should ping
- Keep a counter of **active seconds** for the open section: increment it on a
  timer ONLY while `document.visibilityState === 'visible'` and the user isn't
  idle. Pause it on `visibilitychange`-hidden / idle.
- Every ~30s, POST the heartbeat with the `activeSeconds` accumulated since the
  last successful ping, then **reset that counter to 0**.
- Send `intervalSeconds` = your cadence (e.g. 30).
- **First ping on opening** a section is fine to send (it just "opens the books"
  — the backend credits 0 for the very first ping and starts the clock).
- Switching sections: reset the counter and start sending the new `sectionId`.
  No "stop" call needed.
- On crash/close/sleep: nothing special — the next real ping reports honest
  `activeSeconds ≈ 0` for the gap, so nothing is over-counted.

### Recommended FE shape
```ts
let activeSeconds = 0;
// tick every 1s; only count while visible + not idle
const tick = setInterval(() => {
  if (document.visibilityState === 'visible' && !idle) activeSeconds += 1;
}, 1_000);

// flush to the backend every 30s
const beat = setInterval(async () => {
  const active = activeSeconds; activeSeconds = 0;      // reset on send
  await sendHeartbeat({ sectionId, activeSeconds: active, intervalSeconds: 30 });
}, 30_000);

// on section close/unmount: clearInterval(tick); clearInterval(beat);
```
Heartbeat failures are non-critical — fire-and-forget; don't block the UI or
retry aggressively. (If a send fails, it's fine to fold its `activeSeconds` back
into the counter so the next ping includes it — the `min(serverGap)` clamp keeps
it honest.)

### Old clients (sending only `{ sectionId }`)
Still accepted for backward-compat: they hit a conservative gap-rejection
fallback (credit = `min(serverGap, interval × 1.5)`), **not** the old buggy
rule. But all clients should send `activeSeconds` for accurate numbers.

---

## 3. Reports (read) — for admin/analytics screens

### 3.1 Login history
```
GET /api/v1/tracking/login-history/:userId        (any user — admin view)
GET /api/v1/tracking/login-history                 (the current user)
   ?limit=50   (default 50, max 200)
```
Response:
```json
{
  "message": "Login history fetched successfully",
  "statusCode": 200,
  "data": [
    {
      "id": "...",
      "ipAddress": "203.0.113.7",
      "userAgent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ... Chrome/120.0 ...",
      "createdAt": "2026-06-08T08:54:08.050Z",
      "device": "Chrome on macOS",
      "browser": "Chrome",
      "os": "macOS",
      "deviceType": "desktop"
    }
  ]
}
```
Newest first. The backend now **parses the user-agent for you** — render `device`
directly (e.g. "Chrome on macOS"); `browser` / `os` / `deviceType`
(`mobile`|`tablet`|`desktop`) are also provided for icons/filters. The raw
`userAgent` is still included for finer detail. When the UA can't be parsed,
`device` is `"Unknown device"` and the parts are `"Unknown"` / `"desktop"`.

**On `ipAddress`:** in local dev this is `::1` (IPv6 localhost) — that's correct,
you're on the same machine. In production behind Vercel it's the real client IP
(read from `x-forwarded-for`). It may be `null` if a proxy stripped it.

### 3.2 Time spent in a course
```
GET /api/v1/tracking/time-spent/:userId/:courseId
```
Response:
Response — a **named, nested tree** (module → chapter → lesson), each level with
its `title` and `totalSeconds`, plus a flat `perSection` list:
```json
{
  "message": "Time spent fetched successfully",
  "statusCode": 200,
  "data": {
    "courseId": "2ef7...",
    "totalSeconds": 90,
    "modules": [
      {
        "moduleId": "9cf8...",
        "title": "UNIT GIC2: RISK ASSESSMENT",
        "totalSeconds": 90,
        "chapters": [
          {
            "chapterId": "fc3a...",
            "title": "Element 6: Musculoskeletal Health",
            "totalSeconds": 45,
            "sections": [
              { "sectionId": "04a5...", "title": "6.3 Load Handling Equipment", "totalSeconds": 45 }
            ]
          }
        ]
      }
    ],
    "perSection": [
      { "sectionId": "04a5...", "chapterId": "fc3a...", "moduleId": "9cf8...",
        "title": "6.3 Load Handling Equipment", "totalSeconds": 45 }
    ]
  }
}
```
**This drives the per-lesson drill-down** the report UI needs: render `modules[]`,
expand each to its `chapters[]`, expand each chapter to its `sections[]` (lessons)
— all with names, no extra lookups. Totals roll up consistently
(sum of lessons = chapter = module = course). Convert seconds to h/m/s in the FE.

> **Shape change:** the old flat `perModule` / `perChapter` arrays were replaced
> by the nested `modules` tree (which carries the same totals plus titles). If
> your screen only rendered `perModule` before, switch to `modules` (each node
> has `moduleId` + `title` + `totalSeconds` + `chapters`). A lesson with no
> module resolves under a `{ moduleId: null, title: "Unassigned" }` node.

---

## 4. Notes / edge cases

- **Auth:** every endpoint needs the `cJwt` bearer token. Heartbeats from a
  logged-out user are rejected.
- **Idle/closed tabs:** handled by the 90s cap (see §2) — the FE doesn't need a
  "stop" call, but SHOULD pause pinging when hidden/idle for accurate numbers.
- **Unknown section:** `POST /tracking/heartbeat` with a bad `sectionId` returns
  `404`; a section not linked to a course returns `400`. The FE can ignore these
  (tracking is best-effort) — they won't affect the learning UI.
- **Privacy:** IP + user-agent are stored for security/audit. If you later need
  a retention policy or user-facing "your login history", these tables already
  support it.

---

## 5. Config (server-side, for reference)

| Setting | Value | Where |
| ------- | ----- | ----- |
| Heartbeat cadence (expected) | 30s | FE |
| Max accrual per ping (cap) | 90s | `tracking.service.ts` |
| Login-history page size | 50 (max 200) | `tracking.service.ts` |

Tables: `login_events`, `section_time_spent` (migration
`20260608120000_platform_tracking`).
