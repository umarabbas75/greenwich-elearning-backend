# Notifications — Frontend / Backend Contract

**Owner:** FE (Umar) — please align backend to this spec.
**Status:** Frontend is implemented against this contract. Backend currently
ships a subset (Wave 1). Items marked **PENDING** are blocking nothing
critical, but the FE assumes them and degrades gracefully where possible.

---

## 1. Behavioral model

Three states per notification, derived from two timestamps:

| State        | Definition                                             | UI effect                                                  |
| ------------ | ------------------------------------------------------ | ---------------------------------------------------------- |
| **unseen**   | `seenAt = null`                                        | Counted in the **bell badge** (orange ping on the icon).   |
| **seen**     | `seenAt != null AND readAt = null`                     | Cleared from bell badge, still bold/highlighted in list.   |
| **read**     | `readAt != null` (implies `seenAt != null`)            | No badge anywhere, default styling, no orange dot.         |

Transitions:

- **unseen → seen**: panel is opened. One bulk call: `PATCH /notifications/mark-all-seen`.
- **unseen/seen → read**: row is clicked, or "Mark as read" button, or
  "Mark all as read".
- `readAt` implies `seenAt` — backend must enforce
  `seenAt = COALESCE(seenAt, readAt)` whenever it sets `readAt`.

The FE **never** writes to `seenAt`/`readAt` directly. It calls endpoints
and trusts the next fetch (with optimistic updates in between).

There is **no IntersectionObserver, no localStorage, no client-side
"seen" tracking.** "Seen" is a server-side concept.

---

## 2. Data model — `Notification`

```ts
{
  id: string;                 // uuid
  userId: string;             // recipient
  type: NotificationType;     // enum, see §3
  message: string;            // legacy pre-rendered string — keep, but FE
                              // prefers `payload` when present (§4)
  payload: Json | null;       // PENDING — see §4
  groupKey: string | null;    // PENDING — see §5
  dedupeKey: string | null;   // PENDING — see §6
  seenAt: string | null;      // ISO timestamp
  readAt: string | null;      // ISO timestamp
  referenceId: string | null; // attemptId / assessmentId / etc.
  threadId: string | null;    // forum thread reference
  commenterId: string | null; // user who triggered it
  commenter: {                // hydrated on read
    id, firstName, lastName, photo
  } | null;
  createdAt: string;
  updatedAt: string;
}
```

**Removed:** `isRead` boolean. The FE accepts it during the Wave 2
migration but the canonical shape is `seenAt` + `readAt`.

---

## 3. `NotificationType` enum

```
ASSESSMENT_SUBMITTED   // → admin: a student submitted an assessment
ASSESSMENT_GRADED      // → student: admin finalized their attempt
FORUM_THREAD           // → all users: admin created a new thread
FORUM_COMMENT          // → thread subscribers: new comment on a thread
```

If we add more types, the FE renderer falls back to `item.message` as
plain text. Adding a type does not require an FE change to land,
but `routeFor()` (§9) must be extended to make it clickable.

---

## 4. `payload` — structured template data **(PENDING — Wave 2 PR 3)**

The FE wants to stop rendering pre-baked `message` strings and render
from structured payload + i18n templates. Until `payload` ships, FE
falls back to `message`. Proposed payload shapes per type:

```ts
// ASSESSMENT_SUBMITTED
{
  assessmentId: string;
  assessmentTitle: string;
  attemptId: string;
  studentFirstName: string;
  studentLastName: string;
}

// ASSESSMENT_GRADED
{
  assessmentId: string;
  assessmentTitle: string;
  attemptId: string;
  passed: boolean;
  scorePct: number;
}

// FORUM_THREAD
{
  threadId: string;
  threadTitle: string;
  creatorFirstName: string;
  creatorLastName: string;
}

// FORUM_COMMENT
{
  threadId: string;
  threadTitle: string;
  commentId: string;
  commentExcerpt: string;            // first 140 chars
  commenterFirstName: string;
  commenterLastName: string;
}
```

The FE will define exhaustive `assertNever`-style switch on `type` once
this lands. Until then, please keep `message` populated alongside.

---

