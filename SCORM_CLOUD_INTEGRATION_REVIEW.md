# SCORM Cloud Integration — Code Review

**Branch:** `feat/scorm-cloud-integration` vs `main`
**Diff size:** 100 files changed, ~5,919 insertions / 106 deletions
**Method:** 9 parallel review angles (line-by-line diff scan, cross-file tracing, language/Prisma pitfalls, wrapper/proxy correctness, removed-behavior audit, efficiency, simplification, reuse/duplication, conventions), each independently reading the full diff plus current file state, deduplicated into the list below. The full SCORM Jest suite (79 tests) passes — these findings live in gaps the tests don't cover.

**Files most implicated:** `src/scorm/scorm-runtime.service.ts`, `src/scorm/scorm.service.ts`, `src/scorm-cloud/scorm-cloud.client.ts`, `src/quiz/quiz.service.ts`, `src/course-assessment/course-assessment.service.ts`, `src/course/course.service.ts`.

---

## Verification pass — fixes applied

A follow-up commit addressed all 27 findings. Verified against the working tree (not just the diff) by 4 independent passes reading full file context, running `tsc --noEmit`, and re-running the affected Jest suites (53/53 pass). **21 of 27 fully fixed, 4 partial, 1 new regression introduced by combining two fixes.**

### ⚠️ New issue introduced — fix before merging

Combining the fixes for #18 (drop redundant re-fetch) and #20 (batch + parallelize reconcile cron) reopened a race. The old code re-fetched each registration row *immediately before* the write, right after each Cloud API round-trip — a deliberate freshness guard. The new code batches all candidate rows up front (`findMany`), runs the Cloud calls concurrently (`Promise.all`), then writes using that now-stale snapshot. `completionStatus`/`successStatus` are still protected by `pickMonotonic`, but `scoreScaled` and `totalTimeSeconds` use plain `?? current.value` fallbacks in the write — so a live postback updating those fields on a registration while its reconcile candidate is mid-flight can have its newer value silently clobbered by the reconcile write's stale fallback. **Fix:** re-fetch immediately before each write (partially trading back #20's batching gain), or make `scoreScaled`/`totalTimeSeconds` monotonic/conditional updates the same way completion status already is.

### Summary table

