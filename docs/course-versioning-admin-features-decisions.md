# Course Versioning Admin Features — Decisions Needed Before Build

Companion to [`course-versioning-admin-features-spec.md`](./course-versioning-admin-features-spec.md).
That spec is solid; backend agrees with the priority order, the pagination stance,
the per-learner audit rows on bulk migration, and the "reconcile stays CLI-only"
call. This doc lists the six gaps the spec left open, backend's recommended
answer for each, and what FE needs to confirm before we start writing code.

Each item is a **yes / no / counter-propose** decision. None of them are
contentious; we just want the answers on record before the first PR so we're
not renegotiating shape mid-build.

---

## 1. Restore endpoint (§1) — three sub-decisions

Restore is not as trivial as the spec assumes. Three questions the spec doesn't
answer:

### 1a. Section restored while its parent chapter is still archived

**Options:**

- **Reject with 409** — `parent Chapter "…" is archived; restore the chapter first`.
- Cascade-restore the whole parent chain automatically.
- Allow the orphan; parent stays archived, section becomes reachable in `getAllSections`
  but has a dead parent pointer.

**Backend recommendation: reject with 409.** Cascade-restore is too much magic
for a sensitive path; orphan-allowed produces UI inconsistencies immediately.
FE surfaces the error message and offers a "Restore parent first" affordance.

### 1b. `orderIndex` collision on restore

If the section had `orderIndex: 3` and a new section now occupies `orderIndex: 3`,
we either:

- **Append the restored row to the end** of its parent (renumber the restored row).
- Preserve original `orderIndex` and renumber all siblings from that point down.

**Backend recommendation: append to end.** Preserving position is a promise
restore can't reliably keep (siblings may have been reordered, renamed, etc.),
and renumbering siblings is a silent-mutation-side-effect we don't want on an
already-sensitive path.

### 1c. Restored row exists in current live tree but no _published_ version references it

The spec calls this out and recommends a warning (`data.note`) rather than blocking.
**Backend agrees.** Wording proposal:

> Restored to the live tree. The current latest published version (v5) does
> not include this row — new enrollments will not see it until you publish a
> new version.

Also: emit `RESTORE_ENTITY` audit with `metadata: { entityType, priorIsArchived, parentWasArchived, orderIndexResolution: 'appended', publishedInLatest: boolean }` so we can reconstruct what happened later.

**FE decision needed:** confirm 1a rejection message and the 1c note wording,
or counter-propose.

---

## 2. Roster (§3) — drop `certified`, keep `isCompleted`

`certified` and `isCompleted` are the same field — both mean
"learner has a `CourseCompletion.courseCompletedAt`". The fixes doc uses
`certified` inside `probeUserCourseResidualState`'s 409 details; the FE progress
guide uses `isCompleted` on `getAllAssignedCourses`.

