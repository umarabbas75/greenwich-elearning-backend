# Interactive / "Storyline-style" content — strategy & implementation spec

Last updated: 2026-06-23
Status: Proposed (approved direction; not yet built)

## TL;DR

We want the polished, animated, slide-based course experience we saw on the
ITCILO Fire Safety course (Articulate Storyline in an iframe). After analysis,
the chosen approach is **NOT** SCORM-import and **NOT** a hand-built slide
editor. Instead:

> **Author courses in a GUI tool (H5P to validate for free; Articulate 360
> Rise/Storyline or iSpring for production) → publish to self-contained HTML5 →
> host the bundle on a static URL → embed it in the LMS as ONE new `EMBED`
> section type, storing only the launch URL.**

This is the exact ITCILO iframe pattern, minus the SCORM tracking layer. The
embedded package is treated as **one "mark-complete" `Section`**, so all of our
existing completion %, certificate, `SectionTimeSpent` and engagement logic keeps
working unchanged. SCORM/xAPI **export** stays a free latent capability of the
authoring tool if a B2B "run in the buyer's LMS" deal ever appears.

See the decision rationale in `docs/course-progress-freeze-at-completion.md`
(why coupling matters) and `docs/SECTION_TYPES_IMPLEMENTATION.md` (the existing
section-type system this extends).

---

## Who leads this: **Frontend-led, with a small backend unblock first**

This is **~80% a frontend/product effort.** The backend change is small,
well-bounded, and is a one-time *prerequisite* that unblocks the frontend.

| Workstream | Owner | Size | Notes |
|---|---|---|---|
| Add `EMBED` section type + accept/serve it | **Backend** | ~1–3 days | Enum value + migration; create/update branch; include in section reads. Prerequisite — do this first. |
| Learner iframe player (render, fullscreen, mark-complete, resume, responsive) | **Frontend** | bulk of the work, ~1–2 wks | This is where the "experience" lives. |
| Admin authoring UI (create an EMBED section by pasting a URL) | **Frontend** | ~2–3 days | Simple form; reuses existing section-create flow. |
| Static hosting for published bundles (S3 / Cloudflare R2 / Pages) + naming convention | **DevOps / Platform** | ~1 day one-time | Not application code. See "Content & hosting". |
| Buy authoring tool, train SMEs, author content | **Content / Instructional design** | ongoing | Not an engineering task. |

**Recommended sequencing:** Backend ships the `EMBED` type behind the existing
section API (1–3 days) → DevOps stands up a static bucket → Frontend builds the
player + admin form against it. Backend is never on the critical path after the
first few days.

**Why not backend-led:** the hard/valuable part (the player UX, gating,
completion wiring, fullscreen, admin form) is all client-side. The backend
genuinely only needs to (a) know the new enum value and (b) store/return a URL —
which is the same pattern it already uses for every other asset.

---

## Architecture

```
SME authors in Storyline / Rise / iSpring / Lumi (H5P)
        │  publish → self-contained HTML5 folder
        ▼
Static host (S3 / Cloudflare R2 / Pages)   ← separate origin from the app
        │  stable launch URL, e.g.
        │  https://cdn.greenwich.../packages/fire-safety-m1/index.html
        ▼
Admin pastes that URL when creating a Section { type: EMBED }
        │  (DB stores only the URL string — no upload/unzip in our backend)
        ▼
Learner LMS (Next.js)  →  renders the Section as a full-bleed <iframe>
        │  on finish → existing PUT /courses/updateUserChapter/progress
        ▼
UserCourseProgress row written  →  feeds existing completion / certificate /
                                    freeze-at-completion logic unchanged
```

Key property: **the multi-file HTML5 bundle never enters our backend.** We store
a URL string — identical to how `Chapter.pdfFile`, `Section.imageUrl`,
`Course.image` and `CourseCompletion.certificateUrl` already work. This is why no
upload/unzip/object-storage code is required (we have none today, and don't need
to build any).

---

## Backend spec (the small, do-it-first part)

### 1. Add the enum value

`prisma/schema.prisma` — extend the `SectionType` enum (around line 681):

```prisma
enum SectionType {
  DEFAULT
  MATCH_AND_LEARN
  VISUAL_ACTIVITY
  ORDERING
  MATCHING
  EMBED            // self-contained HTML5 package (Storyline/Rise/iSpring/H5P) shown in an iframe
  @@map("section_type")
}
```

Migration is a single additive enum value (non-breaking):

```bash
npx prisma migrate dev --name add_embed_section_type
```

### 2. Store embed metadata in the existing `config` JSON

