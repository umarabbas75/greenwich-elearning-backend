# Chapter quiz reorder API

**Frontend integration:** see [`chapter-quiz-reorder-frontend-handoff.md`](./chapter-quiz-reorder-frontend-handoff.md).

Reorder is **presentation-only**: it does **not** publish a new course version. Pinned learners keep the same quiz **set** from their snapshot; **order** comes from live `orderIndex` on the `quizzes` table.

## Reorder

- **Method:** `PATCH /api/v1/quizzes/chapter/reorder`
- **Auth:** `cJwt` (admin/content JWT)

**Body:**

```json
{
  "chapterId": "8d8a691e-d20e-4eed-8fa3-95bfef3d0583",
  "quizzes": [
    { "id": "quiz-uuid-1", "orderIndex": 0 },
    { "id": "quiz-uuid-2", "orderIndex": 1 }
  ]
}
```

Rules:

- `quizzes` must list **every** non-archived quiz in the chapter **exactly once** (full permutation).
- `orderIndex` is opaque to the backend (same as sections); use contiguous `0..n-1` or `1..n` consistently in the UI.

**Response:** `{ chapterId, updatedCount }`

After success, refresh with `GET /api/v1/quizzes/getAllAssignQuizzes/:chapterId` (avoid stale 304 caches).

## Assign / move (unchanged)

- **Assign:** `PUT /api/v1/quizzes/assignQuiz/:quizId/:chapterId` — still auto-publishes when structure changes; new quiz gets `orderIndex` at end of chapter.
- **Move between chapters:** unassign then assign — still publishes a new version (relocation is structural).

## Ordering everywhere

Live and learner paths sort by: `orderIndex asc`, `createdAt asc`, `id asc`.
