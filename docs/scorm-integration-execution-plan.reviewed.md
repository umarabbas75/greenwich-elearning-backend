# SCORM integration — execution plan (reviewed clone)

**Status:** Clone of [scorm-integration-execution-plan.md](./scorm-integration-execution-plan.md). Independent review loop finished (2026-08-30, 6 zero-context passes on the Cloud plan / this clone). **Execute from this file.** D1/D2 remain: **D2 — buy** (SCORM Cloud); **D1 — imported courses certify off Cloud completion** (`CourseCompletion.isPassed`). Review history is §13.
**Builds on:** [scorm-imported-courses-architecture.md](./scorm-imported-courses-architecture.md) rev 3 (the *why*). This document is the *how*.

---

## 0. Changelog — what the D1/D2 decisions removed

The previous version of this plan (build-our-own-runtime) went through six independent, no-context review rounds earlier in this project's development, before the D1/D2 decisions arrived — that review history lives in this session's own record rather than as a separate artifact in the repo (this file was rewritten in place, not appended to), so treat the *facts* it surfaced as carried forward and re-stated here, not as something to go looking for a standalone log of. Worth knowing it happened, because some of what it found is still relevant even though the mechanism it was reviewing is gone:

- Rounds 1–2 found real gaps in reusing this codebase's existing patterns (`_assertEnrollmentUsable` isn't actually on the native progress path; the GDPR purge list is a hand-maintained 18-call list, not ~27; migration forward-references break `prisma migrate dev` if a relation field is added before its target model exists). **These facts are still true and still apply** — carried into this rewrite.
- Rounds 2–6 spent most of their effort on a `commitSeq`/`sessionId` concurrency mechanism for persisting SCORM 1.2 runtime state ourselves — a hard problem that took four rewrites to get right. **That entire mechanism is gone.** SCORM Cloud owns concurrent-session correctness against its own SCORM RTE; we only ever receive a finished, already-reconciled status via postback. If D2 is ever revisited back toward "build," that review history (preserved in git) is the place to restart from, not from scratch.

This rewrite carries forward everything that was true independent of build-vs-buy (the synthetic tree, the publish-time empty-tree guard, the GDPR purge list, the engagement CTE fix, the title-escaping note) and replaces everything that was specific to hosting our own player and RTE.

**How to read this clone:** execute from this file, not [scorm-integration-execution-plan.md](./scorm-integration-execution-plan.md). §13 Rounds 1–3 are the original Cloud-plan reviews (kept for history). **Round 4 is a separate zero-context review of that original against the live repo** (2026-08-30 clone loop). Later rounds in this clone are further zero-context passes on *this* file.

---

## 1. Decisions

D1 and D2 are resolved. Remaining, from architecture doc §16 — flags, none blocking:

| ID | Question | Default | Affects |
|---|---|---|---|
| D7 | How the **frontend** opens SCORM Cloud's player after our API returns a launch link | **`window.location = launchLink` immediately** (full-page navigation to Cloud). Not an API 302, not an iframe, unless Phase 1 proves iframe-on-iOS is required. The frontend owns this navigation; our API never redirects the browser. | Phase 3 |
| D-retry | Expose SCORM Cloud's `resetRegistration` ("try the whole course again," as opposed to retrying just the embedded quiz, which already works inside one registration) or not | **Not in v1**, and the deferral has two real costs worth knowing now (round-1 review finding), not just a "later" flag: (1) `@@unique([userId, packageId])` on `ScormRegistration` means there is no schema-level room for a second attempt — revisiting this needs a migration, not just a new API call; (2) if `resetRegistration` is ever wired up, calling it will make SCORM Cloud report a *downgrade* (`completed`/`passed` → `incomplete`/`unknown`) on the same registration, which §6.2's monotonic postback rule would — correctly, for every other case — refuse to persist. A future reset feature needs its own explicit bypass of that rule (e.g. a distinct "reset" write path, not a postback), not just a schema change | Phase 3 |
| D-upload-role | Who may upload packages — all admins or a content role | All admins for v1 | Phase 2 |
| D-api-version | Confirm SCORM Cloud **V2** operation names and payloads against live OpenAPI | Phase 1 logs the live job-status enum. Until then: treat `COMPLETE` **and** `COMPLETED` as success; `ERROR`/`error` as failure; `RUNNING`/`running` as in-flight. Do **not** wait for LMS Integration's `finished`. `BuildRegistrationLaunchLink.expiry` = **10–300s, default 120**. `ScoreSchema` has only `scaled` (0–100). `mayCreateNewVersion=false`. Postback: `authType: "HTTPBASIC"`, `userName`. | Phase 1, Phase 2 |
| D-reset-unassign | What happens on admin **reset progress** / **unassign** for an imported course | **Refuse all unassign and reset** for `IMPORTED_SCORM` in v1 (not only force-unassign). `probeUserCourseResidualState` (`:170`) does not count `ScormRegistration`. A launch that created a Cloud registration but failed `LastSeenSection` looks “clean” and **non-force unassign succeeds**, leaving Cloud state behind. GDPR purge (§8.3) is the only v1 path that deletes Cloud registrations. | Phase 3, Phase 5 |
| D-fire-safety | The repo's fire-safety folder is a `raw`/HTML5 export, not a SCORM package (no manifest, no SCO) | Request a real SCORM re-export from the client before any playthrough test needs a real scoreable quiz; use it as a `runtime-data.js` probe-data fixture only until then | Phase 1, Phase 6 testing |
| D-zip-path | How the zip reaches SCORM Cloud | **Must not proxy the zip through this Nest app on Vercel.** v1: frontend uploads the zip to **durable public object storage Cloud can GET** (Cloudinary **raw** upload, R2, or S3 — this backend has **no** zip helper; image Cloudinary URLs in mail templates do not count). Admin `POST /scorm/packages` with that HTTPS URL. This API maps it to Cloud `CreateFetchAndImportCourseJob` body **`{ url }`** (not `contentUrl`) and stores **`response.result`** as `cloudImportJobId` (`StringResultSchema`). Not a short-lived signed URL. Import job ids expire **one week** after the job finishes — complete-import must run inside that window. Forbidden: zip body on this API. | Phase 1, Phase 2 |

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

   # Public origin of THIS API (scheme + host, no trailing slash). Postback URL
   # registered with Cloud is ${PUBLIC_APP_URL}/api/v1/scorm/postback — the
   # /api/v1 prefix is set in app.setup.ts (`setGlobalPrefix('api/v1')`) and
   # omitting it is a silent 404.
   PUBLIC_APP_URL=
   # Learner-facing origin (scheme + host). BuildRegistrationLaunchLink
   # redirectOnExitUrl goes HERE (course player page), not PUBLIC_APP_URL.
   # Empty redirectOnExitUrl makes Cloud send the learner to scorm.com.
   PUBLIC_FRONTEND_URL=
   ```
4. [ ] Confirm billing is on the client's own account (consistent with how recurring hosting costs were handled in the earlier invoicing conversation), not ours.
5. [ ] Confirm a DPA is in place with Rustici Software before any real learner data reaches SCORM Cloud (legal/commercial task — flagged here so it isn't missed, not solved by engineering).
6. [ ] In the Cloud app, **enable application delete operations** (disabled by default — required for `DeleteAllLearnerData`). Add:
   ```
   SCORM_CLOUD_OWNER_EMAIL=
   ```
   GDPR purge calls `DELETE /learner/{learnerId}/delete-information?userEmail={SCORM_CLOUD_OWNER_EMAIL}` ([PII/GDPR](https://cloud.scorm.com/docs/v2/guides/pii_deletion/)). The call is **async**; do not wait for Cloud to finish before the local transaction.
7. [ ] At `CreateRegistration`, set shorthand `postBack` to `{ url, authType: "HTTPBASIC", userName, password, resultsFormat: "COURSE" }` ([Postback Guide](https://cloud.scorm.com/docs/v2/guides/postback/) — JSON keys are `userName` not `user`; enum is `FORM` \| `HTTPBASIC`). Config-system default `ApiRollupRegistrationAuthType` is **form**. If we send `user` + `"httpbasic"`, Cloud either 400s or form-posts, and `ScormPostbackGuard` looking for `Authorization: Basic` 401s every real postback.

**Acceptance criteria:** `GET ${SCORM_CLOUD_API_BASE}/ping` (V2 ping) succeeds with App ID/Secret; `SCORM_POSTBACK_AUTH_USER`/`PASSWORD` and `PUBLIC_APP_URL` confirmed set in every environment (local, preview, production).

---

## 3. Master checklist

- [ ] §1 D-api-version confirmed against SCORM Cloud's live API reference
- [ ] §2 provisioning complete
- [ ] Phase 1 — Spike proven on the lifting package (the only real playable SCORM sample in this repo); D-api-version **and** D-zip-path confirmed
- [ ] Phase 2 — Import pipeline (migrations, fetch-from-URL + import-status **and** import-job cron, Prisma synthetic tree, first-import `publishNewVersion`, `setCourseActive` guard)
- [ ] Phase 3 — `POST /scorm/launch` JSON `{ launchLink }` + postback that 5xxs on persist/certify failure + `vercel.json` reconcile **and** import-job crons
- [ ] Phase 4 — Completion bridge (re-checks enrolment; uses `CourseCompletionModule`)
- [ ] Phase 5 — Platform edges (engagement STALLED arm, `LastSeenSection`, GDPR purge, refuse reset/unassign)
- [ ] Phase 6 — Admin/report surface
- [ ] §10 Testing plan fully executed
- [ ] §11 Rollout confirmed reversible

---

## 4. Phase 1 — Spike

**Goal:** prove SCORM Cloud's actual API shape and postback mechanism against a real package, before writing any of our own code.

**Depends on:** §2 provisioning.

### Tasks

1. [ ] Manually import the **lifting** package (`occupational-health-amp-safety-safe-lifting-and-rigging-operations-level-3-awar-scorm12-1zKdvoHT/`) via SCORM Cloud's own dashboard first — the fastest way to confirm it's accepted as a valid SCORM package, independent of our API integration.
2. [ ] Repeat via the API: `CreateFetchAndImportCourseJob` with `{ url }` (our DTO may still call the field `contentUrl`). Persist **`response.result`** as `cloudImportJobId`. Poll until `COMPLETE`/`ERROR`. Always `mayCreateNewVersion=false`. Do not wait inside one 60s invocation. Complete-import within **one week** of job finish (Cloud drops the job id).
3. [ ] `CreateRegistration` (**we supply `registrationId` and `learnerId`**). `postBack` as §2. `BuildRegistrationLaunchLink` with `redirectOnExitUrl` = `${PUBLIC_FRONTEND_URL}/…` and **`expiry` in 10–300 seconds (use 120 unless Phase 1 needs otherwise)**. Do not pass 28800 or 43200 — OpenAPI will 400. Config `LaunchAuthExpiry` 28800 is content-availability after launch, not unused-link TTL.
4. [ ] Confirm Cloud reports `registrationCompletion: "COMPLETED"` and `registrationSuccess: "UNKNOWN"` (lifting has no scoreable quiz) via **`GetRegistrationProgress`**. Payload fields are `id`, `registrationCompletion` (`UNKNOWN`\|`INCOMPLETE`\|`COMPLETED`), `registrationSuccess` (`UNKNOWN`\|`PASSED`\|`FAILED`), `score.scaled`, `totalSecondsTracked` — not `completionStatus` / `successStatus`. Map into our columns (§6.2).
5. [ ] Configure per-registration `postBack` at a tunnel. Confirm a **real** (queued) postback arrives — do this before building our receiver.
6. [ ] `TestRegistrationPostback` against the stub: **payload shape and auth only**. Test postbacks **do not use the retry queue** ([Retries and Error Handling](https://cloud.scorm.com/docs/v2/guides/postback/)). Confirm retries with a real registration postback that returns 5xx. Cloud treats **3xx as success and does not follow POST redirects** — `PUBLIC_APP_URL` must be HTTPS with **no** HTTP→HTTPS redirect on the postback path.
7. [ ] Measure unused launch-link TTL; confirm whether a used link can be replayed.
8. [ ] Time-box: if import or registration creation don't work cleanly against the lifting package within **2 working days**, stop and re-open **D2** with real friction data.

### Acceptance criteria

- [ ] The lifting package imports via the real API call (not just the dashboard), and D-api-version's exact endpoint/payload shape is documented here for Phase 2 to build against.
- [ ] Direct-upload path confirmed (OAuth-to-Cloud or fetch-from-URL); a zip larger than 4.5 MB never enters our Vercel function.
- [ ] A registration plays to `registrationCompletion: COMPLETED` and a **queued** postback is received, authenticated as HTTP Basic.
- [ ] `TestRegistrationPostback` confirmed for payload/auth only; retry behaviour confirmed on a real postback + 5xx.
- [ ] Unused launch-link TTL measured. `expiry` vs `LaunchAuthExpiry` vs vault `launchAuth.options.expiry` distinguished.

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
     scormCloudCourseId String             // the UUID *we* supplied to Cloud as courseId
     cloudImportJobId   String?            // GetImportJobStatus id while PROCESSING
     zipSha256          String?            // optional audit; zip never reaches this app — client hash is untrusted
     riseProbeJson      Json?              // best-effort Rise probe — see §5.3
     status             ScormPackageStatus @default(PROCESSING)
     failureReason      String?
     createdAt          DateTime           @default(now())

     course Course @relation(fields: [courseId], references: [id], onDelete: Cascade)

     @@unique([courseId, versionNumber])
     @@index([courseId, status])
     @@map("scorm_packages")
   }
   ```
   Also add `scormPackages ScormPackage[]` to `Course` **in this same migration**. **`onDelete: Cascade` on this FK only stops P2003 from `scorm_packages` itself.** `deleteCourse` (`course.service.ts:3933`) is still a bare `prisma.course.delete`. `UserCourse`, `UserCourseProgress`, `LastSeenSection`, `CourseCompletion` have **no** `onDelete: Cascade` from `Course`. Do **not** claim Cascade makes imported courses deletable. v1: refuse `deleteCourse` for `IMPORTED_SCORM` (or accept the same P2003 as a native course with progress). Also call Cloud `DeleteCourse` only if we add an explicit admin "destroy imported course" later — out of v1.

4. `<TS_4>_add_scorm_registration`
   ```prisma
   model ScormRegistration {
     id                       String    @id @default(uuid())
     userId                   String
     courseId                 String    // denormalised for the report index
     packageId                String    // AUTHORITATIVE for launch — never re-resolve from live Section.config
     sectionId                String
     completeOn               String    // copied from Section.config at create — never re-read live tree
     scormCloudRegistrationId String    @unique
     completionStatus         String    @default("unknown") // mapped from registrationCompletion
     successStatus            String    @default("unknown") // mapped from registrationSuccess
     scoreScaled              Float?    // Cloud ScoreSchema.scaled is 0–100; scoreRaw unused at course level
     totalTimeSeconds         Float?    // Cloud totalSecondsTracked is a float
     firstLaunchAt            DateTime?
     lastPostbackAt           DateTime?
     completedAt              DateTime?
     createdAt                DateTime  @default(now())
     updatedAt                DateTime  @updatedAt

     user    User         @relation(fields: [userId], references: [id], onDelete: Cascade)
     package ScormPackage @relation(fields: [packageId], references: [id], onDelete: Cascade)

     @@unique([userId, packageId])
     @@index([courseId, completionStatus])
     @@index([userId, courseId])
     @@map("scorm_registrations")
   }
   ```
   Also add, **in this same migration**: `scormRegistrations ScormRegistration[]` to `User` (load-bearing — see §5.6's GDPR note) and `registrations ScormRegistration[]` to `ScormPackage`. `scormCloudRegistrationId` is unique because the postback resolver looks up on it alone. We *supply* this id to Cloud at `CreateRegistration` (our row's `id` is the natural choice) so the two stay aligned.

Run `yarn prisma migrate dev` after each file individually, not all four at once.

### 5.2 New modules — keep them leaves (no `CourseService` import)