**Backend recommendation:** roster returns `isCompleted` only. Matches every
other endpoint the FE already reads. `certified` stays internal to the
unassign-loophole details payload (where it's already shipped) and is not
introduced as a new public field.

**FE decision needed:** yes / no.

---

## 3. Version diff endpoint

The original sweep called out `GET /courses/:courseId/versions/diff?from=&to=` —
`diffManifests` exists internally but returns only counts and needs titled
added/removed lists. The FE spec dropped this entirely in favor of the §4
tree inspector.

**Options:**

- **Ship the diff endpoint alongside §4** — one PR, shared query paths, titled
  `added[]` / `removed[]` / `moved[]` per entity type.
- Skip it; FE fetches two `/versions/:id` responses and diffs client-side.
- Skip it now, revisit if an admin need surfaces.

**Backend recommendation: ship it alongside §4.** The manifest read is already
in hand and the tree inspector's query path is doing 80% of the work. Diffing
client-side across two big trees is doable but wastes a full second tree render
every time and puts the "what actually changed" logic in the FE bundle.

**FE decision needed:** ship it now, or defer.

---

## 4. Archive inventory (§2) — how to render archived-under-archived

If a module is archived, its chapters and sections are functionally unreachable
too. Options:

- **Flat table with `parentPath` markers + `parentIsArchived: boolean`** on the
  row — FE can group/style as they choose.
- Filter chapters/sections whose parent chain is also archived; show only the
  highest-archived ancestor.
- Indented tree view.

**Backend recommendation: flat with `parentIsArchived: boolean` per row.**
Simplest data shape, most flexible for FE. If the FE later wants to collapse
under-archived-ancestor rows, that's a client-side filter, not a re-shape.

Payload adjustment vs the spec's §2 shape:

```jsonc
{
  "id": "…",
  "entityType": "section",
  "title": "…",
  "parentPath": "Module 2 › Chapter 4",
  "parentIsArchived": true,          // NEW
  "archivedAt": "2026-07-01T00:00:00Z",
  "stillServedTo": 12,
  "versionsReferencing": [ … ]
}
```

Default sort: `archivedAt DESC`. FE can override via `?sort=archivedAt:asc` etc.

**FE decision needed:** confirm the added field and default sort, or counter-propose.

---

## 5. Bulk migration ceiling (§5) — 500, not 200

The spec proposes rejecting `userIds.length > 200` server-side.

**Backend recommendation: 500.** A course with 2,000 learners needing migration
would take 10 batches at 200; 4 batches at 500 is more humane and still safely
below the point where the dry-run response gets unwieldy.

Rejection shape:

```jsonc
{
  "status": 400,
  "error": "Batch size exceeds ceiling",
  "details": { "ceiling": 500, "requested": 743 }
}
```

**FE decision needed:** 500 or a different number.

---

## 6. Roster (§3) — filter soft-deleted users by default

The spec doesn't say. `User.deletedAt` exists.

**Backend recommendation:** default `user.deletedAt IS NULL`. Historical
enrollments of deleted users available via explicit `?includeDeletedUsers=true`
for audit workflows only.

**FE decision needed:** yes / no. If yes, is `includeDeletedUsers=true` needed
in the MVP, or can we ship without it and add later?

---

## Answers to the three questions FE asked in the spec

Included here so they're on the same page as the decisions above.

### Q1. Can `Course` cheaply expose `isLatest` per version, for §3's `isLatestVersion`?

**Yes.** One extra query per roster response computes `latestPublishedVersionId`
(`max(versionNumber) where status = 'PUBLISHED'` scoped to `courseId`).
Returned as a **top-level field** on the roster response, not per row:

```jsonc
{
  "data": {
    "latestPublishedVersionId": "…",
    "latestPublishedVersionNumber": 5,
    "rows": [ { "enrolledVersionId": "…", … } ],
    "total": 2400, "page": 1, "pageSize": 20
  }
}
```

FE computes `row.enrolledVersionId === data.latestPublishedVersionId`. Zero
extra round-trips, no schema change.

### Q2. Can `getReferencingVersionsWithEnrollments` be batched?

**Yes.** Current implementation scans manifests once for a single `sourceId`.
Refactor to accept `sourceIds: string[]` and return
`Map<sourceId, versionsReferencing[]>`. One manifest scan, one aggregate
enrollment-count query per version, regardless of archived-row count.
Existing single-ID callers get a one-element wrapper — no caller changes.

### Q3. Batch-size ceiling for §5.

**500.** See item 5 above.

---

## What ships in which PR (assuming the six decisions land as recommended)

1. **PR 1** — §1 restore + §2 archive inventory, together (restore has no UI
   surface without inventory).
2. **PR 2** — §3 roster.
3. **PR 3** — §4 manifest tree inspector + version diff endpoint (per decision 3).
4. **PR 4** — §6 coverage + §7 drift status (reconcile stays CLI-only).
5. **PR 5** — §5 bulk migration with dry-run.

Migration ships last on purpose. Same reasoning as the FE spec's own §5 note:
it's the reassignment-regression bug at N-learner scale, so we let the simpler
endpoints exercise the archive/audit conventions in production for a release
or two first.

---

## Sign-off

Please reply with a decision per numbered item (1a / 1b / 1c / 2 / 3 / 4 / 5 / 6).
"Agree with recommendation" is a valid answer for any of them. If you counter-propose
on any item, backend will roll a v2 of this doc and we go one more round before
starting PR 1.

---

## FE sign-off (2026-08-07)

Agree with the recommendation on all 8 items. Four have small additive asks that
tighten the contract but don't change the answer — none require a v2 round-trip
before PR 1 starts, they're implementation notes backend can fold in directly.

### 1a. Section restored while parent chapter archived — **Agree (reject with 409)**

Consistent with the 409-then-`force` "safe by default" pattern
`course-versioning-admin-fixes.md` §1 already established for `unAssignCourse`.
Cascade hides a multi-row mutation behind one click on a sensitive path;
orphan-allowed just moves the bug from delete to restore.

**Additive ask:** include `details: { parentEntityType, parentId, parentTitle }`
in the 409 body so FE's "Restore parent first" affordance in the inventory table
can wire a one-click jump without a lookup round-trip — same treatment
`unAssignCourse`'s 409 already gives with its `details` breakdown.

### 1b. `orderIndex` collision — **Agree (append to end)**

Preserving position is a promise restore can't reliably keep (siblings may have
been reordered, renamed, or deleted). Renumbering siblings from the restored
index down is a silent side-effect on rows the admin didn't touch. Append is
the only option that doesn't mutate untouched data.

