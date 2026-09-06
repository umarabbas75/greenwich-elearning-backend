# Community Forum — Plan

**Status:** Wave 3 in progress. Waves 1–2 shipped. §2 decisions locked. Confirmed 6 Sep 2026: Study requires a course (via category setting, not a hardcoded slug); student threads publish live (via category setting); Wave 1 first. DB stays detachable so categories / course rules / posting rules can be turned off later without dropping tables.
**Audience:** Backend + frontend. Implements the client’s 4-board community, then the LMS extras.
**Related:** [forum-course-scoping-frontend-handoff.md](forum-course-scoping-frontend-handoff.md) (already shipped).

---

## 1. Goal

Turn `/forum` from a **flat admin announcement list** into a **Category → Thread → Comment** community, matching Discourse / Moodle / Circle / Skool, without nested boards and without a second discussion product in the course player.

Client ask (20 Jun 2026): four top-level boards (Support, Study, Technical, plus a 4th). Inside each, **admin and students** start discussions. One level deep.

---

## 2. Locked decisions

| Decision | Choice | Why |
|---|---|---|
| Hierarchy | **Category → Thread → Comment** | Industry standard. No sub-threads, no nested categories. |
| Who creates categories | **Admin only** | Students creating boards turns this into Reddit. |
| Category on every thread | **Required** | Every thread has a home. |
| Delete category with threads | **Refuse** | Admin must bulk-move first (or we add bulk-move in the same PR). |
| 4th seeded category | **General** | Catch-all + backfill for existing threads. |
| Table names | Keep `ForumThread` / `ForumComment` | Rename to Topic/Post is churn for zero product gain. |
| Root label | **Community** (nav + page). Drop “News & announcements”. | `/forum` URL can stay. |
| Nested categories | **Never in v1–v3** | Mobile friction; client said one level. |
| Study requires a course | **Yes, as a category setting** (`courseScope = REQUIRED` on Study). Other boards `OPTIONAL`. Admin can change any board later without a migration. | Confirmed 6 Sep 2026. |
| Student threads publish live | **Yes, as a category setting** (`studentCreatePolicy = ALLOWED`). Admin can switch a board to `MODERATED` or `DISABLED` later. | Confirmed 6 Sep 2026. |
| Admin choices | Where a rule exists, expose **more than one option** (see §4). | Don’t hardcode slugs or a single workflow. |
| DB flexibility | FKs **nullable** + `ON DELETE SET NULL`. Soft-disable categories. No `NOT NULL` on the new product columns. No DB check that slug = `study`. | We can unplug categories, course-scoping, or student posting later. |

Seeded categories on day one:

| Slug | Name | Typical use |
|---|---|---|
| `support` | Support | Platform / login / access help. Mark-as-solution matters here. |
| `study` | Study | Course discussion. Usually tied to a course. |
| `technical` | Technical | Tools, content bugs, technical questions. Mark-as-solution matters here. |
| `general` | General | Off-topic + backfill of legacy threads. |

Admins can add more later (Announcements, Feedback, etc.) via CRUD. We do **not** seed a separate Announcements category — admin **pinned threads** inside a category cover that.

---

## 3. What already exists (reuse, don’t rebuild)

| Capability | Today | Keep / change |
|---|---|---|
| Threads + comments | Yes | Keep |
| Course scoping | `courseId` **required** on create; students only see enrolled courses | **Relax** — see §4 |
| Personal bookmark | `FavoriteForumThread`, UI currently labelled “Pin” | Keep as **Save / bookmark**. Real pin is new. |
| Follow | `ThreadSubscription` + comment emails / bell | Keep. Auto-subscribe the author on create. |
| Thread body rich text | Quill + Cloudinary images | Keep; add `code-block` to toolbar |
| Comment body | Plain `<textarea>` | Upgrade to Quill in Wave 2 |
| View tracking | `ForumViewEvent` + admin analytics | Keep |
| Notifications | `FORUM_THREAD` (on admin **activate**), `FORUM_COMMENT` (subscribers) | Change trigger — see §5 |
| Approval gate | New threads start `inActive`; students never see them until admin sets `active` | **Drop for student posts** — they publish live |
| In-course Discussions | Separate `Post` / `Comment` in the player | Hide in Wave 3, then delete |

---

## 4. Categories vs courses (both stay)

These are **not** the same axis.

- **Category** = which board (Support / Study / Technical / General). Navigation.
- **Course** = which learners may see the thread. Visibility.

App rules (enforced in code, **not** as rigid DB constraints):

- New threads should send `categoryId`. Column stays **nullable** so we can detach or retire categories later (`ON DELETE SET NULL`).
- `courseId` stays **optional** on the row. What the API requires is read from the category:
  - `courseScope = REQUIRED` — Study default. Must pick a course.
  - `courseScope = OPTIONAL` — Support / Technical / General default. Admin or student *may* attach a course.
  - `courseScope = FORBIDDEN` — never attach a course (available if a board should stay platform-wide).
