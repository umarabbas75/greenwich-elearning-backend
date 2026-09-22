# SCORM progress parity — implementation plan

**Status:** v5 — backend-led restructure. The central design decision is reversed.
**Scope:** **Backend only.** The frontend syncs later against the contract in §9.
**Goal:** an imported SCORM course produces the *same progress data* a native course does — same tables, same engine, same shapes — so that when the frontend catches up it **deletes** SCORM branches rather than adding them.

> **Review log**
>
> **v4 → v5 (this revision).** v4 was checked against the live SCORM Cloud account, the live Rise manifest, the backend source and the frontend source. Three of its factual claims were wrong, one of its frontend rows targeted code that does not exist, and its central design choice — a SCORM branch inside the percentage engine — was found to work *against* the stated goal. §1 records the measurements; §2 states the reversal. The `suspendData` decode survives intact: it is the one thing v4 got right and it is the foundation of this plan.
>
> **v1 → v4** history is preserved at the end of this document (§14).

---

## 1. Evidence

Everything in this section was read from the live account and repository on 2026-09-21. The probe scripts that produced them land in commit 1 alongside the fixtures (§10.3); until then they exist only as scratch.

### 1.1 Where the runtime data actually lives

**v4 said `runtime.location` sits on the registration. It does not.** It is nested on the deepest child activity:

```
GET /registrations/{id}?includeChildResults=true&includeRuntime=true

registration
└── activityDetails                     ← attempts, suspended, completionAmount
    └── children[0]                     ← the single Rise SCO
        └── runtime                     ← location, entry, exit, suspendData, …
```

A mapper written against `payload.runtime` finds `undefined` and silently writes nothing. **Extraction must walk `activityDetails` depth-first for the deepest node carrying `runtime`.**

Confirmed live on registration `f896568a`:

| Field | Live value | Verdict |
|---|---|---|
| `activityDetails.children[0].runtime.location` | `index.html#/lessons/190692ab-…` | usable — the bookmark |
| `…runtime.suspendData` | 2875 bytes, `{"v":3,"d":[…729 codes]}` | **the real signal** — §1.2 |
| `…runtime.entry` / `exit` | `resume` / `suspend` | metadata only |
| `…runtime.progressMeasure` | `""` **(empty)** | unusable |
| `activityDetails.attempts` / `suspended` | `1` / `true` | usable |
| `registrationCompletionAmount` | `0` — after **1966s tracked and 21% done** | **unusable, always 0 for Rise** |
| `firstAccessDate` / `lastAccessDate` | real timestamps | usable |
| `xapiRegistrationId` | `9b927a85-…` | metadata only |

### 1.2 `suspendData` decodes — this part of v4 holds

`{"v":3,"d":[…]}` is classic LZW over a 256-entry initial dictionary. A ~10-line decoder yields:

```json
{"cpv":"z9SXlNnk","progress":{"p":21,"lessons":{
  "0":{"c":1,"p":100,"i":{…25/25 blocks…}},
  "1":{"c":1,"p":100,"i":{…25/25…}},
  "2":{      "p":18, "i":{…4/22…}},
  "3":{      "p":7,  "i":{…2/27…}},
  "4":{"c":1,"p":100,"i":{…25/25…}},
  "5":{      "p":4,  "i":{…1/28…}}}}}
```

- `lessons[n].c === 1` → that lesson is **complete**
- keys are **array indices** into the package manifest's `course.lessons`, not lesson ids
- absent key → never opened

This is a *set of completed units* — structurally identical to native section progress. That is what makes §2 possible.

### 1.3 `progress.p` is lesson-counted, not block-weighted

**v4's §3.7 claimed `progress.p` "counts blocks within the current lesson, so it moves while a learner works through one." It does not.** Measured against the live blob:

| hypothesis | computation | value |
|---|---|---|
| lessons complete / total | 3 / 14 | 21.43 → **21** |
| blocks complete / total | 82 / 371 | 22.10 → 22 |
| **actual `progress.p`** | — | **21** |

Confirmed on a second registration: 1 lesson complete → `p = 7` = `floor(1/14 × 100)`.

