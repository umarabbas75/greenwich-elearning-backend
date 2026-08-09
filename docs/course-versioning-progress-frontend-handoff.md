# Course Versioning & Progress — Frontend Handoff

Last updated: 2026-08-09
Audience: frontend engineers. Covers **14 backend commits** (`4f31d99..00db3d5`) plus
2 frontend commits already landed in `greenwich-elearning`.

**TL;DR for the FE team:** almost none of this requires frontend work. Two things do,
and both are already committed on your side (§2). The rest is 11 new admin endpoints
that have **no UI at all** (§4) — a greenfield build whenever you want it. One thing
needs a product decision (§3), and one is a live UX bug in your uncommitted work (§7).

---

## 1. What these 14 commits are

Two batches. The first five shipped admin *visibility* for course versioning; the
last seven fixed correctness bugs that review of the first batch uncovered.

| # | Commit | What it did | FE impact |
|---|---|---|---|
| 1 | `50e4163` | Baseline: `AdminAuditLog`, unassign/reassign guard, denominator alignment | none |
| 2 | `899d65d` | **PR 1** — restore endpoints + archive inventory | new endpoints, no UI |
| 3 | `d4e28c9` | **PR 2** — enrollment roster | new endpoint, no UI |
| 4 | `d76fdf6` | **PR 3** — version tree + titled diff | new endpoints, no UI |
| 5 | `303fd54` | **PR 4** — coverage + drift | new endpoints, no UI |
| 6 | `c17e760` | **PR 5** — bulk migration + dry-run | new endpoint, no UI |
| 7 | `c5fa3ec` | **A0** — completion now requires passing chapter quizzes | **behaviour change** |
| 8 | `00d2fb9` | **A2** — migration audit moved out of its transaction | none |
| 9 | `ca0e5e1` | **A1** — single source of truth for progress % | none (internal) |
| 10 | `d160a79` | **A3** — roster + dry-run onto that engine | none |
| 11 | `d26b716` | **A5** — learner-facing % onto the engine; live-branch scope fixes | **subtle** |
| 12 | `6e72c15` | **A6** — lint rule + property tests | none |
| 13 | `be0c08d` | **A7** — 3 defects found in adversarial review | none |
| 14 | `00db3d5` | **perf** — 3 round trips → 1 on the live-section lookup | none |

Already landed on the frontend:

| Commit | What |
|---|---|
| `1864078` | **A0b** — 4 surfaces now read `isCompleted` instead of `percentage === 100` |
| `bf39b1e` | **A8** — lesson sidebar stopped adding `+1` for the chapter quiz |

---

## 2. The two things that actually change for learners

### 2a. A course is no longer complete until its chapter quizzes are passed

Previously `CourseCompletion.courseCompletedAt` was stamped from **completed sections
only** — `QuizProgress` was never consulted. A learner could finish every section,
skip a chapter quiz, and be certified: congratulations email, feedback request, and
(in future) a certificate.

The progression gate already required the quiz, but it only gates *entering the next
chapter* — so the **last** chapter's quiz was never enforced.

Now: **all sections done AND every quiz-bearing chapter passed.**

**What this means for your UI:** a learner can legitimately sit at **100% with the
course not complete**. That is correct and intended — the quiz is a pass/fail *gate*,
not a fraction of the content.

Nothing to build: the "Quiz pending" badge in
[`SideBarAllSection.tsx:248-267`](../greenwich-elearning/src/app/(coursePage)/studentNewCourse/_components/SideBarAllSection.tsx)
already communicates it, and A0b already moved the four "am I done?" surfaces onto
`isCompleted`. **But see §3 — this needs a product sign-off, not just an engineering one.**

Production impact today: **0 learners affected.** Only OTHM Level 6 is exposed (29/29
chapters carry quizzes, including the last) and it is not live yet. Audit:
`scripts/_audit-completion-quiz-gap.ts` (read-only, safe in any env).

### 2b. Percentage is now scoped correctly

All progress percentages come from one engine
(`src/course-version/learner-percentage.ts`). Previously each endpoint assembled the
ratio itself and picked its own numerator/denominator scope — e.g. a numerator filtered
to *live* sections over a denominator frozen at publish time. A learner who completed
all 12 sections of their pinned version read **92%** once one of those sections was
archived, while the completion gate correctly considered them done.

**Wire format is unchanged.** `percentage`, `isCompleted`, `completedAt`,
`_count.UserCourseProgress`, `_count.sections`, `contribution`, `progress` — all the
same fields in the same places.

**Measured blast radius on production data: one learner, 14% → 16%, upward.** No
percentage decreases anywhere; no denominator moves. The learner had completed a
"Case study" section archived after they pinned — they did the work and were being
under-credited.

Two smaller fixes rode along in A5:

- `getUserChapterProgress` and `getAllUserSections` live branches now filter
  `isActive: true` (they only filtered `isArchived`). **An inactive-but-not-archived
  section will disappear from the lesson player's section list.** If you have learners
  parked on such a section, they lose access to it — worth a check before deploy.
