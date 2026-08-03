# Chapter quiz reorder — Frontend handoff

> **Owner:** Backend.
> **Status:** Implemented. Requires migration `20260804120000_quiz_order_index` on each environment (`npx prisma migrate deploy`).
>
> Backend API summary: [`chapter-quiz-reorder-api.md`](./chapter-quiz-reorder-api.md).

---

## 1. What this feature does

Admins can change the **display order** of quizzes inside a chapter (e.g. drag-and-drop). That order is stored as `orderIndex` on each quiz row.

| Action | Publishes new course version? | Who sees new order? |
| ------ | ----------------------------- | ------------------- |
| Reorder within chapter | **No** | Everyone (admin + learners), immediately after refetch |
| Assign quiz to chapter | **Yes** (structural) | Per normal versioning rules |
| Move quiz to another chapter | **Unassign + assign** → **Yes** | Per normal versioning rules |

**Learners on a pinned course version** keep the same **set** of quizzes from their snapshot. **Order** always follows live `orderIndex`, so reorder does not require republishing or re-enrollment.

---

## 2. Parity with section reorder

Quiz reorder mirrors lesson **section** reorder:

| | Sections | Quizzes |
| --- | --- | --- |
| Method | `PUT` | `PATCH` |
| Path | `/api/v1/courses/sections/updateOrder` | `/api/v1/quizzes/chapter/reorder` |
| Auth | Admin `jwt` | Content admin `cJwt` |
| Body | `{ chapterId, sections: [{ id, orderIndex }] }` | `{ chapterId, quizzes: [{ id, orderIndex }] }` |
| Version bump | No | No |
| List after save | Refetch chapter sections | Refetch assign-quizzes for chapter |

Use the same UX pattern: optimistic UI optional, but **always send the full ordered list** on save.

---

## 3. Endpoints

Base URL prefix: **`/api/v1`**.

### 3.1 List quizzes for a chapter (admin + learner)

```http
GET /api/v1/quizzes/getAllAssignQuizzes/:chapterId
Authorization: Bearer <cJwt for admin tooling; uJwt for learner app>
```

**Response envelope:**

```ts
interface ApiResponse<T> {
  message: string;
  statusCode: number;
  data: T;
}
```

**`data` item shape** (array; order is already correct — do not re-sort on the client unless you have a local draft):

```ts
interface ChapterQuizRow {
  id: string;
  question: string;
  options: string[];
  /** Present for admin roles; omitted or hidden for learners depending on existing FE rules. */
  answer?: string;
  userAnswered?: boolean;   // learners
  isAnswerCorrect?: boolean; // learners
}
```

`orderIndex` is **not** returned on this endpoint; rely on **array order** from the API.

**Caching:** After a successful reorder, refetch this URL. If your client uses HTTP caching, bust cache or use `Cache-Control: no-cache` for this request so **304** does not show the old order.

### 3.2 Save new order (admin content JWT only)

```http
PATCH /api/v1/quizzes/chapter/reorder
Authorization: Bearer <cJwt>
Content-Type: application/json
```

**Body:**

```ts
interface UpdateChapterQuizOrder {
  chapterId: string;
  quizzes: Array<{ id: string; orderIndex: number }>;
}
```

**Example:**

```json
{
  "chapterId": "8d8a691e-d20e-4eed-8fa3-95bfef3d0583",
  "quizzes": [
    { "id": "quiz-uuid-a", "orderIndex": 0 },
    { "id": "quiz-uuid-b", "orderIndex": 1 },
    { "id": "quiz-uuid-c", "orderIndex": 2 }
  ]
}
```

**Success (200):**

```json
{
  "message": "Successfully updated chapter quiz order",
  "statusCode": 200,
  "data": {
    "chapterId": "8d8a691e-d20e-4eed-8fa3-95bfef3d0583",
    "updatedCount": 3
  }
}
```

**Validation rules (400):**

- `quizzes` must include **every non-archived** quiz in the chapter **exactly once** (full permutation).
- Every `id` must belong to that chapter and be active (`isArchived: false`).
- No duplicate ids in the payload.
- DTO validation: `chapterId` required; `quizzes` array min length 1; each item needs string `id` and number `orderIndex`.

Typical messages:

- `Quiz list must include every active quiz in the chapter exactly once`
- `Quiz <uuid> is not an active quiz in this chapter`
- `Duplicate quiz ids in reorder payload`

**Do not** show a “Publish course” step after reorder — nothing structural changed.

### 3.3 Assign / unassign (unchanged; affects structure)

```http
PUT /api/v1/quizzes/assignQuiz/:quizId/:chapterId
Authorization: Bearer <jwt>
```

New assignments append at the **end** of the chapter (`orderIndex = max + 1`) and **auto-publish** when the course structure changes.

```http
PUT /api/v1/quizzes/user/unAssignQuiz
Authorization: Bearer <jwt>
Body: { "quizId": "...", "chapterId": "..." }
```

Moving a quiz to another chapter: **unassign from A, assign to B** — still a version bump; do not try to encode “move” in the reorder endpoint.

---

## 4. Recommended UI flow

1. **Load:** `GET getAllAssignQuizzes/:chapterId` → render list in returned order.
2. **Edit mode:** Drag-and-drop (or up/down) updates **local** order only.
3. **Save:** Build payload from the full visible list:

   ```ts
   const quizzes = orderedRows.map((row, index) => ({
     id: row.id,
     orderIndex: index, // 0..n-1 recommended; backend accepts any numeric orderIndex as long as list is complete
   }));
   await patchReorder({ chapterId, quizzes });
   ```

4. **Confirm:** Refetch `getAllAssignQuizzes` and replace list state (or merge if you trust optimistic order).
5. **Edge cases:**
   - If another admin assigns/unassigns while the editor is open, save may 400 (count mismatch). Refetch and ask user to retry.
   - Single-quiz chapter: payload is one item `{ id, orderIndex: 0 }` — still valid.
   - Empty chapter: reorder API requires `@ArrayMinSize(1)` — hide reorder UI when there are zero quizzes.

---

## 5. Learner app

No new endpoints. Learners already call `getAllAssignQuizzes/:chapterId` with **`uJwt`**. After admin reorder, the next fetch returns quizzes in the new order (same ids for pinned users).

Quiz **progress / gating** is unchanged: reorder does not reset answers or chapter completion.

---

## 6. Environment checklist

| Step | Command / check |
| ---- | ---------------- |
| Migration applied | `npx prisma migrate status` → `Database schema is up to date!` |
| Column exists | `quizzes.orderIndex` (nullable int; backfilled per chapter) |
| Deploy | Backend build includes reorder handler; no extra feature flag |

---

## 7. TypeScript helpers (copy-paste)

```ts
const QUIZ_REORDER_URL = '/api/v1/quizzes/chapter/reorder';
const chapterQuizzesUrl = (chapterId: string) =>
  `/api/v1/quizzes/getAllAssignQuizzes/${chapterId}`;

async function saveChapterQuizOrder(
  token: string,
  chapterId: string,
  orderedQuizIds: string[],
): Promise<void> {
  const res = await fetch(QUIZ_REORDER_URL, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chapterId,
      quizzes: orderedQuizIds.map((id, orderIndex) => ({ id, orderIndex })),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.message ?? err?.error ?? `Reorder failed (${res.status})`);
  }
}
```

Use the **content admin** token (`cJwt`) that you already use for other quiz CMS routes (`GET /quizzes`, `assignQuiz` may use admin `jwt` — match existing FE auth split).