| # | Finding | Status | Notes |
|---|---|---|---|
| 1 | Stale sectionId blocks certification | **FIXED** | Solved at certify-time via new `resolveCertifySection` rather than write-time update — remaps floaters to the live section, correctly leaves pinned learners on their archived one |
| 2 | 409 fallthrough doesn't fail closed | **FIXED** | Now throws `InternalServerErrorException` on an unverifiable 409 instead of persisting an unverified id |
| 3 | `bulkAssignQuiz` missing guard | **FIXED** | |
| 4 | `unAssignQuiz` missing guard | **FIXED** | |
| 5 | `updateQuiz` missing guard | **FIXED** | |
| 6 | `deleteQuiz` missing guard | **FIXED** | |
| 7 | Assessment methods missing guard | **FIXED** | |
| 8 | `isPassed` always true | **FIXED** | Now gated on `certifyPassed` matching the actual `completeOn` signal; `bestAttemptId` still unset for SCORM, but `certificate.service.ts` now falls back to `ScormRegistration.scoreScaled` so scores no longer render null |
| 9 | Double-publish race | **FIXED** | `treeBuilt` flag gates the publish call; `publishNewVersion`'s own advisory lock + dedup is a second line of defense even if that gate were bypassed |
| 10 | Duplicate-title race | **FIXED** | P2002 mapped to `ConflictException` |
| 11 | Version-number race | **FIXED** | P2002 mapped to `ConflictException` |
| 12 | Over-broad catch mislabels errors | **FIXED** | Now checks `instanceof ForbiddenException` before treating as "not enrolled"; anything else rethrows |
| 13 | Non-Rise silent gate skip | **PARTIAL** | Warning message is now accurate ("probe unavailable" vs "0 quiz items"), but still only `logger.warn`'d — no admin-visible field on the package record |
| 14 | SUPERSEDED resources never pruned | **PARTIAL** | Real `pruneSupersededPackagesCron` now exists and is wired into `vercel.json`, but there's no terminal/pruned status on `ScormPackage` — the same oldest-10 candidates get reprocessed daily even after a successful delete |
| 15 | Unenumerated states silently no-op | **FIXED** | Explicit branches now throw/log instead of falling through |
| 16 | `launch()` serialized round trips (a) | **FIXED** | Verified `assertEnrollmentUsable` doesn't depend on `resolvePinnedScormTarget`'s result — safe to parallelize |
| 17 | `launch()` serialized round trips (b) | **FIXED** | Minor: `upsertLastSeen` can now commit even if `ensureCloudRegistration` later throws, low severity |
| 18 | Redundant registration re-fetch | **FIXED, see regression above** | |
| 19 | Cron processes imports serially | **FIXED** | `Promise.all`; verified safe via per-package advisory lock + per-course `inFlight` check |
| 20 | Reconcile fetches one-by-one | **FIXED, see regression above** | |
| 21 | Tree-lock guard re-fetches data | **PARTIAL** | Guard now accepts an optional `deliveryMode` and is used correctly at all `course-assessment.service.ts` sites and 3 of ~8 in `quiz.service.ts`; not applied at ~13 sites in `course.service.ts` or 2 newer guard calls in `quiz.service.ts` — inefficiency persists there, not a new bug |
| 22 | Duplicated compensating-delete block | **FIXED** | Extracted to `src/utils/scorm-cloud-compensate.ts` |
| 23 | `err instanceof Error` hand-rolled ~10x | **FIXED** | Extracted to `src/utils/error-message.ts`, applied at all originally-flagged sites |
| 24 | Dead `ping()`/`testRegistrationPostback()` | **FIXED** | Removed entirely |
| 25 | Timing-safe compare reimplemented | **FIXED** | Extracted to `src/utils/constant-time-equal.ts`, used by both `auth.service.ts` and the postback guard |
| 26 | Leftover forwarder method | **FIXED** | `_assertEnrollmentUsable` removed, call sites use the shared util directly |
| 27 | Trailing-slash stripping duplicated 6x | **PARTIAL** | Extracted to `src/utils/strip-trailing-slash.ts`, applied everywhere in scope plus a bonus fix to `certificate.service.ts`; `engagement.service.ts:77` (outside this PR) still has a raw copy |

---

## Correctness — fix before shipping further

### 1. Stale `sectionId` blocks certification permanently after a package replace
**File:** `src/scorm/scorm-runtime.service.ts:321` (also `src/scorm/scorm.service.ts:429-446`)

`ScormRegistration.sectionId` is captured once at registration creation and never updated when an admin replaces the SCORM package.

**Failure scenario:** Learner registers under package v1 (section S1). Admin replaces the package before the learner finishes; `buildOrReplaceTree` archives S1 and creates S2 under the same chapter. The learner's later postback satisfies `completeOn`, but `runCompletionBridge` looks up the archived S1, so `checkContentCompletion`'s live-section denominator (which only counts S2) never matches — `courseCompletedAt` is never stamped. Every retried postback 500s (`throwIfCertifyIncomplete: true`) and every cron reconcile pass silently no-ops forever; the learner can never certify, with no recovery path.

---

### 2. 409 registration fallthrough never actually "fails closed"
**File:** `src/scorm/scorm-runtime.service.ts:453` (fallthrough at 471–493)

When SCORM Cloud returns 409 on `createRegistration` and no local row races in, the code always falls through and persists a local row asserting ownership of an unverified Cloud registration id — despite a comment promising to "fail closed" in that case.