- Student list: `active` threads where (`courseId` is null **or** the student is enrolled), plus category filter. Threads with `categoryId = null` still show (legacy / uncategorized).
- Admin list: everything, filterable by category and course.

### Admin choices (Wave 1)

Each category is a row the admin can edit. Defaults are only seed data.

| Setting | Options | Seed |
|---|---|---|
| `courseScope` | `REQUIRED` / `OPTIONAL` / `FORBIDDEN` | Study `REQUIRED`, rest `OPTIONAL` |
| `studentCreatePolicy` | `ALLOWED` (live) / `MODERATED` (hidden until admin activates) / `DISABLED` | all `ALLOWED` |
| `notifyOnCreate` | `ADMIN_ONLY` / `ALL` / `NONE` | all `ADMIN_ONLY` |
| Create / rename / reorder / deactivate | yes | four seeded boards |
| Pin a thread | pin or leave unpinned | off |
| Publish vs hide a thread | `active` / `inActive` | student follows policy; admin can pick either |
| Move threads | to another category, or uncategorize (`categoryId = null`) | — |

Never key behaviour off `slug === 'study'`. Always read the settings on the category.

---

## 5. Who can post, and who gets notified

Client: admin **and users** create threads. Today only admins get a “New thread” button, and posts wait for activation.

| Actor | Create thread | Publish | Pin | Moderate (edit/delete any) |
|---|---|---|---|---|
| Student | If category `studentCreatePolicy` ≠ `DISABLED` | `ALLOWED` → live; `MODERATED` → `inActive` until admin activates | No | Own only |
| Admin | Yes | Can pick live or hidden | Yes | Any |

`inActive` is **admin hide** *and* the moderated queue when a board is set to `MODERATED`.

**Notification policy (default `ADMIN_ONLY` — avoids spam):**

- `ADMIN_ONLY` — fan out `FORUM_THREAD` when an admin publishes (create-as-active, or activate). Student posts do not broadcast.
- `ALL` — every new active thread on that board broadcasts (old behaviour, available if they want it).
- `NONE` — never broadcast.
- New comment: existing subscriber fan-out. Author is auto-subscribed.
- Mentions (Wave 2): notify the mentioned user only.

---

## 6. Waves (feature-rich, not all at once)

Shipping Category + every LMS extra in one go will stall. Each wave is usable on its own.

### Wave 1 — Community foundation (this piece of work)

The client can use four boards. Students can talk. Admins can pin rules.

- `ForumCategory` model + admin CRUD + seed four categories
- `categoryId` on threads, **nullable**, backfill existing → General. App requires it on create; DB does not.
- `courseId` optional; required only when that category’s `courseScope` is `REQUIRED`
- `GET /forum/categories` with `threadCount`, `lastActivityAt`
- `GET /forum-thread?categoryId=`
- Student create-thread (same modal; course + category fields)
- Admin **pin**: `isPinned` on the thread (sort pinned first **within the category**)
- Split today’s favorite: UI “Save” for personal bookmark; “Pin” is admin-only
- Rebrand nav + `/forum` to **Community**; category tiles on the index, then thread list
- Simple search: `q` on title + stripped content (`ILIKE`), category-scoped
- Quill `code-block` on thread compose
- Auto-subscribe author
- Frontend handoff doc

**Out of Wave 1:** votes, accepted answer, mentions, tags, file attachments, killing in-course posts.

### Wave 2 — Quality and engagement **(backend done)**

Turns Support/Technical into a real help desk, Study into a living class board.

- **Mark as solution:** `acceptedCommentId` on the thread. OP or admin. Accepted comment sorts to the top (still in the list, with a badge).
- **Upvotes:** `ForumVote` on thread **or** comment, one per user. Net score on the card. Default comment sort: solution first, then score, then newest. Toggle: Latest / Top.
- **Mentions:** `@` autocomplete of users the actor is allowed to see (admins + classmates on that course / all students for global threads). New `FORUM_MENTION` notification + email. No new `username` column — match `firstName lastName` (and unique id in the token, e.g. `@[First Last](userId)` in stored HTML).
- **Rich comments:** same Quill + image upload as threads (plain textarea goes away). Frontend work; backend stores HTML.

See [forum-community-wave2-frontend-handoff.md](./forum-community-wave2-frontend-handoff.md).

### Wave 3 — Unify the product **(backend in progress)**

