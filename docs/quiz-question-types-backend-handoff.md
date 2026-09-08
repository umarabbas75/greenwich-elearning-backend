# Quiz Multi-Type Support — Frontend Handoff to Backend

**Date:** September 2026  
**Feature:** Extend chapter quizzes to support 7 auto-gradable question types (currently MCQ-only).  
**Repo:** greenwich-elearning (frontend)  
**Status:** Frontend implementation complete; backend implementation pending.

---

## Overview

Chapter quizzes (admin-created, assigned to a chapter, shown to students after completing the chapter in the course player) have historically supported only a single implicit question type: **single-correct-answer MCQ** (`{ question, options: string[], answer: string }`).

The Assessment feature (implemented April 2026) already has a mature multi-type framework with 9 question types, including auto-grading logic for each. We are **extending chapter quizzes to reuse that framework's 7 auto-gradable types**, while excluding the 2 manual-grading types (`SHORT_ANSWER`, `LONG_ANSWER`) since chapter quizzes must remain fully automated.

**Supported quiz question types (7, all auto-gradable):**
1. `SINGLE_CHOICE` — Single correct answer from options
2. `MULTIPLE_CHOICE` — Multiple correct answers possible
3. `TRUE_FALSE` — True/False toggle
4. `FILL_IN_THE_BLANK` — Select word from word bank
5. `ORDERING` — Arrange items in correct sequence
6. `MATCHING` — Match left items to right categories
7. `VISUAL_ACTIVITY` — Clickable image with options

**Explicitly excluded:**
- `SHORT_ANSWER` — Requires human grading
- `LONG_ANSWER` — Requires human grading

---

## Data Model Changes

### Quiz Entity

Add two **optional** columns to the `Quiz` (or `ChapterQuiz`) entity:

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `type` | String (enum) | Yes | `SINGLE_CHOICE` | One of the 7 above. Omit for legacy quizzes. |
| `content` | JSON | Yes | `null` | Polymorphic payload per type (see section 2). For legacy quizzes, omit. |

**Backward compatibility rule:** Existing quiz rows (which have `options`/`answer` and no `type`/`content`) remain untouched. When `type` is omitted, the quiz is treated as legacy MCQ using the `options`/`answer` fields. No data migration required.

---

## Question Type Content Shapes

The `content` field is a polymorphic JSON object. Each type's shape is **reused verbatim from the Assessment feature** (documented in `docs/assessment-feature-frontend-guide.md` section 1).

**Important:** When returning a quiz to a student, strip all `correct*` fields from `content`, exactly as assessments do. The student must never see the answer key.

### SINGLE_CHOICE

```json
// content (admin-created, correct fields stripped before sending to student)
{
  "options": [
    { "id": "a", "text": "Option A" },
    { "id": "b", "text": "Option B" },
    { "id": "c", "text": "Option C" }
  ],
  "correctOptionId": "b"
}

// studentAnswer
{ "selectedOptionId": "b" }
```

### MULTIPLE_CHOICE

```json
// content
{
  "options": [
    { "id": "a", "text": "Option A" },
    { "id": "b", "text": "Option B" },
    { "id": "c", "text": "Option C" }
  ],
  "correctOptionIds": ["a", "c"]
}

// studentAnswer
{ "selectedOptionIds": ["a", "b"] }
```

**Grading:** Jaccard similarity (partial marks possible).

### TRUE_FALSE

```json
// content
{ "correctAnswer": true }

// studentAnswer
{ "answer": true }
```

### FILL_IN_THE_BLANK

```json
// content
{
  "sentence": "Reducing the likelihood of fines are ___ reasons to manage safely.",
  "wordBank": ["financial", "moral", "legal"],
  "correctAnswer": "financial"
}

// studentAnswer
{ "selectedWord": "financial" }
```

**Grading:** Case-insensitive exact match.

### ORDERING

```json
// content
{
  "items": [
    { "id": "1", "text": "Make sure the injured person is looked after" },
    { "id": "2", "text": "Preserve the scene of the accident" },
    { "id": "3", "text": "Report the accident" },
    { "id": "4", "text": "Assemble the investigation team" }
  ],
  "correctOrder": ["1", "2", "3", "4"]
}

// studentAnswer
{ "orderedIds": ["2", "1", "3", "4"] }
```

**Grading:** Positional match (partial marks possible).

### MATCHING

```json
// content
{
  "pairs": [
    { "id": "p1", "left": "Integration of safety systems", "right": "Strong and active leadership" },
    { "id": "p2", "left": "Effective upward communication", "right": "Worker involvement" },
    { "id": "p3", "left": "Accessing competent advice", "right": "Assessment and review" }
  ],
  "categories": ["Strong and active leadership", "Worker involvement", "Assessment and review"]
}

// studentAnswer
{
  "pairs": [
    { "leftId": "p1", "rightId": "Strong and active leadership" },
    { "leftId": "p2", "rightId": "Worker involvement" },
    { "leftId": "p3", "rightId": "Assessment and review" }
  ]
}
```