**Failure scenario:** Cloud 409s a freshly generated `registrationId` with no local row present (e.g. a stale Cloud-side registration from a previous purge or failed launch). The code logs a warning but proceeds to create a local `ScormRegistration` row claiming that id anyway. `launch()` then calls `buildRegistrationLaunchLink` against the unverified id, which can 404 or hand the learner a link into a different registration; the same unverified id can later be passed to `deleteRegistration` by the P2002 branch, deleting a Cloud registration this code never actually owns.

---

### 3. `bulkAssignQuiz` skips the imported-SCORM tree-lock guard
**File:** `src/quiz/quiz.service.ts:788`

`bulkAssignQuiz` never calls `assertImportedCourseTreeLocked`, even though its single-item sibling `assignQuiz` does.

**Failure scenario:** Admin bulk-assigns quizzes to the auto-created "Course content" chapter of an `IMPORTED_SCORM` course. The chapter becomes quiz-bearing per `countCompletionDenominator`, so `checkContentCompletion` now requires a passing `QuizProgress` row before certifying — but SCORM Cloud learners only ever get a `UserCourseProgress` row via `runCompletionBridge`, which never creates `QuizProgress`. The course becomes **permanently uncompletable** for every SCORM learner.

---

### 4. `unAssignQuiz` has no imported-SCORM tree-lock guard
**File:** `src/quiz/quiz.service.ts:866`

Neither the archive branch nor the disconnect branch is guarded, unlike `assignQuiz`.

**Failure scenario:** A call to `unAssignQuiz` against a quiz/chapter belonging to an `IMPORTED_SCORM` course returns 200 and silently detaches/archives the quiz instead of the 403 that governs every other write to that course's tree — an asymmetry between assign (blocked) and unassign (allowed).

---

### 5. `updateQuiz` has no imported-SCORM tree-lock guard
**File:** `src/quiz/quiz.service.ts:992`

No guard before the write at line 1010.

**Failure scenario:** Admin edits a quiz's question or correct answer for a quiz whose chapter belongs to an `IMPORTED_SCORM` course; the edit succeeds instead of being rejected with "Replace the package instead of editing the tree" — the exact message the guard exists to enforce elsewhere in this file.

---

### 6. `deleteQuiz` has no imported-SCORM tree-lock guard
**File:** `src/quiz/quiz.service.ts:1033`

Neither the archive branch (1055) nor the hard-delete branch (1099) is guarded, unlike every module/chapter/section delete path in `course.service.ts`.

**Failure scenario:** Admin deletes a quiz belonging to an `IMPORTED_SCORM` course's chapter; if no published version references it, it is hard-deleted immediately with no 403 — silently diverging from the locked-curriculum policy applied everywhere else.

---

### 7. `updateAssessment` / `activateAssessment` / `deactivateAssessment` skip the tree-lock guard
**File:** `src/course-assessment/course-assessment.service.ts:422` (also 455, 494)

`createAssessment` in the same file calls `assertImportedCourseTreeLocked`; these three siblings don't.

**Failure scenario:** Admin calls `activateAssessment` on a MANUAL assessment tied to an `IMPORTED_SCORM` course; it flips `isActive: true` and becomes a live gating requirement even though creating a *new* assessment on that course is explicitly blocked — an inconsistent application of the same policy within one file.

---

### 8. SCORM completion always marks `isPassed = true` with no real pass/fail signal
**File:** `src/scorm/scorm-runtime.service.ts:357`

`runCompletionBridge`'s `courseCompletion.upsert` unconditionally sets `isPassed: true` and `assessmentPassedAt` for any SCORM completion, even for `completeOn: "completed"` packages where `successStatus` may be `'unknown'` or `'failed'`. It also never populates `bestAttemptId` the way every other completion producer does.

**Failure scenario:** A `completeOn: "completed"` imported course (allowed even with zero quiz items) certifies every learner who merely views the content as having "passed," corrupting admin-dashboard pass-rate stats and leaving certificate `scorePct` permanently `null` for SCORM completers (`certificate.service.ts` reads `bestAttempt?.percentage` at 3 call sites, never set here) — silently wrong data with no error to surface it.

---

