# SCORM Cloud Integration — Frontend Implementation Guide

This is the handoff doc for building the frontend on top of the SCORM Cloud backend (branch `feat/scorm-cloud-integration`). It covers both surfaces you need: the **admin import/management UI** and the **learner playback UI**. All endpoints, request/response shapes, and states below are read directly from the current backend code, not from memory — line references are given so you can verify anything.

---

## 1. Concepts you need before building anything

- A **Course** gets a `deliveryMode` field: `NATIVE` (existing authoring flow) or `IMPORTED_SCORM`. Check this field to decide which UI to render for a course — the two are mutually exclusive and mostly non-overlapping.
- An `IMPORTED_SCORM` course's curriculum tree (modules/chapters/sections/quizzes/assessments) is **auto-generated from the SCORM package and locked**. Any write attempt to that tree (add/edit/delete a module, chapter, section, quiz, or assessment) returns **403** with the message:
  > "Imported SCORM courses have a locked curriculum. Replace the package instead of editing the tree."

  **Do not show the normal course-builder UI (add module/chapter/quiz/assessment buttons) for an `IMPORTED_SCORM` course.** Show a read-only curriculum view instead, with a "Replace package" action in its place.
- A **`ScormPackage`** is one imported SCORM zip, versioned per course (`versionNumber` increments on replace). It has a lifecycle status (see §3).
- A **`ScormRegistration`** is one learner's play-through of one package — created on first launch, updated by SCORM Cloud postbacks (backend-only, you never call this).
- Replacing a package is how content gets updated — **there is no "edit the tree" flow**. The old package becomes `SUPERSEDED`; a new one is created via the same import endpoint with the existing `courseId`.

---

## 2. Auth cheat sheet

| Guard | Meaning | Who can call |
|---|---|---|
| `AuthGuard('jwt')` | Admin JWT | Admin only (403 if `role !== 'admin'`) |
| `AuthGuard('uJwt')` | User JWT | Learner only (403 if `role !== 'user'`) |
| `AuthGuard('cJwt')` | Combined | Either role |

All SCORM package-management endpoints require **admin** (`jwt`). Launch and progress require the calling role's own guard as noted below.

---

## 3. Package status lifecycle (admin UI)

`ScormPackage.status` is one of:

| Status | Meaning | What to show |
|---|---|---|
| `PROCESSING` | Import job running on SCORM Cloud, or the local tree-build/publish step is in progress | Spinner / "Importing…" — **poll** `GET /scorm/packages/:id/import-status` (see §4.2) until it leaves this state |
| `READY` | Import succeeded, curriculum tree built, course version published | Show as the active/current package |
| `FAILED` | Import or gate-check failed | Show `failureReason` (human-readable string) and a "Retry" action (re-submit the import) |
| `SUPERSEDED` | An older, replaced package. Still launchable for learners pinned to an old course version, but not for new enrollments | Show in version history, greyed out / "Replaced" badge |
| `PRUNED` | A `SUPERSEDED` package whose SCORM Cloud resources have been cleaned up by the nightly cron once no enrollment references it anymore | Show in version history as "Archived" — nothing launches against this anymore |

Two extra fields worth surfacing in the admin UI:
- **`failureReason`** (string, nullable) — set on `FAILED`. Show verbatim; it's already a human-readable message (e.g. Cloud import error, or a policy-gate rejection reason).
- **`importWarning`** (string, nullable) — set on `READY` when the import succeeded but something couldn't be fully verified (e.g. the package isn't a Rise export, so the "has a scored quiz" gate check couldn't run). **Surface this as a visible warning badge on the package**, not just a log line — admins need to know a `completeOn: "passed"`-configured course actually got its completion gate verified.

---

## 4. Admin flow: import & manage SCORM packages

### 4.1 Import a package — `POST /scorm/packages` (admin, `jwt`)

Body (`CreateScormPackageDto`):

```ts
{
  courseId?: string;        // omit to create a new catalogue course from the fields below
  contentUrl: string;       // REQUIRED. Durable public HTTPS URL SCORM Cloud can GET.
                             // The zip is NEVER uploaded through this API — you need a
                             // public URL (e.g. from your own upload-to-storage step first).
  zipSha256?: string;       // optional integrity check value
  completeOn: 'completed' | 'passed';  // REQUIRED — see note below
  passingScore?: number;    // 0-100, only meaningful when completeOn: 'passed'
  title?: string;           // used for a new course, or to relabel the package
  description?: string;
  image?: string;
  overview?: string;
  duration?: string;
  assessment?: string;
  syllabusOverview?: string;
  resourcesOverview?: string;
}
```