- **Tags:** optional; not a substitute for categories. Admin choice per board: `tagPolicy` = `FREEFORM` | `ADMIN_ONLY` | `DISABLED`. Filter + search by `tagId` / slug.
- **File attachments:** Cloudinary PDF/docx, max 3, on the thread body. Screenshots stay in Quill. Category flag `allowAttachments`.
- **Deprecate in-course Discussions:**
  1. Player “Discussions” button becomes a link: Community → Study → this course (`/forum?category=<studySlug>&courseId=`). Drive the slug from `GET /forum/categories` (`courseScope === 'REQUIRED'`), fallback `'study'`.
  2. Optional one-off migrate `Post` → `ForumThread` (Study + that `courseId`) and `Comment` → `ForumComment` (`yarn script:forum-posts-migrate`). Idempotent via `sourcePostId`.
  3. Remove `DiscussionForum/` UI usage and stop fetching `/courses/posts/:courseId`. Keep `/courses/post*` APIs until a later cleanup.

See [forum-community-wave3-frontend-handoff.md](./forum-community-wave3-frontend-handoff.md).

---

## 7. Target information architecture

```
/forum                         Community hub — 4 category tiles
/forum?category=support        Thread list for that board (pinned first)
/forum?category=study&courseId=…   Study filtered to a course
/forum/[threadId]              Thread + comments
```

Admin extra:

```
/forum/categories              Optional settings: create / rename / reorder / deactivate
```

(If we don’t want a new page, category CRUD can live in a modal on the hub for admins.)

Hub tile payload:

```jsonc
{
  "id": "…",
  "name": "Support",
  "slug": "support",
  "description": "Account, login, and platform help",
  "sortOrder": 0,
  "threadCount": 12,
  "lastActivityAt": "2026-09-06T10:00:00.000Z"
}
```

---

## 8. Schema (Wave 1 + fields reserved for Wave 2)

### Wave 1

```prisma
enum ForumCourseScope { REQUIRED OPTIONAL FORBIDDEN }
enum ForumStudentCreatePolicy { ALLOWED MODERATED DISABLED }
enum ForumNotifyOnCreate { ADMIN_ONLY ALL NONE }

model ForumCategory {
  id                  String                   @id @default(uuid())
  name                String
  slug                String                   @unique
  description         String?
  icon                String?
  sortOrder           Int                      @default(0)
  isActive            Boolean                  @default(true) // soft-disable; prefer this over DELETE
  courseScope         ForumCourseScope         @default(OPTIONAL)
  studentCreatePolicy ForumStudentCreatePolicy @default(ALLOWED)
  notifyOnCreate      ForumNotifyOnCreate      @default(ADMIN_ONLY)
  createdByAdminId    String?                  // SET NULL if that admin is removed
  createdAt           DateTime                 @default(now())
  updatedAt           DateTime                 @updatedAt
  threads             ForumThread[]
}

model ForumThread {
  // existing fields…
  categoryId     String?        // nullable + ON DELETE SET NULL — can unplug categories later
  isPinned       Boolean        @default(false)
  lastActivityAt DateTime       @default(now())
  courseId       String?        // already nullable + SET NULL
}
```

Why this stays removable later:

- Dropping the *feature* does not require dropping data: stop sending `categoryId`, leave the column.
- Deleting a category sets `forum_threads.categoryId` to null instead of wiping threads.
- Deactivating a category hides it from the hub without a destructive migration.
- `isPinned` / `lastActivityAt` / policy enums have defaults; ignoring them is valid.
- No `CHECK (slug = 'study')`. Study’s course rule is a row the admin can edit.

Migration:

1. Create enums + `forum_categories`. Add nullable `categoryId`, `isPinned`, `lastActivityAt`.
2. Seed four categories. Backfill existing threads → General (still nullable-capable).
3. Stop requiring `courseId` in `createForumThread`; require `categoryId` in the **service** only.

Delete category: `409` if threads still point at it. `POST /forum/categories/:id/move-threads { toCategoryId }` accepts another id **or `null`** (uncategorize), then delete is allowed. Prefer `isActive = false`.

### Wave 2 (do not migrate until Wave 1 is live)

```prisma
model ForumThread {
  acceptedCommentId String?
  voteScore         Int     @default(0) // denormalised for list sort
}

model ForumComment {
  isAccepted Boolean @default(false)
  voteScore  Int     @default(0)
}

model ForumVote {
  id         String   @id @default(uuid())
  userId     String
  threadId   String?
  commentId  String?
  value      Int      // +1 only in v1 (no downvotes — LMS, not Reddit)
  createdAt  DateTime @default(now())

  @@unique([userId, threadId])
  @@unique([userId, commentId])
  @@map("forum_votes")
}
```

One of `threadId` / `commentId` is set. Downvotes are out of scope (they sour a small cohort).

---

## 9. API surface

Base paths stay `/forum-thread` and `/forum-thread-comment` so existing FE keeps working. Add `/forum/categories`.

### Wave 1