No new columns. Reuse the `Section.config Json?` field — the same pattern
`ORDERING` and `MATCHING` already use for type-specific data. Shape:

```jsonc
// Section { type: "EMBED", config: {...} }
{
  "embedUrl": "https://cdn.greenwich.../packages/fire-safety-m1/index.html",
  "provider": "storyline",        // "storyline" | "rise" | "ispring" | "h5p" — for analytics/debug only
  "aspectRatio": "16:9",          // hint for the player; default 16:9
  "completionTrigger": "onView",  // "onView" | "onEnd" | "manual" — see Completion below
  "minViewSeconds": 0             // optional dwell gate before "mark complete" is allowed
}
```

The learner-facing `title`/`description`/`shortDescription` stay on the columns
as with every other section type.

### 3. DTO

`src/dto.ts` — add alongside the other section DTOs (e.g. after
`CreateVisualActivitySectionDto`, line ~571):

```ts
export class CreateEmbedSectionDto extends CreateSectionDto {
  embedUrl: string;                 // required, https only
  provider?: 'storyline' | 'rise' | 'ispring' | 'h5p';
  aspectRatio?: string;             // default "16:9"
  completionTrigger?: 'onView' | 'onEnd' | 'manual'; // default "onView"
  minViewSeconds?: number;          // default 0
}
```

### 4. `createSection` branch

`src/course/course.service.ts` `createSection()` (~line 1169) — add a branch
mirroring the existing `ORDERING`/`MATCHING` handling:

```ts
if (body.type === SectionType.EMBED) {
  const e = body as CreateEmbedSectionDto;
  if (!e.embedUrl || !/^https:\/\//i.test(e.embedUrl)) {
    throw new Error('EMBED sections require an https embedUrl');
  }
  data.type = SectionType.EMBED as any;
  data.config = {
    embedUrl: e.embedUrl,
    provider: e.provider ?? null,
    aspectRatio: e.aspectRatio ?? '16:9',
    completionTrigger: e.completionTrigger ?? 'onView',
    minViewSeconds: e.minViewSeconds ?? 0,
  } as unknown as Prisma.InputJsonValue;
}
```

Add the matching branch in `updateSection()` (the type-branch block around
lines 2344–2439). Also add the new DTO to the `createSection` parameter union.

### 5. Reads — no sanitization needed

`getAllUserSections()` calls `sanitizeLessonSectionForStudent()`
(`course.service.ts:84`). `EMBED` has **no answer key**, so no sanitization is
required — it falls through untouched and the `config.embedUrl` is returned to
the client as-is. (Contrast: `ORDERING`/`MATCHING` strip the correct answer
before sending; `EMBED` has nothing to hide.)

### 6. Completion — **no change required**

Completion is `COUNT(distinct progressed sections) >= COUNT(active sections)`
(`_checkContentCompletion`, `course.service.ts:3614`). An `EMBED` section is a
normal `Section` row, so it counts exactly like any other section. The frontend
writes one `UserCourseProgress` row via the existing
`PUT /courses/updateUserChapter/progress` when the learner finishes it. **This
is the whole point of the approach — completion/certificate/freeze-at-completion
math is untouched.**

### Backend scope summary
Enum value + migration, one create branch, one update branch, one DTO, add DTO
to the union. ~1–3 days incl. tests. No file upload, no unzip, no storage, no
SCORM runtime.

---

## Frontend spec (the bulk of the work)

### A. Learner player — render an `EMBED` section

When a section has `type === 'EMBED'`, render its `config.embedUrl` full-bleed:

```tsx
<div className="embed-stage" style={{ aspectRatio: cfg.aspectRatio ?? '16/9' }}>
  <iframe
    src={cfg.embedUrl}
    title={section.title}
    allow="fullscreen; autoplay; encrypted-media"
    allowFullScreen
    sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
    loading="lazy"
  />
</div>
```

Requirements:
- **Responsive**: maintain aspect ratio; `max-width: 100%`; never let the page
  scroll horizontally. Provide a **Fullscreen** button (Fullscreen API) — this is
  a big part of the "Storyline feel".
- **Loading & error states**: skeleton while the iframe loads; a friendly
  fallback + retry if the URL 404s (packages can be re-published / moved).
- **Resume**: on mount, honour the existing `LastSeenSection` so a learner lands
  back on the right section (the resume happens at *our* section level; intra-
  package slide position is owned by the package itself, see "Tracking" below).

### B. Mark-complete wiring (the gating)

Drive our existing per-section progress write based on `config.completionTrigger`:

- `onView` (default): mark complete after the section is opened (optionally after
  `minViewSeconds`). Simplest; matches how our other client-checked sections
  behave (per `docs/lesson-section-types-frontend-handoff.md`, lesson
  interactions are completed client-side).
- `onEnd`: only mark complete when the package signals it finished — requires the
  optional postMessage bridge (see "Future"). Use for flagship modules where you
  want true "reached the end" gating.
- `manual`: show a "Mark as complete / Next" button the learner clicks.

On completion, call the existing endpoint (no new API):

```
PUT /courses/updateUserChapter/progress
body: { userId, courseId, chapterId, sectionId, moduleId }
```

### C. Admin authoring UI

Add `EMBED` to the section-type picker in the admin. The form is just:
`title`, `description`, optional `shortDescription`, **Embed URL** (validated
https), `provider`, `aspectRatio`, `completionTrigger`, `minViewSeconds`. Posts
to the existing `POST /section`. No file upload in the app — the SME publishes
and hosts the bundle (see below) and pastes the resulting URL.

---

## Content & hosting (DevOps + content, one-time)

The published HTML5 folder (e.g. Storyline's `index.html` + `/assets`,
`/html5`, `story_content/…`) must live at a **stable URL on a separate origin**
from the app. Pick one:

- **Cloudflare R2 + Pages** or **S3 + CloudFront** — recommended; cheap, our own
  control, signed URLs possible later.
- **Articulate hosting / Review 360** — fastest to trial, but content lives with
  the vendor.

Convention: one folder per package/version, e.g.
`/packages/<course-slug>/<module-slug>-v<n>/index.html`. Versioning by folder
means re-publishing a course doesn't break learners mid-flight and gives a clean
rollback. Hosting on a separate origin also keeps untrusted package JS out of the
app's origin (defence in depth — see Security).

---

## Completion, tracking & analytics behaviour

- **Completion / certificates / freeze-at-completion**: unchanged. An `EMBED`
  section is one `Section`; it counts in the denominator like any other. Adding
  one to a *completed* course will be covered by the existing freeze-at-completion
  logic (the learner already at 100% stays 100%).
- **`SectionTimeSpent`**: our heartbeat is keyed on a real `sectionId`. While the
  learner is on the `EMBED` section, the frontend should keep sending the normal
  section heartbeat (the iframe is still "the current section"), so coarse
  time-on-section still accrues. We do **not** get per-slide time *inside* the
  package — acceptable, since the package owns its internal navigation.
- **Engagement sweeps** (NEVER_STARTED / STALLED): keep working, because opening
  an `EMBED` section still writes `UserCourseProgress` / heartbeat rows — i.e. the
  learner does not look "never started". (This is precisely the failure mode that
  SCORM-import would have caused.)

---

## Security considerations

- Serve packages from a **separate origin** and keep the `sandbox` attribute on
  the iframe (`allow-scripts allow-same-origin` is required for most authored
  output to run; review per provider). This isolates third-party/authored JS from
  the app.
- Only accept **https** embed URLs; consider an allow-list of permitted host(s)
  in the admin form so a typo/paste can't embed an arbitrary site.
- We are **not** executing uploaded code on our backend — there is no unzip/serve
  path — which removes a large class of risk that SCORM-import would have added.

---

## Phased rollout

1. **Validate for free (this week)** — backend ships `EMBED`; author one module
   in **Lumi (H5P, $0)**, host it, embed it as one section, confirm the player +
   mark-complete + completion math end-to-end. Zero licence spend to de-risk.
2. **Production polish** — if the workflow feels right, buy **Articulate 360**
   (Rise for fast modern courses, Storyline for flagship animated modules like the
   ITCILO screens) or **iSpring** if SMEs prefer PowerPoint. Re-author priority
   modules.
3. **Scale authoring** — train SMEs on the publish→host→paste-URL workflow. No
   engineering per course after step 1.

## Future (only if needed)

- **postMessage completion bridge**: a tiny listener so the package can signal
  true completion/score for `onEnd` gating, without adopting the full SCORM
  runtime ("SCORM-lite"). ~1–2 days frontend + a thin endpoint.
- **xAPI capture**: if we later want formative interaction data, capture xAPI
  statements to a thin endpoint — keep it formative; the server-side Assessment
  engine stays the authority for pass/fail.
- **SCORM/xAPI export**: only when a concrete enterprise buyer requires "run in
  our LMS". Buy Rustici dispatch; do not hand-build. The authoring tool already
  exports the package, so this is a distribution task, not a content rebuild.

## Open decisions

