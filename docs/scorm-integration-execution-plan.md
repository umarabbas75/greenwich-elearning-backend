# SCORM integration — execution plan

**Status:** Rewritten for **D1 and D2 resolved** by explicit client/product decision (2026-08-30): **D2 — buy** (SCORM Cloud, not our own storage/player/RTE); **D1 — imported courses certify directly off SCORM Cloud's reported completion, no separate native exam gate**. This replaces the build-path plan entirely — see the changelog below for what that removes.
**Builds on:** [scorm-imported-courses-architecture.md](./scorm-imported-courses-architecture.md) rev 3 (the *why*). This document is the *how*.

---

## 0. Changelog — what the D1/D2 decisions removed

The previous version of this plan (build-our-own-runtime) went through six independent, no-context review rounds earlier in this project's development, before the D1/D2 decisions arrived — that review history lives in this session's own record rather than as a separate artifact in the repo (this file was rewritten in place, not appended to), so treat the *facts* it surfaced as carried forward and re-stated here, not as something to go looking for a standalone log of. Worth knowing it happened, because some of what it found is still relevant even though the mechanism it was reviewing is gone:

- Rounds 1–2 found real gaps in reusing this codebase's existing patterns (`_assertEnrollmentUsable` isn't actually on the native progress path; the GDPR purge list is a hand-maintained 18-call list, not ~27; migration forward-references break `prisma migrate dev` if a relation field is added before its target model exists). **These facts are still true and still apply** — carried into this rewrite.
- Rounds 2–6 spent most of their effort on a `commitSeq`/`sessionId` concurrency mechanism for persisting SCORM 1.2 runtime state ourselves — a hard problem that took four rewrites to get right. **That entire mechanism is gone.** SCORM Cloud owns concurrent-session correctness against its own SCORM RTE; we only ever receive a finished, already-reconciled status via postback. If D2 is ever revisited back toward "build," that review history (preserved in git) is the place to restart from, not from scratch.

This rewrite carries forward everything that was true independent of build-vs-buy (the synthetic tree, the zero-section guard, the GDPR purge list, the engagement CTE fix, the title-escaping note) and replaces everything that was specific to hosting our own player and RTE.

---

## 1. Decisions

D1 and D2 are resolved. Remaining, from architecture doc §16 — flags, none blocking:

| ID | Question | Default | Affects |
|---|---|---|---|
| D7 | Embedded iframe vs full-page redirect to SCORM Cloud's player | **Full-page redirect** — simplest, most compatible, no embedding edge cases to chase | Phase 3 |
| D-retry | Expose SCORM Cloud's `resetRegistration` ("try the whole course again," as opposed to retrying just the embedded quiz, which already works inside one registration) or not | **Not in v1**, and the deferral has two real costs worth knowing now (round-1 review finding), not just a "later" flag: (1) `@@unique([userId, packageId])` on `ScormRegistration` means there is no schema-level room for a second attempt — revisiting this needs a migration, not just a new API call; (2) if `resetRegistration` is ever wired up, calling it will make SCORM Cloud report a *downgrade* (`completed`/`passed` → `incomplete`/`unknown`) on the same registration, which §6.2's monotonic postback rule would — correctly, for every other case — refuse to persist. A future reset feature needs its own explicit bypass of that rule (e.g. a distinct "reset" write path, not a postback), not just a schema change | Phase 3 |
| D-upload-role | Who may upload packages — all admins or a content role | All admins for v1 | Phase 2 |
| D-api-version | Confirm SCORM Cloud V2 API's exact course-import and launch endpoints | Confirm against their live Swagger/OpenAPI reference in Phase 1 — this plan's endpoint names are conceptual until then | Phase 1, Phase 2 |
| D-fire-safety | The repo's fire-safety folder is a `raw`/HTML5 export, not a SCORM package (no manifest, no SCO) | Request a real SCORM re-export from the client before any playthrough test needs a real scoreable quiz; use it as a `runtime-data.js` probe-data fixture only until then | Phase 1, Phase 6 testing |

---

## 2. Provisioning checklist

Far shorter than the build-path version — no domain, no bucket, no CDN.

