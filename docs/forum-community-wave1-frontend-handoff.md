# Community Forum Wave 1 — Frontend Handoff

Backend Wave 1 is in this repo. Categories, student posting, admin pin, optional course, and search are live once the migration `20260906160000_forum_categories` is applied.

**Product copy:** rename nav + `/forum` title from “News & announcements” / “Forum” to **Community**. Keep the `/forum` URL.

---

## 1. Categories

`GET /forum/categories` (auth `cJwt`)

Returns active boards, `sortOrder` asc, with `threadCount` and `lastActivityAt` (visibility-scoped for students).

```jsonc
{
  "id": "10000000-0000-4000-8000-000000000002",
  "name": "Study",
  "slug": "study",
  "description": "Course discussion — pick the course this thread belongs to",
  "icon": "book",
  "sortOrder": 1,
  "isActive": true,
  "courseScope": "REQUIRED",       // REQUIRED | OPTIONAL | FORBIDDEN
  "studentCreatePolicy": "ALLOWED", // ALLOWED | MODERATED | DISABLED
  "notifyOnCreate": "ADMIN_ONLY",   // ADMIN_ONLY | ALL | NONE
  "threadCount": 12,
  "lastActivityAt": "2026-09-06T10:00:00.000Z"
}
```

Seeded: Support (`OPTIONAL`), Study (`REQUIRED`), Technical (`OPTIONAL`), General (`OPTIONAL`). All `ALLOWED` + `ADMIN_ONLY`.

**Do not hardcode `slug === 'study'`.** Drive the course picker from `courseScope`:

| `courseScope` | Course field on create |
|---|---|
| `REQUIRED` | Required |
| `OPTIONAL` | Optional (admin/student *can* attach a course) |
| `FORBIDDEN` | Hide the course picker |

**Student “New thread”:** show if `studentCreatePolicy !== 'DISABLED'`. Admins always see it.

Admin-only:

| Method | Path | Notes |
|---|---|---|
| GET | `/forum/categories?includeInactive=true` | Includes deactivated boards |
| POST | `/forum/categories` | `{ name, slug?, description, icon, sortOrder, courseScope, studentCreatePolicy, notifyOnCreate, isActive }` |
| PATCH | `/forum/categories/:id` | Any of the same fields |
| POST | `/forum/categories/:id/move-threads` | `{ toCategoryId }` or `{ toCategoryId: null }` to uncategorize |
| DELETE | `/forum/categories/:id` | `409` `{ error: "category_has_threads", threadCount }` if threads remain. Prefer deactivate (`isActive: false`). |

---

## 2. Threads

### List

`GET /forum-thread?categoryId=&courseId=&q=`

- Sorted **admin-pinned first**, then `lastActivityAt` desc.
- Each row now includes `category`, `isPinned`, `lastActivityAt`. `course` may be `null`.
- `isFavorite` is still the **personal bookmark** (rename UI from Pin → Save).
- `isPinned` is the **admin pin**.

### Create — breaking vs old FE

`POST /forum-thread`

```jsonc
{
  "title": "…",
  "content": "<p>quill html</p>",
  "categoryId": "…",          // required by the service
  "courseId": "…"             // required only when that category.courseScope === REQUIRED
}
```

Admin extras: `"status": "active" | "inActive"`, `"isPinned": true`.

Students:

- `ALLOWED` → thread is `active` immediately.
- `MODERATED` → `inActive` until an admin activates it.
- Author is auto-subscribed.

Response `data` is the thread (not `{}`).

`courseId` is **no longer always required**. Old FE that always sent it still works (OPTIONAL boards accept it).

### Update / pin / hide

`PUT /forum-thread/update/:id`

- Author or admin: `title`, `content`, `categoryId`, `courseId` (including `null` to detach).
- Admin only: `status`, `isPinned`.

### Delete

Author or admin only.

---

## 3. Suggested IA

```
/forum                         Hub — category tiles from GET /forum/categories
/forum?category=<slug>         List: GET /forum-thread?categoryId=<id>
/forum?category=study&courseId= List filtered to a course
/forum/<threadId>              Unchanged URL
```

Empty board: “Be the first to start a discussion.”

---

## 4. Notifications

Default `notifyOnCreate = ADMIN_ONLY`: only **admin-published** threads fan out `FORUM_THREAD`. Student posts do not spam the course. Comment notifications are unchanged (subscribers). Admins can switch a board to `ALL` or `NONE` in category settings.