⚠️ **Important:** When returning to a student, **strip `right` from each pair in `content`** (they already have `categories` or can derive the right-side options from context). Return only `{ id, left }` per pair.

**Grading:** Correct pairs / total pairs (partial marks possible).

### VISUAL_ACTIVITY

```json
// content
{
  "imageUrl": "https://storage.example.com/diagram.png",
  "options": [
    { "id": "a", "text": "Policy" },
    { "id": "b", "text": "Planning" },
    { "id": "c", "text": "Leadership" }
  ],
  "allowMultiple": false,
  "correctOptionIds": ["b"]
}

// studentAnswer
{ "selectedOptionIds": ["b"] }
```

⚠️ **Important:** Strip `correctOptionIds` from options before sending to student. Return only `{ id, text }` per option.

**Grading:** Same as SINGLE_CHOICE (if `allowMultiple: false`) or MULTIPLE_CHOICE (if `allowMultiple: true`).

---

## Endpoint Changes

### Backward Compatibility

The legacy path **must remain unchanged:**
- If a request body does **not** include `type`, the quiz is MCQ-legacy.
- If a response body does **not** include `type`, it is MCQ-legacy.
- Legacy `options`/`answer` fields stay supported alongside new `type`/`content` fields indefinitely.

### Admin Endpoints

#### POST /quizzes (Create)

**Legacy (existing behavior, unchanged):**
```json
{
  "question": "What is the capital of France?",
  "options": ["Paris", "London", "Berlin"],
  "answer": "Paris"
}
```

**New (multi-type, no `type` key means legacy):**
```json
{
  "question": "What is the capital of France?",
  "type": "MULTIPLE_CHOICE",
  "content": {
    "options": [
      { "id": "a", "text": "Paris" },
      { "id": "b", "text": "London" }
    ],
    "correctOptionIds": ["a"]
  }
}
```

Response should echo back the quiz row (legacy or typed, as submitted).

#### PUT /quizzes/:id (Update)

Same contract as POST. Can update only certain fields (e.g., question, or type/content).

#### GET /quizzes (List)

Response is unchanged (flat list of quiz rows). Each row may have `type`/`content` or legacy `options`/`answer`.

#### GET /quizzes/:id (Get Single)

Same as above.

### Student Endpoints

#### POST /quizzes/checkQuiz (Submit Answer)

**Legacy (existing behavior, unchanged):**
```json
{
  "quizId": "uuid",
  "chapterId": "uuid",
  "answer": "Paris",
  "isAnswered": true
}
```

**New (multi-type):**
```json
{
  "quizId": "uuid",
  "chapterId": "uuid",
  "studentAnswer": { "selectedOptionIds": ["a", "b"] },
  "isAnswered": true
}
```

**Response:**
```json
{
  "data": {
    "isAnswerCorrect": true,
    "systemScore": 2,           // [NEW] score for this question
    "maxMarks": 2                // [NEW] max marks for this question
  }
}
```

**Backend action:**
- Differentiate on presence of `studentAnswer` vs `answer`, or on quiz `type`.
- If legacy (`answer` field present, no `type`): apply legacy boolean grading (exact match).
- If new type (`studentAnswer` present, `type` set): apply per-type auto-grading (see section 4).
- Persist the `studentAnswer` and `isAnswerCorrect` flag to the attempt.
- Return `isAnswerCorrect` as a boolean (used by frontend for UI feedback).

#### GET /quizzes/getAllAssignQuizzes/:chapterId (Get Chapter Quizzes)

**Current response (unchanged for legacy quizzes):**
```json
{
  "data": [
    {
      "id": "uuid",
      "question": "What is the capital of France?",
      "options": ["Paris", "London"],
      "answer": "Paris",
      "userAnswered": false,
      "isAnswerCorrect": null
    }
  ]
}
```

**New response (with multi-type):**
```json
{
  "data": [
    {
      "id": "uuid",
      "question": "What is the capital of France?",
      "type": "MULTIPLE_CHOICE",
      "content": {
        "options": [
          { "id": "a", "text": "Paris" },
          { "id": "b", "text": "London" }
        ]
        // ⚠️ correctOptionIds is OMITTED from content for students
      },
      "studentAnswer": null,        // populated after student answers
      "userAnswered": false,
      "isAnswerCorrect": null
    }
  ]
}
```

**Rules:**
- If `type` is omitted or `SINGLE_CHOICE` and `content` is null, use legacy `options`/`answer` format.
- If `type` is present and `content` is present, return type + content (with correct-answer fields stripped).
- Once `userAnswered: true`, echo the student's `studentAnswer` (or legacy `answer`).
- `isAnswerCorrect` remains a boolean, type-agnostic.