### 1c. Restored row not in latest published version — **Agree (warn, don't block); tighten wording**

Non-blocking is correct and matches the "Approach A: live = draft" model
(`course-versioning-plan.md` §1). The `RESTORE_ENTITY` audit metadata shape is good.

**Wording tighten** — make the version number explicit rather than hardcoded to `v5`:

> Restored to the live tree. Latest published version (v{N}) does not reference
> this row; new enrollments will not see it until you publish a new version.

**Additive ask:** return `latestPublishedVersionNumber` (and `latestPublishedVersionId`)
as structured fields on the response `data`, not only interpolated into `data.note`.
FE will build its own copy from the structured fields rather than parsing the string.

### 2. Roster returns `isCompleted`, drop `certified` — **Agree**

Matches [`frontend-progress-display-guide.md`](./frontend-progress-display-guide.md)
§3–4 and the shape `getAllAssignedCourses` already returns. `certified` stays
internal to `probeUserCourseResidualState`'s 409 details payload where it's
already shipped. Introducing a second name for the same field on a new endpoint
is exactly the drift the audit sweep was meant to catch.

### 3. Ship the version diff endpoint alongside §4 in one PR — **Agree**

FE spec dropped it because §4 covers "what's in this version"; backend's argument
reverses that call correctly. The manifest scan is loaded once for §4,
`diffManifests` already exists internally, and the alternative (two
`/versions/:id` fetches + client-side diff of two big trees) puts non-trivial
diff logic in the FE bundle we'd rather not maintain.

**Shape ask:** `added[]` / `removed[]` / `moved[]` should be **slim entries**
(`{ id, entityType, title, path }`), not full nested subtrees. A moved section
doesn't need its chapters/quizzes re-rendered inside the diff response — FE
will link to the tree inspector (§4) if the admin wants to drill in. Slim
entries also keep the diff response small enough to render without pagination.

### 4. Archive inventory — flat rows with `parentIsArchived`, `archivedAt DESC` default — **Agree**

Flat is right. Filtering under-archived-ancestor rows server-side would prevent
the admin from ever seeing the full picture; indented tree is over-engineering
for a table view.

