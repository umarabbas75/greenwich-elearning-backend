# Learner Registration Form v2 — Backend Handoff

**Owner (frontend):** Course-forms surface
**Related docs:** [`registration-form-v2-plan.md`](./registration-form-v2-plan.md), [`course-forms-flow.md`](./course-forms-flow.md)
**Status:** ✅ Frontend + backend both live. Advisor endpoint delivered by backend, frontend hook wired with `userId`.

This note describes the frontend contract for the new universal **Learner Registration Form (v2)** and the **advisor review** flow it introduces. Nothing about the existing `POST /courses/markFormComplete/` contract has changed for the learner; the only new endpoint is for advisor review.

## Delivery status (2026-08-17)

Backend confirmed:

- **Learner submit** — `POST /courses/markFormComplete/` unchanged. Learner v2 payload lands verbatim.
- **Advisor review** — `POST /api/v1/courses/updateFormMetadata` shipped. Admin JWT only. Overwrites `metaData` on the existing completion. Does **not** touch `isComplete`, `completedAt`, uploaded photos, emails, or enrollment.
- Backend validates: `bookingFormVersion === "GWTC/IQA-R0014 · 15/08/2026"` (v2 only), advisor yes/no fields, `registrationStatus`, `advisorSignature` (≥ 2 chars), `advisorDate` (YYYY-MM-DD).
- **Contract change picked up on frontend:** the request body now includes `userId` (the learner). `courseFormId` identifies the course–form assignment, not a person, so the review cannot be saved without it. `useUpdateCourseFormMetadata` has been updated to send `userId` and guards submit if it's missing.
- Success response shape: `{ "success": true, "form": { ... } }`. Errors: `{ "detail": "..." }` (same as `markFormComplete`).
- Existing v1 rows are **not** rewritten. Address/photo promotion still works for v2 (`address` and `userPhoto`).

---

## 1. Context

The old NEBOSH-shaped "Course Booking Form" has been replaced by a universal 12-section **Learner Registration Form** used for every course and every new enrollment. See `docs/registration-form-v2-plan.md` for the full field-by-field plan.

Two audiences write to the same submission record:

1. **Learner** — fills sections 1–12 and submits via the existing `POST /courses/markFormComplete/` endpoint. **No backend change required for this path.**
2. **Learning Advisor** (admin) — reviews the learner's submission and fills **Section 13 (Learning Advisor Use Only)** via a new endpoint documented below.

Backwards compatibility: legacy (v1) submissions still exist in the DB. They are detected by the `bookingFormVersion` field on `metaData` and are rendered read-only in the old layout. The advisor-review flow is **v2-only** and the frontend blocks it for legacy submissions.

Form version constants:

| Version | `bookingFormVersion` string   | Meaning                           |
| ------- | ----------------------------- | --------------------------------- |
| v1      | `GWTC/IQA-R0013 · 05/05/2026` | Legacy NEBOSH-shaped booking form |
| v2      | `GWTC/IQA-R0014 · 15/08/2026` | Universal learner registration    |

Any missing/empty `bookingFormVersion` should be treated as v1 (legacy).

---

## 2. What the learner submits — v2 `metaData` shape

Sent as the `metaData` field of the existing `POST /courses/markFormComplete/` request. Same envelope as before:

```json
{
  "courseId": "...",
  "formId": "registration-form",
  "courseFormId": "...",
  "metaData": { ... see below ... }
}
```

### Top-level keys

All fields are strings unless noted. Radios use `"yes"` / `"no"`. Multi-selects are arrays.