**Important UX point on `completeOn`:**
- `'completed'` = a learner is considered done once the SCO reports `completed`, no scoring required.
- `'passed'` = requires the SCO to report `successStatus: 'passed'`. This only works reliably for **Rise-authored** packages, because pass/fail detection is verified via a Rise-specific probe. For any other authoring tool (Storyline, Captivate, iSpring…), the backend can't verify a quiz exists and will either reject the import (if it can prove there's no quiz) or import it with an `importWarning` flagging that gate verification was skipped. **Your import form should warn admins up front**: "'Requires passing score' is only fully verified for Rise-exported packages."

Response (200):
```ts
{ message: string, statusCode: 200, data: ScormPackage }  // status: 'PROCESSING'
```

Possible errors:
- `400` — `contentUrl` isn't a public HTTPS URL, or DTO validation failed
- `409 ConflictException` — "An import is already in progress for this course." (only one `PROCESSING` package per course at a time — disable the import button while one is in flight)
- `409 ConflictException` — "A concurrent package import created the same version number. Retry shortly." (rare double-submit race — just retry)
- `502 BadGateway` — SCORM Cloud rejected the import job creation; the package row is marked `FAILED` with `failureReason` set — surface that message

### 4.2 Poll import status — `GET /scorm/packages/:id/import-status` (admin, `jwt`)

Call this on an interval (suggest every 3-5s) while a package is `PROCESSING`, and stop once you get `READY`, `FAILED`, or `SUPERSEDED`. This endpoint is what actually **drives** the import forward server-side (it checks the Cloud job, runs the policy gate, builds the tree, and publishes the course version) — there's also a background cron doing the same thing every 5 minutes as a safety net, so polling isn't strictly required for correctness, but without it admins will wait up to 5 minutes to see `READY`.

Response:
```ts
{ message: 'ok', statusCode: 200, data: ScormPackage }
```

### 4.3 List package versions — `GET /scorm/courses/:courseId/packages` (admin, `jwt`)

Returns all packages for a course, `versionNumber` descending. Use this to render version history.

```ts
{ message: 'ok', statusCode: 200, data: ScormPackage[] }
```

### 4.4 Get one package — `GET /scorm/packages/:id` (admin, `jwt`)

```ts
{ message: 'ok', statusCode: 200, data: ScormPackage }
```

### 4.5 Replace-preview — `GET /scorm/courses/:courseId/replace-preview` (admin, `jwt`)

Call this **before** letting an admin replace a package, and show the numbers so they understand the blast radius:

```ts
{
  message: 'ok', statusCode: 200,
  data: {
    completedOnOldPackage: number;   // learners who already finished the current package
    pinnedEnrollments: number;       // learners pinned to the published version referencing the current package — keep working after replace
    floatingEnrollments: number;     // learners not pinned to a specific version — will see the NEW package next launch
    packageId: string | null;        // current READY package id (null if none yet)
  }
}
```

Suggested copy: *"12 learners have completed this version. 40 are mid-course and will keep their progress on the current version. 8 haven't started and will get the new version automatically."*

To actually replace: call **4.1** again with the same `courseId` and the new `contentUrl`/settings — there's no separate "replace" endpoint, it's just another package create.

---

## 5. Learner flow: launching & playing SCORM content

### 5.1 Detecting a SCORM course

Check `course.deliveryMode === 'IMPORTED_SCORM'` on whatever course-detail endpoint you already use. When true:
- Hide/replace any native "mark chapter complete" or quiz-taking UI for that course's content — SCORM courses don't use those, progress comes only from the Cloud player.
- Route "Start/Continue course" to the launch flow below instead of your native lesson player.

### 5.2 Launch — `POST /scorm/launch` (learner, `uJwt`)

Body (`LaunchScormDto`):
```ts
{
  courseId: string;      // required
  packageId?: string;    // optional consistency check only — omit unless you have a specific reason
}
```

Response:
```ts
{ launchLink: string }
```

**Critical: the launch link expires in 120 seconds.** Call this endpoint immediately before you need it — do not cache it, do not fetch it ahead of time, do not reuse it across page loads/refreshes. Every time a learner clicks "Start/Continue", call this fresh and immediately open the returned URL (new tab or iframe — SCORM Cloud content is typically embedded in an iframe; confirm sizing/embedding requirements with design, the backend has no opinion here).