| Method | Path | Notes |
|---|---|---|
| GET | `/forum/categories` | Active, `sortOrder`, counts. Students and admins. |
| POST/PATCH/DELETE | `/forum/categories` | Admin. Delete refuses if threads exist. |
| POST | `/forum/categories/:id/move-threads` | Admin. Body `{ toCategoryId }`. |
| GET | `/forum-thread?categoryId=&courseId=&q=&sort=` | `sort`: `latest` (default) \| `pinned` (pinned then latest). |
| POST | `/forum-thread` | **Service requires `categoryId`.** `courseId` follows that category’s `courseScope`. Status from `studentCreatePolicy` (students) or body (admin). Auto-subscribe author. |
| PUT | `/forum-thread/update/:id` | Add `isPinned` (admin only). |
| Existing | favorite / subscribe | Unchanged. |

List sort: `isPinned desc`, then `createdAt desc` (or last comment time if we add `lastActivityAt` — worth a denormalised column in Wave 1 so hub tiles and lists stay cheap).

### Wave 2

| Method | Path | Notes |
|---|---|---|
| POST | `/forum-thread-comment/:id/accept` | OP or admin. Clears previous accepted. Optional `{ accepted?: boolean }` to set instead of toggle. |
| POST | `/forum-thread/:id/vote` | `{ value: 1 \| 0 }` toggle like. |
| POST | `/forum-thread-comment/:id/vote` | Same. |
| GET comments | `?sort=top\|latest` | Include `voteScore`, `isAccepted`, `isVotedByMe`. Default `top`: accepted, score, createdAt. |
| GET | `/forum/mentions?q=&threadId=&courseId=` | Autocomplete. `{ id, firstName, lastName, photo, role }`. |

Mentions are parsed server-side from stored HTML on **create** (`data-mention-user-id` or `@[Name](uuid)`). Category flags `allowAcceptedAnswer`, `allowVotes`, `allowMentions` default true.

### Wave 3

| Method | Path | Notes |
|---|---|---|
| GET | `/forum/tags?q=` | Autocomplete `{ id, name, slug }`. No counts. |
| POST | `/forum/tags` | `{ name }`. Returns existing slug match if present. |
| PATCH/DELETE | `/forum/tags/:id` | Admin. |
| GET | `/forum-thread?tagId=` / `?tag=` | Filter by id or slug. List includes `tags`. |
| POST/PUT thread | `tagIds` / `tags`, `attachments` | Max 8 tags, 3 PDF/DOCX files. Nested create; no interactive `$transaction`. |
| DELETE | `/forum-thread/:id/attachments/:attachmentId` | Author or admin. |

Category flags `tagPolicy` (`FREEFORM` \| `ADMIN_ONLY` \| `DISABLED`) and `allowAttachments` default on. Detail includes `attachments`; list does not.

---

## 10. Frontend (Wave 1)

- Nav: **Forum → Community**.
- `/forum`: category tiles, not a flat thread wall. Search at the top.
- `/forum?category=…`: thread list; admin “Pin”; everyone “Save” + “Follow”; **New thread** for all authenticated users.
- Create modal: category (pre-filled from query), course (required if Study / optional otherwise), title, Quill body.
- Thread page: pinned/solved badges in Wave 2; replies stay as they are until Wave 2 Quill.
- Empty category copy: “Be the first to start a discussion.”
- Deep links from email/bell stay `/forum/{threadId}`.

---

## 11. What we will not do

- Nested categories / “sub-threads”.
- A parallel Announcements product. Pin a thread instead.
- Student-created categories.
- Downvotes.
- Real-time / SSE chat (notifications stay pull + email).
- Renaming Prisma models to Topic/Post.
- Killing in-course Discussions in Wave 1 (plan the link; migrate in Wave 3).
- Broadcasting every new student thread to the whole course.

---

## 12. Suggested build order inside Wave 1

1. Schema + seed + backfill.
2. Category APIs + thread create/list changes (`categoryId`, optional `courseId`, `isPinned`, `q`, auto-subscribe, live publish).
3. Notification trigger narrowed to admin-created threads.
4. Frontend hub + list + modal + rebrand.
5. Handoff doc for remaining FE polish.

Wave 1 backend is roughly 2–3 days; FE hub/list/modal another 2–3. Wave 2 is a similar size after this is live.

---

## 13. Confirmed (6 Sep 2026)

1. **Study + course:** yes — implemented as `courseScope` on the category, default `REQUIRED` for Study. Admin can change it later.
2. **Student threads go live immediately:** yes — implemented as `studentCreatePolicy = ALLOWED`. Admin can switch a board to `MODERATED` or `DISABLED` later.
3. **Wave 1 first:** yes.
4. **Admin should have more than one choice** where a rule exists (scope, posting, notify, pin, publish/hide, move vs deactivate).
5. **DB stays detachable:** nullable FKs, `ON DELETE SET NULL`, soft-disable, no slug hardcoding.
