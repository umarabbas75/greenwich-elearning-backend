# Holistic spec: embed auto-gradable questions in course sections

This document describes **why** we might embed assessment-style interactions inside lessons (sections), **what the frontend does today**, **how we could extend it**, and **what the backend likely needs**—including scoring, progress, and reporting.

**Important for backend engineers:** treat the backend sections as **starting points**, not mandates. Please **critically analyse** them, propose better designs where you see risk or duplication, and **tell the product/frontend team what you changed** (API shape, enums, completion rules, storage) so we can align the UI and docs.

---

## 1. Problem statement

### 1.1 Product intent

We want learners to practise (or be checked on) structured questions **inside the normal course flow**—not only in isolated “chapter quiz” or “course assessment” moments. That implies more than **showing** a question in the UI:

- **Answer capture** — store what the learner submitted.
- **Automatic checking** — where possible, determine correctness without human grading.
- **Progress / completion** — define when a section counts as “done” (e.g. correct on first try, any attempt, or informational only).
- **Results and reporting** — optionally fold outcomes into dashboards, certificates, or “course report” style aggregates **when product requires it**.

### 1.2 Constraint: auto-gradability

Some question types **cannot** be scored automatically in a reliable way (e.g. free-form paragraph / essay). For any feature that depends on **automatic** checking or **machine-readable** results:

- **In scope (examples):** single/multiple choice, true/false, ordering, matching pairs, fill-in-the-blank with normalised answers, image-based multi-select where options are predefined, etc.
- **Out of scope for automatic checking (unless human-in-the-loop is added later):** long paragraph answers, open “explain your reasoning” without rubric automation.

**Policy suggestion:** for **section-embedded** questions intended to affect completion or aggregated metrics, restrict to types with a **deterministic scoring function** agreed between product, frontend, and backend. Short text might be allowed only if normalised (trim, case-folding, synonym list)—backend should own validation of that.

### 1.3 Holistic outcomes we must design together

| Concern | Question to resolve |
|--------|----------------------|
| **UX** | How the learner sees and submits answers. |
| **Correctness** | Server-side validation and scoring (never trust the client alone). |
| **Completion** | When does `LastSeenSection` / section complete / chapter progress advance? |
| **Retries** | Unlimited, capped, or one shot? |
| **Analytics** | What is stored for reports (attempt count, best score, pass/fail, time)? |
| **Separation** | Section practice vs chapter quiz vs course assessment—same engine or different tables? |

---

## 2. Current frontend implementation (reference)

### 2.1 Course sections (“lessons” in the learner UI)

Sections live under chapters. Admin creates/edits them via `SectionModal`; types today:

| `type` | Learner experience (approx.) |
|--------|-------------------------------|
| `DEFAULT` | Rich HTML; completion often tied to read-through / scroll behaviour. |
| `MATCH_AND_LEARN` | Match items to categories; client state + submit when correct. |
| `VISUAL_ACTIVITY` | Image + options; check/reset flow; submit when correct. |

Student rendering branches in `src/app/(coursePage)/studentNewCourse/[...slug]/page.tsx` on `selectedItem.type`.

### 2.2 Formal assessment (question bank & exams)

Separate flow: question types are rendered by `src/components/assessment/questions/QuestionRenderer.tsx`, including:

`SINGLE_CHOICE`, `MULTIPLE_CHOICE`, `TRUE_FALSE`, `FILL_IN_THE_BLANK`, `SHORT_ANSWER`, `LONG_ANSWER`, `ORDERING`, `MATCHING`, `VISUAL_ACTIVITY`.

Authoring uses `QuestionFormModal` (`QUESTION_TYPES`). APIs are under the **course-assessment** area (attempts, snapshots, grading, etc.).

**Note:** `VISUAL_ACTIVITY` as a **section** and `VISUAL_ACTIVITY` as an **assessment question** may not share identical JSON; any reuse requires alignment or mapping.

### 2.3 Implication

The frontend **already has** UI components for many question shapes. What is **not** unified is:

- persistence of answers for arbitrary question types **as sections**,
- server-side scoring for those section attempts,
- a single rule for how they affect **progress and reports**.

---

## 3. How to extend the frontend (high level)

These steps assume backend exposes stable contracts (see §4).

### 3.1 Data model on the wire

For each section that carries a question:

- **`questionType`** — enum aligned with assessment (or a **subset** explicitly listed for sections).
- **`questionContent`** — JSON matching a schema per type (ideally **the same** as assessment `questionContent` for types we support, to reuse `QuestionRenderer`).
- **Optional metadata** — `gradingMode` (`practice` | `counts_toward_progress` | `informational`), `maxAttempts`, `requireCorrectToProceed`, etc.

### 3.2 Admin UI

- Extend `SectionModal` (or add a dedicated “Question section” flow): pick **allowed** types only; for each type, reuse field patterns from `QuestionFormModal` or a shared sub-form module to avoid drift.
- Validate on submit: required fields per type; block or warn if type is not auto-gradable when “counts toward progress” is on.

### 3.3 Learner UI