```jsonc
{
  // Section 1 — Course information
  "courseTitle": "string (prefilled from course context, locked)",
  "modeOfLearning": "E-learning (LMS) | Blended Learning",
  "startDate": "YYYY-MM-DD",
  "learningAdvisorName": "Muhammad Waqas", // hardcoded, disabled input

  // Section 2 — Personal information
  "title": "Mr. | Mrs. | Miss | Ms. | Dr. | Other",
  "fullName": "string",
  "dateOfBirth": "YYYY-MM-DD",
  "gender": "Male | Female | Other",
  "nationality": "string",
  "countryOfResidence": "string (ISO country name)",
  "idNumber": "string (CNIC/Passport)",

  // Section 3 — Contact information
  "address": "string (residential address, multi-line)",
  "city": "string",
  "state": "string",
  "postalCode": "string",
  "country": "string (ISO country name)",
  "mobileNumber": "string (with country code)",
  "whatsappNumber": "string",
  "email": "string (validated as email)",

  // Section 4 — Employment (nested)
  "employment": {
    "status": "Employed | Self-employed | Student | Unemployed | Retired",
    "jobTitle": "string",
    "employer": "string",
    "industry": "string",
    "yearsExperienceOHS": "string"
  },

  // Section 5 — Education (nested)
  "education": {
    "highestQualification": "Secondary School | Higher Secondary | Diploma | Bachelor's Degree | Master's Degree | Doctorate | Other",
    "qualificationTitle": "string",
    "institution": "string",
    "yearCompleted": "YYYY (4 digits)"
  },

  // Section 6 — English & Learner Needs (nested)
  "englishSkills": {
    "reading": "Excellent | Good | Fair | Limited",
    "writing": "Excellent | Good | Fair | Limited",
    "speaking": "Excellent | Good | Fair | Limited",
    "listening": "Excellent | Good | Fair | Limited"
  },
  "englishQualifications": [
    "IELTS",
    "TOEFL",
    "PTE",
    "OET",
    "Medium of Instruction in English",
    "Other"
  ], // multi-select subset
  "englishQualificationScore": "string (required only if englishQualifications non-empty)",
  "computerSkills": {
    "computerLaptop": "yes | no",
    "internetBrowsing": "yes | no",
    "email": "yes | no",
    "microsoftWord": "yes | no",
    "fileConversion": "yes | no",
    "uploadingFiles": "yes | no",
    "lms": "yes | no"
  },
  "techAccess": {
    "computerLaptop": "yes | no",
    "internet": "yes | no",
    "microphone": "yes | no",
    "webcam": "yes | no",
    "smartphone": "yes | no"
  },

  // Section 7 — Special consideration
  "hasDisability": "yes | no",
  "disabilityDetail": "string (required when hasDisability === 'yes')",
  "reasonableAdjustments": [
    "Extra assessment time",
    "Alternative assessment arrangements",
    "Accessible learning materials",
    "Screen reader compatible resources",
    "Large print",
    "Other"
  ], // multi-select subset
  "reasonableAdjustmentsDetail": "string (required when reasonableAdjustments contains 'Other')",

  // Section 8 — Country-specific requirements
  "countryOfUse": "string",
  "hasLocalRequirements": "yes | no",
  "localRequirementsDetail": "string (required when hasLocalRequirements === 'yes')",
  "verificationServices": [
    "Apostille",
    "Embassy Attestation",
    "Notarisation",
    "Additional Verification Letter",
    "None"
  ], // multi-select subset

  // Section 9 — Emergency contact (nested)
  "emergencyContact": {
    "name": "string",
    "relationship": "string",
    "telephone": "string",
    "email": "string (validated)"
  },

  // Section 10 — Documents
  "userPhoto": "https://...cloudinary URL (JPEG/PNG/WEBP ≤ 1 MB)",
  "passportOrIdFile": "https://...cloudinary URL (JPEG/PNG/WEBP/PDF ≤ 2 MB)",
  "providedDocuments": {
    "passportOrId": true, // auto-ticks when passportOrIdFile uploads
    "photograph": true, // auto-ticks when userPhoto uploads
    "educationalQualification": false, // self-declared
    "academicTranscript": false,
    "englishEvidence": false,
    "cvResume": false,
    "employerApproval": false
  },

  // Section 11 — Declarations (all five must be true to submit)
  "declarations": {
    "informationTrue": true,
    "falseInfoConsequences": true,
    "policiesCompliance": true,
    "dataConsent": true,
    "additionalVerification": true
  },

  // Section 12 — Learner signature
  "signature": "string (learner types their full name, 2–100 chars)",
  "formCompletionDate": "YYYY-MM-DD (auto = today)",

  // Section 13 — LEFT EMPTY on learner submit; populated by advisor review flow below.
  "advisor": {
    "learnerEligibilityConfirmed": "",
    "identityDocsVerified": "",
    "entryRequirementsMet": "",
    "englishRequirementMet": "",
    "needsAssessmentCompleted": "",
    "reasonableAdjustmentsRequired": "",
    "specialConsiderationRequired": "",
    "registrationStatus": "",
    "comments": ""
  },
  "advisorSignature": "",
  "advisorDate": "",

  // Version stamp
  "bookingFormVersion": "GWTC/IQA-R0014 · 15/08/2026"
}
```

