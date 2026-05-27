# Forum Threads → Course-Scoped — Frontend Handoff

**Owner:** Backend (Umar)
**Status:** Backend implemented. Pending DB migration deploy (`20260527120000_forum_thread_course`).
**Audience:** Frontend team — changes required to stay in sync.

---

## 1. What changed (TL;DR)

Forums used to be **global**: an admin created a thread and **every** student saw it.

Now forum threads are **course-scoped**:

- Every **new** thread must be tied to a **course** (`courseId` is required on create).
- A student only sees an active thread if they are **actively enrolled** in that thread's course.
- New-thread notifications now fan out **only to enrolled students** of that course (not everyone).
- **Legacy threads** created before this change have `courseId = null`. These remain **globally visible** to all students (backward-compatible; nothing breaks).

Admins still see **all** threads regardless of course.

---

## 2. API changes

Base path: `/forum-thread`. All endpoints require the `cJwt` bearer auth (unchanged).

### 2.1 Create thread — **BREAKING**

`POST /forum-thread/`

**Request body — `courseId` is now REQUIRED:**

```jsonc
{
  "title": "How do I submit assignment 2?",
  "content": "Lorem ipsum...",
  "courseId": "f3a1...-uuid"   // ⬅️ NEW, required. Omitting it returns 403.
}
```

If `courseId` is missing, backend responds:

```jsonc
{ "status": 403, "error": "courseId is required" }
```

**FE action:** The "create thread" form (admin side) must include a **course selector**
and send the selected `courseId`. Use your existing course list endpoint to populate it.

> Threads are still created with `status: "inActive"` and only become visible to
> students once an admin sets `status: "active"` via the update endpoint (unchanged).

### 2.2 List threads

`GET /forum-thread/`

- **No request change.** Visibility is enforced server-side from the JWT:
  - `role === "user"`: returns only `active` threads where the user is actively
    enrolled in the thread's course, **plus** legacy threads with `courseId = null`.
  - admin: returns everything.
- **Response now includes a `course` object** (see §3).

### 2.3 Get single thread

`GET /forum-thread/:forumThreadId`

- Response now includes the `course` object (see §3).

### 2.4 Unchanged endpoints

`PUT /forum-thread/update/:id`, `DELETE /forum-thread/delete/:id`,
subscribe/unsubscribe, favorite/unfavorite — no contract change.
(You *can* pass `courseId` in the update body to move a thread to another course,
but it is optional there.)

---

## 3. Response shape additions

Each thread object in the list and detail responses now carries:

```jsonc
{
  "id": "…",
  "title": "…",
  "content": "…",
  "status": "active",
  "courseId": "f3a1…",         // null for legacy global threads
  "course": {                   // ⬅️ NEW — null for legacy global threads
    "id": "f3a1…",
    "title": "Level 3 Diploma in …"
  },
  "user": { "id": "…", "firstName": "…", "lastName": "…", "photo": "…" },
  "ForumComment": [ … ],
  "isFavorite": false,
  "isSubscribed": false
}
```

**FE action:** Display `course.title` as a badge/label on each thread card.
Handle `course === null` gracefully (render as "General" or hide the badge).

---

## 4. Notifications

The `FORUM_THREAD` notification (fired when an admin activates a thread) is now sent
**only to students enrolled in that thread's course**. Legacy null-course threads
still notify everyone. No FE change needed — the notification payload is unchanged
(`threadId`, `threadTitle`, `creatorFirstName`, `creatorLastName`). See
[notifications-contract.md](notifications-contract.md).

---

## 5. Migration / rollout notes

- DB change: nullable `courseId` column + FK on `forum_threads`
  (migration `20260527120000_forum_thread_course`). Applied via
  `prisma migrate deploy`.
- **No data loss / no breakage** for existing threads — they keep `courseId = null`
  and stay globally visible.
- Coordinate deploy order: backend (migration + code) should ship **before** the
  FE makes `courseId` mandatory in the create form, otherwise older FE create calls
  will start failing with the 403 above.

---

## 6. Open question for FE

- Do you want a **course filter dropdown** on the student-facing forum list
  (client-side filter over the already-scoped list), or is the implicit
  enrollment-based scoping enough? Backend already returns the `course` object to
  support either.
```