**On exit, SCORM Cloud redirects the learner to your app's configured base URL (`PUBLIC_FRONTEND_URL`), not back to the specific course page.** There's no per-launch custom return URL today. If you need "return to course X" behavior, that's a backend follow-up (parameterizing `redirectOnExitUrl`) — flag it if it's a hard requirement, don't try to work around it client-side with sessionStorage tricks that won't survive a real redirect.

Possible errors:
- `403` — account disabled, not enrolled/enrollment expired, course not published, or package not `READY`/`SUPERSEDED` — show a generic "This course isn't available right now" and let the learner retry or contact support; these map to real backend states, not bugs
- `404` — course/curriculum not found
- `409` — `packageId` mismatch (only relevant if you pass it)

### 5.3 Progress — `GET /scorm/progress?courseId=<id>` (learner or admin, `cJwt`)

```ts
{
  message: 'ok', statusCode: 200,
  data: {
    id: string;
    packageId: string;
    completionStatus: 'unknown' | 'incomplete' | 'completed' | string;  // raw SCORM values
    successStatus: 'unknown' | 'passed' | 'failed' | string;
    scoreScaled: number | null;      // 0.0–1.0 if the SCO reported a score
    totalTimeSeconds: number | null;
    firstLaunchAt: string | null;    // ISO date
    lastPostbackAt: string | null;
    completedAt: string | null;
  } | null   // null if the learner has never launched this course's SCORM content
}
```

Use this to render a progress badge / "resume" state on the course card without needing to launch. Poll it (e.g. on page focus, or a moderate interval) rather than expecting a push update — there's no websocket/SSE for this.

### 5.4 Completion & certificates

Course completion and certificate issuance for SCORM courses go through the **same existing certificate endpoints** you already integrate with for native courses — nothing SCORM-specific to add there. Two things worth knowing:
- A learner's `isPassed` / `courseCompletedAt` gets set automatically by the backend once the Cloud postback satisfies whatever `completeOn` the package was configured with — you don't drive this from the frontend at all.
- Certificate score display (`scorePct`) now falls back to the SCORM registration's `scoreScaled` when there's no native assessment attempt behind it, so score should render correctly on SCORM-course certificates without any special-casing on your side.

---

## 6. What NOT to build

- No manual "mark as complete" button for SCORM sections/chapters — completion is Cloud-driven only.
- No curriculum editor (add/edit/delete module/chapter/section/quiz/assessment) for `IMPORTED_SCORM` courses — every one of those calls now 403s server-side; the only supported edit is replacing the whole package (§4.5).
- No file upload for the SCORM zip itself through this API — you need your own "upload to storage, get a public HTTPS URL" step first, then pass that URL as `contentUrl`. If there's no existing asset-upload flow for large zips, that's a prerequisite to sort out before this can ship, not something this API provides.
- No caching/reuse of `launchLink` — it's single-use-ish and expires in 2 minutes.

---

## 7. Error-handling quick reference

| Status | When | Suggested UI |
|---|---|---|
| 400 | Bad `contentUrl`, DTO validation | Inline form error |
| 403 (locked tree) | Any curriculum-edit call on an `IMPORTED_SCORM` course | Shouldn't happen if you hide the UI per §1/§6; if it does, treat as a bug, not a user-facing state |
| 403 (launch) | Not enrolled, course unpublished, package not ready | "This course isn't available right now" |
| 404 | Course/package not found | Standard not-found handling |
| 409 (import in progress) | Second import attempt while one is `PROCESSING` | Disable import button, show current progress instead |
| 409 (version race) | Rare concurrent-import collision | Silent retry once |
| 502 | SCORM Cloud unreachable/rejected the job | Show `failureReason`, offer retry |

All list/detail responses use the envelope `{ message: string, statusCode: number, data: T }` — unwrap `data`.

---

## 8. Open questions to raise with backend before/while building

1. **Return-to-course after exit** — currently fixed to the app's base URL (§5.2). Confirm whether that's acceptable for launch or needs a follow-up.
2. **Zip upload path** — confirm where the "get a public HTTPS URL for the zip" step lives (existing asset pipeline vs. new work) before scoping the import form.
3. **Polling cadence** — no push mechanism exists for import status or learner progress; agree on acceptable polling intervals so you're not hammering the API.