This repo has **zero `forwardRef` usages**. `CourseService` is ~6.4k lines and `CourseModule` already exports it; pulling it into `ScormModule` (and then `UserModule` for GDPR) is how you get a cycle. Follow `CourseCompletionModule`'s pattern (commented in `course-completion.module.ts`: shared leaf, imported by both Course and Quiz).

**Leaf 1 — Cloud HTTP only**

- `src/scorm-cloud/scorm-cloud.module.ts` — imports `PrismaModule` + `ConfigModule` only; exports `ScormCloudClient`.
- `src/scorm-cloud/scorm-cloud.client.ts` — V2 wrappers: `CreateFetchAndImportCourseJob` (v1 default), `GetImportJobStatus`, `GetCourseAsset`, `CreateRegistration`, `BuildRegistrationLaunchLink` (`redirectOnExitUrl` from `PUBLIC_FRONTEND_URL`, `expiry` 10–300 default 120), `GetRegistrationProgress`, `TestRegistrationPostback`, `DeleteRegistration`. Always pass `mayCreateNewVersion: false` on import. Optional: mint short-lived `write:course` OAuth **only if** Phase 1 proves CORS (D-zip-path). No Nest controllers.

`UserModule` imports this leaf for GDPR `deleteRegistration`. `ScormModule` imports it for everything else. Neither imports the other.

**Leaf 2 — enrolment gate extracted out of `CourseService`**

- `src/utils/assert-enrollment-usable.ts` — move the body of private `_assertEnrollmentUsable` (`course.service.ts:6037`) here. Signature keeps `(prisma, userId, courseId, userRole: Role)`. **Callers must pass `Role.user` for learners** — the helper only enforces `UserCourse.isActive` / `validityDays` when `userRole === Role.user`. `CourseService._assertEnrollmentUsable` becomes a one-line wrapper so existing form paths don't change.

**`src/scorm/` (feature module)**

- `src/scorm/scorm.module.ts` — imports `ScormCloudModule`, `CourseCompletionModule`, `CourseVersionModule`, `PrismaModule`. **Does not import `CourseModule` or `UserModule`.** Provide `JwtUserStrategy` / `JwtAdminStrategy` the same way `course.module.ts` / `quiz.module.ts` do.
- `src/scorm/scorm.controller.ts` — admin package endpoints; `AuthGuard('jwt')` (admin strategy — same as `PATCH /courses/admin/:id/active`).
- `src/scorm/scorm-launch.controller.ts` — `POST /scorm/launch`, `AuthGuard('uJwt')`, **`@HttpCode(200)`** (Nest POST defaults to 201). Postback on a controller with `ScormPostbackGuard`, **no JWT**, **`@HttpCode(200)`** (Cloud treats any non-4xx/5xx as success, so 201 would not retry, but our contract is 200).
- `src/scorm/scorm-reconcile.controller.ts` — `GET /internal/cron/scorm-reconcile` + optional POST alias, `CronSecretGuard`, `@HttpCode(200)`, same shape as `engagement.controller.ts` (Vercel Cron is **GET**). **`CronSecretGuard` is not exported from `EngagementModule`** (`engagement.module.ts` providers include it, exports only `EngagementService`). Provide the same class in `ScormModule` (or extract it to `src/common/cron-secret.guard.ts` and provide from both). Do **not** import `EngagementModule` just for the guard.
- `src/scorm/scorm.service.ts` — package metadata, **non-blocking** import-job tracking, synthetic tree via Prisma, first-import + replace `publishNewVersion(adminId, courseId, changeNotes?)`.
- `src/scorm/scorm-runtime.service.ts` — launch, postback, reconcile.
- `src/scorm/scorm-postback.guard.ts` — HTTP Basic against `SCORM_POSTBACK_AUTH_USER`/`PASSWORD`, fail closed if unset. Compare with `crypto.timingSafeEqual` **and** the length-check pattern in `auth.service.ts:58-62`.
- `src/scorm/dto.ts` — dedicated DTO file for **admin/launch request** bodies (avoid growing `src/dto.ts`, currently ~1250 lines). Every *request* field `class-validator`-decorated — `ValidationPipe({ whitelist: true })` in `app.setup.ts` strips undecorated properties.
- **Postback must not use a whitelist DTO.** Global `ValidationPipe({ whitelist: true })` (`app.setup.ts:28-31`) still runs; method `@UsePipes()` **adds** pipes, it does not disable the global one. Bind `@Req() req` and read `req.body` (metatype is not a class-validator DTO). JSON when `authType` is HTTPBASIC.
- `src/utils/rise-probe.ts` + `src/utils/rise-probe.spec.ts` — `scormcontent/runtime-data.js` is **not JSON**. It is `__jsonp("runtime-data.js","<base64-json>")`. Unwrap JSONP + base64 before parse. There is **no** `quizItemCount` key. Derive quiz item count from `course.lessons` where `type === "quiz"` (`items.length`). Reporting from `settings.reporting` / `course.exportSettings.reporting` (lifting: `passed-incomplete`, empty quiz `items: []`). Fixtures: trimmed copies of both real files.
- `src/utils/assert-imported-course-tree-locked.ts` — if `deliveryMode === IMPORTED_SCORM`, reject **any** tree write (not only edits of the synthetic rows). Extra live sections would make `countCompletionDenominator` (`course-version.service.ts:783-808`) wait forever and `checkContentCompletion` would never stamp `courseCompletedAt`. Call from:
  - **Create siblings:** `createModule` / `createChapter` / `createSection` (`course.controller.ts:404` / `:412` / `:421`; services `:2145` / `:2181` / `:2218`)
  - **Updates / reorder:** `updateModule` / `updateChapter` / `updateSection` / `updateSectionOrder` (`course.controller.ts:309-338`)
  - **Restore:** `restoreModule` / `restoreChapter` / `restoreSection` (`course.controller.ts:464-487`, services `:4369` / `:4440` / `:4545`)
  - **Archive path:** `deleteModule` / `deleteChapter` / `deleteSection` (`course.service.ts:3981` / `:4084` / `:4186`) — after the first `publishNewVersion` they soft-archive. There are no `archive*` methods.
  - Quiz: `assignQuiz` (`quiz.service.ts:635`) and `restoreQuiz` (`:999`)
  - Assessment: `createAssessment` (`course-assessment.service.ts:382`)
  - Learner: `updateUserChapterProgress` (`course.controller.ts:511-516`)
- Register `ScormModule` and `ScormCloudModule` in `src/app.module.ts`.

**`src/dto.ts` `SectionType` vs Prisma:** Prisma `SectionType` (`schema.prisma:811-821`) includes `EMBED` and will include `SCORM`. The HTTP enum `export enum SectionType` in `src/dto.ts:478-486` has **neither `EMBED` nor `SCORM`**. `createSection` (`course.service.ts:2218`) types `body.type` from that DTO enum. **Do not create the synthetic SCORM section through `createSection`.** Use `prisma.section.create` inside the import transaction, with `type: 'SCORM'` as a Prisma enum value. Optionally add `SCORM` to the DTO enum later for reads; it is not required for the import path.

**Where the probe runs:** **server-side, after Cloud import job reaches success**, via **`GetCourseAsset(scormCloudCourseId, relativePath: "scormcontent/runtime-data.js")`** (query param `relativePath`, not a path segment; optionally after `GetCourseFileList`). Do **not** call `GetCourseZip`.

### 5.3 Import flow (`scorm.service.ts`)

