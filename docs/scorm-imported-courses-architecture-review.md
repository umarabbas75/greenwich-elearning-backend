# Review — “Imported SCORM courses — architecture”

**Reviewing:** [scorm-imported-courses-architecture.md](./scorm-imported-courses-architecture.md) (Proposed, 2026-08-22)
**Date:** 2026-08-22
**Status:** **Incorporated.** Every finding below is folded into rev 2 of [scorm-imported-courses-architecture.md](./scorm-imported-courses-architecture.md) — build from that file, not this one. This review is kept as the evidence trail: it records what was wrong in rev 1 and how each claim was verified.

**Method:** every claim the doc makes about *our* code checked against the source; every claim about *Rise* checked by decoding the two sample packages in the repo root.

**Verdict up front:** the central decision is right and I would not change it — one zip = one course, a synthetic 1-section tree, reuse `CourseCompletionService` rather than fork it. What is wrong is mostly *underneath* that decision: the version-pinning story does not work the way the doc says, the certificate path does not exist for imported courses, the launch token as specified is a full session token, engagement emails will misfire, and the fixture the doc nominates for Phase 0 **can never be completed**. Details below, worst first.

---

## 0. The one that matters most: the Phase-0 fixture cannot complete

The doc names `occupational-health-…-scorm12-1zKdvoHT` as the first fixture (§15) and recommends `completeOn: "passed"` (§7.4, §17.1).

Decoding that package's `scormcontent/runtime-data.js`:

```
exportSettings.reporting          = "passed-incomplete"
exportSettings.completeWith       = "reporting"
exportSettings.completionPercentage = 100
exportSettings.quizId             = "cmt03qwu2002q3b7djf69n1j2"
lessons[8] = { type: "quiz", title: "Quiz", items: 0, piles: 0 }   ← EMPTY
```

The quiz lesson has **zero questions**. `reporting: passed-incomplete` means the SCO reports `passed` (or `incomplete`) *from the quiz result* — and there is no quiz result to report. So this package will never set `cmi.core.lesson_status = passed` and never set `cmi.core.score.raw`. Under the doc's recommended `completeOn: "passed"`, this course is **uncompletable by construction**. It is also one of the client's two real courses.

The fire-safety course is the opposite case:

```
lessons[N] = { type:"quiz", items: 25,
               settings: { passingScore: 80, retryCount: -1, revealAnswers:"all" } }
```

25 questions, 80% pass, **unlimited retries**.

Three consequences the doc has to absorb:

1. `completeOn: "passed"` cannot be the default. Default to `completed`, make `passed` an opt-in per package, and refuse to publish a `passed` package that has no scoreable quiz.
2. §6 says “We **do not** parse Rise `runtime-data.js` … Manifest + launch file is enough.” That is false for validation. The only place the reporting mode, the quiz item count and the pass mark exist is `runtime-data.js`. Without reading it (best-effort, Rise-only, non-fatal if absent) you will publish courses learners cannot finish, and support will eat it. This is the single change I'd insist on in the import pipeline.
3. §7.2's `masteryScore Float? // from manifest if present` is dead code for Rise. `imsmanifest.xml` in the sample has **no** `<adlcp:masteryscore>`. The pass mark is `quiz.settings.passingScore` inside `runtime-data.js`, or it's admin-typed.

Related, same file: `scormdriver/driverOptions.js` ships

```js
scope.USE_STRICT_SUSPEND_DATA_LIMITS = false;
scope.FORCED_COMMIT_TIME = 20000;
```

The commit interval matches the doc. The first line does not: the Rustici driver is explicitly configured to **exceed** SCORM 1.2's 4096-character `suspend_data` limit, and it LZW-compresses the blob (`lzwCompress` is visible in `scormdriver/lms-interface.js`). §5's table records “max 4096 chars in 1.2” as if that were a constraint we enforce. If scorm-again's 1.2 validator, our DTO, or our column enforces 4096, resume breaks **silently and only on long courses** — the classic Rise-on-a-custom-LMS bug. Moodle allows 64000. This must be proven with a full playthrough, not a smoke test.

---