## 5. `groupKey` — collapsed rows **(PENDING — Wave 2 PR 3)**

When multiple notifications share a `groupKey`, the FE renders them as
one row with "+N more …" suffix. Convention:

| Type                  | `groupKey`                              |
| --------------------- | --------------------------------------- |
| `ASSESSMENT_SUBMITTED`| `assessment-submitted:<assessmentId>`   |
| `ASSESSMENT_GRADED`   | `null` (per-student, no grouping)       |
| `FORUM_THREAD`        | `null`                                  |
| `FORUM_COMMENT`       | `forum-comment:<threadId>`              |

Until `groupKey` ships, FE groups client-side on
`(type, message)` for `ASSESSMENT_SUBMITTED`, which is fragile (any
message copy change breaks the grouping). Please prioritize.

---

## 6. `dedupeKey` — idempotency **(PENDING — Wave 2 PR 3)**

Add `@@unique([userId, dedupeKey])` (partial, allow nulls). Trigger
sites should set:

| Site                            | `dedupeKey`                                              |
| ------------------------------- | -------------------------------------------------------- |
| Assessment submitted            | `submitted:<attemptId>`                                  |
| Assessment graded               | `graded:<attemptId>:<finalizeIteration>` *or just attemptId if you never re-finalize* |
| New forum thread broadcast      | `thread-created:<threadId>:<userId>`                     |
| New forum comment fan-out       | `comment:<commentId>:<userId>`                           |

Insertion strategy: `ON CONFLICT (userId, dedupeKey) DO NOTHING`.
FE does not need to handle this — it just stops seeing duplicates.

---

## 6.5 Response envelope — **MUST FIX**

Every other endpoint in the app wraps its body in:

```json
{
  "message": "...",
  "statusCode": 200,
  "data": <actual payload>
}
```

The notifications endpoints **do not** follow this convention today.
`GET /notifications` returns a bare array. `GET /notifications/unread-count`
returns `{ count: 1 }`. This caused the FE list to render empty after
the Wave 2 wiring landed, because the selector tries the standard path
first.

**Action:** wrap every notification response (existing and new) in the
standard envelope. Concrete examples below assume this is done — i.e.
when you see `{ "data": [...], "nextCursor": ... }` in §7, the wire
body is actually:

```json
{
  "message": "Notifications fetched successfully",
  "statusCode": 200,
  "data": { "data": [...], "nextCursor": null, "unreadCount": 7, "unseenCount": 2 }
}
```

The FE accepts both shapes today as a defensive measure, but please
standardize so we can stop carrying the compat code.

---

## 7. Endpoints — canonical

All notification endpoints require the existing `cJwt` (combined
user/admin) guard.

### 7.1 `GET /notifications`

List the caller's notifications, paginated.

**Query params:**

| Param     | Type                                       | Default | Notes                                       |
| --------- | ------------------------------------------ | ------- | ------------------------------------------- |
| `cursor`  | string (notification id)                   | none    | Returns rows older than this id.            |
| `limit`   | integer                                    | 20      | Server clamps to `[1, 50]`.                 |
| `filter`  | `all` \| `unread`                          | `all`   |                                             |
| `type`    | `NotificationType`                         | —       | Optional, single value.                     |

**Response:**

```json
{
  "data": [ /* Notification[] — newest first */ ],
  "nextCursor": "uuid-or-null",
  "unreadCount": 7,
  "unseenCount": 2
}
```

Cursor is on `(createdAt DESC, id DESC)` tiebreaker.

### 7.2 `GET /notifications/unread-count`

Cheap source-of-truth for the bell badge. Polled by the FE every 60s
and on window focus.

```json
{ "unread": 7, "unseen": 2 }
```

**Note:** BE Wave 1 currently returns `{ count }` only. Please extend
to `{ unread, unseen }`. FE falls back to `count` as `unread` if only
that is present.

### 7.3 `PATCH /notifications/:id/mark-as-read`

Marks one notification as read. Sets both `readAt` and (if null)
`seenAt` to `now()`.

- **Path param:** `id` (notification id).
- **Body:** none.
- **Ownership:** must belong to caller. Returns `404` (not `403`) if
  the row doesn't exist or belongs to someone else.