**Additive ask (same shape as 1a):** include `parentId` and `parentEntityType`
per row when `parentIsArchived: true`, so the row's "Restore parent first" jump
link doesn't need a lookup. The join is already happening to build `parentPath`
so the extra fields are free.

### 5. Bulk migration ceiling — **Agree (500)**

The 200 in the spec was defensive-first, not derived from a real limit. 500
halves the batches for a 2,000-learner course and stays well below the point
where the dry-run response gets unwieldy.

**Implementation flag (not a counter-proposal — asking backend to think through
before writing PR 5):** `course-versioning-admin-fixes.md` §2 sized the wipe
`$transaction` at `{ timeout: 15000, maxWait: 5000 }` for **one** learner's
2 findMany + 13 mutations. A single 500-learner `$transaction` under that
envelope means one wedged learner rolls back 499 successful migrations and
returns a generic 403 with no clue why. Recommend **per-learner mini-transactions
inside a loop**, with failures surfacing as `skipped: [{ userId, reason: "…" }]`
in the response — the shape is already defined for `would_regress_not_accepted`
so extending it costs nothing. Same "best-effort, don't fail the parent"
principle `writeAudit` already applies.

### 6. Roster default filters soft-deleted users; `?includeDeletedUsers=true` opt-in — **Agree**

**MVP scope:** skip `includeDeletedUsers=true` for now. No current FE surface
consumes historical/deleted-user data, and shipping the flag speculatively
means we test/document a code path no page uses. Add when a concrete audit
view surfaces (likely candidate: the drift/coverage page in PR 4, but
speculative — decide when we design that page, not now).

---

### Answers to backend's answers to FE's questions

- **Q1 (`isLatest` per version):** top-level `latestPublishedVersionId` +
  `latestPublishedVersionNumber` on the roster response, with FE computing
  `row.enrolledVersionId === data.latestPublishedVersionId` per row —
  **agreed, this is better than the per-row `isLatestVersion` the spec asked
  for.** Smaller payload, one source of truth, no risk of per-row drift if
  a new version publishes mid-page.
- **Q2 (batched `getReferencingVersionsWithEnrollments`):** agreed. The
  `sourceIds: string[] → Map<sourceId, versionsReferencing[]>` refactor with
  a one-element wrapper for existing single-ID callers is the right migration
  shape — no callers change, §2's archive inventory gets the batched path for free.
- **Q3 (batch ceiling):** 500, per item 5.

---

### PR sequencing

Backend's 5-PR sequence matches the spec's priority order. No pushback.

**Note on PR 2 (roster) shipping before PR 5 (bulk migration):** by design,
the roster page will surface "N learners are 2 versions behind" without a
bulk action to fix it. That's fine — the per-learner actions already called
out in the spec's §3 (existing `ForceUnassignCourseModal`,
`ViewUserCoursesModal`) remain available, and the single-learner
`POST /courses/enrollments/migrate-version` is already implied to exist by
the `MIGRATE_LEARNER_VERSION` audit action in the fixes doc §2. Just
flagging that PR 2's roster row-actions should stop at what's actually
wired — no disabled "Bulk migrate" button that says "coming in PR 5."

---

**Backend: no v2 round-trip needed.** Everything above is either "agree with
recommendation" or an additive contract detail that folds into the same PR.
Green light on PR 1 (§1 restore + §2 archive inventory) whenever you're
ready to start.

---

## Backend response to FE sign-off (2026-08-07)

All four additive contract asks folded into PR 1's scope. One correction on item 5.

### 1a — 409 `details` shape

Confirmed. 409 body will carry:

```jsonc
{
  "status": 409,
  "error": "Cannot restore: parent Chapter \"…\" is archived; restore the chapter first",
  "details": {
    "parentEntityType": "chapter",
    "parentId": "…",
    "parentTitle": "…"
  }
}
```

Same shape/pattern as `unAssignCourse`'s 409 `details` block — FE gets the
one-click "Restore parent first" jump target without a lookup round-trip.

### 1c — structured version fields, not string interpolation

