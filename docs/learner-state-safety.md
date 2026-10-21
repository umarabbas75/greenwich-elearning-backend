# Learner state safety rules

On 17 Oct 2026 one admin "Save" on the NEBOSH IGC course deleted and recreated
its forms, policies and feedback form. That erased every learner's submissions,
re-dated the requirements, locked mid-course learners out, emailed every admin
and re-sent feedback reminders. The fix was then merged without rebuilding
`dist/`, so production kept doing it. These rules exist so it cannot happen
again. Every change touching courses, requirements, completions or
certificates must follow them.

## 1. An admin edit never deletes learner records

- Saving a course updates forms, policies, policy items and the feedback form
  **in place**, matched by id. It never `deleteMany` + recreate.
- Removing a form, policy or policy item **detaches** it (`detachedAt`). The
  row and every learner's submission or acknowledgement stay as evidence.
- Adding it back **re-attaches the same row** (matched by id, else by title)
  and appends the removal period to `detachedWindows`. Never create a fresh
  row for it: a new row has a new anchor, which waives it for everyone
  already enrolled and hides their earlier acknowledgements.
- `course.service.update-course.spec.ts` has an invariant test ("never deletes
  anything, however much an admin removes in one save"). Keep it passing; do
  not weaken it.
- The only paths that delete learner records are explicit, audited, admin
  actions that say so (force unassign, reset progress, course delete, hard
  delete of curriculum no version references).

## 2. A new rule only applies to people who start after it

Every requirement carries the moment it starts to apply, and is checked against
the learner's own moment:

| Requirement | Anchor | Compared with |
| --- | --- | --- |
| Course form (visible / submittable) | `course_forms.createdAt`, minus `detachedWindows` | `user_courses.createdAt` |
| Course form (required) | `course_forms.requiredSince` | `user_courses.createdAt` |
| Policy | `policies.createdAt`, minus `detachedWindows` | `user_courses.createdAt` |
| Policy item | `policy_items.requiredSince`, minus `detachedWindows` | `user_courses.createdAt` |
| Course feedback | `course_feedback_forms.requiredSince` | `course_completions.courseCompletedAt` |
| Access after completion | max(`validityDaysAtCompletion`, current `validityDays`) | `courseCompletedAt` |
| Assessment attempts | max(current `maxAttempts`, each attempt's `snapshotMaxAttempts`) | attempts taken |

- Switching something from optional to required moves its anchor to "now".
- Anything already achieved stays achieved: a recorded course completion, an
  issued certificate, a completed chapter. Later content or rule changes must
  not take them away (`courseCompletedAt`, `certificateUrl`,
  `user_chapter_completions` win over live recomputation).
- A policy counts as complete when every item it requires of the learner is
  acknowledged, even if its own acknowledgement row was never written.
- Use the helpers in `src/utils/` (`course-form-applicability.ts`,
  `feedback-applicability.ts`, `course-access-expiry.ts`) rather than writing a
  new comparison.

## 3. One server-side answer per question

The backend decides access (`canAccessCourseContent`, `getAllAssignedCourses`)
and returns `canAccessContent`, `reason`, `registrationStatus`. The frontend
displays those; it must not re-derive locks from raw forms, policies or
metadata.

- A learner's requirements are the same whoever asks: an admin viewing a
  learner gets that learner's forms and policies, not every one on the course.
- Recorded chapter completions are sent per chapter (`completedAt` from
  `getAllUserModules`) and the course page treats them as complete, matching
  `assertChapterAccessible`.
- Inactive enrolment and expired access gate learners only
  (`assertEnrollmentUsable`); pass the caller's role.

## 4. Every high-impact admin write is attributed

Call `writeAdminAudit` (`src/utils/admin-audit.ts`) or
`CourseVersionService.writeAudit` for any admin action that changes the rules
or records of learners who already have state: course create/save/activate,
version publish/prune, assessment activate/deactivate, manual certificates,
SCORM imports, assignment deletion, category assignment, progress resets,
curriculum hard deletes. Record what changed (before/after, rows removed), not
just that something happened.

Admin-only routes use `AuthGuard('jwt')`. `cJwt` also accepts learners, so a
`cJwt` route that changes or lists other people's records needs a role check
in the service. `assignment.controller.guards.spec.ts` pins the assignment
routes.

## 5. Notifications must survive data changes

- Links in notifications and emails carry ids that a later save may replace.
  Endpoints that act on them must resolve by stable keys
  (learner + course + form), not trust a stale id.
- CC copies to the admin inbox only go out when a new notification row was
  inserted, so retries and double submits do not re-mail.
- Never delete notifications to "reset" them; mark them read. Reminder caps
  count the rows.

## 6. Deploying

`dist/` is committed and is what Vercel serves.

1. If the change has a Prisma migration, run `npx prisma migrate deploy`
   against production **before you merge or push to main**. Migrations here
   are additive, so the old code keeps working; new code that reads a column
   the database does not have yet fails on every learner page.
2. `yarn build`, commit `src/`, `prisma/` and `dist/` together.
3. `yarn check:dist` must print `dist/ matches src/.` before you push.
