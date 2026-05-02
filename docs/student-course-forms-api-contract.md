# Student course requirements forms — API contract (frontend ↔ backend)

This document describes how the Next.js app calls the backend when a student completes a **course requirement** form, so backend changes stay aligned with the client.

The HTTP API is served under the global prefix **`/api/v1`** (see `src/main.ts`). Paths below are relative to that prefix unless noted.

## Endpoints in use

| Action | Method | Path | Notes |
|--------|--------|------|--------|
| Mark form complete | `POST` | `/courses/markFormComplete` | Primary completion event; see payload below. |
| Form status (optional) | `GET` | `/courses/:courseId/forms/status` | Server truth for which forms are complete for the current user. |

## `POST /courses/markFormComplete`

**Request body (JSON)**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `courseId` | string | yes | Course instance the student is enrolled on. |
| `formId` | string | yes | Form type identifier (must match what the admin attached to the course). |
| `courseFormId` | string | yes | Link row ID (`course_forms.id`) for this course–form assignment. |
| `metaData` | object | no | Form-specific answers; shape varies by form. Omitted when empty. |

**Behaviour the frontend assumes**

- Success: `2xx` response; body is not parsed for business logic today (only success toast + cache refresh + redirect). Replays after completion may return **`alreadyCompleted: true`** (still `200`).
- Failure: client surfaces `detail`, `message`, or string body from the error response in a toast when present.

**Backend behaviour (implemented)**

- Validates body (`MarkFormCompleteDto`); missing fields → `400` with validation messages.
- Ensures `courseFormId` exists and matches the given `courseId` and `formId` → otherwise **`400`** with `{ "detail": "…" }`.
- Ensures the user has an appropriate **`user_courses`** row for that course (active enrolment for role `user`) → otherwise **`403`** with `{ "detail": "…" }`.
- If the form is **already complete** for `(user, course, formId)`, returns **`200`** with `{ "alreadyCompleted": true, … }` without failing.

## `GET /courses/:courseId/forms/status`

**Auth:** same JWT guard as other student course routes.

**Response shape**

```json
{
  "courseId": "<uuid>",
  "forms": [
    {
      "courseFormId": "<uuid>",
      "formId": "policies-declaration",
      "formName": "Policies Receipt Declaration",
      "isRequired": true,
      "isComplete": false,
      "completedAt": null
    }
  ]
}
```

Returns **`403`** with `{ "detail": "…" }` if the user is not assigned to the course (same rules as `markFormComplete`).

## Structured errors

Prefer **`{ "detail": "<human readable>" }`** for domain failures so the client toast can show `response.data.detail` (see `useMarkCourseFormComplete` in the frontend).

## Frontend registry

Dashboard labels and URL segments for forms are centralised in the Next.js app:

`src/lib/course-forms/registry.ts`

`formId` values there must stay consistent with API `formId` values and with rows in `course_forms.form_id`.

## Frontend implementation notes (reference)

- Params `courseId`, `formId`, `courseFormId` are read from the query string (with route fallback for `courseId` where implemented). If any are missing, the UI blocks submit and shows an “Incomplete link” alert.
- After success, the client invalidates and refetches `['get-all-assigned-courses', userId]` then redirects: uses `returnUrl` query param only if it is a same-origin relative path; otherwise `/studentCourses`.
- **Course booking form** uploads the learner photo to Cloudinary first, then sends `metaData` including the image URL and `bookingFormVersion` (document reference string).