Confirmed. Restore response `data` will carry the version fields as first-class
alongside the (now-templated) note string:

```jsonc
{
  "message": "Restored",
  "statusCode": 200,
  "data": {
    "id": "…",
    "isArchived": false,
    "latestPublishedVersionId": "…",
    "latestPublishedVersionNumber": 5,
    "publishedInLatest": false,
    "note": "Restored to the live tree. Latest published version (v5) does not reference this row; new enrollments will not see it until you publish a new version."
  }
}
```

FE builds its own copy from the structured fields; the `note` remains for
audit/log surfaces that want the pre-rendered string.

### 3 — slim diff entries

Confirmed. Diff response shape:

```jsonc
{
  "data": {
    "fromVersionNumber": 3,
    "toVersionNumber": 5,
    "added":   [{ "id": "…", "entityType": "section", "title": "…", "path": "Module 2 › Chapter 4" }],
    "removed": [{ "id": "…", "entityType": "quiz",    "title": "…", "path": "Module 1 › Chapter 3" }],
    "moved":   [{ "id": "…", "entityType": "chapter", "title": "…", "fromPath": "Module 1", "toPath": "Module 2" }]
  }
}
```

`moved` gets a two-path shape (`fromPath` / `toPath`) since "path" is the only
useful signal for a move. Everything is one-level metadata — FE links to §4 for
subtree drill-in.

### 4 — `parentId` / `parentEntityType` on inventory rows

Confirmed. When `parentIsArchived: true`, the row carries the two extra fields.
When `parentIsArchived: false` (or the row is a module and has no parent),
both are `null`. FE's "Restore parent first" jump has structured data without
a lookup — same treatment as 1a.

### 5 — per-learner mini-transactions

**Agreed, with one correction on the magnitude claim.** The wipe `$transaction`
in `unAssignCourse` is 13 mutations × N learner-state tables. **Bulk migration
is not that shape** — it's an update to `UserCourse.enrolledVersionId` + one
`writeAudit` per learner, i.e. 2 writes per learner, not 13. A single
500-learner `$transaction` would be ~1000 writes, which would fit inside
`{ timeout: 15000 }` on Neon cold-start in practice.

But the FE's larger argument stands and I want to lock it in as design intent,
not tune it for today's magnitude:

- One wedged learner rolling back 499 successful migrations is the wrong
  failure mode regardless of whether the txn envelope technically fits.
- If we ever extend the migration path (invalidate derived state, recompute
  a snapshot, whatever) the per-learner cost grows and the single-txn design
  quietly becomes unsafe. Per-learner mini-transactions scale with that.
- The `skipped: [{ userId, reason }]` shape is already defined for
  `would_regress_not_accepted`; extending the reason enum costs nothing.

Reason enum I'll ship in PR 5:

```ts
type SkipReason =
  | 'would_regress_not_accepted'  // already spec'd
  | 'migration_failed'            // catch-all for prisma/txn errors
  | 'user_not_enrolled'           // userId in body isn't enrolled in this course
  | 'already_on_target_version';  // no-op skip, not a failure
```

`migration_failed` rows will additionally carry `errorMessage: string` in the
skip entry so post-mortem doesn't require log-diving. Best-effort — never
included in prod telemetry surfaces to the admin, kept as a debug field only.

### 6 — MVP skip on `includeDeletedUsers=true`

Confirmed. Not shipping the flag speculatively. When a concrete FE surface
needs it, we add both the flag and the tests together.

### PR 2 roster row-actions

Confirmed — the roster won't ship a disabled/coming-soon "Bulk migrate" button.
Row actions will be exactly the two the spec's §3 called out (existing
`ForceUnassignCourseModal` + `ViewUserCoursesModal` pattern) plus a per-row
"Migrate to version…" that calls the existing single-learner
`POST /courses/enrollments/migrate-version` endpoint. When PR 5 ships,
multi-select gets added on top of the same table.

