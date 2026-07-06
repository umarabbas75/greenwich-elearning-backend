# Course Versioning Redesign — Decision & Issue Log

> Companion to `docs/course-versioning.md` (which documents the *current* architecture).
> This file records **why** the redesign happened, **what** was wrong before, the
> **decisions** taken, the **review findings**, and the **fixes** applied — so future
> maintainers understand the reasoning, not just the end state.

**Date:** July 2026
**Status:** Implemented, tests green (82/82). Pending production rollout (see checklist).

---

## 1. Background — what versioning is for

Course versioning protects in-progress learners from progress regression. When an admin
adds/removes structure, an already-enrolled learner's completion **denominator** must not
change, or their progress % would drop (e.g. from 100% back to 95% because 5 sections were
added). Each `UserCourse` is pinned to a `CourseVersion` via `enrolledVersionId`.

---

## 2. The problem with the original design (snapshot model)

The original implementation froze structure by **copying the entire live tree** into
`course_version_modules / chapters / sections / quizzes` on every publish.

Two root causes hurt us badly:

### 2.1 Reads performed writes
`resolveCurriculumTree()` — called on **every learner read** — first ran
`syncPublishedVersionWithLiveTree`, which executed ~9 count queries and, on any detected
drift, **published a full snapshot inside the GET request**. This caused:
- Slow reads (12+ queries per learner page load).
- Version spam (v6, v7, v8… created from read traffic).
- A re-archive loop on the NEBOSH case-study sections.

### 2.2 Every version duplicated all content
`snapshotLiveTree` copied each section's full HTML `description` (avg **291 KB/row**) into
`course_version_sections`. 23 versions of one course ≈ **370 MB**. `course_version_sections`
alone reached **403 MB (91% of the DB)** and hit Neon's 512 MB ceiling, which surfaced as a
**quiz-assign 403** and general write failures.

### Immediate mitigation (already done, pre-redesign)
- `scripts/prune-orphan-course-versions.ts` deleted 23 orphan (0-enrollment, non-latest)
  versions (~348 MB).
- Manual `VACUUM (FULL, ANALYZE)` in Neon reclaimed disk → DB dropped from **442 MB → 80 MB**.

---

## 3. The redesign — Structure-Freeze, Content-Live

### Core decision
A `CourseVersion` becomes a lightweight **JSON manifest** of ordered live IDs — it stores
**no content**. Learner content is always read from the **live** `sections / chapters /
modules / quizzes` tables by ID. The manifest only decides *which* IDs are in scope and the
completion denominator.

```
manifest = {
  modules: [
    { sourceId, order, chapters: [ { sourceId, order, sectionIds: [...], quizIds: [...] } ] }
  ]
}
```

Plus `sectionCount Int` on `CourseVersion` for an O(1) progress denominator.

### What is frozen vs live

| Change | Effect |
|--------|--------|
| Add / remove module, chapter, section, quiz | **Structural** → auto-publishes a new version |
| Edit section HTML, quiz text, reorder within a chapter | **Content/live** → flows to everyone, no new version |
| Deactivate a section (`isActive: false`) | Treated as a content edit; leaves the structure on the *next* structural publish |

### Key decisions taken

1. **JSON manifest over normalized slim child tables.** Fewest joins, simplest reads;
   courses are small (max ~115 sections). Normalized child tables were considered and rejected.