- Hosting target: Cloudflare R2/Pages vs S3/CloudFront vs Articulate hosting?
- Default `completionTrigger` — `onView` (simplest) vs `onEnd` (needs bridge)?
- Authoring tool for production: Articulate 360 vs iSpring (SME PowerPoint
  familiarity) — pick after the H5P validation.

---

# ▶ START HERE (pick-up point — 2026-06-23)

## Recommendation: start with H5P (free, no server, easiest to integrate)

Author in **Lumi Desktop** (free, MIT, GUI) → embed the result with the
**`h5p-standalone`** JS library. Two ways to "do H5P" — use the second to build on:

| Path | What it is | Verdict |
|---|---|---|
| Lumi → export single-file HTML → iframe it | Quickest to *see it work* | ✅ great for a Day-1 demo. ⚠️ some H5P content types need a server and export to a **blank page (CORS)** — not every type survives this. |
| Lumi to author → render the `.h5p` with **`h5p-standalone`** | The robust integration | ✅ **build on this.** Renders `.h5p` from static files + one JS bundle (CDN), no H5P/PHP server, supports fullscreen. |

### Why H5P first (free-options comparison)
- **H5P (Lumi + h5p-standalone)** — ✅ free, ✅ no server, ✅ easiest to integrate, ⚠️ look is "clean & interactive," not bespoke-Storyline. → **best place to start.**
- **Adapt** (open-source) — ✅ free, ✅ best free *look* (responsive, closest to Rise), embeds cleanly. ❌ authoring tool needs a server (Node + MongoDB) — powerful but not "easy." → **free PRODUCTION option if we won't pay for Articulate.**
- **Genially** — prettiest, but free plan keeps watermark and gates custom iframe embed behind Premium → skip for our use case.
- *(Paid, for context: Articulate 360 / iSpring = best polish, not free.)*

After validating the pipeline, the real fork is **Adapt (free, more setup)** vs **Articulate/iSpring (paid, best polish)** — decide based on whether H5P's look is good enough.

> ⚠️ Expectation: the bespoke "presenter character + custom animations" ITCILO look is a **paid-tool + designer** output. Free tools get *clean, modern, interactive* (a big jump from a Quill scroll) but not pixel-identical to ITCILO. The spike below tells us whether "clean + interactive" clears the bar before spending anything.

## First step (no code, ~1 hour, de-risks everything)

Do this *before* writing any backend code:

1. **Download Lumi Desktop** (free). Build one "**Course Presentation**" — a slide deck with images + a quiz; recreate a slice of a real module (e.g. one Fire Safety chapter). ~30 min. → answers *"can a non-dev SME make something that looks good?"*
2. **File → Export → HTML**, double-click it, see it run. → confirms the look.
3. **Integration spike** (~1–2 hrs, one static HTML file): take the `.h5p` (it's a zip — rename to `.zip`, extract), drop in `h5p-standalone` from a CDN, point it at the folder:

```html
<div id="h5p-container"></div>
<script src="https://cdn.jsdelivr.net/npm/h5p-standalone@3/dist/main.bundle.js"></script>
<script>
  new H5PStandalone.H5P(document.getElementById('h5p-container'), {
    h5pJsonPath: '/packages/fire-safety-m1',   // extracted .h5p folder
    frameJs:  'https://cdn.jsdelivr.net/npm/h5p-standalone@3/dist/frame.bundle.js',
    frameCss: 'https://cdn.jsdelivr.net/npm/h5p-standalone@3/dist/styles/h5p.css',
    fullScreen: true,
  });
</script>
```
→ confirms *"we can embed it in our app."* (step-by-step: https://gist.github.com/0xMurage/50140981a3b540a7ad5c24cc60dbaae3)

4. **Then make it real**: backend adds the `EMBED` section type (the 1–3 day part above); frontend renders the section with the snippet + wires mark-complete to the existing `PUT /courses/updateUserChapter/progress`.

## ❓ Open question waiting on Umar

**Should the backend `EMBED` section type be built now** (enum + migration + create/update branch + DTO — the only piece that lives in this repo) so it's ready the moment the frontend wires up the H5P snippet? If yes, that's the next action; the frontend then becomes copy-paste.

### Reference links
- Lumi export — https://help.lumi.education/en/articles/9445824-export-content
- h5p-standalone — https://github.com/tunapanda/h5p-standalone
- Adapt authoring tool — https://github.com/adaptlearning/adapt_authoring
- Genially free plan — https://help.genially.com/en_us/explore-geniallys-free-plan-BkuyxyPn1x
