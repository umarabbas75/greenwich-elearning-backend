# User Deletion — Frontend / Backend Contract

**Owner:** BE (Umar) — keep this in sync with the backend implementation.
**Status:** Backend implemented & deployed. Migration `20260601120000_add_user_soft_delete` applied.
**Last updated:** 2026-06-01

---

## 1. What changed and why

Previously `DELETE /users/:id` did a **hard delete**. Because a user is linked
to ~27 other tables (enrollments, quiz/assessment progress, comments, forum
posts, course completions, submissions, …), the database almost always rejected
the delete with a foreign-key error, surfacing as:

```http
403 Forbidden
{ "status": 403, "error": "Cannot delete it because it is associated with other records." }
```

We switched to the industry-standard **soft delete** pattern:

- `DELETE /users/:id` now **flags** the user as deleted (`deletedAt` timestamp)
  instead of removing the row. **It always succeeds.**
- Soft-deleted users are hidden from all user reads and **cannot log in**.
- Their historical data (completions, submissions, audit trail) is preserved.
- A separate admin/GDPR **force-purge** endpoint does a true hard delete.

The FE should treat "delete user" as an action that always succeeds (no more
403-on-delete handling needed for the normal case).

---

## 2. Behavioral model

Two independent flags now describe a user's lifecycle:

| Field       | Type            | Meaning                                                        |
| ----------- | --------------- | ------------------------------------------------------------- |
| `status`    | `active` \| `inactive` | Account enabled/disabled (admin toggle). Existing field. |
| `deletedAt` | `string \| null` (ISO datetime) | **Soft-delete marker.** `null` = live, non-null = deleted. |

- Soft-deleting sets `deletedAt = now()` **and** `status = inactive`.
- A user can be `inactive` **without** being deleted (deactivated, not deleted).
- A deleted user is always `inactive`, but the distinguishing flag is `deletedAt`.

The FE never writes `deletedAt` directly — it calls the endpoints below.

---

## 3. Endpoints

All endpoints require `Authorization: Bearer <jwt>` (guard: `cJwt`).
All responses use the standard envelope:

```ts
{ message: string; statusCode: number; data: any }
```

### 3.1 Soft delete (the default — use this for "Delete user")

```http
DELETE /api/v1/users/:id
```

**Always returns 200** for an existing, non-deleted user.

```jsonc
// 200
{
  "message": "Successfully deleted user record",
  "statusCode": 200,
  "data": { /* the user, now with deletedAt set */ }
}
```

Errors:

| Status | When                              | `error` message                |
| ------ | --------------------------------- | ------------------------------ |
| 403    | User not found / already deleted  | `"User not found"`             |

> The old `"associated with other records"` 403 **no longer occurs** on this
> endpoint.

### 3.2 Deletion preview (call this BEFORE a permanent delete)

Returns the "blast radius" of a permanent delete **without deleting anything**.
The FE uses this to populate the confirmation dialog: show what will be removed,
and — if the purge is blocked — show why.

```http
GET /api/v1/users/:id/deletion-preview
```

```jsonc
// 200
{
  "message": "Successfully fetched user deletion preview",
  "statusCode": 200,
  "data": {
    "user": { "id": "...", "firstName": "...", "lastName": "...", "email": "...", "role": "..." },

    // true  -> purge is allowed; false -> there are blockers (see below)
    "canPurge": true,

    // self-owned records that WILL be permanently deleted along with the user
    "cascadeTotal": 47,
    "cascade": {
      "enrollments": 5,            // course enrollments
      "formCompletions": 3,
      "policyCompletions": 2,
      "policyItemCompletions": 8,
      "feedbackSubmissions": 1,
      "lastSeenSections": 10,
      "quizProgress": 6,
      "courseCompletions": 2,
      "favoriteThreads": 1,
      "threadSubscriptions": 1,
      "todos": 0,
      "contactMessages": 0,
      "policiesAndProcedures": 0,
      "notifications": 7,
      "assessmentAttempts": 1,
      "assignmentSubmissions": 0   // submissions THIS user made as a student
    },

    // content OTHERS depend on. If blockerTotal > 0, canPurge is false.
    "blockerTotal": 0,
    "blockers": {
      "posts": 0,                       // course posts authored
      "postComments": 0,
      "forumThreads": 0,                // forum threads started
      "forumComments": 0,
      "assignmentsCreated": 0,          // assignments this admin created
      "assignmentsToReview": 0,         // assignments this admin is reviewer for
      "assessmentsCreated": 0,          // assessments this admin created
      "submissionsAssignedToReview": 0, // other students' submissions assigned to them
      "submissionsReviewed": 0          // other students' submissions they reviewed
    }
  }
}
```