- In `studentNewCourse/[...slug]/page.tsx`, add branches for lesson section types `ORDERING` and `MATCHING` (same API as other sections: `GET .../allSections/...` returns sanitised payloads—no correct order / no right-column answers for matching).
- Progress for these types uses the same `UserCourseProgress` / client flows as `VISUAL_ACTIVITY` and `MATCH_AND_LEARN` (no separate backend submit endpoint).

### 3.4 Progress and sidebar

- `SideBarAllSection.tsx` (and similar) may need icons/labels for the new type.
- Completion state should come from API (e.g. `isCompleted`, `bestScore`, `passed`) rather than inferring only from client.

### 3.5 Reporting / PDF / grades (if in scope)

- If section scores must appear in existing **course report** or **PDF**, frontend must consume whatever API the backend adds (per-section outcome or rolled-up metrics). Coordinate field names early.

### 3.6 Types we suggest **excluding** from auto-graded section flows (unless backend adds AI/manual review)

- **`LONG_ANSWER`** (and similar free text) for any flow that requires **automatic** scoring or binary completion.
- **`SHORT_ANSWER`** only if backend defines strict normalisation and product accepts false negatives/positives.

Frontend can still **hide** these in the section picker when “auto-grade / affect progress” is enabled.

---

## 4. Suggestions for backend (please review and improve)

These are **proposals**. Backend should optimise for consistency, security, auditability, and operational cost.

### 4.1 Storage

**Option A — Extend section record**

- Add nullable `questionType`, `questionContent` (JSON), and optional flags (`gradingMode`, `maxAttempts`, …).

**Option B — Separate table**

- e.g. `SectionQuestion` / `SectionAttempt` linked to `sectionId` + `userId`, keeping section row smaller and attempts versioned.

Either is fine; prefer the one that fits your ORM, reporting queries, and migration path.

### 4.2 Submit and score endpoint (conceptual)

- **Input:** `sectionId`, `attemptPayload` (answer shape per type—same as assessment answer DTO where possible).
- **Output:** `isCorrect` or `score`, `maxScore`, `passed` (if threshold), `attemptNumber`, `sectionCompletionUpdated` boolean.
- **Rules:** scoring **only on server**; never accept “I got 100%” from the client without verification.

### 4.3 Completion integration

- Define idempotent rules: e.g. mark section complete when `passed === true` or when `maxAttempts` exhausted (product decision).
- Ensure compatibility with existing chapter/course progress and any **quiz** or **assessment** gates.

### 4.4 Reporting

- If results feed aggregates: expose clear fields (per user, per section, per course) or events for analytics.
- Consider privacy and retention (GDPR) if storing free-text—even short answers.

### 4.5 Alignment with course-assessment service

- **Reuse** question JSON schema and scoring logic where possible (shared library or internal service) to avoid two divergent implementations of “single choice correctness.”
- If you **cannot** reuse, document differences so frontend does not assume parity.

### 4.6 API versioning and documentation

- OpenAPI (or equivalent) for new/changed endpoints and enums.
- Changelog entry when backend **changes** suggested field names, completion semantics, or allowed types.

---

## 5. Request to backend team (process)

1. **Critically review** §4 (and §1 constraints). Push back where the design duplicates existing tables, breaks scalability, or weakens security.
2. **Propose improvements** (e.g. different resource model, event-driven progress, shared grading service).
3. **Implement** agreed API + schema.
4. **Tell frontend/product** explicitly:
   - final URL paths and methods,
   - request/response shapes,
   - enum values,
   - completion and retry semantics,
   - which question types are supported for sections,
   - anything you **changed** from this document.

We will update this doc and the implementation to match your **final** contract.

---

## 6. Summary

- The problem is **holistic**: UI + **automatic** verification + optional **results**—not “render a question.”
- **Paragraph-style / long free text** is a poor fit for automatic checking unless you add non-automatic grading; we recommend **excluding** those from auto-graded section flows until that exists.
- The frontend can **extend** by reusing `QuestionRenderer`, extending `SectionModal`, and adding learner submit flows **once** the backend contract is clear.
- Backend suggestions above are **starting points**; please **improve them** and **feed changes back** so we stay aligned.

---

*Document version: 1.0 — maintained by frontend/product; revise when backend publishes the authoritative API spec.*

---

## 7. Backend: extra lesson section types (`ORDERING`, `MATCHING`)

**Course assessment / question bank code is unchanged.** Lesson extensions use the same `sections` row pattern as `MATCH_AND_LEARN` / `VISUAL_ACTIVITY`.

| `type` | Storage | Student list API (`GET .../allSections/...`) |
|--------|---------|-----------------------------------------------|
| `ORDERING` | `items` JSON: `[{ id, text }, …]`; `config` JSON: `{ correctOrder: string[] }` (ids in order). Optional `questionText`. | `config` is omitted (no correct sequence leaked). |
| `MATCHING` | `config` JSON: `{ pairs: [{ id, left, right }, …] }`. Optional `questionText`. | `config` becomes `{ pairs: [{ id, left }], categories: shuffled [{ id, text }] }` (`text` = former `right`). |

**Admin:** `POST /api/v1/courses/section` and `PUT /api/v1/courses/section/update/:id` with DTOs `CreateOrderingSectionDto` / `CreateMatchingSectionDto` / updates. Progress still uses existing `UserCourseProgress` / client flows (no separate submit endpoint for these types in the backend).