`progress.p` is exactly `floor(lessonsCompleted / lessonCount × 100)` — the same number the engine computes from a set of completed sections. **So we do not store it.** A stored copy could only ever duplicate our own number, or contradict it after a package replace (Rise's denominator is frozen at authoring time; ours is not). One number, one source.

### 1.4 The bookmark is a position, not a progress signal

The learner's bookmark is lesson index **5**. Their completed set is **{0, 1, 4}** — non-contiguous. On the second registration the bookmark is index 0 while one lesson is complete.

So `lessonIndex - 1` overstates by 67% in one case and understates in the other. v4 fed that number into the percentage numerator as "rung 2". **It must never reach a numerator.** It is a *label* ("Lesson 6 of 14") and nothing more. Free navigation is confirmed — `course.navigationMode: ""` — so this is by design, not a quirk.

### 1.5 The manifest

`scormcontent/runtime-data.js` is `__jsonp("runtime-data.js","<base64-json>")`, already parsed by [rise-probe.ts](../src/utils/rise-probe.ts). For the live course: **14 lessons** (13 `blocks` + 1 `quiz`), `position` matches array order, none `deleted`.

Two traps the parser must handle: lessons carry a **`deleted`** boolean, and `position` is authoritative. Filter `deleted !== true`, sort by `position`, and treat the resulting array as the index space — then verify that `suspendData` keys index the same array.

### 1.6 Scale today

```
{"regs":2,"incomplete":2,"pkgs":2,"scormCourses":2,"enrollScorm":2,"users":57}
```

**Two registrations, two packages, two enrollments.** v4 was designed around a migration burden that does not exist, and paid for it with a permanent fork. This is the cheapest moment this change will ever have.

---

## 2. The decision that changed

v4's goal statement was *"so shared surfaces stop special-casing it."* Its design then **added** special-casing: a branch in the percentage engine, a suppressed tree in the roster, a suppressed table in the PDF report, a new `denominatorSource`, and seven frontend changes. Its §6 was not a list of consumers to fix — it was the invoice for the wrong choice.

The frontend already carries that debt: **18 files, 39 branch sites, 16 separate `useScormProgress` mounts**, each justified by a comment asserting SCORM has no percentage. v4 patched all of them and added a 17th fetch path.

**The rule this plan follows: branch at write, not at read.**

Branch once, at import, on "did this package yield a lesson manifest?" — and from that point on SCORM data is *native-shaped*. Every read surface, present and future, works without knowing SCORM exists.

### D1 — Rise lessons become real `Section` rows

One `Section` per lesson, `type: SectionType.SCORM`, under the package's chapter, ordered by manifest `position`. A 14-lesson package yields 14 sections instead of 1.

### D2 — Lesson completion becomes `UserCourseProgress` rows

The decoded completed-lesson set is written as progress rows, exactly as a native learner accumulates them. Monotonic — rows are added, never deleted — matching native semantics.

### D3 — `learner-percentage.ts` is **not modified**

This is the test of the design. [learner-percentage.ts](../src/course-version/learner-percentage.ts) exists because per-call-site progress derivation caused real bugs; its own docstring says so. v4 reintroduced that fork inside the thing built to prevent it. Under D1+D2 the engine counts SCORM progress correctly with **zero changes**, and so do the roster drill-down, the PDF report, chapter gating, manifest pinning and version comparison.

*If a change to the engine turns out to be necessary, that is a signal the rest of this plan is wrong — stop and re-examine, do not add the branch.*

### D4 — The completion bridge stamps exactly the gate's denominator

The one real risk of D1. [course-completion.service.ts:83](../src/course-completion/course-completion.service.ts#L83) is:

```ts
if (progressed.length < totalSections) return;
```

With 14 sections, a learner who passes the quiz without every lesson marked complete would never certify. The fix is not to guess: the bridge calls `countCompletionDenominator(userId, courseId)` — the **same** function the gate calls — and stamps precisely the `liveSectionIds` it returns. The gate's check then cannot fail. See §7.

This is honest, not a fudge: SCORM completion is defined by the package (`completeWith: "quiz"`), not by our per-lesson tracking, and today's code already stamps one section regardless of what the learner read. D4 preserves that semantic at N sections.

### D5 — Non-Rise packages fall back to one section

No parseable manifest → create a single section, exactly as today. Storyline, Captivate and malformed Rise exports keep current behaviour: binary 0/100. The branch lives at import, where it costs one `if`.

### D6 — `suspendData` content is not stored

Articulate's private resume blob, rewritten on every commit, Cloud is its system of record, we never replay it. We store the *derived* progress rows and `metadata.suspendDataBytes` for auditability. The raw blob is captured once, as a test fixture (§11).

### D7 — No page render waits on SCORM Cloud

Unchanged from v4 and still right. Reads hit the DB. See §8 — with a correction v4 missed.

---

## 3. Schema

All additive. No column is renamed; nothing existing changes meaning.

```prisma
model ScormPackage {
  // Manifest parsed once at import. Each entry carries the Section row it
  // produced, so decoded lesson index → Section id is a JSON read, not a query.
  // Stable per package: a replace creates a NEW package with its own sections,
  // and a registration is bound to exactly one package (@@unique([userId, packageId])).
  lessons     Json?   // [{ index, id, title, type, sectionId }] in position order
  lessonCount Int?
  chapterId   String? // anchor: the chapter holding this package's lesson sections
}

model ScormRegistration {
  lessonsCompleted Int?       // count of decoded lessons with c === 1
  progressSource   String?    // "suspend-data" | "binary"
  attempts         Int?
  suspended        Boolean?
  locationRaw      String?    // runtime.location verbatim
  lessonId         String?    // resolved from locationRaw — LABEL ONLY (§1.4)
  lessonIndex      Int?       // 1-based — LABEL ONLY, never a numerator
  lessonTitle      String?
  completionAmount Float?     // always 0 for Rise (§1.1) — stored, never displayed
  firstAccessAt    DateTime?  // Cloud's real first access
  lastAccessAt     DateTime?  // Cloud's real last access
  metadata         Json?      // remainder, minus suspendData and minus learner PII
}
```

**Not added, deliberately:** `progressPercent` (§1.3 — redundant and can only disagree), `lessonProgress` keyed by raw index (§1.2 — indices are package-scoped; misattributes after a replace).

`firstLaunchAt` keeps its current meaning (row creation). `firstAccessAt` is the real one. Nothing is renamed; §9 tells the frontend which to prefer.

**PII:** the Cloud payload embeds `learner: { id, firstName, lastName }`. The mapper strips it to `learner.id` — that name is already on the `User` row we own, and copying it into a JSON blob on every commit spreads personal data into a column no purge path inspects.

## 4. Import — materialising lessons

### 4.1 Extend the probe

`parseRiseRuntimeData` additionally returns `lessons: Array<{ index, id, title, type }>`:

- filter `deleted !== true`
- sort by `position`
- `index` is the position in the **filtered, sorted** array
- `title` through `unescapeRiseTitle`
- returns `[]` for any manifest it cannot read — never throws

> `riseProbeJson` stores only the probe *result*, not the raw manifest. It cannot be re-parsed for lessons; §10 re-downloads.

### 4.2 Create one section per lesson

In the import transaction ([scorm.service.ts:556-591](../src/scorm/scorm.service.ts#L556-L591)), replace the single `section.create` with a loop:

```ts
// config must still satisfy parseScormSectionConfig — packageId + completeOn
// are required by the launch path, which reads whichever section it finds first.
{
  packageId, completeOn, passingScore,
  scormLessonId: lesson.id,
  scormLessonIndex: lesson.index,
  scormLessonType: lesson.type,
}
```

- `title`: the lesson title; `orderIndex`: `lesson.index + 1`; `type: SectionType.SCORM`
- then write `sectionId` back into `ScormPackage.lessons[]`, and set `ScormPackage.sectionId` to the **first** lesson section and `chapterId` to the chapter
- no lessons parsed → one section, today's behaviour (D5)

`publishNewVersion` already runs at [scorm.service.ts:445](../src/scorm/scorm.service.ts#L445), so the version manifest picks up all 14 sections with no change.

### 4.3 What already works unchanged

Verified, not assumed:

- **Launch** — `findScormSection` ([scorm-runtime.service.ts:898](../src/scorm/scorm-runtime.service.ts#L898)) returns the *first* SCORM section and reads `packageId`/`completeOn` off its config. Every lesson section carries both, so launch is unaffected. *One fix:* the unversioned branch's `findFirst` has no `orderBy` — add `orderBy: { orderIndex: 'asc' }` for determinism.
- **Tree lock** — `assertImportedCourseTreeLocked` keeps all 14 sections read-only for admins.
- **Package replace** — the existing archive-old-chapter + supersede path now archives N sections instead of 1. Pinned learners keep the old manifest, so their progress rows still count against the curriculum they were pinned to.

## 5. Decoding utilities

Three pure functions, no I/O, each returning `null` rather than throwing. Every one of them handles an **undocumented third-party format**, so the contract is uniform: a malformed, truncated or re-versioned input degrades progress, it never breaks a request.

**`extractRuntime(payload)`** — depth-first walk of `activityDetails` for the deepest node carrying `runtime`; returns `{ runtime, attempts, suspended, completionAmount } | null` (§1.1).

**`parseRiseSuspendData(raw)`**
- accepts `{"v":3,"d":[…]}`; returns `null` for any other `v`
- LZW-decodes, `JSON.parse`s, reads `progress.lessons`
- returns `{ completedIndices: number[] }` — nothing else
- `progress.p` is deliberately **not** returned (§1.3)

**`resolveRiseLesson(locationRaw, lessons)`** — parses `…#/lessons/<id>` → `{ lessonId, lessonIndex, lessonTitle }`; `null` for an empty or unknown location. **Label only** (§1.4).

## 6. Progress sync

One function, `applyProgressSnapshot(registration, payload)`, is the *only* writer. Postback, on-demand refresh and cron all funnel through it, so push and pull cannot drift.

```
extractRuntime(payload)
  → parseRiseSuspendData(runtime.suspendData)
      → completedIndices
      → package.lessons[i].sectionId          (JSON read, no query)
      → createMany(UserCourseProgress, skipDuplicates: true)
      → registration.lessonsCompleted, progressSource = "suspend-data"
  → resolveRiseLesson(runtime.location)  → lessonIndex/Title (label)
```

Rules:

- **Resolve indices against the registration's own package.** Never the course's newest. Index space is package-scoped (§1.2); resolving against the wrong package silently attributes progress to the wrong lessons. This is the single easiest way to corrupt this feature.
- **Additive only.** `skipDuplicates`, never delete. Matches native monotonic progress.
- **Absent data never nulls present data.** A `COURSE`-format postback carries no `runtime`; the mapper must leave `locationRaw`, `lesson*` and the progress rows **untouched** when the payload lacks them. Otherwise every postback erases what the pull just filled in.
- `totalTimeSeconds` keeps its existing `Math.max` guard. New scalar fields are last-write-wins.
- Decode fails → `progressSource = "binary"`, no rows written, today's behaviour.

## 7. Completion bridge

`runCompletionBridge` currently creates **one** `UserCourseProgress` row ([scorm-runtime.service.ts:478-488](../src/scorm/scorm-runtime.service.ts#L478-L488)). Change it to stamp the gate's own denominator (D4):

```ts
const { liveSectionIds } = await this.courseVersionService
  .countCompletionDenominator(row.userId, row.courseId);

await this.prisma.userCourseProgress.createMany({
  data: liveSectionIds.map(/* … chapterId/moduleId from the section */),
  skipDuplicates: true,
});

await this.courseCompletion.checkContentCompletion(row.userId, row.courseId);
```

Because the stamped set *is* the counted set, `progressed.length < totalSections` cannot fail for a SCORM learner whom Cloud reports complete. `resolveCertifySection`'s archived-section remapping is subsumed: `countCompletionDenominator` already resolves pinned vs live correctly.

The SCORM chapter has no native quizzes, so `quizBearingChapterIds` is empty and the quiz half of the gate is a no-op.

**This is the highest-risk change in the plan** — it sits on the certificate-issuance path. It ships behind the tests in §11 and is the first thing to verify in staging.

## 8. Freshness

**Rule (unchanged): no page render waits on a Cloud call.** Reads hit the DB. Three writers keep it current — but v4 mis-sized two of them.

**1. Postbacks.** Continuous and free. **Open question, and it is load-bearing** — see §8.1.

**2. On-demand refresh.** `POST /scorm/progress/refresh`, single-flighted per registration, no-op inside `SCORM_PROGRESS_REFRESH_MS` (60s). Cloud failure is logged, never surfaced.

**3. Reconcile cron.** *Correction:* [vercel.json](../vercel.json) runs **one cron, daily at 09:00**, and `RECONCILE_BATCH = 20`. The pull path's real capacity is **20 registrations per day**. v4 called this a "catch-all"; at 200 in-progress learners a full sweep takes ten days. Fine at today's scale of 2, but it is not the guarantee v4 claimed. Add `includeChildResults=true&includeRuntime=true` to the call it already makes at [scorm-runtime.service.ts:213](../src/scorm/scorm-runtime.service.ts#L213), and **raise the batch and state the ceiling** rather than inventing a second cron.

`GET /scorm/progress` stays a pure DB read. With D1+D2 it stops being the primary progress source anyway — the engine now serves SCORM percentages through the same path as native.

### 8.1 The postback format question — decide this first

v4 deferred this as "commit 4, conditional" and said *"if verification is inconvenient, drop it."* Given a 20/day cron, that is backwards: **postbacks are the only continuous freshness source**, so whether they carry `suspendData` determines whether push or pull is primary.

Two things to establish in staging, before the freshness model is finalised:

1. **Does an `ACTIVITY` postback carry `runtime.suspendData`?** If not, push cannot feed §6 and pull stays primary regardless. If only `FULL` carries it, that is a separate call — `FULL` also puts per-question learner answers on the wire on every commit.
2. **Does the envelope keep a top-level `id`?** `handlePostback` throws 500 without it ([scorm-runtime.service.ts:151](../src/scorm/scorm-runtime.service.ts#L151)) and Cloud retries 500s indefinitely. An unverified switch risks the working completion path.

Also unresolved: `GET /registrations/{id}/postback` returns 404, from which v4 concluded the postback config cannot be mutated. **A 404 on GET does not prove PUT is absent.** Test `PUT /registrations/{id}/postback` against a throwaway registration before accepting that existing registrations can never be upgraded. At two live registrations, recreating them is also a legitimate option.

## 9. What the backend guarantees — frontend contract

The frontend is **not** changed in this plan. This section is what it can rely on afterwards, and belongs in `SCORM_CLOUD_FRONTEND_GUIDE.md` as a deliverable.

| Surface | Before | After this plan |
|---|---|---|
| `course.percentage` on any list/detail | 0 until 100 | **real, lesson-based, from the same engine as native** |
| `course.totalSections` | 1 | `lessonCount` (14) |
| Roster drill-down per-chapter counts | "0 of 1 sections" | "3 of 14 sections", real titles |
| PDF / course report section table | one synthetic row | one row per lesson |
| `GET /scorm/progress` | status + score + time | **additionally** `lessonIndex`, `lessonsTotal`, `lessonTitle`, `lessonsCompleted`, `suspended`, `attempts`, `firstAccessAt`, `lastAccessAt` |

**The frontend's follow-up is a deletion, not a patch.** Once this ships, these become removable — they are listed so the FE team can scope it, not for anyone to do now:

- 39 `isScorm` / `isImportedScorm` branch sites across 18 files
- 16 separate `useScormProgress` / `ScormProgressBadge` mounts, including the per-card N+1 in `SingleCourse` and the per-row N+1 in `ViewUserCoursesModal`
- the `isScorm` early-return in `LearnerCourseDetail`, which today renders a different component entirely
- doc comments asserting "SCORM has no percentage to show" in `ScormProgressSummary`, `SingleCourse`, `UserAssignedCourses` — these become actively misleading the day this ships

Two frontend notes worth recording now, found while reviewing and **not** fixed here:

- `ScormLaunchButton` calls `invalidateQueries` on player-tab close, not a refresh. Invalidate fires a GET, and a GET is a pure DB read — so tab-close currently re-reads the stale row. When the FE wires §8's refresh endpoint it must **await the POST before invalidating**, or the refetch races the pull.
- `ScormProgressSummary` mounts with `poll: true` (`SCORM_PROGRESS_POLL_MS = 30000`). If `refresh=1` is ever wired into that page, it becomes a Cloud pull attempt every 30s per viewing learner. Keep refresh on the tab-close event only.

## 10. Migration

At two packages and two registrations (§1.6) this is near-free — which is why it is worth doing properly now.

1. **Packages** — a script re-downloads `scormcontent/runtime-data.js` per `READY` package via `getCourseAsset`, parses lessons, creates the sections (§4.2), writes `lessons`/`lessonCount`/`chapterId`, and publishes a new course version. `PRUNED`/`FAILED` packages whose Cloud course is gone 404 → leave as one section, log, fall back to binary.
2. **Registrations** — filled by the first refresh or cron pass. No dedicated script.
3. **Fixtures** — the same script saves the raw `suspendData` blob and the parsed manifest into `src/utils/fixtures/` as test data. The real blob is exactly what §11 needs.

Existing learners pinned to a one-section version keep binary progress until they are re-pinned — correct behaviour, and at this scale, two people.

## 11. Tests

- **`parseRiseSuspendData`** — the captured blob yields `completedIndices: [0,1,4]`; `v:4` → null; truncated codes → null; empty string → null; never throws.
- **`extractRuntime`** — finds runtime on a nested child; returns null for a `COURSE`-shaped payload; does not throw on a missing `activityDetails`.
- **`rise-probe`** — lesson extraction and ordering; `position` order honoured over array order; `deleted: true` lessons excluded; quiz lesson present; malformed manifest → `[]`.
- **`resolveRiseLesson`** — hit, unknown id, empty location, no manifest, odd URL shapes.
- **Import** — a 14-lesson manifest creates 14 ordered sections each carrying a config that `parseScormSectionConfig` accepts; a non-Rise package creates exactly one (D5); `ScormPackage.lessons[].sectionId` is populated.
- **`applyProgressSnapshot`** — completed indices become progress rows; **indices resolve against the registration's own package, not the newest**; re-applying is idempotent; a runtime-less payload does not delete existing rows or null the lesson position; `Math.max` on time preserved; learner names stripped from `metadata`.
- **Completion bridge** — a Cloud-complete learner with only 3 of 14 lessons decoded still certifies (D4); the stamped set equals `countCompletionDenominator`'s set; certification is idempotent.
- **`computeLearnerPercentages`** — **assert the file is unmodified in spirit**: a SCORM learner with 3 of 14 sections reads 21% through the ordinary path, with no SCORM-specific code in the engine, and an all-native batch issues an unchanged number of queries.
- **Launch** — still resolves with 14 sections present; deterministic under `orderIndex`.

## 12. Risks

| Risk | Mitigation |
|---|---|
| **Completion gate deadlock** — 14 sections, fewer stamped | D4: the bridge stamps `countCompletionDenominator`'s own output, so the check cannot fail. Highest-risk item; verify in staging first. |
| `suspendData` schema changes (undocumented) | Guarded to `v:3`, try/catch, degrades to `progressSource: "binary"` — today's behaviour. A decode failure loses granularity, never a page. |
| Index misattribution after a package replace | Resolve only against the registration's own `package.lessons`; covered by an explicit test. |
| Rise changes `runtime-data.js` shape | Probe returns `[]` → one section (D5) → today's behaviour. |
| Non-Rise packages (Storyline, Captivate) | D5, by construction. |
| A learner certifies with lessons unopened | Intentional and unchanged: SCORM completion is the package's verdict, and today's code already stamps regardless. Stated in §9 so nobody reads 14/14 as "read every page". |
| 20/day cron cannot keep up as SCORM grows | §8 states the ceiling explicitly; raise `RECONCILE_BATCH` and resolve §8.1 before scaling. |
| `ACTIVITY` postback lacks `suspendData` | §8.1 — decided before the freshness model is finalised, not after. |

## 13. Delivery

Backend-only, shipped as one deploy. The frontend continues to render its existing SCORM branches throughout — they keep working, they simply stop being necessary.

| Commit | Contents |
|---|---|
| **1 — decode** | §5 utilities + §11 unit tests + captured fixtures. Pure functions, no wiring. Independently reviewable. |
| **2 — structure** | §3 migration, §4 import materialisation, §10 backfill script. New imports and the two existing packages gain lesson sections. |
| **3 — progress** | §6 sync, §7 completion bridge, §8 pull-path and cron changes. This is the commit that makes percentages real. |
| **4 — contract** | §9 `SCORM_CLOUD_FRONTEND_GUIDE.md` update, `GET /scorm/progress` additive fields. Hands the FE team a scoped deletion. |

§8.1 is answered **before commit 3**, since it decides whether push or pull is primary.

**Definition of done:** a learner 3 lessons into a 14-lesson imported package reads **21%** on the course card, the roster, the learner detail page and the PDF report — and [learner-percentage.ts](../src/course-version/learner-percentage.ts) contains no reference to SCORM.

---

## 14. Superseded history (v1–v4)

Kept for provenance. These revisions assumed a percentage-engine branch; §2 replaces that approach.

- **v1 → v2** fixed an unworkable backfill step, an unstated registration-selection rule, a wrong denominator for never-launched learners, four progress consumers bypassing the engine, a 24-hour staleness hole, and a dishonest UI label.
- **v2 → v3** fixed a self-contradicting refresh trigger, a case where a package replace could read 100% mid-course, and a "sections" label on lessons. *(The label fix targeted `totalSections` in `SingleCourse` — which is declared but never rendered; there was no such line.)*
- **v3 → v4** discovered the `suspendData` LZW decode — the one finding carried forward intact.
- **v4 → v5** verified v4 against the live account and the source: runtime is nested (§1.1), `progress.p` is lesson-counted (§1.3), the bookmark is not a numerator (§1.4), and the engine branch was reversed (§2).