### 9. Import completion can double-publish a course version
**File:** `src/scorm/scorm.service.ts:310` (also 226-338)

`completeImportIfReady` always falls through to `finishPublishAndReady` (→ `publishNewVersion`) after its transaction, even when the transaction itself no-op'd because a concurrent call already built the section tree.

**Failure scenario:** The admin UI polls import-status every few seconds while the Vercel cron (every 5 min) also calls `completeImportIfReady` on the same package. If both are in flight when the Cloud job flips to COMPLETE, the first builds the tree and publishes; the second's transaction sees `sectionId` already set and no-ops, but still executes the unconditional publish call outside the transaction — producing two `CourseVersion` rows for one import event, risking the wrong version becoming "latest."

---

### 10. Duplicate-title check-then-create race is unhandled
**File:** `src/scorm/scorm.service.ts:524`

`createImportedCourse` checks for an existing course title via `findUnique` but has no P2002 catch around the subsequent `course.create`, racing the schema's `@unique` constraint on `Course.title`.

**Failure scenario:** Two near-simultaneous package-creation requests with the same title (e.g. a double-submit) both pass the `findUnique` check before either commits, then both call `course.create`; the second throws an unhandled `PrismaClientKnownRequestError` (P2002) that surfaces as a generic 500 instead of the intended conflict response.

---

### 11. Version-number computation races a unique constraint
**File:** `src/scorm/scorm.service.ts:64`

`createPackage` computes the next `versionNumber` via a `findFirst` read, then creates the package with no P2002 handling, racing `ScormPackage`'s `@@unique([courseId, versionNumber])` constraint.

**Failure scenario:** Two concurrent replace-package requests for the same course both read the same `latest.versionNumber` and compute the same next version; the second `scormPackage.create` throws an unhandled P2002 that bubbles up as a 500 rather than a clean conflict.

---

### 12. Over-broad catch mislabels real errors as "not enrolled"
**File:** `src/scorm/scorm-runtime.service.ts:307`

The `try/catch` around `assertEnrollmentUsable` catches *any* error — not just its intended enrollment-invalid case — and always logs the fixed message "enrolment not usable," discarding the real error.

**Failure scenario:** A transient DB error (timeout, connection-pool exhaustion) inside `assertEnrollmentUsable` is swallowed and misreported as "enrolment not usable." In the cron reconcile path this silently returns `false` every pass with no real error surfaced, leaving the registration stuck uncertified while on-call engineers only see a misleading log line.

---

### 13. Non-Rise packages silently skip completion-gate verification
**File:** `src/scorm/scorm.service.ts:390` (refuse branch at 367-388)

The only signal distinguishing Rise from other authoring tools (Storyline, iSpring, Captivate) is whether a Rise-specific asset probe succeeds. For `completeOn: "completed"` packages, a failed/inapplicable probe silently proceeds with a warning claiming "no quiz items" that may simply be false for non-Rise content.

**Failure scenario:** An admin imports a non-Rise, `completeOn: "completed"` package; it imports and publishes successfully with no visible indication that gate verification was skipped, while the identical probe failure for `completeOn: "passed"` produces an outright (and misleadingly worded) rejection — two different wrong behaviors depending on `completeOn`.

---

## Reliability

### 14. SUPERSEDED SCORM Cloud resources are never pruned
**File:** `src/scorm/scorm-runtime.service.ts:88` (related: `scorm.service.ts:154-220`, `scorm.service.ts:445`)

SUPERSEDED packages stay launchable forever by design (learners pinned to old `CourseVersion`s), but nothing ever revisits them once `pinnedEnrollments` drops to zero to delete the corresponding SCORM Cloud course/registrations. `replacePreview` already computes the exact counts needed (`completedOnOldPackage`, `pinnedEnrollments`, `floatingEnrollments`) but only pre-replace, never post-replace.

**Impact:** Every course re-import permanently grows SCORM Cloud's course/registration inventory with no path back down, on a third-party service that plausibly meters by volume — a pure accumulation problem with no cron or job ever closing the loop.