## 1. Version pinning does not work as described (the one structural error)

§7.2: “Replacing a zip creates **package v2** … the synthetic section id can stay … In-progress learners stay on the package version they started, same idea as structure-freeze.”

Our versioning does not freeze content. From the schema itself:

```prisma
/// Structural manifest: ordered module/chapter/section/quiz source IDs only.
/// Content is always read from the live tree.
manifest Json?
```
— [prisma/schema.prisma:515-517](../prisma/schema.prisma#L515-L517)

and the resolver proves it: [course-version.manifest.ts:765](../src/course-version/course-version.manifest.ts#L765) reads `prisma.section.findMany({ where: { id: { in: allSectionIds } } })` — live rows by pinned ID. `CourseVersionManifestChapter` carries `sectionIds`/`quizIds` only.

So if `packageId` lives in `Section.config` and the section ID stays stable, replacing the zip **retargets every learner instantly**, including someone half-way through, and then feeds package v1's `suspend_data` into package v2's driver. Best case Rise discards the bookmark; worst case it restores a nonsense state. The doc's own `coursePackageVersion` worry is real — it just doesn't have a mechanism behind it.

Two workable fixes, pick one and write it down:

- **A package version owns its own Section row.** New zip → new `Section` (type `SCORM`, config points at package v2) + archive the old + publish a new `CourseVersion`. Pinning then genuinely works, because pinning is by section ID. Cost: a learner migrated v1→v2 loses their `UserCourseProgress` tick and has to re-finish. The existing bulk-migrate `wouldRegress` guard will (correctly) flag that — which is the honest signal, not a bug.
- **Never resolve the package from live config.** `ScormRegistration.packageId` is authoritative; `POST /scorm/launch` resolves files from the registration and only new registrations pick up the latest package. Cheaper, but now `Section.config` is decorative and two sources of truth exist — say so explicitly.

Either way, §7.2's “pin the package per enrolment” has no column behind it today: there is nothing on `UserCourse`, and §10's launch endpoint says only “create/get registration”.

---

## 2. Certificates do not come for free

§8: “Certificates / validityDays / enrolment | **Unchanged**”, and the diagram runs `UCP → CourseCompletionService → Cert`.

`CourseCompletion` has two independent axes ([prisma/schema.prisma:1144](../prisma/schema.prisma#L1144)):

| field | set by |
|---|---|
| `courseCompletedAt` | content completion — [course-completion.service.ts:61](../src/course-completion/course-completion.service.ts#L61) |
| `isPassed`, `assessmentPassedAt`, `bestAttemptId` | the **native final Assessment** — `_upsertCourseCompletion`, [course-assessment.service.ts:1739](../src/course-assessment/course-assessment.service.ts#L1739) |
| `certificateUrl` | `setCertificate`, after an admin finalises a graded attempt — [course-assessment.service.ts:1401](../src/course-assessment/course-assessment.service.ts#L1401) |

An imported course with no native Assessment gets `courseCompletedAt` and nothing else: no `isPassed`, no `bestAttempt`, no grade, no certificate. So the client's headline requirement — “a full course with its own quizzes, imported” — currently terminates in a course that can be finished but not certified.

The doc must choose, in writing:

- **(a)** imported courses still carry a native `Assessment` as the graded exam (Rise score becomes evidence only). This is the compliance-safe answer and also fixes §11's score-integrity problem — but it contradicts §14's “no mixing” and the client's stated intent.
- **(b)** we add a CMI→`isPassed` path with a `null` bestAttempt. Then every read of `bestAttempt.percentage` (reports, learner snapshot, admin roster) needs a null branch, and “grade” for imported courses means `scoreRaw`.

Also a live landmine in the same area: `_isCourseContentCompleted` returns **true** when `totalSections === 0` ([course-assessment.service.ts:1476](../src/course-assessment/course-assessment.service.ts#L1476)), while `checkContentCompletion` returns early on 0 ([:74](../src/course-completion/course-completion.service.ts#L74)). A half-finished or failed import that leaves a course with zero sections therefore **unlocks the final assessment for everyone enrolled**. Guard the import so a course is never active with 0 sections, and consider tightening that asymmetry regardless.

---

## 3. Engagement emails will tell learners they haven't started

§8: “Engagement NEVER_STARTED / STALLED | First launch / last commit timestamps.”

Activity is a fixed raw-SQL CTE over five tables ([engagement.service.ts:158-185](../src/engagement/engagement.service.ts#L158-L185)): `UserCourseProgress`, `LastSeenSection`, `quiz_progress`, `assessment_attempts`, `assignment_submissions`. `ScormRegistration` is in none of them, and `findNeverStarted` fires precisely when `activity_rollup` has **no row**.

So a learner three weeks into a Rise course, committing every 20 seconds, is “never started” and gets emailed a nudge to begin. And `findStalled` personalises with `completedSections`/`totalSections` counted from `sections`/`UserCourseProgress` — imported learners read “0 of 1”. Adding a sixth UNION arm is small work; it is not zero, and it must be in the phase plan.

Same class of omission: `LastSeenSection` (the “continue where you left off” surface) is never written by the player, so imported courses drop out of that UI too.

---

## 4. The launch token, as specified, is a full session token

§9: “launch token (JWT, ~2 hours, bound to userId + courseId + packageId + attempt)”. §11: “Stolen session via SCO JS → launch token, not LMS cookie.”

All three Passport strategies verify against the **single** `JWT_SECRET` and validate nothing beyond `sub` → role ([src/strategy/jwt.strategy.ts](../src/strategy/jwt.strategy.ts)); `JwtAuthGuard` does a bare `verifyAsync` with the same secret. There is no `aud`, no `iss`, no `typ`. A launch JWT signed with `JWT_SECRET` carrying `sub: <userId>` **is** a valid learner session token for the whole API — and the package's untrusted JS shares an origin with the player shell, so it can read it.

Required, not optional:

- separate signing key for launch tokens (or asymmetric with a distinct kid), **plus** a mandatory `aud`/`typ` claim, **plus** `audience` validation added to the existing strategies so a scorm token is rejected there. Today they'd accept it.
- token out of the query string. `?token=` is readable by the SCO via `parent.location.search`, and lands in CDN access logs and browser history. Use the URL fragment, or hand it to the shell by `postMessage` after an origin check.
- treat the content origin as hostile, and put it on a **separate registrable domain**, not `packages.greenwichtc-elearning.com`. A sibling subdomain can set cookies on the parent domain (cookie tossing) and shares too much ambient trust; this is why GitHub serves user content from `githubusercontent.com`. §11 assumes subdomain isolation is enough — it isn't.
- all packages sharing one origin means package A's JS can read package B's launch state and `localStorage`. Per-package subdomain, or accept and document it.

Two more, one mechanical, one political:

**Mechanical.** CORS is an explicit allowlist ([app.setup.ts:5](../src/app.setup.ts#L5)) — the content origin has to be added. Worse, `vercel.json`'s route headers set `Access-Control-Allow-Origin: *` together with `Allow-Credentials: true` (an invalid pair browsers reject) and the `Access-Control-Allow-Headers` list **omits `Authorization`**. A token-bearing preflight from the new origin fails until that's fixed. And `ValidationPipe({ whitelist: true })` ([app.setup.ts:29](../src/app.setup.ts#L29)) strips every DTO property without a validation decorator — so §10's “persist the whole CMI snapshot” silently arrives as `{}` unless the blob field is explicitly decorated. Each of these is a wasted afternoon in Phase 2; all three are avoidable by writing them into the plan.

**Political.** A learner with devtools can set `cmi.core.score.raw = 100`. That's true of every SCORM LMS, but this doc positions the Rise quiz as the official exam on a platform that issues certificates. If the certificate has any compliance weight, the graded exam should stay native (option 2a). Raise it with the client explicitly rather than discovering it at audit.

---

## 5. The package is not self-contained, and it phones home

§11/§12 treat the zip as inert files we host. Decoded `runtime-data.js` `settings` (both packages):

```
telemetryUri          : https://metrics.eu.articulate.com          (also in scormcontent/index.html)
courseUpdateCallbackUrl: https://rise-runtime.360.prod.eu-central-1.art-internal.com/publish/course/<courseId>
cdnUri                : https://cdn.eu.articulate.com
reviewContentUrl      : https://360.eu.articulate.com/review/content
s3Metadata            : { author: aid|…, tenant-id: 40c5f834-… }
enableTelemetryCollection: true
```

and the cover image resolves to `https://cdn.eu.articulate.com/assets/rise/assets/themes/classic/cover-image/N` — a **runtime** fetch from Articulate, not from our bucket.

So: learner activity telemetry leaves our stack for Articulate EU, the package retains an update-callback endpoint, and part of the theme depends on Articulate staying up. §11's “CSP on the content origin can be loose (the SCO needs to run)” quietly permits all of it. Decide deliberately: block those hosts by CSP and verify the course still renders correctly, or allow them and put it in the privacy notice. Either is defensible; silence isn't. (`features: { "ai-learner-chatbot": true }` is set on both courses too — `aiTutorConfig` is null today, but an AI-tutor block in a future export will want live Articulate calls.)

---

## 6. Phase 1 is a new subsystem, not a phase

There is **no object storage integration in this backend at all**. Uploads go client-side straight to Cloudinary and we persist URLs ([assignment.service.ts](../src/assignment/assignment.service.ts), [reject-inline-base64.ts](../src/utils/reject-inline-base64.ts)). No AWS SDK, no signing, no queue, no Redis, no worker, no job runtime. The only background execution in the product is one Vercel cron hitting an HTTP endpoint behind a shared secret.

§6's “enqueue processPackage → worker/long-running job” therefore implies: a bucket, a CDN, a new domain + certificate, signing/IAM in the API, a job runtime, a separately deployed static player app, and observability for all of it. That is the bulk of the work, and the phase table hides it inside one row.

Also, two concrete infeasibilities:

- Cloudflare Workers (§12's suggestion) cannot unzip a 200 MB package — 128 MB memory and CPU-time caps.
- Nor can a Vercel function: `maxDuration: 60`, and the whole app is a single cached serverless handler.

Cheaper paths worth costing before building any of it:

1. **Unzip in the admin's browser.** JSZip in the admin UI, one presigned PUT per file, API records the manifest. No worker, no queue, no long-running compute. The real sample is **19 MB / 110 files** — trivial. Admin uploads are rare and supervised, and a failed upload is retried by a human, which is exactly the failure model a queue is usually bought to avoid.
2. **Rustici SCORM Cloud / Content Controller.** §18 mentions it in a footnote and dismisses it. Given that the alternative is owning a hostile-code hosting surface, a SCORM RTE, per-authoring-tool `suspend_data` quirks and a new domain, this deserves a real build-vs-buy line with a number on it. Their dispatch model also solves “replace content without re-uploading”.
3. Before designing for 200 MB, **ask the client for their largest export**. The 200 MB cap in §6 is invented; both real courses are ~19 MB.

And a load note the doc doesn't make: we run Neon pooled with `connection_limit=1` per instance — documented as a hard design constraint in at least four places ([engagement.service.ts:49](../src/engagement/engagement.service.ts#L49), [admin-dashboard.service.ts:14](../src/admin-dashboard/admin-dashboard.service.ts#L14), [course-version.service.ts:302](../src/course-version/course-version.service.ts#L302), [docs/admin-dashboard-plan.md](./admin-dashboard-plan.md)), with `withDbRetry` wrapping queries because it's fragile. Rise force-commits every 20 s per active learner. That is a new sustained write stream through a single-connection pool on a serverless function. Mitigate in the design: diff against the last snapshot and skip no-op commits, write `cmiJson` only on `LMSFinish`, and keep the commit handler to one read + one write.

---

## 7. Runtime/protocol gaps in §5 and §9

- **SCORM 1.2 is synchronous.** `LMSSetValue`/`LMSCommit`/`LMSFinish` must return `"true"` immediately. The final commit — the one carrying `passed` and the score — is the one that races the tab closing. It has to go out via `navigator.sendBeacon` (or `fetch(..., {keepalive:true})`), and the server has to accept a beacon's content type. §5's sequence diagram draws it as an ordinary POST.
- **LMS-supplied read-only elements are missing from the CMI table.** We must initialise `cmi.core.entry` (`ab-initio` / `resume`), `cmi.core.credit`, `cmi.core.lesson_mode`, `cmi.student_data.mastery_score`, `cmi.core.total_time`. In 1.2 **`total_time` is read-only to the SCO** — the SCO writes `session_time` and the **LMS** accumulates `total_time += session_time` at Finish. §5 lists `total_time` as if the package supplies it; implement that literally and time-in-course is garbage.
- **Commit ordering.** Debounced POSTs can arrive out of order; §10's “last-write-wins” then regresses score and `suspend_data`. Add a monotonic `commitSeq` per registration and reject stale writes. “Never shrink `passed`” is right — note that the fire quiz has `retryCount: -1`, so a learner really can pass then fail again.
- **Concurrent sessions.** Two tabs = two players on one registration = mutual `suspend_data` clobber. Needs an active-session id and a “this attempt is open elsewhere” response. Not in §7.3 or §10.
- **Resume is a byte-exact round trip** of an LZW-compressed blob. Any truncation, re-encoding, JSON escaping surprise or whitelist stripping loses the learner's place with no error. This needs a dedicated test: play half the course, close, relaunch, assert the bookmark and the blob are identical.
- **Progress percentage.** With `sectionCount = 1`, [learner-percentage.ts](../src/course-version/learner-percentage.ts) can only ever return 0% or 100% for a 9-lesson course. Rise gives us `lesson_location` and an opaque blob, no percentage. Decide: show “In progress” instead of a bar for imported courses, or decode Rise's blob (fragile, don't). The FE handoff will ask on day one — answer it in the doc.
- **Time tracking can't reuse the heartbeat.** `POST /tracking/heartbeat` is session-JWT + `@GetUser()` ([tracking.controller.ts:27](../src/tracking/tracking.controller.ts#L27)). The player is on another origin holding a launch token, and per §17.2 may be in a separate tab where the parent can't heartbeat at all. Either `tracking` accepts the launch token, or imported-course time comes only from `session_time`.
- **The commit→completion bridge is more than one write.** The native path ([course.service.ts:5891](../src/course/course.service.ts#L5891)) does `assertChapterAccessible` (enrolment + post-completion expiry gating), creates the progress row, then calls `checkContentCompletion` **and** `recordChapterAndModuleCompletionIfNeeded`. The SCORM path needs all of it, including the expiry gate — otherwise a learner past their `validityDays` window keeps accruing progress. And note the existing `findFirst`-then-`create` is unguarded by a unique constraint, so two concurrent commits can duplicate the row; the completion query survives it via `distinct`, but reports may not.

---

## 8. Data model corrections (§7)

- **`ScormRegistration` declares no relations**, so the GDPR force-purge — a hand-maintained list of ~27 `deleteMany` calls ([user.service.ts:821-844](../src/user/user.service.ts#L821-L844)) — will orphan learner name, score and interactions. Add the table to that list and state a retention rule.
- Missing fields: `firstLaunchAt`, `completedAt`, `commitSeq`, `sessionId`, an explicit active/attempt-status flag (the doc says “one active attempt” with nothing marking which), and an index on `(courseId, lessonStatus)` for the admin report. `courseId` is redundant given `packageId` — keep it only for the index and say why.
- `cmiJson Json?` rewritten every 20 s, potentially carrying `cmi.interactions` for a 25-question quiz, is row churn and bloat on a DB we're already careful with. Write it on Finish only, or store a trimmed subset.
- **Don't trust the manifest title.** Rise double-escapes it: `imsmanifest.xml` contains `Occupational Health &amp;amp; Safety…`, which renders as the literal `&amp;`. Unescape twice, or take the title from `runtime-data.js`, or make the admin type it.
- **Don't build on `coursePackageVersion`.** §7.2 says Rise stamps it inside `suspend_data`; in the shipped packages it lives in `runtime-data.js` `settings` (`"oFAnPFLN"`) and in an `index.html` comment (`1zKdvoHT`) — and those two **disagree inside the same folder**, as does the folder name. Use `zipSha256` for identity, as §6 already does.
- Course creation needs more than “title, image, enrolment” (§3): `description`, `overview`, `duration`, `assessment`, `syllabusOverview`, `resourcesOverview` are all NOT NULL on `Course`, and `title` is `@unique` — two similarly-titled Rise imports will collide.
- Validation list (§6) is good; add: reject symlinks, reject case-colliding paths (S3 is case-sensitive, the zip may not be), cap per-file size, verify **every** `<file href>` in the manifest exists (not just the launch href), and **record a content-type map at unzip time** — object storage does not infer `Content-Type`, and a `.js` or `.woff` served as `application/octet-stream` gives you a white screen with no error.

---

## 9. Scope the doc decides by omission

- “Admin does not build modules … hidden in admin or locked” (§3) is one sentence covering a guard on every module/chapter/section/quiz create/update/reorder/archive endpoint in a ~6,000-line `course.service.ts`, plus the version-publish path. Cost it.
- `Course` also owns `CourseForm`, `Policy`, `Assignment`, `Assessment`, `CourseFeedbackForm`, forum threads and todos. Pre-course forms and policies are **gates** today. Do imported courses get them? The doc is silent, and the answer changes both the student UI and the completion predicate.
- §17 asks “complete on `passed` or `completed`?” — §0 above answers it from the client's own content. Also fold in: what does the report show for a package that reports `passed` with no score (Rise sets score only when a quiz exists)?
- **No testing strategy at all.** Everything in this design fails silently — a stripped DTO field, a truncated blob, a lost final commit, a score that never arrives. Phase 0 needs: a hand-authored 5-file fake SCO zip as a CI fixture, plus a full manual playthrough of **both** real courses (empty quiz and 25-question quiz), watching `suspend_data` length, resume fidelity and the final commit.

---

## 10. What the doc gets right (keep it)

- One zip = one course; synthetic 1-section tree; do not unpack Rise lessons into our tree. Correct, and the reasoning about the completion predicate ([course-completion.service.ts:61](../src/course-completion/course-completion.service.ts#L61) / `countCompletionDenominator` at [course-version.service.ts:768](../src/course-version/course-version.service.ts#L768)) is accurate.
- Why the player must share an origin with the package (`API` discovery walks `parent`/`opener`). Confirmed in the sample: `scormdriver/scormdriver.js` looks for `window.API` / `API_1484_11` via `GetAPI`.
- Not serving packages from the app origin, and not from Cloudinary.
- SCORM 1.2 / single-SCO scoping, and rejecting multi-SCO with a clear error. The sample is exactly one SCO → `scormdriver/indexAPI.html`.
- Using `scorm-again` instead of hand-writing the eight-function RTE.
- Not turning `cmi.interactions` into `Quiz`/`QuizAnswer` rows.
- Presigned direct-to-storage upload rather than POSTing a zip through the serverless handler.
- §14's non-goals are the right non-goals.

---

## 11. What I'd change before anyone writes code

1. **Fix the pinning story** (§1) — pick “new package = new Section row” or “registration is authoritative”. This is the only structural error in the design.
2. **Answer the certificate question** (§2). It is the client's actual deliverable and it currently has no path.
3. **Parse `runtime-data.js` at import** (§0) — reporting mode, quiz item count, pass mark — and block or warn. Otherwise you ship uncompletable courses on day one.
4. **Re-scope Phase 0** from “prove Rise finds `API`” to “play both real courses end to end, verify suspend_data survives, resume works, the final commit lands, and the lifting course's empty quiz behaves as designed”.
5. **Cost build-vs-buy** (§6) — browser-side unzip, or SCORM Cloud — before standing up a bucket, a CDN, a domain and a worker.
6. **Separate key + `aud` for the launch token, token out of the query string, content on its own registrable domain** (§4).
7. Add engagement, `LastSeenSection`, time-tracking auth, and the GDPR purge list to the phase plan (§3, §7, §8) — each small, all currently invisible.