1. Catalogue row: either existing `POST /courses` **or** `POST /scorm/packages` creates it.
   - **Do not add `deliveryMode` to `CourseDto`.** `PUT /courses/:id` is typed as **`CourseDto`**, not `UpdateCourseDto` (`course.controller.ts:298-304`), and `updateCourse` spreads the body into `prisma.course.update` (`course.service.ts:3493-3498`). A decorated `CourseDto.deliveryMode` would let an admin flip native↔imported on general update. Set `deliveryMode` **only** inside `POST /scorm/packages` via Prisma. Create-time selection, if needed, is a dedicated DTO that `PUT /:id` does not share.
   - `Course.isActive` schema default is **`true`** (`schema.prisma:112`). `createCourse` (`:2063-2096`) does not pass `isActive`. If the admin `POST /courses` first, the row is `NATIVE` + live. The packages endpoint must **update** that course to `IMPORTED_SCORM` and `isActive: false`.
   - If `POST /scorm/packages` creates the `Course`, supply every required Prisma field: `title` (unique), `description`, `image`, `overview`, `duration`, `assessment`, `syllabusOverview`, `resourcesOverview`, plus **`assessments: []`, `resources: []`, `syllabus: []`** (`Json[]`, required in the client even when SQL is nullable), `deliveryMode: IMPORTED_SCORM`, `isActive: false`. Re-read `schema.prisma` at implement time.
2. `POST /scorm/packages`: create `ScormPackage` (`status: PROCESSING`). Admin DTO may use `contentUrl`; Cloud body is **`{ url }`**. Persist **`response.result`**. Do not wait. Job ids expire one week after finish.
3. `GET /scorm/packages/:id/import-status` **and** cron `GET /api/v1/internal/cron/scorm-import-jobs`. `GetImportJobStatus`: `RUNNING` → processing; `ERROR`/`error` → `FAILED`; `COMPLETE` (and `COMPLETED` if seen) → complete-import **once**:
   - **Tree create** in its own `$transaction` guarded by `pg_try_advisory_xact_lock` (same pooling constraint as `publishNewVersion` at `course-version.service.ts:297-307` — **session** `pg_advisory_lock` will not serialize under PgBouncer transaction pooling). If `sectionId` is already set, skip tree. **Commit.**
   - Then `publishNewVersion(adminId | null, courseId)` — it opens **its own** tx/lock and must see the committed section. Then `READY`.
   - Do **not** wrap `publishNewVersion` in the uncommitted tree tx (different connection; it will not see the new section).
4. **Policy gate:** `completeOn: "passed"` + server probe derived quiz item count `=== 0` or reporting not `passed-*` → refuse. Zero quiz under `completeOn: "completed"` → warn.

### 5.4 Synthetic tree

Same shape as the build-path plan, just with a smaller `ScormPackage`. **Create with `prisma.module.create` / `chapter.create` / `section.create` in one transaction** (not HTTP `createSection`). Supply every required NOT NULL field listed below.

```
Module   "Course content"       (locked)
 └── Chapter <package title, unescaped twice — see note>
      └── Section  type = SCORM
           config: { packageId, completeOn: "completed" | "passed", passingScore? }
```

**Title escaping note:** Rise double-escapes the manifest title (`Occupational Health &amp;amp; Safety…`). Prefer the title from `riseProbeJson` (single-escaped) over the manifest title; if only the manifest title is available, unescape twice.

**Same class of gotcha, one model down (round-1 review finding, extended in rounds 2 and 3 — it kept turning out not to be only one field):** `Chapter.pdfFile` is `String` — required, NOT NULL, no default — and it's an actively-read field (`course.service.ts`, `src/dto.ts`, and captured into the pinned-curriculum resolver in `course-version.manifest.ts`), not dead legacy. **`Module.description`, `Chapter.description`, and `Section.description` are all the same shape** — required `String`, no default, read by the exact same resolver (`course-version.manifest.ts:804/852/863`). **Full list the synthetic-tree creation call must supply — re-verify against `prisma/schema.prisma` at implementation, this list has been incomplete before:** `Module.title`, `Module.description`, `Chapter.title`, `Chapter.description`, `Chapter.pdfFile`, `Section.title`, `Section.description`, **`Section.moduleId`** (`schema.prisma:407` — nullable in Prisma but native `createSection` always sets it at `course.service.ts:2237`; `UserCourseProgress.moduleId` and `LastSeenSection.moduleId` are required). Empty string for the text fields. Don't assume DTO validation will catch a missing one before Postgres.

### 5.5 `sectionId` write-back

`ScormPackage.sectionId` is nullable specifically because the Section doesn't exist until the synthetic-tree step runs. In the same transaction that creates the Section, write its new id back onto `ScormPackage.sectionId` — this is the only place that field is ever set, and it's what the launch endpoint (Phase 3) reads to populate `ScormRegistration.sectionId` at registration-creation time.

**Guards to add (edits to existing code, not new endpoints):**

- `createCourse` (`course.service.ts:2063`): do **not** rely on a `CourseDto.deliveryMode` field (§5.3). Inactive+imported is enforced in `POST /scorm/packages`.
- **`setCourseActive` (`course.service.ts:2914`), route `PATCH /courses/admin/:id/active` (`course.controller.ts:283-289`) — this is the publish switch, not `updateCourse`.** `PUT /courses/:id` is `CourseDto` (`:298-304`) and still has no `isActive`. Before allowing `isActive: true` for `IMPORTED_SCORM`, require exactly one live `SCORM` section belonging to a `READY` package. Reject otherwise. This is **not** "zero sections certifies everyone": `checkContentCompletion` (`course-completion.service.ts:74`) **returns early** when `totalSections === 0`. `_isCourseContentCompleted` (`course-assessment.service.ts:1476`) returns `true` at zero (assessment unlock). Still block publish.
- Tree lock: §5.2 list (course + quiz + assessment) **plus** learner `updateUserChapterProgress` (`course.controller.ts:511-516` / `course.service.ts:5977-5984`). Native section-complete on an `IMPORTED_SCORM` / `Section.type === SCORM` row would stamp `UserCourseProgress` and `courseCompletedAt` **without** Cloud `completeOn`.

### 5.6 First publish + replace-package

**First successful import** (not only replace): after the synthetic-tree transaction **commits**, call `publishNewVersion(adminId, courseId, changeNotes?)`. Unpinned enrollments (`UserCourse.enrolledVersionId` null, `schema.prisma:169`) **float on the live tree**. If v1 is never published, a later replace-package that archives the v1 section and publishes v2 moves those floaters onto v2. First import must create `CourseVersion` 1.

Replace: new zip → new Cloud course (**new UUID**, `mayCreateNewVersion: false`) → new `ScormPackage` v2 → new `Section` → archive the v1 section → set v1 package `status: SUPERSEDED` → `publishNewVersion` after the tx.

**Imported `wouldRegress` (define it; do not reuse native version-migrate %):** before the admin confirms replace, return (1) count of `ScormRegistration` rows on the soon-to-be-`SUPERSEDED` package whose `completeOn` is already satisfied, (2) count of enrollments pinned to the current `CourseVersion`, (3) count of unpinned floaters. Native `wouldRegress` in `course-version.service.ts:1929-2310` is projected **section %** — always 0% or 100% on a 1-section tree and the wrong question for Cloud registrations. Surface “N learners in progress / completed on the old package; M pinned; K floaters will move to v2.” v1 may still allow the replace after the admin confirms.

Learners pinned to the v1 `CourseVersion` keep the v1 section, the v1 `ScormPackage`, and therefore their existing Cloud registration against the v1 course id — launch (Phase 3) resolves the course id from `ScormRegistration.packageId`, never from live `Section.config`.

### Acceptance criteria

- [ ] Uploading the lifting package end to end (zip never enters this function): import succeeds, **server** probe (JSONP unwrap) records `reporting: "passed-incomplete"` and derived quiz item count `0`; `completeOn: "passed"` is refused.
- [ ] First import created a `CourseVersion` (learners can pin; live tree is not the only copy).
- [ ] `PATCH /courses/admin/:id/active` with `isActive: true` on an `IMPORTED_SCORM` course with zero live SCORM sections is rejected. `PUT /courses/:id` cannot set `isActive`.
- [ ] Attempting to **create** a second module/chapter/section, or edit/reorder/archive/restore inside an `IMPORTED_SCORM` course, is rejected.
- [ ] `deliveryMode` is **not** on `CourseDto` / `PUT /:id`; imported courses persist `IMPORTED_SCORM` only via the packages service.

---

## 6. Phase 3 — Launch, postback, reconciliation

**Depends on:** Phase 2 (package + section exist).

### 6.1 Launch (`POST /scorm/launch`) — JSON body, never 302