#### POST /quizzes/createChapterQuizzesReport (Create Report)

No changes. Frontend already computes `score`/`isPassed` client-side (per backend notes in `docs/quiz-progression-backend-followups.md`). Backend is authoritative.

#### GET /quizzes/getChapterQuizzesReport/:chapterId (Get Report)

No changes.

#### POST /quizzes/retakeChapterQuiz (Retake)

No changes.

---

## Grading Logic

For new-type quizzes, implement per-type auto-grading in the backend, **reusing the same logic from the Assessment feature if possible** (recommended for consistency and code reuse). If isolated, implement:

### SINGLE_CHOICE
- If `studentAnswer.selectedOptionId === content.correctOptionId`: full marks, else 0.

### MULTIPLE_CHOICE
- Jaccard similarity: `|intersection| / |union|` of selected vs correct IDs.
- Example: student selects ["a", "b"], correct is ["a", "c"] → intersection ["a"] (1), union ["a", "b", "c"] (3) → 1/3 ≈ 0.33 of full marks.

### TRUE_FALSE
- If `studentAnswer.answer === content.correctAnswer`: full marks, else 0.

### FILL_IN_THE_BLANK
- Exact match, case-insensitive: `studentAnswer.selectedWord.toLowerCase() === content.correctAnswer.toLowerCase()` → full marks, else 0.

### ORDERING
- Count positional matches: how many items are in the correct position.
- Score = `(correct positions / total items) * maxMarks`.
- Example: student orders ["2", "1", "3", "4"], correct is ["1", "2", "3", "4"] → 2 correct (3, 4), score = (2/4) * maxMarks.

### MATCHING
- Count correct pairs: how many left-right pairings match.
- Score = `(correct pairs / total pairs) * maxMarks`.
- Example: student makes 2/3 correct pairs → score = (2/3) * maxMarks.

### VISUAL_ACTIVITY
- If `allowMultiple: false`: behave like SINGLE_CHOICE.
- If `allowMultiple: true`: behave like MULTIPLE_CHOICE.

---

## Recommendation: Code Reuse with Assessment Module

The Assessment feature already has:
1. Per-type grading functions (tested, in production).
2. Answer stripping logic (removing correct-answer fields).
3. Scoring/percentage calculation.

**Suggestion:** Extract these into a shared service module (e.g., `services/questionGrading.ts`) and reuse in both `course-assessment` and `quizzes` modules. This:
- Avoids duplication.
- Ensures grading consistency.
- Simplifies future maintenance (bug fixes apply to both).

If this is not feasible, implement grading inline in the quizzes module following the spec above.

---

## Testing Checklist

- [ ] Create a legacy quiz (no type/content), confirm it behaves exactly as today.
- [ ] Create a SINGLE_CHOICE quiz, submit an answer, verify grading.
- [ ] Create a MULTIPLE_CHOICE quiz with 2 correct answers, submit partial match, verify Jaccard score.
- [ ] Create a TRUE_FALSE quiz, submit both true and false, verify both grade correctly.
- [ ] Create a FILL_IN_THE_BLANK quiz, submit case-variant of correct answer, verify case-insensitive match.
- [ ] Create an ORDERING quiz, submit partial-correct order, verify positional scoring.
- [ ] Create a MATCHING quiz, submit some correct/incorrect pairs, verify pair counting.
- [ ] Create a VISUAL_ACTIVITY quiz (single and multi), verify grading as SINGLE_CHOICE or MULTIPLE_CHOICE.
- [ ] Verify student cannot see correct-answer fields in GET quiz endpoints.
- [ ] Verify quiz report page calculates percentage correctly (sum of individual scores / total maxMarks).
- [ ] Verify pass/fail logic still works (percentage >= `CHAPTER_QUIZ_PASS_PERCENTAGE`).
- [ ] Verify retake flow clears all student answers.
- [ ] Verify backward compatibility: legacy MCQ quizzes continue to work without any changes.

---

## Frontend Implementation Summary

Frontend has implemented:
1. Admin quiz builder (QuizModal) with type selector and per-type field UIs.
2. Student course player branching logic (legacy Question vs QuizQuestionRenderer).
3. Payload builders for both legacy and new types.
4. QuizTable type badges.
5. Type/content reuse from Assessment feature's QuestionRenderer components.

No changes to existing Assessment or Quiz features beyond adding multi-type support. Legacy quizzes work unchanged. All new-type logic is additive.

---

## Questions?

- Reach out to the frontend team for clarification on type definitions or payload shapes.
- Reference `docs/assessment-feature-frontend-guide.md` for the assessment implementation patterns (grading, state machine, UI rules).
