# Lesson section types — backend handoff for frontend

This note explains **what the backend implemented**, **what it did not implement**, and **why**, so the frontend can align UI and API calls without guessing. Requirements moved during the project: an early doc described a larger “embedded assessment in lessons” idea; after clarification, the agreed scope was **only to extend lesson (section) types** in the same style as existing types, **without changing the course assessment feature**.

---

## What we did

- Added lesson **section types** on the same `sections` model: **`ORDERING`**, **`MATCHING`**, and **`FLASHCARDS`** (alongside `DEFAULT`, `MATCH_AND_LEARN`, `VISUAL_ACTIVITY`).
- **Admin create/update** still uses the existing course endpoints (`POST /api/v1/courses/section`, `PUT /api/v1/courses/section/update/:id`) with type-specific request shapes (DTOs in the backend).
- **Student chapter sections list** (`GET /api/v1/courses/user/module/chapter/allSections/:chapterId/:courseId`, `uJwt`) **hides answers** for `ORDERING` and `MATCHING`. **`FLASHCARDS` is not sanitised** — both faces are returned so the learner player can flip.
- **`UpdateSectionDto` allows `type`** so `PUT` bodies can change section type without the field being stripped by validation.

---

## FLASHCARDS

Practice cards inside a lesson. Not graded. Not part of the course assessment.

### Config stored on the section

```json
{
  "layout": "grid",
  "cards": [
    {
      "id": "card-fire",
      "front": { "text": "Fire", "imageUrl": null },
      "back": {
        "text": "A rapid oxidation process giving off heat and light.",
        "imageUrl": null
      }
    }
  ]
}
```

| Field | Notes |
| --- | --- |
| `layout` | `"grid"` (default — all cards visible, flip in place) or `"single"` (one card at a time). Same card data either way. Unknown values are rejected, not coerced. |
| `cards[].id` | Required, unique within the section. |
| `front` / `back` | Each face must have **text and/or `imageUrl`**. `imageUrl` must be `http:` or `https:` (data URIs and other schemes are rejected). Missing side is stored as `null`. |

Title + description on the section are the heading and instruction (e.g. “Key Terms: Fire and Combustion” / “Review each flashcard…”).

### Create

`POST /api/v1/courses/section`

```json
{
  "title": "Key Terms: Fire and Combustion",
  "description": "Review each flashcard to reinforce your understanding of essential fire safety terminology.",
  "type": "FLASHCARDS",
  "chapterId": "<uuid>",
  "layout": "grid",
  "cards": [
    {
      "id": "card-fire",
      "front": { "text": "Fire" },
      "back": { "text": "A rapid oxidation process giving off heat and light." }
    },
    {
      "id": "card-combustion",
      "front": { "text": "Combustion" },
      "back": {
        "text": "The process of burning, where a material reacts with an oxidizer and gives off heat and gases."
      }
    }
  ]
}
```

`layout` is optional (defaults to `grid`). `imageUrl` is optional on either face.

### Update

`PUT /api/v1/courses/section/update/:id` — send `layout` and/or `cards`. Omitting `cards` keeps the existing deck; omitting `layout` keeps the existing layout.

### Learner UI

- Branch on `section.type === "FLASHCARDS"`.
- Read `section.config.layout` and `section.config.cards`.
- Both faces are in the payload. Flip is client-side.
- **Do not** call `POST /tracking/section-attempt`. Reports show `totalAttempts: null` (same as `DEFAULT`).
- **Completion:** require each card to be flipped at least once, then use the existing mark-complete / `UserCourseProgress` path (`PUT /courses/updateUserChapter/progress`). Opening the section is not enough. There is no right/wrong check and no self-rate (“I knew it”) loop.

---

## What we did not do (and why)

| Not implemented | Reason |
|-----------------|--------|
| **No changes to the course assessment module** (question bank, attempts, grading APIs) | Product asked to keep assessment as-is and only extend **lessons**. |
| **No `AUTO_GRADED_QUESTION` section type** and **no shared “question bank JSON” inside sections** | That design duplicated assessment concepts inside `sections` and would have tied lesson content to assessment schemas long-term. |
| **No `POST .../embedded-question/submit`** (or any new server endpoint for “submit lesson answer”) | Lesson interactions like Visual Activity and Match and Learn already rely on **client-side checks** plus existing **progress** (`UserCourseProgress`) when the learner completes the activity; we stayed consistent with that pattern. |
| **No `section_question_attempts` table** or server-side scoring for lesson ORDERING/MATCHING/FLASHCARDS | Same as above: avoids a second scoring stack next to assessment and keeps lesson features lightweight. |
| **No spaced-repetition / “I knew it” rating** on FLASHCARDS | Flip-to-reveal only. |

In short: **assessment stays the place for formal exams and stored attempts; lessons stay interactive sections with the same progress model you already use.**

---

## How this differs from the first written spec

An early holistic doc (`section-embedded-questions-holistic-spec.md`) discussed **server scoring**, **attempt storage**, **grading modes**, and **reuse of assessment question JSON** inside lessons. That was a **product/architecture proposal**, not what the backend shipped after requirements were clarified. Sections **§1–§6** of that file are largely historical context; **§7** and this handoff describe the **actual backend contract**.

If the frontend was built against the old idea (e.g. expecting a submit endpoint or `AUTO_GRADED_QUESTION`), those parts should be **dropped or redesigned** to match **ORDERING** / **MATCHING** as normal section types with sanitised payloads on the student list endpoint.

---

## Practical checklist for frontend

1. **Section modal / admin**: Add flows for `type: "ORDERING"`, `"MATCHING"`, and `"FLASHCARDS"` with the field shapes the backend expects (see DTOs in `src/dto.ts`).
2. **Learner course page**: Branch on `section.type`. For ORDERING/MATCHING use the **student** payload from `allSections` (no `correctOrder`; matching uses `categories` + `pairs` without `right`). For FLASHCARDS use `config.layout` + `config.cards` as returned.
3. **Completion**: Continue to use the same `UserCourseProgress` mechanism. For FLASHCARDS, gate on every card flipped once. There is **no** new backend hook for lesson submits.

---

## Who to ask for grey areas

- **Exact UX** (retry limits, “check answer”, mandatory correct before next): not enforced by these backend changes; coordinate with product.
- **Reporting / certificates** using lesson scores: not in scope of this work; would need a separate product decision and API design.

---

*Last updated to match backend as of the FLASHCARDS lesson type.*