- **Response:** `{ "id": "...", "readAt": "...", "seenAt": "..." }`.

**Legacy alias** (kept during migration, will be removed once FE
cuts over): `PUT /notifications/markAsRead` with body `{ id }`.

### 7.4 `PATCH /notifications/mark-all-read`

Marks every unread notification belonging to the caller as read.

- **Body:** none.
- **SQL:** `UPDATE notifications SET readAt = now(), seenAt = COALESCE(seenAt, now()) WHERE userId = $1 AND readAt IS NULL`.
- **Response:** `{ "updated": 12 }`.

**Legacy alias:** `POST /notifications/mark-all-read`.

### 7.5 `PATCH /notifications/mark-all-seen` **(PENDING — Wave 2 PR 2)**

Marks every unseen notification belonging to the caller as seen.

- **Body:** none.
- **SQL:** `UPDATE notifications SET seenAt = now() WHERE userId = $1 AND seenAt IS NULL`.
- **Response:** `{ "updated": 2 }`.

The FE calls this **every time the bell dropdown opens** (if
`unseenCount > 0`). It must be cheap.

### 7.6 Not building (yet)

| Path                                            | Why not                                |
| ----------------------------------------------- | -------------------------------------- |
| `PATCH /notifications/:id/mark-as-seen`         | Treating "seen" as bulk-only.          |
| `DELETE /notifications/:id`                     | Archive flow not in scope.             |
| `POST /notifications/preferences`               | User mute/unmute — defer to Wave 3.    |
| SSE / WebSocket push                            | Polling is fine at current scale.      |

---

## 8. Verb & casing standard

Going forward, **all** notification endpoints:

- **Verb:** `PATCH` for any state mutation (read/seen).
  `GET` for reads. No `PUT`/`POST` for these.
- **Casing:** kebab-case in path segments
  (`mark-as-read`, `unread-count`).
- **IDs:** in the path, not the body.

Legacy aliases (`PUT /notifications/markAsRead`,
`POST /notifications/mark-all-read`) remain available for 60 days from
the merge of the aliases PR. FE will migrate within ~2 weeks. Backend
should emit `Deprecation: true` and `Sunset: <date>` response headers
on the legacy paths, and add `@deprecated` annotations.

---

## 9. FE behaviors — what the FE actually does

### Bell badge
- Shows orange ping iff `unseenCount > 0`.
- Source: `GET /notifications/unread-count`, polled every 60s + on focus.
- Does **not** decrement client-side except via optimistic updates
  during a known mutation.

### Opening the panel
- If `unseenCount > 0`: fire `PATCH /notifications/mark-all-seen`
  + optimistically set `seenAt` on every loaded row + zero the
  unseen count in cache.
- This is the **only** "seen" trigger from the FE.

### Tabs
- `All` / `Unread (N)` / `Assessments` / `Forum`. Pure client-side
  filters on the loaded page. No separate fetch per tab.

### Grouping
- If `groupKey` is present on multiple items, the FE collapses them
  into one row with "+N more" suffix and shows the latest as the
  primary content.
- A row counts as "has unread" if any item in the group is unread.
- Clicking a grouped row navigates using the **latest** item's
  reference. Marking a grouped row read marks every item in the
  group read.

### Clicking a row
1. Closes the dropdown.
2. Fires `PATCH /notifications/:id/mark-as-read` (single item or
   each item in the group).
3. Routes to:
   - `ASSESSMENT_SUBMITTED` → `/assessment/grade/<referenceId>`
     (admin grading page).
   - `ASSESSMENT_GRADED` → `/studentCourses` (until we have a
     deep-link to the graded attempt).
   - Anything with `threadId` → `/forum/<threadId>`.
   - Otherwise: no route, just mark read.

### Mark all as read
- Header button, only shown if `unreadCount > 0`.
- Fires `PATCH /notifications/mark-all-read`. Optimistically clears
  unread state on every loaded row.

### Stale references (404 from target page)
- When a notification points at a deleted attempt/assessment/thread,
  the destination page handles it (renders "no longer available"
  empty state + back link). Backend should return `404`, not `403`.