Student guard is **`AuthGuard('uJwt')`**. A browser **GET with 302** cannot send `Authorization: Bearer`. Putting the JWT in a query string would **leak it to SCORM Cloud** via `Referer` and Cloud request logs. Nest `302` to Cloud is therefore forbidden.

Frontend (D7): `const { launchLink } = await api.post('/scorm/launch', { packageId })` then `window.location = launchLink` immediately. Do not stash the URL — unused TTL is **120s by default** (OpenAPI 10–300).

1. Resolve **package from the pinned curriculum**, not from a client-supplied id as authority. Read the learner's enrolled `CourseVersion` (or live tree if unpinned) SCORM section → `config.packageId` / `ScormPackage`. Body `packageId`, if present, is a consistency check only (409 if it doesn't match). After replace-package, a pinned v1 learner must not be able to launch v2 by posting v2's id.
2. `assertEnrollmentUsable` **plus** for `Role.user`: `Course.isActive === true` and the pinned package is `READY` or `SUPERSEDED`. `_assertEnrollmentUsable` today only checks `UserCourse.isActive` / `validityDays` (`:6037`). Without the catalogue check, an assigned learner can complete Cloud and get `isPassed` while the imported course is still unpublished. Admins/staff may preview (`Role.user` only). Also reject if `User.deletedAt` is set.
3. First-ever launch: **`CreateRegistration` on Cloud first**. Cloud `courseId` = **`ScormPackage.scormCloudCourseId`** (the UUID we supplied at import — after replace this is **not** `Course.id`). `registrationId` = our row UUID; `learner.id` = `User.id`; `firstName`/`lastName`; `postBack` as §2. Copy `completeOn` + `sectionId` from the pinned section. Persist with **`firstLaunchAt: now()`**. Compensate with `DeleteRegistration` / local delete as before.
4. Returning launch / Cloud **409**: treat as exists; continue to `BuildRegistrationLaunchLink`. Local unique violation: load the existing row. If `firstLaunchAt` is null, set it now. Do not `CreateRegistration` again on a known row.
5. `BuildRegistrationLaunchLink` **fresh every time**. `redirectOnExitUrl` = learner page on `PUBLIC_FRONTEND_URL`. **`expiry`: 120** (10–300).
6. `LastSeenSection` direct upsert; create branch supplies `moduleId` and `courseId`. Do not use `updateLastSeenSection` (`:6270`).
7. Respond **200 JSON** `{ launchLink }`.

### 6.2 Postback receiver (`POST /api/v1/scorm/postback`)

Absolute path includes **`/api/v1`**. Cloud also allows course- and application-level postback config (`SetCourseConfiguration` / `SetApplicationConfiguration`). **v1 only sets shorthand `postBack` on `CreateRegistration`.** Do not rely on invitation/dispatch.

1. `ScormPostbackGuard` — HTTP Basic, fail closed, `timingSafeEqual` + length check. 401 if credentials wrong. No whitelist DTO (§5.2).
2. Parse **raw** JSON (HTTPBASIC) matching `GetRegistrationProgress`. Resolve by `payload.id` === `scormCloudRegistrationId`. Map:
   - `registrationCompletion` → `completionStatus` (`UNKNOWN`→`unknown`, `INCOMPLETE`→`incomplete`, `COMPLETED`→`completed`)
   - `registrationSuccess` → `successStatus` (`UNKNOWN`→`unknown`, `FAILED`→`failed`, `PASSED`→`passed`)
   - `score.scaled` → `scoreScaled` (0–100). Course-level `ScoreSchema` has **no** `raw`; leave any `scoreRaw` column unused (or omit it). `totalSecondsTracked` → `totalTimeSeconds`.
   A literal `"completed"` vs Cloud `"COMPLETED"` never matches.
3. **If the row is missing, or the durable write fails: HTTP 5xx.** Queued postbacks retry; `TestRegistrationPostback` does **not**. Dummy test payloads will not match a row — prove the test tool with **401 vs 5xx**, not 200. Use a real registration to prove payload shape.
4. **Idempotent, monotonic update** on mapped lowercase values:
   - `completionStatus`: `unknown`(0) `< incomplete`(1) `< completed`(2).
   - `successStatus`: `unknown`(0) `< failed`(1) `< passed`(2).
   - Unranked `scoreScaled` / time: take newest on accepted writes. `lastPostbackAt: now()` on every authenticated postback.
   - Read `completeOn` from **`ScormRegistration.completeOn`** (copied at create from the pinned section). Never from the course's current live SCORM `Section.config` (replace-package would apply v2 policy to a v1 postback).
   - `completeOn: "completed"` ⇔ mapped completion is `completed`. `completeOn: "passed"` ⇔ mapped success is `passed`.
5. If `completeOn` is satisfied, run the completion bridge (Phase 4). **Re-check enrolment + `deletedAt`.** Persist the Cloud snapshot **first**. Then run the bridge and **read back** `CourseCompletion.courseCompletedAt` and `isPassed` — `checkContentCompletion` **swallows errors** (`course-completion.service.ts:146-151`) and never throws. If certify is still incomplete: **HTTP 5xx** so Cloud retries (queued postbacks). Dummy `TestRegistrationPostback` ids will 5xx after auth; that is correct.
6. Set `ScormRegistration.completedAt` only when **both** `courseCompletedAt` and `isPassed` are set.

### 6.3 Reconciliation poll (backstop, not primary)

Same shape as engagement cron:

- Handler: `GET /api/v1/internal/cron/scorm-reconcile` + POST alias, `CronSecretGuard`, `@HttpCode(200)`.
- **Also register import-job cron** (this is the only `vercel.json` how-to in the plan — do not leave it only in §5.3):
  ```json
  { "path": "/api/v1/internal/cron/scorm-import-jobs", "schedule": "*/5 * * * *" },
  { "path": "/api/v1/internal/cron/scorm-reconcile", "schedule": "*/15 * * * *" }
  ```
  GET, `CronSecretGuard`, `@HttpCode(200)`, batch/limit inside 60s. Live `vercel.json` today has only `engagement-reminders`. Without the import-jobs row, complete-import depends on the admin tab polling until Cloud drops the job id (one week).
- Find `ScormRegistration` rows that still need work:
  - Cloud status not yet terminal per `completeOn`, **or**
  - `completeOn` already satisfied but `CourseCompletion.courseCompletedAt` or `isPassed` is still missing (D1 certify catch-up after a swallowed `checkContentCompletion`).
- Age filter: `COALESCE(lastPostbackAt, firstLaunchAt, createdAt)` older than the threshold — **`NULL < timestamp` is unknown in SQL** and would drop launched-but-never-posted rows. Launch **must** set `firstLaunchAt` (§6.1).
- `GetRegistrationProgress` for each; same update path as §6.2 (including enrolment re-check and 5xx-on-failed-certify only on the HTTP postback; cron just retries locally).
- **Batch limit** so one tick fits `maxDuration: 60` (`vercel.json`). Do not loop the entire table in one invocation.

This exists because Cloud docs say you cannot rely on the learner returning to `redirectOnExitUrl`. The poll is insurance against a lost postback, not the primary channel.

### Acceptance criteria

- [ ] Full playthrough: `POST /scorm/launch` returns JSON `{ launchLink }`; frontend navigates; completion postback lands on `/api/v1/scorm/postback`; `ScormRegistration.completionStatus` becomes `completed`.
- [ ] Same postback twice does not duplicate `UserCourseProgress` or the certificate email.
- [ ] Unknown `scormCloudRegistrationId` or a forced DB failure returns **non-2xx** (retryable). Happy-path commit returns 200.
- [ ] `TestRegistrationPostback` dummy id: **401** if Basic is wrong, **5xx** if auth passes (no row). Payload shape is proven with a **real** registration (200 after durable write + certify). Test tool does **not** prove retries.
- [ ] Reconciliation **and** import-job crons are listed in `vercel.json`. Reconcile catches a dropped postback and an already-terminal-but-uncertified row.
- [ ] A launch attempted with a stale unused link fails the way Cloud fails it. Our API does not 302.
- [ ] First launch: Cloud `CreateRegistration` failure does not leave a local row that blocks retry; local-write failure after Cloud create calls `DeleteRegistration`.