2. **Big-bang rollout**, not phased (user's call).
3. **Reads never write** (headline goal) — `syncPublishedVersionWithLiveTree` removed from the
   read path. (One documented exception below, finding #2.)
4. **No-op publish guard** — a structural fingerprint (sorted set of active module/chapter/
   section/quiz IDs) is compared before publishing; identical → skip. This kills the version spam.
5. **Delete guard** — because content is read live, a live row referenced by *any* version
   manifest is **archived**, not hard-deleted (a pinned learner still needs it). Only truly
   unreferenced rows are hard-deleted.
6. **Drop the four heavy tables** after backfill; this is what permanently prevents the bloat.

---

## 4. Files & responsibilities

| File | Role |
|------|------|
| `src/course-version/course-version.manifest.ts` | Manifest types, build, load (`loadPinnedCurriculum`), fingerprint, diff, publish |
| `src/course-version/course-version.service.ts` | Manifest-based reads/publish/prune, delete-guard membership scan |
| `src/utils/chapter-progression.ts` | Chapter ordering + denominators from the manifest |
| `src/course/course.service.ts` | Migrated learner read call sites |
| `src/quiz/quiz.service.ts` | Removed `syncQuizToLatestVersion`; version-aware quiz reads |
| `src/course-assessment/course-assessment.service.ts` | Version-aware assessment content gate (finding #4) |
| `scripts/backfill-course-version-manifests.ts` | Build manifests from legacy snapshot rows |
| `scripts/audit-course-version-manifest-parity.ts` | Verify section-set parity before dropping tables |
| `scripts/prune-orphan-course-versions.ts` | Retention: delete 0-enrollment, non-latest versions |

**Removed:** `course-version.snapshot.ts` (+ spec). Deprecated: `backfill-course-versions.ts`,
`remediate-nebosh-pre-case-study-v1.ts` (they used the dropped snapshot tables).

**Migrations:**
1. `20260706120000_course_version_manifest` — add `manifest`, `sectionCount` (additive, nullable).
2. `20260706130000_drop_course_version_snapshot_tables` — drop the four heavy tables (children before parents).

---

## 5. Consistency invariant (the thing that must not break)

For a pinned learner, **numerator and denominator must use the same section-ID set**, and
every consumer of the denominator must agree. All five paths now key off the frozen manifest:

| Path | Numerator | Denominator |
|------|-----------|-------------|
| `getCourseReport` | `versionSectionIds ∩ progress` | manifest `ch.sections` |
| `getAllUserModules` | `ch.sections.map(id) ∩ progress` | `ch.sections.length` |
| `getUserChapterProgress` | `versionSectionIds ∩ progress` | `versionSectionIds.length` |
| `_checkContentCompletion` (course completion) | `progress ∩ liveSectionIds` | `sectionCount` |
| chapter gate (`isChapterComplete`) | progress count | `ch.sectionIds.length` |
| **assessment gate** (`_isCourseContentCompleted`) | `progress ∩ liveSectionIds` | `sectionCount` |

Because `sectionCount` and `getSectionIdsFromManifest(manifest).length` derive from the same
manifest, `total === liveSectionIds.length` always → 100% is always reachable and display /
gate / completion can never disagree.

---

## 6. Code review findings & resolutions

An independent review (Claude) flagged the following. Verdicts and fixes below.

### #1 — Two frozen denominators (display re-filtered by live `isActive`) — **FIXED**
Display/report paths were re-filtering manifest sections by live `isActive`
(`ch.sections.filter(s => s.isActive)`), while the gate/completion paths counted raw manifest
membership. These diverge exactly when an admin deactivates a section after a learner is pinned
(a live edit that cuts no new version). Result: display could show 100% while the completion
gate still required the deactivated section → learner stuck below 100%.
**Fix:** removed the `isActive` re-filter from all versioned display/report paths. Denominator
is now manifest membership everywhere. `loadPinnedCurriculum` fetches sections by ID (no
`isActive` filter), so archived-but-referenced sections remain visible and completable.

### #2 — `resolveEnrolledVersionId` writes on read (zero-progress bump) — **KEPT (documented exception)**
`resolveEnrolledVersionId` bumps a **zero-progress** enrollment to the latest version, issuing
a `userCourse.update` from within GET handlers. This slightly contradicts "reads never write."
**Decision:** kept as an intentional, bounded, self-limiting exception (only fires while
`progressCount === 0` and a newer version exists). Moving it to activation-only would be a
behavior change. Optional future hardening: conditional `updateMany WHERE enrolledVersionId =
old AND progress = 0` to shed race noise.

### #3 — Backfill `isActive` parity — **VERIFIED CORRECT**
Concern: backfill and audit both filter legacy rows `isActive: true`, so the audit could be
circular. **Verified from git history:** the old `snapshotLiveTree` copied sections with
`isArchived: false` (including inactive), but the old read-time denominator
(`countVersionActiveSections` / `getVersionActiveSectionSourceIds`) filtered `isActive: true`.
So the backfill's `isActive: true` filter reproduces the **old denominator exactly** — pinned
learners' denominators do not shift. The audit script was also enhanced to print every version
where the snapshot held inactive sections (the only cases where the filter choice matters), so
the parity is self-auditing.

### #4 — Assessment eligibility gate not version-aware — **FIXED**
`_isCourseContentCompleted` counted **all live sections** in the course, not the pinned
manifest. A learner at 100% per their frozen version could be blocked from the assessment after
an admin added sections — the exact freeze violation the redesign targets. (Not a regression —
it behaved this way before the redesign too.)
**Fix:** routed the gate through `CourseVersionService.countCompletionDenominator` (frozen per
enrollment). Injected `CourseVersionService` into `CourseAssessmentService`
(`CourseVersionModule` only depends on `PrismaModule`, so no circular dependency). Uses
`distinct: ['sectionId']` because the `UserCourseProgress` unique key includes `chapterId`.
Covered by `course-assessment.content-gate.spec.ts` (5 tests).

### #5 — Corrupt-manifest edge — **FIXED**
If `manifest` was unparseable but `sectionCount` was set, `countCompletionDenominator` returned
`{ total: sectionCount, liveSectionIds: [] }` — numerator matches nothing → learner stuck below
100% forever. **Fix:** only trust `sectionCount` when the manifest parses; otherwise fall
through to `loadPinnedCurriculum` (which retries parse → legacy fallback) and degrade to
`{ total: 0, liveSectionIds: [] }` only if truly unrecoverable.
Also hardened `loadPinnedCurriculum`'s legacy fallback with `try/catch` so it fails safe (null
tree → caller degrades to live) instead of throwing a "table does not exist" error if ever hit
after migration 2 drops the tables.

### Minor / accepted-as-is
- `isReferencedByAnyVersion` scans every version manifest in JS per mutation — fine at current
  scale (manifests are tiny).
- Publish fingerprint check runs outside the transaction; two concurrent publishes both passing
  the no-op check is prevented from corruption by `@@unique([courseId, versionNumber])` (one
  fails as a unique violation rather than corrupting data).
- `loadVersionManifest` in `chapter-progression.ts` duplicates the service's
  `getManifestForVersion` — harmless.

---

## 7. Production rollout checklist

Order matters — **backfill must run before migration 2** (it reads the legacy tables).

1. Apply migration **1** (`20260706120000_course_version_manifest`) — adds nullable columns.
2. Run `backfill-course-version-manifests.ts` — populates manifests from legacy snapshot rows.
3. Deploy application code.
4. Run `audit-course-version-manifest-parity.ts` — must print only `✓` / `ⓘ` lines (no `✗`).
   `ⓘ` lines flag versions that had inactive snapshot sections (expected, matches old denominator).
5. Apply migration **2** (`20260706130000_drop_course_version_snapshot_tables`).
6. `VACUUM (FULL, ANALYZE)` in the Neon SQL editor to reclaim disk.

Safety net during the window between step 1 and step 2: `loadPinnedCurriculum` falls back to
`buildManifestFromLegacySnapshot` when `manifest` is null, so reads keep working before backfill.

---

## 8. Retention

`POST /api/v1/courses/versions/prune-orphans` (and the CLI script) delete versions with **zero
enrollments** that are **not** `isLatest`. Safe to run periodically — with manifests, storage
stays flat regardless.

---

## 9. Out of scope / follow-ups

- **Pattern 2 completion-freeze** — separate mechanism, still keys off `courseCompletion`, unaffected.
- **Assessment attempt snapshots** — already per-attempt, separate mechanism.
- **#2 optional hardening** — conditional `updateMany` for the zero-progress bump, whenever
  that method is next touched.

---

## 10. Test evidence

- `course-version.manifest.spec.ts` — manifest build, fingerprint, diff, membership.
- `course-version.service.spec.ts` — resolve/publish/prune, no-op guard, corrupt-manifest fallback.
- `course.service.versioning.spec.ts` — delete-guard (archive vs hard-delete), pinned progress.
- `chapter-progression.spec.ts` — manifest-based ordering/denominators.
- `quiz.service.versioning.spec.ts` — version-aware quiz reads, delete/unassign guard.
- `course-assessment.content-gate.spec.ts` — version-aware assessment gate (#4).

Full suite: **82/82 passing**, clean build, zero lint errors.
