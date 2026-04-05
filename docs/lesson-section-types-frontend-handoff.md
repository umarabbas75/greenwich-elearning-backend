# Lesson section types — backend handoff for frontend

This note explains **what the backend implemented**, **what it did not implement**, and **why**, so the frontend can align UI and API calls without guessing. Requirements moved during the project: an early doc described a larger “embedded assessment in lessons” idea; after clarification, the agreed scope was **only to extend lesson (section) types** in the same style as existing types, **without changing the course assessment feature**.

---

## What we did

- Added two new **section types** on the same `sections` model as today: **`ORDERING`** and **`MATCHING`** (alongside `DEFAULT`, `MATCH_AND_LEARN`, `VISUAL_ACTIVITY`).
- **Admin create/update** still uses the existing course endpoints (`POST /api/v1/courses/section`, `PUT /api/v1/courses/section/update/:id`) with new request shapes (DTOs in the backend: ordering items + `correctOrder`; matching `pairs` with `id`, `left`, `right`). Optional `questionText` is supported where noted in code.
- **Student chapter sections list** (`GET /api/v1/courses/user/module/chapter/allSections/:chapterId/:courseId`, `uJwt`) now **hides answers** for these types: for **ORDERING**, `config` is cleared so the correct sequence is not sent; for **MATCHING**, the API returns `pairs` with only `left` plus a shuffled **`categories`** list (each item `{ id, text }` where `text` is the hidden “right” side), similar in spirit to how matching is presented elsewhere.
- **Database migration** adds enum values `ORDERING` and `MATCHING`, and removes the earlier experimental “auto-graded question section” columns and attempts table (see below). Any old rows that used the removed section type were moved to `DEFAULT` so nothing breaks at read time.
- **`UpdateSectionDto` now allows `type`** so `PUT` bodies can change section type without the field being stripped by validation.

---

## What we did not do (and why)

| Not implemented | Reason |
|-----------------|--------|
| **No changes to the course assessment module** (question bank, attempts, grading APIs) | Product asked to keep assessment as-is and only extend **lessons**. |
| **No `AUTO_GRADED_QUESTION` section type** and **no shared “question bank JSON” inside sections** | That design duplicated assessment concepts inside `sections` and would have tied lesson content to assessment schemas long-term. |
| **No `POST .../embedded-question/submit`** (or any new server endpoint for “submit lesson answer”) | Lesson interactions like Visual Activity and Match and Learn already rely on **client-side checks** plus existing **progress** (`UserCourseProgress`) when the learner completes the activity; we stayed consistent with that pattern. |
| **No `section_question_attempts` table** or server-side scoring for lesson ORDERING/MATCHING | Same as above: avoids a second scoring stack next to assessment and keeps lesson features lightweight. |

In short: **assessment stays the place for formal exams and stored attempts; lessons stay interactive sections with the same progress model you already use.**

---

## How this differs from the first written spec

An early holistic doc (`section-embedded-questions-holistic-spec.md`) discussed **server scoring**, **attempt storage**, **grading modes**, and **reuse of assessment question JSON** inside lessons. That was a **product/architecture proposal**, not what the backend shipped after requirements were clarified. Sections **§1–§6** of that file are largely historical context; **§7** and this handoff describe the **actual backend contract**.

If the frontend was built against the old idea (e.g. expecting a submit endpoint or `AUTO_GRADED_QUESTION`), those parts should be **dropped or redesigned** to match **ORDERING** / **MATCHING** as normal section types with sanitised payloads on the student list endpoint.

---

## Practical checklist for frontend

1. **Section modal / admin**: Add flows for `type: "ORDERING"` and `type: "MATCHING"` with the field shapes the backend expects (see DTOs in `src/dto.ts`: `CreateOrderingSectionDto`, `CreateMatchingSectionDto`, and update variants).
2. **Learner course page**: Branch on `section.type === "ORDERING"` / `"MATCHING"`; render using the **student** payload from `allSections` (no `correctOrder` for ordering; matching uses `categories` + `pairs` without `right`).
3. **Completion**: Continue to use the same mechanism as other interactive sections (e.g. mark complete / `UserCourseProgress` when the learner finishes the activity), unless product defines something new—there is **no** new backend hook for lesson submits.

---

## Who to ask for grey areas

- **Exact UX** (retry limits, “check answer”, mandatory correct before next): not enforced by these backend changes; coordinate with product.
- **Reporting / certificates** using lesson scores: not in scope of this work; would need a separate product decision and API design.

---

*Last updated to match backend as of the ORDERING/MATCHING lesson types + removal of embedded auto-graded section experiment.*
