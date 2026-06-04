# Chapter-quiz progression — backend follow-ups

Frontend fixes for the reported incident (quiz gate, cache invalidation, honest sidebar, shared pass constant, removal of dead `userIdAtom` bypass) are handled on the frontend. This document tracks **backend** work (B1–B5).

## Implemented (backend)

### B1 — Sticky `isPassed`
On `POST /quizzes/createChapterQuizzesReport`, `isPassed` is never downgraded: `existingIsPassed || newIsPassed`. `score` stores the best percentage across attempts (`max`).

### B2 — Server-side grading
`score`, `isPassed`, and `totalAttempts` are computed from stored `quiz_answers`; client-supplied values are ignored.

### B3 — `passingCriteria`
Default pass threshold is **70%** (`DEFAULT_CHAPTER_QUIZ_PASS_PERCENTAGE`). Stored progress uses this when DB value is 0; API responses normalize `passingCriteria` via `resolvePassingCriteria`.

### B4 — `retakeChapterQuiz`
Deletes all `quiz_answers` for `(userId, chapterId)` so a new attempt starts clean.

### B5 — Server-side gating
`PUT /courses/updateUserChapter/progress`, `POST /courses/section/updateLastSeen/`, `GET /courses/user/module/chapter/allSections/:id/:courseId`, `POST /quizzes/checkQuiz`, `POST /quizzes/createChapterQuizzesReport`, and `POST /quizzes/retakeChapterQuiz` reject access when the previous chapter (sections + quiz) is incomplete, unless the user email is in `FREE_ROAM_EMAILS` (comma-separated, mirrors frontend free-roam allowlist).

## Env

```bash
# Optional: comma-separated learner emails that bypass chapter sequencing (free roam)
FREE_ROAM_EMAILS=
```

## Suggested implementation order (historical)

1. B1 + B2
2. B5
3. B3 + B4