---

## 7. Phase 4 — Completion bridge

**Depends on:** Phase 3.

Per **D1** this is simpler than the build-path plan: there is no native-exam branch. Triggered from the postback (or reconcile) handler on a status transition that satisfies `completeOn`, **after** `assertEnrollmentUsable(..., Role.user)` and a `deletedAt` check succeed:

1. Create `UserCourseProgress` for the synthetic section, only if absent. Required fields: `userId`, `courseId`, `chapterId`, `sectionId`, **`moduleId`** (`schema.prisma:451-458`; native write at `course.service.ts:5977-5984`).
2. Inject **`CourseCompletionService.checkContentCompletion`** from `CourseCompletionModule` — do not import `CourseService`. For `sectionCount = 1`, this stamps `courseCompletedAt` and sends the congratulations email (`course-completion.service.ts:61-141`). That is **content completion**, not this repo's "certified" flag.
3. **D1 certified (v1):** after `checkContentCompletion`, **upsert `isPassed: true`** until it sticks (`course.service.ts:267`; snapshot in `src/course-version/learner-snapshot.service.ts:235-236`). **v1 does not set `certificateUrl`.** Existing `setCertificate` is `POST …/admin/attempts/:attemptId/certificate` (`course-assessment.controller.ts:225-234`).
4. `recordChapterAndModuleCompletionIfNeeded` from `src/utils/chapter-progression.ts` (`:450`).
5. Set `ScormRegistration.completedAt` only when **both** `courseCompletedAt` **and** `isPassed` are set (same rule as §6.2). Optionally also set `assessmentPassedAt` so native “passed at” columns are not empty (`course-assessment.service.ts:1756-1768` sets both together).

If the enrolment gate fails: skip steps 1–5; Cloud snapshot on `ScormRegistration` may still update.

### 7.1 Empty-tree publish guard, restated

Do **not** treat "zero live sections" as "certify every enrollee." `checkContentCompletion` returns immediately when `totalSections === 0` (`course-completion.service.ts:74`) — no `courseCompletedAt`. `_isCourseContentCompleted` returns `true` at zero (`course-assessment.service.ts:1476`) and would unlock a native Assessment if one existed; D1 does not add that Assessment. §5.5's `setCourseActive` guard is still load-bearing so a half-finished import never hits the catalogue, and so a later Assessment cannot ride the zero-section `true`.

### Acceptance criteria

- [ ] Completing the lifting package stamps `courseCompletedAt`, sets `isPassed: true`, and fires the congratulations email. Snapshot `isPassed` is true. `certificateUrl` stays null in v1.
- [ ] If `isPassed` update fails after `courseCompletedAt` is set, a later postback still sets `isPassed`.
- [ ] Expired `validityDays`, inactive `UserCourse`, or `deletedAt` set: launch 403s **and** a later Cloud postback does **not** create `UserCourseProgress` or set `isPassed`.
- [ ] If `checkContentCompletion` fails once, a later postback/reconcile retries until `courseCompletedAt` is set.

---

## 8. Phase 5 — Platform edges

**Depends on:** Phase 4.

### 8.1 Engagement reminders

Add a sixth `UNION ALL` arm to `ACTIVITY_CTE` (`src/engagement/engagement.service.ts`, currently five arms, lines ~158-185) over `ScormRegistration`:

```sql
UNION ALL
SELECT sr."userId", sr."courseId", MAX(COALESCE(sr."lastPostbackAt", sr."firstLaunchAt")) AS last_at
  FROM "scorm_registrations" sr
 WHERE sr."firstLaunchAt" IS NOT NULL OR sr."lastPostbackAt" IS NOT NULL
 GROUP BY sr."userId", sr."courseId"
```

**This arm is for `findStalled`, not `findNeverStarted`.** Launch already upserts `LastSeenSection` (§6.1 step 6). The STALLED template already omits the progress sentence when `done <= 0` (`src/mail/templates/engagement-reminder.template.ts:36`). Keep the sixth arm so in-player postbacks refresh `last_at`. Optionally skip the section-count line for `IMPORTED_SCORM`.

### 8.2 `LastSeenSection`

Direct upsert on launch (§6.1 step 6), not `updateLastSeenSection`. Create data: `userId`, `chapterId`, `sectionId`, **`moduleId`, `courseId`**. Unique key remains `@@unique([userId, chapterId])`.

### 8.3 GDPR force-purge

`src/user/user.service.ts`'s hand-maintained `deleteMany` list (starting at line 821, 18 calls as of this writing) needs:

```ts
this.prisma.scormRegistration.deleteMany({ where: { userId: id } }),
this.prisma.userCourseProgress.deleteMany({ where: { userId: id } }),
```

`UserCourseProgress` has **no User FK** (`schema.prisma:451-471`), so `user.delete` will not cascade those rows. The live purge list (`user.service.ts:821-844`) already omits `userCourseProgress` — that is a pre-existing gap; Phase 4 makes it worse. Add the `deleteMany` in the **same PR** as the bridge.