---

## Frozen contract summary (post-sign-off)

Everything below is the final wire shape for PRs 1–5. Changes after this point
require another round of this doc.

**Audit vocabulary added:**

| Action | Emitted by | Metadata |
|---|---|---|
| `RESTORE_ENTITY` | §1 restore endpoint | `{ entityType, priorIsArchived, parentWasArchived, orderIndexResolution: 'appended', publishedInLatest }` |
| `BULK_MIGRATE_LEARNER_VERSION` | §5, best-effort per migrated learner (see plan doc CC3) | `{ fromVersionId, fromVersionNumber, toVersionId, toVersionNumber, wouldRegress, forced }` |
| `RECONCILE_VERSION` | §7 if reconcile mutates (CLI-only) | `{ versionId, changesApplied }` |

**Response envelope extensions:**

- `outcome` / `stillServedTo` / `versionsReferencing` — already shipped in the
  fixes-doc batch, reused verbatim by §2 archive inventory.
- 409 `details` — `{ parentEntityType, parentId, parentTitle }` for restore.
- Restore success `data` — `{ latestPublishedVersionId, latestPublishedVersionNumber, publishedInLatest, note }`.
- Roster response top-level — `{ latestPublishedVersionId, latestPublishedVersionNumber, rows, total, page, pageSize }`.
- Archive inventory row — adds `parentIsArchived`, `parentId`, `parentEntityType` (last two null when parent is live or entity is a module).
- Diff response — slim `added[] / removed[] / moved[] / renamed[]` entries with `path` (or `fromPath`/`toPath` for moves, `fromTitle`/`toTitle` for renames). Move detection is structural (parent-sourceId chain), not string-based (see plan doc PR 3). `renamed[]` added post-sign-off per FE review of the plan doc.
- Bulk migration `skipped[].reason` — enum of four values above; `migration_failed` also carries `errorMessage`.

**Batch ceilings:**

- Bulk migration `userIds.length`: 500. Server returns `400 { ceiling: 500, requested: N }` above that.
- Pagination default `pageSize`: 20 (spec). Max: 100 (backend enforced).

**Guardrails:**

- All new endpoints: `AuthGuard('jwt')` + admin-only, no exceptions.
- Restore of section-under-archived-chapter: `409` with `details`.
- Bulk migration: per-learner mini-transactions, not one big txn.
- Roster: `user.deletedAt IS NULL` by default, no opt-in flag in MVP.

**Contract is frozen. Starting PR 1 now.**

---

### Post-freeze plan-doc revisions (2026-08-07)

Two additive contract clarifications emerged during FE review of the implementation plan (`course-versioning-admin-features-plan.md`). Both are additive on the FE side — ignoring the new keys doesn't break anything — so they do not require another sign-off round:

- **Diff response gains `renamed[]` as a first-class bucket.** Move detection is now structural (parent-sourceId chain), so a parent-title rename no longer masquerades as descendant moves. Renames are their own diff row. Full contract in the plan doc's [PR 3 endpoint 3b](./course-versioning-admin-features-plan.md#endpoint-3b--get-coursescourseidversionsdifffromto).
- **Drift response gains `changeCount` as a 4-bucket breakdown** (`{ added, removed, moved, renamed }`). Fixes a v1 workaround that didn't compose — the diff endpoint takes two `versionId`s and the live tree isn't a version, so FE had no way to render "N unpublished changes" on a header badge. Full contract in the plan doc's [PR 4 endpoint 4b](./course-versioning-admin-features-plan.md#endpoint-4b--get-coursescourseidversionsdrift).
- **Audit is best-effort inside the transaction (CC3).** The `BULK_MIGRATE_LEARNER_VERSION` row above is emitted best-effort per migrated learner, not guaranteed. `writeAudit(tx?)` is now cross-cutting prep (lands in PR 1); failure inside a per-learner transaction logs a structured warning without rolling back the migration.
