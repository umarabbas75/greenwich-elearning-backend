# SCORM Cloud Dashboard Settings — Backend Reference

> **Where:** [SCORM Cloud](https://cloud.scorm.com) tenant admin dashboard (Rustici), **not** the Greenwich LMS admin UI.
>
> **Frontend copy:** The Next.js app maintains a fuller dashboard checklist at `greenwich-elearning/docs/scorm-cloud-dashboard-settings.md`. This doc focuses on what **this backend** configures automatically and what still needs manual dashboard setup.

---

## 3.4 Launch behaviour — FRAMESET (required for embedded player)

| | |
| --- | --- |
| **Dashboard (quick test)** | Course → **Course Properties** → **Launch Settings** → **SCO Launch Type** and **Player Launch Type** both **Frameset** |
| **API (production path)** | After each import completes, this backend calls `SetCourseConfiguration` on `scormCloudCourseId` |

### Why it matters

SCORM Cloud defaults to **`NEW_WINDOW`**. With that setting, opening a launch URL does:

```text
Launch URL opens in tab
    → Cloud shows launcher page (“We launched your course in a new window…”)
    → Cloud opens a separate popup window with the course
```

That message is **Rustici’s launcher**, not Greenwich. Pre-opening a tab or fighting popup blockers in JavaScript does not remove it — Cloud is configured to use a popup.

### What this backend does on import

When `completeImportIfReady` sees a successful Cloud import job, it calls:

```http
POST /courses/{scormCloudCourseId}/configuration
```

```json
{
  "settings": [
    { "settingId": "PlayerLaunchType", "value": "FRAMESET", "explicit": true },
    { "settingId": "PlayerScoLaunchType", "value": "FRAMESET", "explicit": true }
  ]
}
```

Implementation: `ScormCloudClient.setCourseConfiguration()` in `src/scorm-cloud/scorm-cloud.client.ts`, invoked from `ScormService.completeImportIfReady()`.

If configuration fails, the package is marked **`FAILED`** with `failureReason` explaining the Cloud error.

### Per-launch exit redirect

`POST /scorm/launch` passes `redirectOnExitUrl` to `BuildRegistrationLaunchLink`:

```text
${PUBLIC_FRONTEND_URL}/studentCourses/{courseId}/scorm
```

Not bare `/` — otherwise the iframe can land on the login page when the session cookie isn’t sent on cross-site redirect.

Implementation: `scormPlayerReturnUrl()` in `src/utils/scorm-player-url.ts`.

### Target learner experience (after FRAMESET)

```text
Click "Start course"
    → POST /scorm/launch
    → iframe fills with SCORM player (Rise/Storyline UI)
    → learner plays inside Greenwich
    → Exit → redirect back to /studentCourses/{courseId}/scorm
```

### Courses imported before this change

Re-import the package, or set **Frameset / Frameset** manually in the SCORM Cloud dashboard for that course, then test **Start course** on the player page.

### Launch types

| Value | UX |
| --- | --- |
| `NEW_WINDOW` (default) | Launcher tab + popup — **avoid** |
| `NEW_WINDOW_AFTER_CLICK` | Same, with explicit click — **avoid** |
| `FRAMESET` | Inline in iframe or full tab — **use this** |

---

## Related env vars

| Variable | Purpose |
| -------- | ------- |
| `PUBLIC_FRONTEND_URL` | Base for `redirectOnExitUrl` (must match the environment the learner uses) |
| `PUBLIC_APP_URL` | Postback URL host (`/api/v1/scorm/postback`) |
| `SCORM_CLOUD_APP_ID` / `SCORM_CLOUD_SECRET_KEY` | API auth for import, configuration, launch |

---

## Backend handoff (one-liner)

> On SCORM import complete, call `SetCourseConfiguration` with `PlayerLaunchType=FRAMESET` and `PlayerScoLaunchType=FRAMESET`. Set `redirectOnExitUrl` to `${PUBLIC_FRONTEND_URL}/studentCourses/${courseId}/scorm` on `BuildRegistrationLaunchLink`. Without FRAMESET, Cloud always shows the popup launcher page regardless of frontend launch mode.