### File uploads

`userPhoto` and `passportOrIdFile` are **uploaded to Cloudinary directly from the browser** before the metaData POST — the backend only ever sees the resulting HTTPS URLs (`secure_url`). PDF uploads use Cloudinary `resource_type=raw`; images use `resource_type=image`. Nothing new for the backend here; same pattern as v1's `userPhoto`.

### Field name delta from v1 → v2

Fields that changed shape or name (backend team may want to migrate reporting queries):

| v1 field(s)                                                                                                                          | v2 field                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `givenName` + `surname`                                                                                                              | `title` + `fullName`                                                                                                                                                                                                   |
| `country` (residence)                                                                                                                | `countryOfResidence`                                                                                                                                                                                                   |
| `houseStreetNumber` + `mainAddress`                                                                                                  | `address` (single field) + `state` + `postalCode`                                                                                                                                                                      |
| `workTelephone`                                                                                                                      | _removed_                                                                                                                                                                                                              |
| `occupation`                                                                                                                         | _replaced by_ `employment.*`                                                                                                                                                                                           |
| `studyMethod` (`E-Learning`)                                                                                                         | `modeOfLearning` (`E-learning (LMS)` / `Blended Learning`)                                                                                                                                                             |
| `examType`, `isGreenwichLearner`, `learningPartnerName`, `neboshLearnerNumber`, `examTakenDate`, `resitUnits.*`, `resitAssessment.*` | _dropped from v2 write path_ (still readable from v1 records)                                                                                                                                                          |
| `needsAssessment.*` (~30 legacy sub-fields)                                                                                          | _replaced by_ `englishSkills.*`, `computerSkills.*`, `techAccess.*`, `englishQualifications`, `englishQualificationScore`, `hasDisability`, `disabilityDetail`, `reasonableAdjustments`, `reasonableAdjustmentsDetail` |

**IMPORTANT:** v1 records must still be readable — the frontend renders them via a legacy read-only view keyed off `bookingFormVersion`. Do **not** rewrite existing rows to the v2 shape.

---

## 3. Advisor Review Endpoint (delivered)

### `POST /api/v1/courses/updateFormMetadata`

Admin JWT only. Overwrites `metaData` on the existing completion without touching `isComplete`, `completedAt`, uploaded photos, emails, or enrollment.

**Request body (JSON)**

| Field          | Type   | Required | Description                                                                                                                                                  |
| -------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `courseId`     | string | yes      | Course instance identifier (same value as `markFormComplete`).                                                                                               |
| `formId`       | string | yes      | Form type identifier (`"registration-form"`).                                                                                                                |
| `courseFormId` | string | yes      | Course–form assignment id (identifies which assignment, not which person).                                                                                   |
| `userId`       | string | yes      | Learner whose submission is being reviewed. **Required** — backend cannot resolve the person from `courseFormId` alone.                                      |
| `metaData`     | object | yes      | Full merged metadata bag — original learner fields plus updated `advisor.*` / `advisorSignature` / `advisorDate`. Backend overwrites the stored bag with it. |

**Frontend behaviour (implemented)**

- Sends the full merged metadata bag rather than a delta, so backend can safely overwrite the entire `metaData` blob.
- Prefills the form from previously stored `advisor.*` values on revisit, so admins can iterate on a review.
- `useUpdateCourseFormMetadata.submit({ userId, metaData })` — hook signature explicitly takes `userId` and refuses to fire without it.
- `AdvisorReviewForm` receives `userId` via prop from the route (`/user/[userId]/forms/course-booking-form/advisor-review`).

**Example request**