**New in rev 3**: also call SCORM Cloud's `deleteRegistration` API for each of that user's registrations, so the third party doesn't retain the learner's data after a purge either. **Ordering, made explicit after round-2 review found the original phrasing left a real gap, then tightened again in round 3 after finding a live race in that fix**: the whole purge already runs as one `prisma.$transaction([...])` array ([user.service.ts:811-846](../src/user/user.service.ts#L811-L846)) — a plain array of Prisma operations, which cannot itself contain an HTTP call. So the sequence is:

1. `findMany` this user's `ScormRegistration` rows and capture each `scormCloudRegistrationId` (plus `userId`/`packageId` for context). Log via the existing `UserService.logger` (`Logger(UserService.name)`, already used in this exact class for the same "best-effort external side-effect failed, warn and continue" shape at `user.service.ts:909`) — there's no Queue/BullModule infrastructure. Inject `ScormCloudClient` from `ScormCloudModule` into `UserModule` — **do not import `ScormModule` or `CourseModule`.**
2. Call `DeleteRegistration` for each captured id, then **`DeleteAllLearnerData`**: `DELETE /learner/{learnerId}/delete-information?userEmail={SCORM_CLOUD_OWNER_EMAIL}` ([PII/GDPR](https://cloud.scorm.com/docs/v2/guides/pii_deletion/)). Requires a Realm Owner/Administrator email and **application deletes enabled** (§2). The operation is **async** — fire-and-forget; do not block the local transaction on it finishing. Catch failures, log captured ids, continue. Keep per-registration `DeleteRegistration` even if this extra wipe fails.
3. **Re-run step 1's `findMany` immediately before building the transaction**, and repeat step 2 for any row that wasn't in the first pass. **Why this second pass is not optional (round-3 finding):** `purgeUser` never deactivates or locks the target user before running — no JWT strategy checks `deletedAt` or any "purge in progress" state, and `assertEnrollmentUsable` (the gate `POST /scorm/launch` uses) checks only `UserCourse.isActive`/`validityDays`, nothing about deletion unless we add that check (§6.1 step 2). So a user with a still-valid session token can call `POST /scorm/launch` and get a **brand-new** `ScormRegistration` at any point during step 2's real, sequential, wall-clock-taking HTTP calls — a row step 1's original capture never saw. Step 3's local `deleteMany` is a live query and would delete that row anyway, silently taking its `scormCloudRegistrationId` down with it, with no record left to ever clean it up on SCORM Cloud's side.
4. Only then run the existing `$transaction([...])` that deletes the local rows (adding `scormRegistration.deleteMany` to it).

This narrows the race to "a launch lands in the gap between step 3's re-check and step 4's commit" — negligible in practice (that gap is one more `findMany` plus transaction setup, not N HTTP calls) but not literally zero. Closing it completely would mean locking the account against new launches before starting the purge at all, which is a broader auth-layer change outside this document's scope — recorded here as a known, accepted residual risk, not silently assumed away.

### Acceptance criteria

- [ ] A learner actively committing SCORM Cloud progress does not receive a **STALLED** email. A learner who has launched (LastSeenSection row) does not receive NEVER_STARTED.
- [ ] `LastSeenSection` after launch has `moduleId` and `courseId` populated.
- [ ] A hard-deleted user's `ScormRegistration` rows are gone, and a corresponding `deleteRegistration` call was made to SCORM Cloud (verify via their API or account dashboard in testing).
- [ ] Admin reset-progress and force-unassign on `IMPORTED_SCORM` return a clear error (D-reset-unassign). `wipeUserCourseState` / `probeUserCourseResidualState` (`course.service.ts` ~170–377) are not left able to wipe local progress while leaving the Cloud registration intact.

---

## 9. Phase 6 — Admin/report surface

**Depends on:** Phase 5.

- [ ] Package status/probe panel on the admin course screen: `ScormPackageStatus`, `riseProbeJson` (reporting mode, quiz item count, pass mark) — so an admin uploading a package with an empty quiz sees it before publishing, not after.
- [ ] "Replace package" flow surfaces the `wouldRegress` migration count before the admin confirms.
- [ ] Learner/admin report: **status + `scoreScaled` (0–100)** — not `scoreRaw`, not a percentage bar of sections.
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
| Postback auth | `src/scorm/scorm-postback.guard.spec.ts` | Missing/invalid Basic Auth → 401; unset env → fail closed; unequal-length secrets do not throw |
| SCORM Cloud's own postback test tool | manual | Unknown dummy id → **5xx** (auth already passed); invalid Basic → **401**. Payload shape proven with a **real** registration |
| Real playthrough — fire safety | manual, **once a real SCORM export exists** (D-fire-safety) | `scoreScaled` arrives; pass→fail→pass never regresses |
| GDPR purge | manual/integration | `scormRegistration.deleteMany`, `userCourseProgress.deleteMany`, Cloud `deleteRegistration` |
| Reconciliation poll | `src/scorm/scorm-runtime.service.spec.ts` | Past-threshold registration caught up; batch limit respected |
| Empty-tree publish guard | `src/course/course.service.versioning.spec.ts` or new `src/scorm/*.spec.ts` | **`setCourseActive`** refuses `isActive: true` on `IMPORTED_SCORM` with no live SCORM section |
| First-import version | `src/scorm/scorm.service.spec.ts` | Successful first import calls `publishNewVersion`; second import-status poll does not create a second section |
| Tree lock including restore | `src/course/course.archive.spec.ts` + quiz/assessment specs | `createModule` / `createSection` / `restoreSection` / `deleteSection` / `assignQuiz` / `createAssessment` rejected on imported |
| Reset/unassign refuse | new scorm or course spec | reset + unassign on `IMPORTED_SCORM` 409/400 without `wipeUserCourseState` |
| Negative import fixtures | `src/scorm/scorm.service.spec.ts` | Cloud `ERROR` surfaced; zero-quiz + `completeOn: "passed"` refused |
| Launch contract | `src/scorm/scorm-launch.controller.spec.ts` | `POST` + `uJwt`; body `{ launchLink }`; no 302; Cloud 409 still launches |
| Real playthrough — lifting | manual | `registrationCompletion: COMPLETED`, `registrationSuccess: UNKNOWN`, no `scoreScaled` |
| Engagement false-positive | new `src/engagement/` spec or scorm spec | Postback-only activity not STALLED; launched learner not NEVER_STARTED |

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
| Zip posted through Vercel / fake Cloud PUT URL | D-zip-path: `CreateFetchAndImportCourseJob` + durable public `contentUrl`; zip never enters this function |
| `deliveryMode` on `CourseDto` writable via `PUT /:id` | Set only in `POST /scorm/packages` via Prisma; never decorate `CourseDto` |
| Publish guard on the wrong method (`updateCourse`) | Guard `setCourseActive` / `PATCH .../active`; schema default `isActive: true` overridden in packages service |
| GET 302 launch + Bearer JWT | `POST /scorm/launch` + JSON `{ launchLink }`; `AuthGuard('uJwt')`; D7 frontend navigation |
| Postback always-200 / form auth / wrong JSON keys | 200 after durable write; `authType: "HTTPBASIC"`, `userName`; URL includes `/api/v1`; no HTTP→HTTPS redirect |
| Whitelist DTO strips Cloud payload | Raw `req.body`; no class-validator DTO on postback |
| Cloud `COMPLETED` compared to `"completed"` | Map `registrationCompletion` / `registrationSuccess` |
| First import never published | `publishNewVersion(adminId, courseId)` **after** the tree tx |
| Import poll inside one Vercel request | Persist `cloudImportJobId`; admin GET / cron |
| Client JSZip / `GetCourseZip` | `GetCourseAsset` for `runtime-data.js` |
| `createSection` DTO has no `SCORM` | Prisma `section.create` in the import transaction |
| `ScormModule` imports `CourseService` | Leaf `ScormCloudModule` + `CourseCompletionModule` + extracted `assertEnrollmentUsable` |
| Launch block assumed to block postback | Enrolment + `deletedAt` re-checked on the completion bridge |
| `checkContentCompletion` swallow + early `completedAt` | Retry bridge until `courseCompletedAt`; then stamp registration |
| `isPassed` stays false (D1 "certified") | Set `isPassed: true` after content completion for imported |
| Reconciliation cron never scheduled | `vercel.json` GET path + provided `CronSecretGuard` + batch limit |
| `deleteCourse` claimed fixed by Cascade | Refuse delete of imported-with-progress; Cascade only covers new SCORM tables |
| Reset/unassign wipes local state only | Refuse for `IMPORTED_SCORM` in v1 (D-reset-unassign) |
| GDPR purge forgets Cloud or `UserCourseProgress` | `DeleteRegistration` + `deleteAllLearnerData(learnerId)`; add `userCourseProgress.deleteMany` |

---

## 13. Review log

This clone has been through an independent no-context review loop against the live repo and Cloud V2 docs (Rounds 4–7 below are that loop; Rounds 1–3 are the original Cloud-plan reviews kept for history). The postback/certify path and migration ordering remain the load-bearing spots to re-read before coding.

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

### Round 4 — independent clone-loop review (2026-08-30)

Zero-context review of the **original** Cloud execution plan against the live repo (this clone's Review 1). Findings applied in this file:

**BLOCKING**

- Publish path is `setCourseActive` / `PATCH /courses/admin/:id/active`, not `updateCourse`. `UpdateCourseDto` has no `isActive`. Schema default `Course.isActive: true`; `createCourse` must force false for imported.
- `deliveryMode` is stripped by `ValidationPipe({ whitelist: true })` unless decorated; set it in `POST /scorm/packages` via Prisma.
- `GET /scorm/launch` + 302 is incompatible with `AuthGuard('uJwt')` Bearer JWT and can leak the token to Cloud. Replaced with `POST` + `{ launchLink }` + frontend `window.location`.
- Postback "always 200" prevents Cloud retries. Auth default is form, not Basic — require `postBack.authType: "httpbasic"`. Public URL must include `/api/v1`. 200 only after durable write.
- First import never called `publishNewVersion`; unpinned learners float on the live tree. Call it on first READY tree. Build the tree with Prisma, not `createSection` (DTO `SectionType` has no `SCORM`).
- Zips cannot transit this Vercel function (4.5 MB body, 60s, no Multer). D-zip-path: Cloud direct upload.

**SIGNIFICANT**

- Extract `_assertEnrollmentUsable` to a util; pass `Role.user`; do not import `CourseService` into `ScormModule`. `CourseCompletionModule` for the bridge. Leaf `ScormCloudModule` so `UserModule` can GDPR-delete without a cycle.
- Zero sections does **not** certify everyone: `checkContentCompletion` returns early at 0. Softened; `setCourseActive` guard remains.
- Launch block ≠ postback block — re-check enrolment/`deletedAt` on the completion bridge.
- Cloud IDs are caller-supplied. V2 names: `CreateUploadAndImportCourseJob`, `GetImportJobStatus`, `GetRegistrationProgress`, `BuildRegistrationLaunchLink` (`redirectOnExitUrl`, explicit `expiry`). Ping is `GET /api/v2/ping`. Do not assume 15-minute unused-link TTL (`LaunchAuthExpiry` default 28800s).
- D-reset-unassign: refuse reset/unassign in v1; `wipeUserCourseState` does not know Cloud registrations.
- Client JSZip probe is untrusted; parse `runtime-data.js` server-side.
- Reconciliation needs `vercel.json` cron + GET + `CronSecretGuard` + batch limit.
- Sixth CTE arm is for STALLED (`lastPostbackAt`), not NEVER_STARTED (`LastSeenSection` already covers launch).
- Lock **restore** and native assessments via `assertImportedCourseTreeLocked`.
- `onDelete: Cascade` + unique `scormCloudRegistrationId` or `deleteCourse` P2003s.
- `LastSeenSection` create requires `moduleId` and `courseId`.
- Postback Basic Auth: `timingSafeEqual` + equal-length check (`auth.service.ts:58-62`).

**MINOR (applied)**

- Synthetic create must still supply `Module`/`Chapter`/`Section` titles and descriptions + `Chapter.pdfFile`.
- Cloud postback scopes in their docs include invitation/dispatch; we only use per-registration.

Confirmed still true from Rounds 1–3: monotonic ranks; GDPR capture-then-delete race; forward-reference migration order; five required synthetic-tree strings.

### Round 5 — clone-loop Review 2 (2026-08-30)

Zero-context review of **this clone** against the live repo and Cloud V2 docs. Applied:

**BLOCKING**

- `ScormRegistration` indexed `completionStatus` after that column was dropped in an earlier edit — restored.
- `CreateUploadAndImportCourseJob` does not return a PUT URL; it is multipart `file` to Cloud. D-zip-path is now OAuth-to-Cloud or `CreateFetchAndImportCourseJob` + `contentUrl`.
- `postBack` wire keys: `userName`, `authType: "HTTPBASIC"` (not `user` / `"httpbasic"`).
- Progress/postback fields: `registrationCompletion` / `registrationSuccess` uppercase enums; map before ranking; lookup `payload.id`.
- Do not whitelist-DTO the postback body.
- Do not put `deliveryMode` on `CourseDto` (`PUT /:id` uses that class).

**SIGNIFICANT**

- D1 "certified" requires `CourseCompletion.isPassed = true`; `checkContentCompletion` only stamps `courseCompletedAt` + emails.
- `TestRegistrationPostback` does not retry; 3xx is success; no POST redirect follow.
- Import job success is Cloud `COMPLETE`/`finished`, not local `READY`. Do not poll to completion in one 60s function; persist `cloudImportJobId`.
- Probe via `GetCourseAsset`, not `GetCourseZip`.
- Cloud `CreateRegistration` before local persist (or compensate with `DeleteRegistration`).
- Tree lock from `createAssessment`, `assignQuiz`, `restoreQuiz`, `restoreModule`, `restoreChapter`.
- `UserCourseProgress.moduleId` required; GDPR must `deleteMany` that table (no User FK).
- Retry bridge until `courseCompletedAt`; then `ScormRegistration.completedAt`.
- `publishNewVersion(adminId, courseId)` after the tree tx.
- Packages endpoint must fill every required `Course` field / flip an existing `POST /courses` row.
- Cascade on SCORM FKs does not make `deleteCourse` work; refuse imported-with-progress.
- `CronSecretGuard` not exported from `EngagementModule` — provide/extract it.
- `totalTimeSeconds` is `Float` (`totalSecondsTracked`).

### Round 6 — clone-loop Review 3 (2026-08-30)

Zero-context review of this clone vs live repo + Cloud V2 OpenAPI. Applied:

**BLOCKING**

- `zipSha256` is optional (zip never hits this app).
- v1 zip path is **`CreateFetchAndImportCourseJob` + `contentUrl`** so this API receives `cloudImportJobId`. Browser OAuth is optional and requires `POST …/import-job { jobId }` plus CORS proof; `write:course` is app-wide and tokens are irrevocable.

**SIGNIFICANT**

- Complete-import is a single `PROCESSING` → `READY`/`FAILED` transition (no double tree).
- Job status: `RUNNING` \| `COMPLETE` \| `ERROR` only.
- Launch `expiry` 10–300s (default 120).
- Report `scoreScaled` (0–100); no course-level `scoreRaw`.
- `completeOn` copied onto `ScormRegistration` at create.
- Dummy `TestRegistrationPostback` → 5xx after auth, not 200.
- v1 certified = `isPassed` only; no attempt-based `certificateUrl`.
- Retry bridge until `courseCompletedAt` **and** `isPassed`.
- Postback: `@Req() req.body`; empty `@UsePipes()` does not disable global ValidationPipe.
- `mayCreateNewVersion: false`; new package = new Cloud courseId.
- `PUBLIC_FRONTEND_URL` for `redirectOnExitUrl`.
- Cloud 409 = exists; local unique violation = load row.
- Synthetic `Section.moduleId` required in practice.
- Spec files: use existing `course.archive.spec.ts` / `course.service.versioning.spec.ts` or new `src/scorm/*.spec.ts`.
- Replace-package sets v1 `SUPERSEDED`.

### Round 7 — clone-loop Review 4 (2026-08-30)

Zero-context review of this clone. Applied:

**BLOCKING**

- Complete-import: if `sectionId` is set, skip tree only; still `publishNewVersion` then `READY`. Advisory lock; do not no-op the whole function.
- Postback: persist snapshot, run bridge, **read back** `courseCompletedAt` + `isPassed`; 5xx if certify incomplete (`checkContentCompletion` swallows). Reconcile also selects already-terminal-but-uncertified rows.
- Launch sets `firstLaunchAt`. Reconcile ages with `COALESCE(lastPostbackAt, firstLaunchAt, createdAt)` (`NULL < ts` drops rows).

**SIGNIFICANT**

- Launch package id from pinned curriculum, not client body as authority.
- Fetch-from-URL: frontend hosts a durable public `contentUrl`; this repo has no zip upload.
- Import-status **and** `scorm-import-jobs` cron; `adminId: null` on cron.
- Job success: `COMPLETE` or `COMPLETED`.
- Course create also needs `assessments`/`resources`/`syllabus` `[]`.
- Lock learner `updateUserChapterProgress` on imported SCORM sections.
- Refuse **all** unassign/reset for imported (not only force).
- GDPR: `deleteAllLearnerData(learnerId)` as well as `DeleteRegistration`.
- `ScormModule` provides JWT strategies like Course/Quiz.

### Round 8 — clone-loop Review 5 (2026-08-30)

Zero-context review: **no BLOCKING**. Applied SIGNIFICANT:

- Cloud fetch body `{ url }`; job id is `response.result`.
- `CreateRegistration.courseId` = `ScormPackage.scormCloudCourseId`.
- Rise probe: unwrap JSONP+base64; derive quiz count from lessons.
- Tree lock on `deleteModule`/`deleteChapter`/`deleteSection` (the real archive path).
- `pg_try_advisory_xact_lock` only around tree tx; commit; then `publishNewVersion`.
- Name zip host (Cloudinary raw / R2 / S3); job ids expire in one week.
- Learners need `Course.isActive` + package `READY`/`SUPERSEDED` to launch/certify.
- `completedAt` requires both stamps; `@HttpCode(200)` on POST launch/postback.

### Round 9 — clone-loop Review 6 (final, 2026-08-30)

Last allowed zero-context pass. **No BLOCKING.** Applied SIGNIFICANT + MINOR:

- GDPR `DeleteAllLearnerData` needs `SCORM_CLOUD_OWNER_EMAIL`, deletes enabled on the Cloud app, async fire-and-forget.
- Tree lock also on `createModule` / `createChapter` / `createSection` / updates / `updateSectionOrder`.
- `vercel.json` registers **both** `scorm-import-jobs` and `scorm-reconcile`.
- Imported `wouldRegress` defined as Cloud-registration + pin/floater counts, not native section %.
- Engagement CTE uses `COALESCE` in the SQL; `GetCourseAsset(..., relativePath=)`; dummy TestRegistrationPostback is 5xx after auth.

Loop stopped here (max 6 reviews). Execute from this clone.