- `getUserChapterProgress` now *intersects* progress against the chapter's live
  sections rather than counting rows and clamping. A learner with stale progress rows
  previously read exactly 100%; they now read their true position.

---

## 3. ⚠️ Needs a product decision before deploy

**"100% but not complete" changes what 100% means to a learner.**

Today 100% implies done. After A0 it means "all content consumed" — completion
additionally requires passing chapter quizzes. The "Completed Courses" tab is no longer
populated by percentage (A0b already switched it to `isCompleted`).

This is correct, but it is a **learner-visible semantic change**, not an engineering
detail. Whoever owns the learner experience should sign off before this ships, and
support should know the answer to "why does it say 100% but I'm not finished?"

---

## 4. 11 new admin endpoints — zero UI exists

All are `AuthGuard('jwt')` + admin-only. **None are called from the frontend today.**
This is a greenfield build; nothing is half-wired.

### Restore + archive inventory (PR 1)
```
POST /courses/module/:id/restore
POST /courses/chapter/:id/restore
POST /courses/section/:id/restore
POST /quiz/:id/restore
GET  /courses/:courseId/archived?page=&pageSize=&entityType=&search=&sort=
```
- Restore does **not** cascade in either direction. Restoring a child under an archived
  parent returns **409** with `details: { parentEntityType, parentId, parentTitle, chain }`
  so you can offer a one-click "Restore parent first" jump.
- Success `data` carries `{ latestPublishedVersionId, latestPublishedVersionNumber,
  publishedInLatest, note }`. Build your own copy from the structured fields; `note` is
  a pre-rendered string for log surfaces.
- Inventory rows are **flat** with `parentIsArchived`, plus `parentId`/`parentEntityType`
  when that is true (`null` otherwise). Default sort `archivedAt:desc`. Max `pageSize` 100.
- ⚠️ **Restore does not touch `orderIndex`** — the row keeps its archived value and a
  collision lands wherever the sort tiebreaker puts it. The decisions doc originally
  promised append-to-end; that was never implemented and the doc is now corrected.

### Enrollment roster (PR 2)
```
GET /courses/:courseId/enrollments?page=&pageSize=&sort=&search=&versionFilter=
```
Response `data`: `{ latestPublishedVersionId, latestPublishedVersionNumber, rows[], total, page, pageSize }`.
Row: `{ userId, userLabel, email, enrolledVersionId, enrolledVersionNumber, percentage, isCompleted, isActive, isPaid }`.

- Derive "is on latest?" as `row.enrolledVersionId === data.latestPublishedVersionId` —
  a top-level field, so a publish landing mid-page can't produce inconsistent rows.
- `sort`: `percentage:desc|asc`, `email:asc|desc`, `versionNumber:asc|desc`. Unknown
  values fall back to `email:asc` rather than erroring.
- Soft-deleted users are excluded; there is no opt-in flag in the MVP.

### Version tree + diff (PR 3)
```
GET /courses/:courseId/versions/:versionId
GET /courses/:courseId/versions/diff?from=&to=
```
Diff returns slim entries — `added[]` / `removed[]` / `moved[]` / `renamed[]` with
`{ id, entityType, title, path }` (`fromPath`/`toPath` for moves). Link to the tree
endpoint for drill-in rather than expecting nested subtrees.

`renamed[]` is **always empty** in the current schema (titles aren't snapshotted per
version). The plumbing is there for a future schema change — don't build UI that
depends on it firing.

Move detection is structural (parent-sourceId chain), so renaming a chapter no longer
cascades its descendants into `moved[]`.

### Coverage + drift (PR 4)
```
GET /courses/versions/coverage
GET /courses/:courseId/versions/drift
```
Drift returns `{ hasDrift, changeCount: { added, removed, moved, renamed },
latestPublishedVersionId, latestPublishedVersionNumber, latestPublishedAt,
liveFingerprint, publishedFingerprint }`. `changeCount` is what you want for an
"N unpublished changes" header badge.

Reconcile is deliberately **CLI-only** — not exposed as an endpoint.

### Bulk migration (PR 5)
```
POST /courses/:courseId/enrollments/migrate-version-bulk
body: { userIds: string[], targetVersionId: string, dryRun: boolean, acceptRegressionFor?: string[] }
```
- **Always dry-run first.** `dryRun: true` returns per-learner
  `{ currentPercentage, projectedPercentage, wouldRegress, isCertified, ... }` plus a
  summary — that is the confirmation modal's data.
- Regression is **default-deny**. A learner whose percentage would drop is skipped
  unless their id is in `acceptRegressionFor`.
- Ceiling **500** `userIds` per call; above that returns
  `400 { ceiling: 500, requested: N }`.