**Interpretation:**

- `cascade.*` — things this user owns. They will be **permanently deleted** if
  the admin confirms the purge. Render these as "this will also delete: …".
- `blockers.*` — content **other users depend on** (shared course content, or
  this user's reviewer role on other students' work). If any is non-zero,
  `canPurge` is `false` and the purge will be **refused** — these must be
  reassigned/removed first, or the admin should soft-delete instead.

### 3.3 Force purge (admin / GDPR "right to be forgotten")

Permanently removes the user **and all of their self-owned records** (everything
under `cascade` above), atomically. Use only for genuine erasure requests,
behind an admin-only / typed-confirmation UI. **Call `deletion-preview` first**
and show the user what will be deleted.

```http
DELETE /api/v1/users/:id/purge
```

```jsonc
// 200
{
  "message": "Successfully purged user record and associated data",
  "statusCode": 200,
  "data": {
    "user": { /* the purged user snapshot */ },
    "deleted": { /* the same `cascade` count object — what was removed */ }
  }
}
```

Errors:

| Status | When                                                     | `error` (+ extra fields) |
| ------ | -------------------------------------------------------- | --------------- |
| 409    | User authored content others depend on (blockers > 0)    | `"Cannot permanently delete this user because they authored content other users depend on. Reassign or remove these records first, or use a soft delete instead."` — also includes a `blockers` object (same shape as the preview) so the FE doesn't need a second call |
| 403    | User not found / other error                             | `"User not found"` or the underlying message |

> Purge can legitimately fail with **409**. The 409 body carries the same
> `blockers` breakdown as the preview, so you can show *what* is blocking right
> from the failed purge response. Fall back to offering a soft delete.

---

## 4. Reads — deleted users are filtered out

| Endpoint                  | Behavior                                            |
| ------------------------- | --------------------------------------------------- |
| `GET /users/`             | Returns only users where `deletedAt = null`.        |
| `GET /users/:id`          | Returns 403 `"User not found"` if soft-deleted.     |
| Login (`/auth/login`)     | Soft-deleted users are rejected (`"User not found"`).|

So after a soft delete, the user simply disappears from lists and detail views —
no extra FE filtering needed.

> ⚠️ **Known gap:** user objects embedded in *other* responses (course rosters,
> forum threads/comments, notifications, submissions) are **not yet filtered**
> for `deletedAt`. If you render a deleted user's name there, it may still
> appear. Track this with BE if it affects a screen — full sweep is a planned
> follow-up.

---

## 5. Email reuse after deletion

`email` is still `@unique`, so a soft-deleted user **keeps their email
reserved**. Re-registering that email returns:

```jsonc
// 403 on POST /users (create)
{
  "status": 403,
  "error": "A previously deleted account is using this email. Restore that account or purge it before re-registering this email."
}
```

vs. a normal duplicate (active user):

```jsonc
{ "status": 403, "error": "User already exists in the system" }
```

FE should distinguish these two messages if it wants to guide the admin
(e.g. "purge the old account first").

---

## 6. Suggested FE UX

**Normal delete (default):**
- **Delete button** → calls `DELETE /users/:id`. Expect success; optimistic
  removal from the list is safe. No need to handle the legacy
  `"associated with other records"` error here anymore.

**Permanent delete (admin, guarded):**
1. Admin clicks "Permanently delete" → FE calls
   `GET /users/:id/deletion-preview`.
2. Render a confirmation dialog:
   - If `canPurge === true`: list the `cascade` counts ("This will also
     permanently delete: 5 enrollments, 7 notifications, 1 assessment
     attempt…"). Require typed confirmation (e.g. type the email).
   - If `canPurge === false`: show the non-zero `blockers` and **disable**
     the confirm button. Offer "Soft delete instead" and/or a link to
     reassign the blocking content.
3. On confirm → `DELETE /users/:id/purge`.
   - 200 → remove from list, show `data.deleted` summary if you like.
   - 409 → blockers changed since preview (race); read `blockers` from the
     409 body and re-render the blocked state.

---

## 7. Open items (not yet implemented)

These are **not** built yet — flag to BE before depending on them:

- **PENDING** `restoreUser` endpoint (undo a soft delete).
- **PENDING** Filtering `deletedAt` users out of embedded user objects across
  other modules (see §4 gap).
- **PENDING** Email-freeing on delete (rename email so it can be reused without
  purge).
- **PENDING** Reassign-blockers flow (transfer authored assignments/assessments
  and reviewer duties to another admin so a blocked user can then be purged).
  Today the admin must clear blockers manually or soft-delete.