```jsonc
{
  "courseId": "...",
  "formId": "registration-form",
  "courseFormId": "...",
  "userId": "<learner id>",
  "metaData": {
    "...allLearnerFieldsFromSection1Through12": "...",
    "advisor": {
      "learnerEligibilityConfirmed": "yes | no",
      "identityDocsVerified": "yes | no",
      "entryRequirementsMet": "yes | no",
      "englishRequirementMet": "yes | no",
      "needsAssessmentCompleted": "yes | no",
      "reasonableAdjustmentsRequired": "yes | no",
      "specialConsiderationRequired": "yes | no",
      "registrationStatus": "Approved | Pending | Rejected",
      "comments": "string (optional, free text)"
    },
    "advisorSignature": "Muhammad Waqas",
    "advisorDate": "YYYY-MM-DD",
    "bookingFormVersion": "GWTC/IQA-R0014 · 15/08/2026"
  }
}
```

**Success response**

```json
{ "success": true, "form": { "...persistedRecord": "..." } }
```

**Error response**

```json
{ "detail": "human readable message" }
```

Frontend surfaces `detail` (or `message`, or string body) in a destructive toast, same as `markFormComplete`.

### Backend-side validation (confirmed live)

- `metaData.bookingFormVersion === "GWTC/IQA-R0014 · 15/08/2026"` — otherwise rejected (v2-only endpoint).
- Every `advisor.*` yes/no field must be `"yes"` or `"no"`.
- `advisor.registrationStatus` must be one of `Approved | Pending | Rejected`.
- `advisorSignature` non-empty string, ≥ 2 chars.
- `advisorDate` valid `YYYY-MM-DD`.

Frontend enforces the same rules via `buildCourseBookingAdvisorReviewSchema()` (`src/lib/forms/course-booking-form-schema.ts`).

### Deferred

- No audit log of previous advisor decisions yet. If desired later, backend can append to a `metaData.advisor.history: [...]` array; frontend will render it read-only.

---

## 7. NEW — Registration approval gate, emails, notifications

Frontend now treats registration as **submitted ≠ approved**. Learner submit stamps `advisor.registrationStatus: "Pending"`. Advisor review overwrites it with `Approved | Pending | Rejected`.

### 7.1 `GET /courses/canAccessCourseContent/:courseId`

Keep the existing rule (all required forms complete **and** all policies complete) **and** add:

- For a v2 registration form (`bookingFormVersion === "GWTC/IQA-R0014 · 15/08/2026"`), `canAccessContent` must be `false` unless `metaData.advisor.registrationStatus === "Approved"`.
- Do **not** block completing other forms or policies. Those endpoints stay open.
- Legacy v1 submissions have no advisor status — keep current behaviour (form complete is enough).

Suggested extra fields on the gate response (frontend already reads them when present):

```json
{
  "canAccessContent": false,
  "reason": "REGISTRATION_PENDING",
  "registrationStatus": "Pending",
  "registrationComments": "optional advisor comments",
  "message": "Your registration is waiting for advisor approval."
}
```

`reason` values we handle: `REGISTRATION_PENDING` | `REGISTRATION_REJECTED` | anything else falls back to the generic requirements copy.

`GET /courses/getAllAssignedCourses/:userId` rows should use the same `canAccessContent` rule. Optionally include `formStatus.forms[].metadata` (or at least `advisor.registrationStatus` + `advisor.comments`) so the course card can show waiting/rejected copy without a second fetch.

`GET /users/:userId` `courses[].forms[]` should include `courseFormId` plus full `metadata` so the admin View → Review as Advisor URL can be built, and so the learner can reopen the form and see comments.

### 7.2 Emails (backend sends; frontend documents the links)

Recipient for the admin email is **whatever mailbox backend already uses for org/admin mail**. Frontend does not pick the address.