1. [ ] Create a SCORM Cloud account (`app.cloud.scorm.com`); confirm current pricing tier against expected course/registration volume.
2. [ ] Obtain App ID + Secret Key (or set up OAuth2 per SCORM Cloud's V2 auth docs).
3. [ ] Add env vars:
   ```
   # ── SCORM Cloud ─────────────────────────────────────────────────────────
   SCORM_CLOUD_APP_ID=
   SCORM_CLOUD_SECRET_KEY=
   # Base path is stable across SCORM Cloud's public V2 docs; the exact
   # course-import and registration/launch endpoint paths under it are NOT
   # yet confirmed (see D-api-version) — this value, unlike this file's other
   # unconfirmed specifics, is reasonably safe to set now, but Phase 1 still
   # owns final confirmation.
   SCORM_CLOUD_API_BASE=https://cloud.scorm.com/api/v2

   # Shared secret WE generate and hand to SCORM Cloud at registration-create
   # time — verifies inbound postbacks are really from SCORM Cloud. Distinct
   # from the App ID/Secret Key pair above (that's outbound auth; this is
   # inbound). Generate with e.g. `openssl rand -base64 48`.
   SCORM_POSTBACK_AUTH_USER=
   SCORM_POSTBACK_AUTH_PASSWORD=
   ```
4. [ ] Confirm billing is on the client's own account (consistent with how recurring hosting costs were handled in the earlier invoicing conversation), not ours.
5. [ ] Confirm a DPA is in place with Rustici Software before any real learner data reaches SCORM Cloud (legal/commercial task — flagged here so it isn't missed, not solved by engineering).

**Acceptance criteria:** a script-level call to SCORM Cloud's API using the App ID/Secret Key succeeds against a trivial endpoint (e.g. list courses, empty result is fine); `SCORM_POSTBACK_AUTH_USER`/`PASSWORD` confirmed set in every environment (local, preview, production).

---

## 3. Master checklist

- [ ] §1 D-api-version confirmed against SCORM Cloud's live API reference
- [ ] §2 provisioning complete
- [ ] Phase 1 — Spike proven on the lifting package (the only real playable SCORM sample in this repo)
- [ ] Phase 2 — Import pipeline (migrations, module, probe, synthetic tree, zero-section guard)
- [ ] Phase 3 — Launch redirect + postback receiver + reconciliation poll
- [ ] Phase 4 — Completion bridge
- [ ] Phase 5 — Platform edges (engagement, `LastSeenSection`, GDPR purge)
- [ ] Phase 6 — Admin/report surface
- [ ] §10 Testing plan fully executed
- [ ] §11 Rollout confirmed reversible

---

## 4. Phase 1 — Spike

**Goal:** prove SCORM Cloud's actual API shape and postback mechanism against a real package, before writing any of our own code.

**Depends on:** §2 provisioning.

### Tasks

1. [ ] Manually import the **lifting** package (`occupational-health-amp-safety-safe-lifting-and-rigging-operations-level-3-awar-scorm12-1zKdvoHT/`) via SCORM Cloud's own dashboard first — the fastest way to confirm it's accepted as a valid SCORM package, independent of our API integration.
2. [ ] Repeat via the API: call the course-import operation, confirm the exact request/response shape (pin down D-api-version here — this is the concrete task that resolves it), and confirm you get back a usable course id.
3. [ ] Create a registration against that course id via the API; request a launch link; open it in a browser; play the course to completion.
4. [ ] Confirm SCORM Cloud reports `completionStatus: "completed"` and `successStatus: "unknown"` (never `"passed"` — no scoreable quiz, per architecture §0) via `getRegistrationResult`.
5. [ ] Configure a `postbackurl` pointing at a temporary local tunnel (e.g. a webhook-catcher or `ngrok`) and confirm a postback actually arrives on status change — do this **before** building our own receiver, so you're debugging one thing at a time.
6. [ ] Use SCORM Cloud's own `testRegistrationPostUrl`/`TestRegistrationPostback` tool to send dummy postback data at your endpoint stub — confirms the wire format independent of playing the course again.
7. [ ] Confirm the launch link's ~15-minute expiry empirically (request one, wait, try it stale) so Phase 3's "always generate fresh, never cache" rule is enforced with a real number, not an assumed one.
8. [ ] Time-box: if course import or registration creation don't work cleanly against the lifting package within **2 working days**, stop and re-open **D2** with real friction data.

### Acceptance criteria

- [ ] The lifting package imports via the real API call (not just the dashboard), and D-api-version's exact endpoint/payload shape is documented here for Phase 2 to build against.
- [ ] A registration plays to `completed` and a postback for that status change is received by a real (even if temporary) endpoint.
- [ ] `testRegistrationPostUrl` confirmed working against a stub of our own future `/scorm/postback` endpoint's shape.
- [ ] Launch-link expiry confirmed empirically.

---

## 5. Phase 2 — Import pipeline

**Depends on:** Phase 1 (API shape confirmed).

### 5.1 Prisma migrations, in order

Each migration is additive-only. **Forward-reference rule, learned the hard way in the build-path plan's review rounds and worth restating**: a relation-array field (`Foo[]`) must be added in the same migration that defines `model Foo`, not earlier — Prisma validates the whole schema file before generating SQL, and a field pointing at a not-yet-defined model is a hard failure, not a warning.

1. `<TS_1>_add_course_delivery_mode`
   ```prisma
   enum CourseDeliveryMode {
     NATIVE
     IMPORTED_SCORM
   }
   ```
   Add `deliveryMode CourseDeliveryMode @default(NATIVE)` to `Course` (schema.prisma, near line 110). **Do not** add `Course.scormPackages` here — `ScormPackage` doesn't exist until migration 3.

2. `<TS_2>_add_scorm_section_type`
   Add `SCORM` to the `SectionType` enum (`prisma/schema.prisma:811-821`). The migration SQL is exactly:
   ```sql
   ALTER TYPE "section_type" ADD VALUE IF NOT EXISTS 'SCORM';
   ```
   Copy the `IF NOT EXISTS` verbatim — both precedent migrations in this repo (`20260626000000_add_embed_section_type`, `20260829120000_add_flashcards_section_type`) use it to safely reconcile a divergent migration history. **Postgres gotcha:** `ALTER TYPE … ADD VALUE` cannot be used in the same transaction as a later statement that *reads* the new value — keep this migration to only the enum addition.

3. `<TS_3>_add_scorm_package`
   ```prisma
   enum ScormPackageStatus {
     PROCESSING
     READY
     FAILED
     SUPERSEDED
   }

   model ScormPackage {
     id                 String             @id @default(uuid())
     courseId           String
     versionNumber      Int
     sectionId          String?            // set after the Section is created — see §5.5
     title              String
     scormCloudCourseId String             // SCORM Cloud's own identifier — package identity, not zipSha256
     zipSha256          String             // audit/dedup only
     riseProbeJson      Json?              // best-effort Rise probe — see §5.3
     status             ScormPackageStatus @default(PROCESSING)
     failureReason      String?
     createdAt          DateTime           @default(now())

     course Course @relation(fields: [courseId], references: [id])

     @@unique([courseId, versionNumber])
     @@index([courseId, status])
     @@map("scorm_packages")
   }
   ```
   Also add `scormPackages ScormPackage[]` to `Course` **in this same migration** (safe here — `Course` already exists, `ScormPackage` is defined in this same file).

4. `<TS_4>_add_scorm_registration`
   ```prisma
   model ScormRegistration {
     id                       String    @id @default(uuid())
     userId                   String
     courseId                 String    // denormalised for the report index
     packageId                String    // AUTHORITATIVE for launch — never re-resolve from live Section.config
     sectionId                String
     scormCloudRegistrationId String
     completionStatus         String    @default("unknown")
     successStatus            String    @default("unknown")
     scoreRaw                 Float?
     scoreScaled              Float?
     totalTimeSeconds         Int?
     firstLaunchAt            DateTime?
     lastPostbackAt           DateTime?
     completedAt              DateTime?
     createdAt                DateTime  @default(now())
     updatedAt                DateTime  @updatedAt

     user    User         @relation(fields: [userId], references: [id])
     package ScormPackage @relation(fields: [packageId], references: [id])

     @@unique([userId, packageId])
     @@index([courseId, completionStatus])
     @@index([userId, courseId])
     @@map("scorm_registrations")
   }
   ```
   Also add, **in this same migration**: `scormRegistrations ScormRegistration[]` to `User` (load-bearing — see §5.6's GDPR note) and `registrations ScormRegistration[]` to `ScormPackage`.

Run `yarn prisma migrate dev` after each file individually, not all four at once.

### 5.2 New module: `src/scorm/`

- `src/scorm/scorm.module.ts`
- `src/scorm/scorm.controller.ts` — admin package endpoints
- `src/scorm/scorm-launch.controller.ts` — the student-facing launch redirect and the postback receiver (kept separate from the admin controller: different guards — ordinary admin JWT vs a dedicated postback-auth guard vs ordinary student JWT)
- `src/scorm/scorm.service.ts` — package create, forward-to-SCORM-Cloud, poll import status
- `src/scorm/scorm-runtime.service.ts` — launch (create/resolve registration, request launch link), postback handling, reconciliation poll
- `src/scorm/scorm-postback.guard.ts` — mirrors `src/engagement/cron-secret.guard.ts`'s pattern (a small dedicated `CanActivate`): verifies HTTP Basic Auth against `SCORM_POSTBACK_AUTH_USER`/`PASSWORD`, fails closed if either is unset
- `src/scorm/scorm-cloud-client.ts` — thin wrapper around SCORM Cloud's API (import, create/resolve registration, request launch link, `getRegistrationResult`, `deleteRegistration`) — isolate this so Phase 1's confirmed request/response shapes live in one file, not scattered across services
- `src/scorm/dto.ts` — dedicated DTO file for this module (a deliberate departure from this repo's single-`src/dto.ts` convention, same reasoning as before: avoid growing an already-1,250-line file). Every field needs explicit `class-validator` decorators — `ValidationPipe({ whitelist: true })` in `app.setup.ts` strips undecorated properties, and the postback payload is exactly this kind of large, loosely-typed body that would silently arrive as `{}` if this is missed.
- `src/utils/rise-probe.ts` — best-effort parser for `scormcontent/runtime-data.js`, unchanged in substance from the build-path plan: extracts `reporting`, `completeWith`, `completionPercentage`, end-quiz item count, `passingScore`, `retryCount`, and `course.title` (single-escaped). `loadOnlyInLMS` deliberately excluded (disagrees with itself three ways in the real sample; nothing here gates on it). Add `src/utils/rise-probe.spec.ts` fixturing on trimmed copies of both real `runtime-data.js` files.
- Register `ScormModule` in `src/app.module.ts`.

**Where the probe actually runs, now that we don't unzip on our own infrastructure**: the admin's browser reads `scormcontent/runtime-data.js` out of the zip locally via JSZip (a single-file peek, not a full unzip-and-upload), and posts the extracted JSON to our API alongside forwarding the zip itself to SCORM Cloud. `rise-probe.ts` is the same parsing logic either way — only where it runs (browser vs. our own backend, since we never hold an unzipped copy server-side) changes from the build-path version.

### 5.3 Import flow (`scorm.service.ts`)

1. `POST /scorm/packages`: create `ScormPackage` row (`status: PROCESSING`), accept the zip (proxied through our API or uploaded by the admin's browser directly to SCORM Cloud if their API supports a client-side upload URL — confirm which in Phase 1/D-api-version).
2. Forward to SCORM Cloud's course-import operation. If it's async (their V1 docs describe `importCourseAsync` + poll `getAsyncImportResult`), poll until it resolves; store the returned SCORM Cloud course id as `scormCloudCourseId`.
3. Store the browser-submitted `riseProbeJson`.
4. **Policy gate, unchanged from the build-path plan and just as important**: if the admin requests `completeOn: "passed"` (§5.4) and the probe shows `quizItemCount === 0` or the reporting mode isn't a `passed-*` mode, refuse with a message naming the empty quiz. If the probe shows a `passed-*` mode with zero quiz items even under `completeOn: "completed"`, warn (don't block) — the admin should know no score will ever appear in reports for this exact course (this is precisely the lifting sample).
5. On success: build the synthetic tree (§5.5), flip `status: READY`. On failure: `status: FAILED` + `failureReason` (surface SCORM Cloud's own rejection reason where possible, not a generic error).

### 5.4 Synthetic tree

Same shape as the build-path plan, just with a smaller `ScormPackage`:

```
Module   "Course content"       (locked)
 └── Chapter <package title, unescaped twice — see note>
      └── Section  type = SCORM
           config: { packageId, completeOn: "completed" | "passed", passingScore? }
```

**Title escaping note:** Rise double-escapes the manifest title (`Occupational Health &amp;amp; Safety…`). Prefer the title from `riseProbeJson` (single-escaped) over the manifest title; if only the manifest title is available, unescape twice.

**Same class of gotcha, one model down (round-1 review finding, extended in rounds 2 and 3 — it kept turning out not to be only one field):** `Chapter.pdfFile` is `String` — required, NOT NULL, no default — and it's an actively-read field (`course.service.ts`, `src/dto.ts`, and captured into the pinned-curriculum resolver in `course-version.manifest.ts`), not dead legacy. **`Module.description`, `Chapter.description`, and `Section.description` are all the same shape** — required `String`, no default, read by the exact same resolver (`course-version.manifest.ts:804/852/863`). **And `Section.title` (`schema.prisma:404`) is too** — round 3 found this one after rounds 1–2 had already flagged `pdfFile` and the three `description` fields as "the complete list," and it very nearly wasn't the last: the synthetic-tree diagram gives the Module and Chapter explicit titles but never says what the Section's is. Read directly by `course-version.manifest.ts:803` (`title: s.title`, no `?? ''` fallback the way some sibling fields get), and enforced with `@IsNotEmpty()` on `CreateSectionDto` (`src/dto.ts`). **Full list the synthetic-tree creation call must supply, don't assume this is now exhaustive without checking `prisma/schema.prisma` yourself against whatever the actual create calls end up being:** `Module.description`, `Chapter.description`, `Chapter.pdfFile`, `Section.description`, `Section.title` — all empty string, alongside every other required field. Don't assume the create DTOs' own validation will catch a missing one before it reaches Postgres; at least one existing DTO (`ModuleDto`, `src/dto.ts`) marks `description` as `@IsNotEmpty()` while `pdfFile` there is merely `@IsOptional()`, so these fields aren't even guarded the same way as each other today.

### 5.5 `sectionId` write-back

`ScormPackage.sectionId` is nullable specifically because the Section doesn't exist until the synthetic-tree step runs. In the same transaction that creates the Section, write its new id back onto `ScormPackage.sectionId` — this is the only place that field is ever set, and it's what the launch endpoint (Phase 3) reads to populate `ScormRegistration.sectionId` at registration-creation time.

**Guards to add (edits to existing code, not new endpoints):**

- `course.service.ts` `createCourse` (line 2063): if `deliveryMode === IMPORTED_SCORM`, force `isActive: false` at creation.
- `course.service.ts` `updateCourse` (line 3481, `prisma.course.update` at line 3496): before allowing `courseData.isActive` to become `true` for an `IMPORTED_SCORM` course, check it has exactly one live `SCORM`-type section belonging to a `READY` package. Reject otherwise. Closes architecture §8.2: `_isCourseContentCompleted` returns `true` at zero sections, and under the new direct-certify D1 rule a half-finished import with zero sections would certify every enrolled learner immediately, not just unlock an exam.
- Every module/chapter/section/quiz create/update/reorder/archive endpoint not already scoped by `deliveryMode`: reject mutation of the locked synthetic rows for an `IMPORTED_SCORM` course.

### 5.6 Replace-package flow

New zip → new SCORM Cloud course (via the same import flow) → new `ScormPackage` v2 → new `Section` (write-back per §5.5) → archive the v1 section → publish a new `CourseVersion` via `courseVersionService.publishNewVersion` → run the existing bulk-migration `wouldRegress` check and surface "N learners in progress will restart if migrated" before the admin confirms.

Learners pinned to the v1 `CourseVersion` keep the v1 section, the v1 `ScormPackage`, and therefore their existing SCORM Cloud registration against the v1 course id — launch (Phase 3) resolves the course id from `ScormRegistration.packageId`, never from live `Section.config`.

### Acceptance criteria

- [ ] Uploading the lifting package end to end: import succeeds, probe records `reporting: "passed-incomplete"`, `quizItemCount: 0`; requesting `completeOn: "passed"` is refused naming the empty quiz.
- [ ] Attempting to set an `IMPORTED_SCORM` course `isActive: true` with zero live SCORM sections is rejected.
- [ ] Attempting to edit/reorder/archive a section directly inside an `IMPORTED_SCORM` course's locked chapter is rejected.

---

## 6. Phase 3 — Launch, postback, reconciliation

**Depends on:** Phase 2 (package + section exist).

### 6.1 Launch (`GET /scorm/launch`)

1. Resolve key: `(userId, packageId)` per `@@unique([userId, packageId])` on `ScormRegistration`.
2. `_assertEnrollmentUsable` (`course.service.ts`) — called explicitly here, not inherited from the native progress path. **Correction carried from the build-path plan's review**: `updateUserChapterProgress` (`course.service.ts:5922`) only calls `assertChapterAccessible` (`src/utils/chapter-progression.ts:337`), which enforces chapter sequencing, not `UserCourse.isActive`/`validityDays` expiry. `_assertEnrollmentUsable` exists and is correct for this purpose but is only called from the course-forms paths today — call it directly.
3. First-ever launch: create the `ScormRegistration` row, set `firstLaunchAt: now()`. Call SCORM Cloud's create-registration operation, storing the returned `scormCloudRegistrationId`. Configure the postback URL and Basic Auth credentials (§2) at this call, per-registration.
4. Returning launch: reuse the existing `scormCloudRegistrationId` — do not create a second SCORM Cloud registration for the same `(userId, packageId)`.
5. Request a **fresh** launch link from SCORM Cloud (never cached, never pre-generated — it expires in ~15 minutes per Phase 1's confirmed figure).
6. Write a `LastSeenSection` upsert here too (§7.2) — cheap, one extra write on the same request.
7. Respond with a **302 redirect** straight to the launch link. Never return it in a JSON body for the frontend to navigate to "later."

### 6.2 Postback receiver (`POST /scorm/postback`)

1. Guarded by `ScormPostbackGuard` (§5.2) — HTTP Basic Auth, fails closed if the shared secret is unset.
2. Parse the payload (mirrors `getRegistrationResult`'s shape — confirm exact fields in Phase 1). Resolve the `ScormRegistration` by `scormCloudRegistrationId`.
3. **Idempotent, monotonic update — with the ordering made explicit (round-1 review finding: "never backward" is meaningless for `successStatus` until an order is stated, and the naive reading would block the exact retry-then-pass sequence this design needs to support).** Two independent rank orders, each checked as "only write if the new rank is strictly greater than the stored rank":
   - `completionStatus`: `unknown`(0) `< incomplete`(1) `< completed`(2).
   - `successStatus`: `unknown`(0) `< failed`(1) `< passed`(2). **This is the important one.** Ranking `failed` below `passed` — not the two of them as siblings with no order between them — is what makes a `failed → passed` postback (an ordinary retry-then-pass, expected and required per architecture §1.3's `retryCount: -1` fact) a valid forward move, while a `passed → failed` postback (e.g. a later, separate attempt that fails) is correctly refused: `passed` is a one-way-absorbing terminal state once reached, matching this codebase's existing "never un-complete a learner" philosophy elsewhere (freeze-at-completion). `failed` itself is not absorbing — `unknown → failed` and `failed → passed` are both legitimate writes.
   - Update `scoreRaw`/`scoreScaled`/`totalTimeSeconds` to the latest reported values on every accepted write (these aren't ranked — always take the newest), and set `lastPostbackAt: now()` on every postback received, accepted or not (it's evidence of activity either way, and feeds §8.1's engagement fix). A duplicate or genuinely-backward postback is a no-op on the ranked fields, not an error.
4. If the new status satisfies the section's `completeOn` (§5.4) **and it didn't already**, run the completion bridge (Phase 4).
5. Respond `200` regardless of whether anything changed — SCORM Cloud's postback is fire-and-forget on their side; there's nothing useful to reject it with.

### 6.3 Reconciliation poll (backstop, not primary)

A periodic sweep, same shape as the existing engagement-reminder cron (`src/engagement/engagement.controller.ts` + `cron-secret.guard.ts`): find `ScormRegistration` rows with no terminal status and `lastPostbackAt`/`firstLaunchAt` older than some threshold, call `getRegistrationResult` for each, and run the same idempotent update path as §6.2. This exists because SCORM Cloud's own docs say postbacks are reliable but the integration "cannot rely on the learner making it back to `redirecturl`" — the poll is insurance against a lost postback, not the primary channel.

### Acceptance criteria

- [ ] A full playthrough of the lifting package through the real endpoints: launch redirects to a real SCORM Cloud link, playing it to completion results in a postback that lands on `/scorm/postback`, and `ScormRegistration.completionStatus` becomes `completed`.
- [ ] Sending the same postback payload twice does not create a duplicate `UserCourseProgress` row or send a duplicate certificate email.
- [ ] `testRegistrationPostUrl`'s dummy payload is accepted by the real endpoint (not just the Phase 1 stub).
- [ ] The reconciliation poll, run against a registration whose postback was deliberately not sent, catches it up within its cadence.
- [ ] A launch attempted with an expired (~15+ minute old) link fails the way SCORM Cloud fails it, not silently.

---

## 7. Phase 4 — Completion bridge

**Depends on:** Phase 3.

Per **D1** (resolved) this is simpler than the build-path plan's version: there is no branch. The bridge, triggered from the postback handler on a status transition that satisfies `completeOn`:

1. Create `UserCourseProgress` for the synthetic section, only if absent.
2. `checkContentCompletion` (existing, unmodified) — for an imported course with `sectionCount = 1`, this ticks `courseCompletedAt` as soon as this one row exists, and (per D1) that **is** the certificate trigger — no separate native `Assessment` gate to wire up.
3. `recordChapterAndModuleCompletionIfNeeded` (existing, unmodified).

### 7.1 Zero-section guard, restated

`_isCourseContentCompleted` returns **true** when `totalSections === 0` ([course-assessment.service.ts:1476](../src/course-assessment/course-assessment.service.ts#L1476)); `checkContentCompletion` returns early on 0 ([:74](../src/course-completion/course-completion.service.ts#L74)). Under the new direct-certify rule this is a sharper edge than in the build-path plan: a half-finished `IMPORTED_SCORM` course left active with zero sections would certify **every enrolled learner immediately** on their first postback, with no exam standing in the way at all. §5.5's guard (block `isActive: true` at zero sections) is the mitigation — treat it as load-bearing, not a nice-to-have, given this change.

### Acceptance criteria

- [ ] A learner who completes the lifting package's content (via the real Phase 3 endpoints) sees their course marked content-complete and — since there's no native-Assessment branch — the certificate path fires the same way it would for a native zero-quiz course.
- [ ] A learner past their `validityDays` expiry window cannot launch (blocked at `_assertEnrollmentUsable`, §6.1 step 2) and therefore cannot accrue progress via a stray postback either.

---

## 8. Phase 5 — Platform edges

**Depends on:** Phase 4.

### 8.1 Engagement reminders

Add a sixth `UNION ALL` arm to `ACTIVITY_CTE` (`src/engagement/engagement.service.ts`, currently five arms, lines ~158-185) over `ScormRegistration`:

```sql
UNION ALL
SELECT sr."userId", sr."courseId", MAX(GREATEST(sr."lastPostbackAt", sr."firstLaunchAt")) AS last_at
  FROM "scorm_registrations" sr
 GROUP BY sr."userId", sr."courseId"
```

Without this, a learner actively progressing through SCORM Cloud is "never started" (the rollup has no row for them) and `findStalled`'s progress personalization reads "0 of 1 sections." Recommend omitting the section-count line entirely for imported courses in the STALLED template rather than trying to make it meaningful.

### 8.2 `LastSeenSection`

Already wired into the launch endpoint (§6.1 step 6) as a **direct upsert**, not via the existing `updateLastSeenSection` helper (`course.service.ts:6270`) — that helper's unique constraint is `@@unique([userId, chapterId])`, not per-section, and it also runs `assertChapterAccessible` internally, a sequencing gate that has no meaningful definition against a synthetic one-chapter tree.

### 8.3 GDPR force-purge

`src/user/user.service.ts`'s hand-maintained `deleteMany` list (starting at line 821, 18 calls as of this writing) needs:

```ts
this.prisma.scormRegistration.deleteMany({ where: { userId: id } }),
```

**New in rev 3**: also call SCORM Cloud's `deleteRegistration` API for each of that user's registrations, so the third party doesn't retain the learner's data after a purge either. **Ordering, made explicit after round-2 review found the original phrasing left a real gap, then tightened again in round 3 after finding a live race in that fix**: the whole purge already runs as one `prisma.$transaction([...])` array ([user.service.ts:811-846](../src/user/user.service.ts#L811-L846)) — a plain array of Prisma operations, which cannot itself contain an HTTP call. So the sequence is:

1. `findMany` this user's `ScormRegistration` rows and capture each `scormCloudRegistrationId` (plus `userId`/`packageId` for context). Log via the existing `UserService.logger` (`Logger(UserService.name)`, already used in this exact class for the same "best-effort external side-effect failed, warn and continue" shape at `user.service.ts:909`) — there's no ambiguity to resolve here, no Queue/BullModule infrastructure exists in this codebase to route this through instead.
2. Call `deleteRegistration` for each one. **Do not let a failure block the rest of the purge** — catch it, log the captured id from step 1, continue.
3. **Re-run step 1's `findMany` immediately before building the transaction**, and repeat step 2 for any row that wasn't in the first pass. **Why this second pass is not optional (round-3 finding):** `purgeUser` never deactivates or locks the target user before running — no JWT strategy checks `deletedAt` or any "purge in progress" state, and `_assertEnrollmentUsable` (the gate this plan's own `/scorm/launch` uses) checks only `UserCourse.isActive`/`validityDays`, nothing about deletion. So a user with a still-valid session token can call `/scorm/launch` and get a **brand-new** `ScormRegistration` at any point during step 2's real, sequential, wall-clock-taking HTTP calls — a row step 1's original capture never saw. Step 3's local `deleteMany` is a live query and would delete that row anyway, silently taking its `scormCloudRegistrationId` down with it, with no record left to ever clean it up on SCORM Cloud's side.
4. Only then run the existing `$transaction([...])` that deletes the local rows (adding `scormRegistration.deleteMany` to it).

This narrows the race to "a launch lands in the gap between step 3's re-check and step 4's commit" — negligible in practice (that gap is one more `findMany` plus transaction setup, not N HTTP calls) but not literally zero. Closing it completely would mean locking the account against new launches before starting the purge at all, which is a broader auth-layer change outside this document's scope — recorded here as a known, accepted residual risk, not silently assumed away.

### Acceptance criteria

- [ ] A learner actively committing SCORM Cloud progress does not receive a NEVER_STARTED email.
- [ ] `LastSeenSection` is populated after a SCORM Cloud launch.
- [ ] A hard-deleted user's `ScormRegistration` rows are gone, and a corresponding `deleteRegistration` call was made to SCORM Cloud (verify via their API or account dashboard in testing).

---

## 9. Phase 6 — Admin/report surface

**Depends on:** Phase 5.

- [ ] Package status/probe panel on the admin course screen: `ScormPackageStatus`, `riseProbeJson` (reporting mode, quiz item count, pass mark) — so an admin uploading a package with an empty quiz sees it before publishing, not after.
- [ ] "Replace package" flow surfaces the `wouldRegress` migration count before the admin confirms.
- [ ] Learner/admin report: **status + score** (`Not started / In progress / Completed`, plus `scoreRaw` when present) — not a percentage bar (architecture §8.6: `sectionCount = 1` makes a percentage meaningless).
- [ ] Extend the PDF report with an imported-course variant: no per-chapter timing breakdown, instead launch/last-activity timestamps, total time (straight from SCORM Cloud's own reporting, no accumulation logic of our own needed), and score if present. **Not executable from this repository (round-3 finding):** the generator (`PDFReport.tsx`, per `docs/frontend-progress-display-guide.md`) lives in the Next.js frontend, not this NestJS backend — this box gets checked in a different repo, by the frontend team; this backend's job is only to make sure the launch/activity/score fields this bullet needs are actually present on the report API response (Phase 5/§9's own report endpoint) for them to consume.
- [ ] Confirm with the frontend team, in writing, that a progress percentage bar is not applicable to imported courses before they build one that will always read 0% or 100%.

### Acceptance criteria

- [ ] Admin can see, before publishing, exactly what an uploaded package will and won't report.
- [ ] A completed imported-course learner's PDF report renders without error and does not show a fabricated percentage.

---

## 10. Testing plan

| Test | File | Covers |
|---|---|---|
| Rise probe fixtures | `src/utils/rise-probe.spec.ts` | Trimmed copies of both real `runtime-data.js` payloads (lifting: empty quiz; fire-safety: 25-question quiz, `passingScore: 80`) |
| Postback idempotency | `src/scorm/scorm-runtime.service.spec.ts` | Same postback sent twice → no duplicate `UserCourseProgress`, no duplicate certificate email |
| Postback status monotonicity | `src/scorm/scorm-runtime.service.spec.ts` | An out-of-order or regressive postback (e.g. `completed` arriving after `passed`) never regresses the stored status |
| Postback auth | `src/scorm/scorm-postback.guard.spec.ts` | Request without valid Basic Auth is rejected; guard fails closed if the shared secret is unset |
| SCORM Cloud's own postback test tool | manual, Phase 1 stub then the real endpoint | `testRegistrationPostUrl`/`TestRegistrationPostback` payload accepted end to end |
| Reconciliation poll | `src/scorm/scorm-runtime.service.spec.ts` | A registration with no postback, past the threshold, gets caught up by the poll |
| Zero-section guard | `src/course/course.service.spec.ts` (extend existing) | `updateCourse` refuses `isActive: true` on an `IMPORTED_SCORM` course with no live SCORM section |
| Negative import fixtures | `src/scorm/scorm.service.spec.ts` | A non-zip file, a package SCORM Cloud itself rejects (confirm we surface its reason), a zero-quiz package requesting `completeOn: "passed"` |
| Real playthrough — lifting | manual, full course, before Phase 4 sign-off | Reaches `completed`, `successStatus` stays `unknown`, no score ever appears |
| Real playthrough — fire safety | manual, **once a real SCORM export exists** (D-fire-safety) | Score arrives, pass→fail→pass sequence doesn't corrupt state, status never regresses |
| Engagement false-positive | `src/engagement/engagement.service.spec.ts` (extend existing) | Active SCORM Cloud learner not flagged NEVER_STARTED |
| GDPR purge | manual/integration | `scormRegistration.deleteMany` and SCORM Cloud's `deleteRegistration` both fire on hard delete |

---

## 11. Rollout & rollback

- Every migration in §5.1 is additive; `deliveryMode` defaults to `NATIVE`. Existing native courses are unaffected by every phase of this plan.
- Nothing in the catalogue is `IMPORTED_SCORM` until an admin explicitly creates one — ships dormant, exercised first on a single test course.
- Rollback: stop admins from creating new `IMPORTED_SCORM` courses (don't ship the admin UI for it, or a config flag) — no data-migration undo needed, since nothing native depends on the new tables.
- The one irreversible-in-practice step is the `<TS_2>` SectionType enum addition (Postgres can't drop an enum value without recreating the type) — normal for this codebase (same as `EMBED`/`FLASHCARDS`), not a special risk.

---

## 12. Risk register (build-specific, beyond architecture §10's security table)

| Risk | Mitigation |
|---|---|
| SCORM Cloud API shape assumed, not yet confirmed (D-api-version) | Phase 1 exists specifically to confirm it before Phase 2 is built against assumptions |
| Postback lost entirely (network blip, SCORM Cloud-side issue) | Reconciliation poll (§6.3) — not "rely on the learner returning to `redirecturl`," per SCORM Cloud's own explicit warning |
| Postback replay / duplicate delivery | Idempotent, monotonic update (§6.2) |
| Admin publishes a package whose empty quiz is discovered only after learners are enrolled | The probe + publish-time block (§5.3) is the primary mitigation; the status panel (Phase 6) is the secondary one |
| Vendor outage | Imported-course launches fail; native courses unaffected (no shared infrastructure) |
| GDPR purge forgets the third party | `deleteRegistration` call added alongside our own `deleteMany` (§8.3) — treat as part of the same PR, not a follow-up |

---

## 13. Review log

This rewrite has not yet been run through the independent no-context review loop the build-path version went through six times. Given the reduced surface area (no runtime concurrency mechanism to get subtly wrong — that was where five of the six build-path rounds found real bugs), a smaller number of rounds should suffice, but **do not skip the loop entirely** — the postback idempotency/monotonicity logic (§6.2) and the migration forward-reference ordering (§5.1) are exactly the kind of thing that looked obviously-correct on the first pass of the previous design too.

### Round 1

Confirmed the prediction in this section's own opening paragraph: the postback logic looked obviously correct on first pass and wasn't. 9 findings, all fixed:

- **BLOCKING:** §6.2's "never move `completionStatus`/`successStatus` backward once a terminal status is recorded" never defined an order between `passed` and `failed` — read literally, it would refuse a `failed → passed` postback exactly as readily as a `passed → failed` one, silently blocking the ordinary retry-then-pass outcome this whole design exists to support (the fire-safety quiz's `retryCount: -1`). Fixed by giving each field an explicit rank order (`unknown < incomplete < completed` for completion; `unknown < failed < passed` for success, with `passed` one-way-absorbing) and stating the write rule as "only write if the new rank is strictly greater than stored."
- **SIGNIFICANT:** the deferred `resetRegistration`/full-course-restart feature (D-retry) has two real costs the plan hadn't named: the `@@unique([userId, packageId])` constraint leaves no schema room for a second attempt without a migration, and calling `resetRegistration` later would itself produce a status *downgrade* that the newly-fixed monotonic rule would (correctly, everywhere else) refuse to persist — a future reset feature needs its own bypass, not just a schema change. Fixed — both costs now stated on the D-retry row instead of a bare "not in v1."
- **SIGNIFICANT:** `Chapter.pdfFile` is required NOT NULL and actively read elsewhere in the codebase, but only `Course`'s required fields were flagged as a synthetic-tree gotcha, not `Chapter`'s. Fixed in both documents.
- **SIGNIFICANT:** two internal cross-references to "§11.3" in the architecture doc pointed at a subsection that doesn't exist (§11 has no numbered subsections). Fixed — repointed at §10's actual security-table row.
- **SIGNIFICANT:** two citations of "the execution plan's §14 review log" pointed at the wrong section number (the review log is §13). Fixed in both places, and the architecture doc's own restatement of the monotonicity rule was updated to match the round's actual fix rather than repeating the same underspecified "forward, never backward" phrasing.
- **SIGNIFICANT:** `prisma/schema.prisma:515` was cited as containing "Content is always read from the live tree" — that comment is actually on line 517; line 515 is an unrelated field. Fixed to the correct range in both citations.
- **MINOR:** the "six independent review rounds" claim (this section's own opening) isn't verifiable from the repository alone — this file was rewritten in place, not appended to, so there's no separate discoverable log of that history. It happened, but reworded to say so honestly rather than implying a reader could go find a standalone artifact confirming it.
- **MINOR:** `SCORM_CLOUD_API_BASE`'s value was stated as a plain default alongside other env vars, without the same "confirm in Phase 1" hedge the surrounding D-api-version discussion applies to everything else about SCORM Cloud's exact API shape. Fixed with an inline note.
- **MINOR:** the architecture doc's fields-we-read table cited `resultsformat=full` as a specific, confirmed SCORM Cloud query parameter, again without the hedge the rest of that section applies. Fixed to describe it generically pending Phase 1 confirmation.

Confirmed clean by the same round: no forward-reference errors in the four migrations (traced every relation field across all four in order — the exact bug class that took multiple rounds to fix in the predecessor design does not recur here), and every other file/line citation checked (a substantial list — see the round's own "what checked out clean" summary) matched the repository exactly.

### Round 2

Stress-tested round 1's monotonicity fix again (it held — the `unknown` edge case and the completion/success independence both check out correctly) and swept sections round 1 hadn't touched. 2 findings, both fixed:

- **SIGNIFICANT:** round 1 fixed the `Chapter.pdfFile` required-NOT-NULL gotcha but missed that `Module.description`, `Chapter.description`, and `Section.description` are the exact same shape — required, no default, actively read by the same pinned-curriculum resolver — and none of the docs' synthetic-tree instructions mentioned supplying them. Fixed in both documents, alongside a note that at least one existing DTO enforces `description` more strictly than `pdfFile` today, so this isn't a case where existing validation would have caught the omission.
- **SIGNIFICANT:** the GDPR purge instruction said to call SCORM Cloud's `deleteRegistration` "before the DB delete" and "log it for manual follow-up if it fails" — correct in spirit, but never said the log has to capture `scormCloudRegistrationId` *before* the local transaction commits. Since the whole purge runs as one `prisma.$transaction([...])` array and that id lives nowhere but the row being deleted, a failure logged after (or without) that id is unrecoverable — the exact silent, permanent compliance gap this rev-3 addition exists to prevent. Fixed with an explicit three-step ordering: capture ids first, attempt the external deletes with the captured ids in any failure log, only then run the local transaction.

Everything else the round stress-tested — the monotonicity rule's `unknown`-after-`failed` edge case, `completionStatus`/`successStatus` independence, the round-1 citation fixes themselves (schema.prisma:515-517, the §10 security-table row, all §13 references), the registration resolve-key against the schema's actual `@@unique`, and every zero-section-guard line citation — checked out clean.

### Round 3

5 findings, all fixed. Two are worth flagging as a pattern, not just individually:

- **SIGNIFICANT:** the required-NOT-NULL-field audit — `pdfFile` (round 1), then `description`×3 (round 2) — still wasn't complete: `Section.title` is the same shape and was missed by both prior rounds. Fixed, with the list now stated as five fields and an explicit instruction to re-verify against `prisma/schema.prisma` directly rather than trust this document's own list is exhaustive, since it's been wrong twice already.
- **SIGNIFICANT:** round 2's GDPR-purge fix (capture ids → external deletes → local transaction) closes the *ordering* gap but not a genuine *race*: nothing in this codebase deactivates a user before `purgeUser` runs, so a still-valid session can call `/scorm/launch` and create a brand-new registration during step 2's real, sequential HTTP calls — a row the original capture never saw, silently deleted alongside everything else in the final transaction with no record left to clean it up externally. Fixed by adding a second capture-and-retry pass immediately before the transaction, narrowing the race to a much smaller window; a fully airtight fix would require locking the account against new launches before the purge starts, which is out of this document's scope and is recorded as an explicit, accepted residual risk rather than silently assumed away.
- **MINOR:** the GDPR-purge log-mechanism note offered three hypothetical options ("a log line, an error-tracking event, or a dedicated table") when the codebase already answers this unambiguously in the same file — `UserService`'s own `Logger` instance, already used for this exact "best-effort external call failed, warn and continue" pattern. Fixed to point at it directly.
- **SIGNIFICANT:** Phase 6's PDF-report task is work in a different repository (the Next.js frontend) entirely, not this NestJS backend — unlike the very next bullet, it carried no cross-team caveat, so a reader could reasonably start looking for `PDFReport.tsx` in the wrong codebase. Fixed with the same kind of caveat the adjacent bullet already has, and narrowed this backend's actual scope to making the right fields available on the report API.
- **MINOR:** the architecture doc's aside about postback configuration scope ("per-registration, or per-course, or app-wide") invented two configuration levels that don't exist in SCORM Cloud's actual docs (verified live: per-registration, per-invitation, or per-dispatch — no per-course, no app-wide fallback). Fixed to match what's actually documented; not load-bearing, since Phase 3's real implementation only ever commits to the confirmed per-registration mechanism.

Two rounds in a row (2 and 3) found an incomplete required-field list after the previous round believed it was complete — a real pattern, not noise. Recorded so a future implementer doesn't stop checking after five fields either.

*(Further rounds appended here as the loop continues.)*