- `skipped[].reason` ∈ `would_regress_not_accepted | migration_failed |
  user_not_enrolled | already_on_target_version`. `migration_failed` also carries
  `errorMessage` (debug field — don't surface it to admins verbatim).
- Per-learner transactions: one wedged learner is skipped, the batch continues.

The **single**-learner endpoint (`POST /courses/enrollments/migrate-version`) still
does **no** regression check — that was PR 2's shipped contract. When you build the
row-action preview, call the bulk endpoint with a 1-element `userIds` array instead.

---

## 5. Docs

Backend is the source of truth. These were **copied into `greenwich-elearning/docs/`**
as part of this handoff:

| Doc | Read it for |
|---|---|
| `course-versioning.md` | **The core model.** Was missing on the FE side entirely — start here |
| `course-versioning-admin-features-decisions.md` | The frozen FE↔BE contract for all 11 endpoints |
| `course-progress-freeze-at-completion.md` | Why the completion freeze exists (the NEBOSH incident) |
| `frontend-progress-display-guide.md` | Every FE progress surface, mapped to its endpoint |

Already present on the FE: `course-versioning-admin-features-plan.md`,
`course-versioning-admin-features-spec.md`, `course-versioning-admin-fixes.md`,
`course-versioning-plan.md`.

⚠️ **Five of these are untracked in git on the frontend repo** (`git status` shows `??`)
— they will vanish on a clean checkout. Please `git add docs/` on your side.

Backend-only, referenced if you go deeper: `course-versioning-redesign-decision-log.md`,
`quiz-progression-backend-followups.md`.

---

## 6. Read-only audit scripts

Safe in any environment; all pure reads.

```bash
yarn ts-node -r tsconfig-paths/register scripts/_audit-completion-quiz-gap.ts
yarn ts-node -r tsconfig-paths/register scripts/_audit-completion-mismatch.ts
yarn ts-node -r tsconfig-paths/register scripts/_audit-version-coverage.ts
```

The first is the leading indicator for A0: its second table lists courses with a quiz on
their **last** chapter — those are the ones exposed to the completion gap. Re-run it
before OTHM Level 6 goes live.

---

## 7. Issues in your current working tree

Found while surveying the frontend. **Not mine to fix** — all in uncommitted work.

1. **`ForceUnassignCourseModal.tsx:170-174` advertises a feature that doesn't exist.**
   The copy says *"Moving to a different version instead? Use "Migrate version""* — there
   is no Migrate version button anywhere in the codebase. Either build the row-action or
   soften the copy; right now it sends admins looking for a control that isn't there.

2. **Rounding is inconsistent for the same backend `percentage`.** `.toFixed(0)`,
   `Math.round`, `.toFixed(1)`, `parseInt`, and raw pass-through all appear across
   surfaces. The backend now returns an **integer** 0–100, so `Math.round`/`toFixed(0)`
   are harmless no-ops and `toFixed(1)`/`toFixed(2)` show precision that doesn't exist.
   (`ViewUserCoursesModal.tsx:158` was changed to `toFixed(0)` as part of this work.)

3. **`CourseContent.tsx:35-39, 92, 180-181` still divides `_count` client-side.** Those
   `_count` pairs remain correct and aligned, so this works today — but it is the same
   pattern that produced the 92%-vs-100% bug, and it can disagree with the backend
   `percentage` shown on the same learner's card. Backend now has a lint rule preventing
   this recurring server-side; consider the mirror rule on the FE.

4. **`Grades.tsx:319-322` sums `contribution` (a possibly-*string* field via `parseFloat`)
   and tests `=== 100`.** Float equality on a summed value is fragile — a course whose
   contributions sum to 99.99999 never reads as complete. Prefer `data?.isCompleted`,
   which is authoritative.

5. **`debugFetchLog.ts:1-16` says REMOVE BEFORE MERGING** and is still wired into
   `useApiGet` and the query provider.

---

## 8. Deploy order

1. `prisma migrate deploy` (both migrations are additive and already applied in earlier PRs)
2. **Backend** — the 14 commits
3. **Frontend** — `1864078` (A0b) and `bf39b1e` (A8)

Backend-first is safe: A0b is an improvement on its own. But **A0b must not lag A0 into
production** — if the backend ships alone, the Award icon, "Completed Courses" tab, and
feedback prompt will fire for learners who finished their sections but still owe a quiz.

**Hard deadline: A0 must ship before OTHM Level 6 goes live.** That course has quizzes on
all 29 chapters including the last, and is the only one exposed to the completion gap.

---

## 9. Verification state at handoff

- `npx tsc --noEmit` — clean, both repos
- `npx jest` — **270/270** (baseline before this work: 130)
- `npm run build` — clean
- `npx eslint 'src/**/*.ts'` — 5 pre-existing errors in unrelated files, zero introduced
- Production audits re-run post-change: 0 completion/quiz gaps, 0 unpinned active
  enrollments, 0 `sectionCount` drift across all 136 `CourseVersion` rows
- Server-side query cost measured via `EXPLAIN ANALYZE`: every engine query
  **0.03–0.18 ms**; round trips are flat in learner count (17 at 42 learners, 17 at 500)