| When                                                                           | To                             | Purpose                                                                                                | Link                                                                                                                                          |
| ------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Learner `POST /courses/markFormComplete/` for v2 registration                  | Admin mailbox (more important) | “A learner submitted a registration form — please review”                                              | `/user/{userId}/forms/course-booking-form/advisor-review?viewOnly=1&courseId={courseId}&formId=registration-form&courseFormId={courseFormId}` |
| Same submit                                                                    | Learner                        | “We received your registration. Wait for advisor approval. You can still complete other requirements.” | `/studentCourses/{courseId}/course-form-page`                                                                                                 |
| Advisor saves `registrationStatus` (`POST /api/v1/courses/updateFormMetadata`) | Learner                        | Approved / Pending / Rejected, include comments                                                        | `/studentCourses/{courseId}/course-form-page/forms/course-booking-form?viewOnly=1&courseId={courseId}`                                        |

Login bounce is already handled (`/login?from=...`). Do not double-encode the path.

### 7.3 In-app notifications (frontend routing is live)

| Type                     | Recipient   | `payload`                                                                                    | Click-through                       |
| ------------------------ | ----------- | -------------------------------------------------------------------------------------------- | ----------------------------------- |
| `REGISTRATION_SUBMITTED` | Admin users | `{ userId, courseId, courseTitle, formId, courseFormId, studentFirstName, studentLastName }` | Advisor review URL above            |
| `REGISTRATION_REVIEWED`  | Learner     | `{ courseId, courseTitle, registrationStatus, comments }`                                    | Learner registration view URL above |

`referenceId` can be `courseId`. Send `REGISTRATION_REVIEWED` on every advisor save (Approved, Pending, or Rejected) so the learner sees status + comments.

### 7.4 Learner UX (frontend already shipped)

- Rejected: view-only. Comments visible. Cannot resubmit.
- Pending / not yet reviewed: view-only wait state. Other forms and policies stay available.
- Approved: start-course unlocks only if the existing forms+policies rule is also satisfied.

---

## 4. Read paths / reporting implications

- The user forms endpoint (`GET /users/:userId`, `courses[].forms[].metadata`) must return the same `metaData` bag stored above. Advisor fields will appear as nested keys — reporting layers should treat unknown keys gracefully.
- New "photo/document" metadata keys excluded from flattened field tables in the UI: `userPhoto`, `passportOrIdFile`. Everything else is exported as a labelled row in the PDF appendix and the "Submitted responses" modal.
- Human-readable labels for both the v1 and v2 field paths live in the frontend (`COURSE_BOOKING_ALL_FIELD_LABELS` in `src/lib/forms/course-booking-needs-assessment-data.ts`). Backend does not need to know them.
- `formId` and `pathSegment` are unchanged — `"registration-form"` / `course-booking-form`. Frontend routing keys off `bookingFormVersion` alone.

---

## 5. Rollout status

- ✅ Backend `POST /api/v1/courses/updateFormMetadata` live, admin JWT gated.
- ✅ Frontend hook `useUpdateCourseFormMetadata` sends `userId` + guards on missing values.
- ✅ Admin can access the review via **Review as Advisor** button on `/user/[userId]/forms/course-booking-form?...`, which routes to `.../course-booking-form/advisor-review?...` with the required query params.
- ⏳ Reporting queries can be migrated to the v2 key layout when convenient (non-blocking; `COURSE_BOOKING_ALL_FIELD_LABELS` on frontend already labels both v1 and v2 keys for the PDF appendix and "Submitted responses" modal).
- ⏳ **Backend still needed for production approval flow (§7):** `canAccessContent` stays false until `advisor.registrationStatus === "Approved"`; emails on submit + review; `REGISTRATION_SUBMITTED` / `REGISTRATION_REVIEWED` notifications; `courseFormId` on `GET /users/:id` form rows.

---

## 6. Contacts / follow-ups

- Frontend impl: `CourseBookingFormV2.tsx` (learner), `advisor-review/AdvisorReviewForm.tsx` (advisor), `useUpdateCourseFormMetadata.ts` (hook).
- Version constants: `src/lib/forms/course-booking-registration.ts` (`COURSE_BOOKING_DOC_REF`, `COURSE_BOOKING_DOC_REF_V2`, `isLegacyBookingSubmission`).
- Schema (advisor): `src/lib/forms/course-booking-form-schema.ts` → `buildCourseBookingAdvisorReviewSchema()`.
- Open frontend follow-ups tracked in `docs/registration-form-v2-plan.md` §Risk register.