- **Future:** cascade-null `referenceId` / `threadId` when the target
  is deleted, so the FE can detect and grey out the row pre-click.
  Optional for now.

### Optimistic updates
- All mutations optimistically mutate the React Query cache
  (`get-notifications` + `notifications-unread-count`) and then call
  `invalidateQueries` `onSettled` so server state wins on the next
  fetch.

---

## 10. Indexes / performance notes

- Composite index: `(userId, readAt, createdAt DESC)`.
  Replaces the Wave 1 `(userId, isRead, createdAt DESC)` after the
  `isRead` → `readAt` migration.
- `mark-all-read` and `mark-all-seen` are unbounded `UPDATE`s by
  `userId`. With the index above they're O(unread rows for this
  user), which is small. No transaction wrapping needed —
  `updateMany` is a single atomic statement.
- `GET /notifications/unread-count` is two `COUNT(*)` queries (or one
  with `FILTER (WHERE …)`). Must use the index.
- Pagination: cursor on `(createdAt, id)`. No `OFFSET`.

---

## 11. Triggers — where notifications are written

No FE change here; recording the current contract for completeness:

| Event                                     | Trigger location                                      | Type                  | `referenceId`     | `threadId` | `commenterId` |
| ----------------------------------------- | ----------------------------------------------------- | --------------------- | ----------------- | ---------- | ------------- |
| New forum comment                         | `forum-comment.service.ts:40-60`                      | `FORUM_COMMENT`       | null              | threadId   | commenter     |
| Admin activates a forum thread            | `forum-thread.service.ts:288-335`                     | `FORUM_THREAD`        | null              | threadId   | admin         |
| Student submits an assessment             | `course-assessment.service.ts:884-895`                | `ASSESSMENT_SUBMITTED`| attemptId         | null       | studentId     |
| Admin finalizes grading                   | `course-assessment.service.ts:1174-1180`              | `ASSESSMENT_GRADED`   | attemptId         | null       | adminId       |

**Asks for backend cleanup:**

1. **Dedupe the forum-thread broadcast.** The inline fan-out in
   `forum-thread.service.ts:288-335` duplicates the unused
   `NotificationService.notifyAllUsersForNewThread`. Pick one.
2. **Rename directory** `src/notifiications/` → `src/notifications/`.
3. **Set `commenterId` on assessment notifications** (the student for
   `ASSESSMENT_SUBMITTED`, the admin for `ASSESSMENT_GRADED`) — today
   it's null for both, which is why FE can't show an avatar on
   assessment rows.
4. **Cascade-null** notification `referenceId` / `threadId` on parent
   delete, so dangling links can be detected at fetch time and the
   grading page's 404 path is reached cleanly.

---

## 12. Wave roadmap (recap)

| Wave         | Items                                                    | Status     |
| ------------ | -------------------------------------------------------- | ---------- |
| **1 — shipped** | Ownership check; `/unread-count` `{ count }`; `mark-all-read` (POST); composite index | ✅ live  |
| **2 PR 1**   | Pagination on `GET /notifications`; legacy aliases for new PATCH routes; extend `/unread-count` to `{ unread, unseen }` | ▶ in-flight |
| **2 PR 2**   | `seenAt` / `readAt` split + migration + backfill; `PATCH /notifications/mark-all-seen`; updated composite index | ⏳ pending |
| **2 PR 3**   | `payload` / `groupKey` / `dedupeKey` columns; populate on all triggers; FE switches to template rendering | ⏳ pending |
| **3**        | User preferences (mute by type); email digest worker; SSE push channel | 📅 later  |

---

## 13. Open questions for backend

1. `/unread-count` response shape — can we extend to `{ unread, unseen }`?
2. Confirm grouping convention in §5 — any reason to differ?
3. Confirm payload shapes in §4 — particularly the field names for the
   student/commenter on assessments.
4. For `ASSESSMENT_GRADED` re-finalize case, does `dedupeKey` need a
   suffix or do we just overwrite the existing row?
5. Cascade-null vs cascade-delete on parent delete (§9, §11)? My vote:
   cascade-null + 404 at fetch time.

Ping me on Slack on anything that doesn't match what you're building —
the FE is fully implemented against this doc, so divergence shows up as
runtime breakage.