---

### 15. Unenumerated package-status states silently no-op
**File:** `src/scorm/scorm.service.ts:233`

`completeImportIfReady`'s five sequential status checks rely on an invariant (`READY` implies `sectionId` is set) that is never asserted. If that invariant is ever violated by a future admin tool or manual DB fix, execution falls through all five checks and returns the package unchanged with zero logging.

**Failure scenario:** A future "reset package" admin action or manual DB fix produces a `READY` package with no `sectionId`; `completeImportIfReady` silently no-ops instead of erroring, and `launch()` later fails downstream with an unrelated-looking "No SCORM section on this curriculum" error that gives no hint of the real cause.

---

## Efficiency

### 16. `launch()` serializes two independent DB round trips
**File:** `src/scorm/scorm-runtime.service.ts:65, 77`

`resolvePinnedScormTarget` and `assertEnrollmentUsable` are awaited sequentially even though neither depends on the other's result. `resolvePinnedScormTarget` alone is 2-4 round trips, fully serialized in front of `assertEnrollmentUsable`'s own 1-3 round trips, on every learner launch. `Promise.all` removes one full round of latency from the hottest user-facing path in the module.

---

### 17. `launch()` serializes registration creation + last-seen upsert
**File:** `src/scorm/scorm-runtime.service.ts:96, 107`

`ensureCloudRegistration` and `upsertLastSeen` are awaited one after another though neither depends on the other's result (only the later launch-link call needs `ensureCloudRegistration`'s return value). `Promise.all` removes one fully serialized Postgres round trip from every learner launch.

---

### 18. Registration row re-fetched though both callers already hold it
**File:** `src/scorm/scorm-runtime.service.ts:245`

`applyProgressAndMaybeCertify` re-fetches `scormRegistration` by id even though both call sites (`handlePostback` at 140-151, `reconcileCron` at 186-197) already loaded the identical row moments earlier and pass only its id.

**Cost:** One avoidable round trip on every SCORM Cloud postback — the hottest externally-triggered path in this PR — plus one more per reconcile candidate (up to 20/run). Passing the already-loaded row instead of the id removes it entirely.

---

### 19. Cron processes 8 independent import jobs fully serially
**File:** `src/scorm/scorm.service.ts:143`

`processImportJobsCron` awaits `completeImportIfReady` in a plain `for` loop for up to 8 packages per tick (`IMPORT_CRON_BATCH`). Each belongs to a distinct course and is fully independent, yet each does 1-2 external Cloud calls plus a full Prisma transaction, entirely serialized.

**Cost:** Sequential wall time is roughly 8x what a `Promise.all` (or bounded pool) run would take on the same cron tick.

---

### 20. Reconcile cron fetches candidates one-by-one with zero concurrency
**File:** `src/scorm/scorm-runtime.service.ts:163, 187, 191`

The batch `$queryRaw` selects only `sr.id`, then the loop re-fetches each candidate individually via `findUnique` and calls `getRegistrationProgress` one at a time inside a `for` loop.

**Cost:** Up to 20 avoidable round trips per run for data the batch query could have selected directly, plus up to 20 sequential external HTTP calls to SCORM Cloud that could instead run concurrently — wall time is the sum of all 20 calls instead of the slowest one.

---

### 21. Tree-lock guard re-fetches data callers already hold
**File:** `src/course-assessment/course-assessment.service.ts:391` (representative of ~16 call sites across `course.service.ts` and `quiz.service.ts`)

`assertImportedCourseTreeLocked` re-fetches the course row for `deliveryMode` even when the caller (e.g. `createAssessment`) already loaded the full course row moments earlier. The same pattern recurs at `course.service.ts:3646` (`updateModule`), `2189-2190` (`createChapter`), `3689-3692` (`updateChapter`), `3741-3744` (`updateSection`), and roughly a dozen more sites.

**Cost:** ~19 avoidable round trips total added by this PR. Having the guard accept an optional already-loaded row/`deliveryMode`, or having it return the resolved id/row for the caller to reuse, would remove the redundancy everywhere at once.

---

## Simplification / dead code / duplication

### 22. Compensating-delete-and-log block duplicated verbatim
**File:** `src/scorm/scorm-runtime.service.ts:508` (duplicate at 520)

`ensureCloudRegistration`'s P2002 catch handler contains two byte-for-byte identical `try/catch` blocks (delete + log) — one inside the "raced" branch, one as the fallthrough — even though the delete actually runs unconditionally on every path through the catch. Hoist a single `compensateCloudRegistration(registrationId)` helper instead.

---

### 23. `err instanceof Error ? err.message : String(err)` hand-rolled ~10 times
**File:** `src/scorm/scorm.service.ts:146` (also 271, 326, 551; plus `scorm-runtime.service.ts:199,512,524`, `scorm-cloud.client.ts:259`, `user.service.ts:33,44,54`)

Copy-pasted roughly 10 times across this PR's new files. `scorm.service.ts` even defines its own local `cloudErrorMessage` helper but still repeats the inline ternary elsewhere in the same file instead of using it everywhere. A single exported `errorMessage(err): string` in `src/utils/` would collapse all of them.

---

### 24. `ping()` and `testRegistrationPostback()` are dead code
**File:** `src/scorm-cloud/scorm-cloud.client.ts:60` (also 166)

Both methods are public on `ScormCloudClient` but are never called by any of its three injection sites (`UserService`, `ScormRuntimeService`, `ScormService`) or any controller — confirmed via repo-wide grep. Delete both, or wire one behind an actual admin/ops route so it's reachable.

---

### 25. Timing-safe compare reimplements existing `auth.service.ts` logic
**File:** `src/scorm/scorm-postback.guard.ts:69` (also `parseBasicAuth` at 50-67)

`safeEqual` re-implements the same length-check-then-`timingSafeEqual` pattern already inline in `auth.service.ts`'s `loginUser` (lines 57-62) — and the guard's own doc comment ("same pattern as auth.service.ts") acknowledges the duplication without factoring it out. A shared `constantTimeEqual(a, b): boolean` in `src/utils/` would remove both copies.

---

### 26. One-line forwarder method left behind after extraction
**File:** `src/course/course.service.ts:6127`

`_assertEnrollmentUsable` is a 1-line pass-through to the new shared `assertEnrollmentUsable` util, kept at only 2 call sites (568, 926) instead of being deleted after the extraction. Call the shared util directly at both sites and delete the wrapper plus its JSDoc.

---

### 27. Trailing-slash URL stripping duplicated 6x
**File:** `src/scorm-cloud/scorm-cloud.client.ts:201` (also `scorm-runtime.service.ts:123, 445`)

The `(baseUrl).replace(/\/$/, '')` idiom is re-typed 3 times new in this PR on top of 3 pre-existing copies in `certificate.service.ts` (`getApiBase`, `buildVerifyUrl`) and `engagement.service.ts` (`appBaseUrl`, using the `/\/+$/` variant) — two slightly different regexes already drifting from each other. A single `stripTrailingSlash(url): string` in `src/utils/` would collapse all six.

---

## Angles that came back clean

- **Conventions (CLAUDE.md):** no `CLAUDE.md`/`CLAUDE.local.md` exists anywhere in the repo or at the user level — nothing to check against.
- **Line-by-line diff scan:** no additional typos/swapped-args/off-by-ones found beyond what's listed above; all guard-call field names, Prisma `data` object field names, and cross-service argument orders were verified correct. Full SCORM Jest suite (79 tests) passes.
- **Module wiring:** no circular imports between `ScormModule`, `ScormCloudModule`, `UserModule`, `CourseModule`.
- **`purgeScormCloudLearnerData` id semantics:** correct — `scormCloudRegistrationId` and `userId` are not swapped.
- **Guard statelessness:** `ScormPostbackGuard` and `CronSecretGuard` hold no mutable instance state.
