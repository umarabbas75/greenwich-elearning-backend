# Role & Permission System (RBAC) — Design & Implementation Plan

**Owner:** Backend (Umar)
**Status:** 📋 Planned — not yet implemented. This document is the agreed design; implementation is a single PR + single migration.
**Audience:** Backend (implementer), Frontend (portal + login changes), stakeholder (Sir Tayyeb) for scope sign-off.
**Rev 2 (post-review):** Incorporated code-review amendments — `role.slug`/`role.isLearner` for stable identity + learner data-scoping (§4.1), wider user-route security audit + `JwtAuthGuard` retirement + inactive-user check (§1.3, §7), login/`auth/me` response contract with `permissions` (§7), Super Admin promotion moved out of SQL migration into seed only (§8), CI route-coverage guard + revised 6–8 day estimate (§12).
**Rev 3 (post-2nd-review):** Resolved P0/P1 — confirmed & flagged the unauthenticated `assignCourse/public` enrollment hole as urgent-standalone (§1.3, §14), custom-role slug generation rule (§6.1), `isLearner` editability + the isLearner-vs-permission conflict rule (§4.2), completed §5 seeded-roles table with slug/isLearner, corrected contact-message scoping to permission-based (§4.1), `User` model `AdminAction` relations (§3), system-role edit semantics aligned (§10), public-route allowlist (§14).

---

## 1. Requirements

### 1.1 What the client asked for

> "We need to create one super admin, and its own portal. Then super admin should be able to create more admins and more users. It should be a flexible system."
>
> Follow-up: "Super admin should be able to create another role like **Moderator** and then assign permissions — what a moderator can do and what not. For each role, super admin should be able to select permissions: course create/edit/update/delete/read, assessment create/read/delete/mark, etc."

Decoded into concrete requirements:

| # | Requirement |
|---|---|
| R1 | A **Super Admin** tier sits above everything. Single bootstrapped account to start. |
| R2 | Super Admin can **create / edit / delete roles** at runtime (e.g. invent a "Moderator" role) — without code changes or redeploys. |
| R3 | Each role has a **selectable set of permissions**. Super Admin ticks boxes ("course: create, read; assessment: grade") to define what a role can do. |
| R4 | Super Admin can **create users and admins**, and assign any role to them. |
| R5 | The system must be **flexible** — new roles and new permission combinations are data, not hardcoded. |
| R6 | Super Admin gets **its own portal** (frontend), distinct from the existing admin area. |

### 1.2 Decisions locked with stakeholder

| Decision | Choice | Rationale |
|---|---|---|
| Authorization model | **Full DB-backed RBAC** (roles + permissions are rows, runtime-editable) | R2/R3/R5 require runtime-configurable roles — code-based roles can't satisfy this. |
| Permission granularity | **Coarse** — CRUD + special actions (~80 permissions, 22 resource groups) | Fine-grained (~300+) makes the role-edit UI a maze. Coarse is manageable and covers the asks. |
| Per-user overrides | **No** — strictly role-based | One source of truth per user. "What can Sarah do?" = "what does her role allow?" Simpler to audit. |
| Public signup | **Keep public signup**, but split it: `POST /auth/register` (public, forces Student role) vs `POST /users` (admin-only, can assign any role) | Students can self-register; nobody can self-promote to admin. |
| First Super Admin | **One-time seed script** (`npm run seed:super-admin`, env-driven) | Explicit, repeatable, doesn't run on every boot. |
| Admin → user creation | **Yes** — admins can create/manage students; only Super Admin (or a role granted `user:assign-role`) can create other admins | Avoids a super-admin bottleneck for routine student onboarding. |
| Audit log | **Yes** — basic who-did-what-to-whom | Accountability for sensitive actions (role changes, deactivations). |
| Scope of permissions | **Global only** (NOT course-scoped per admin) | Course-scoped admins ("Sarah is admin only for NEBOSH") is a separate ABAC axis, explicitly out of scope. See §9. |

### 1.3 Current state (what exists today)

- **`Role` enum**: `admin | user` only. No permissions. `prisma/schema.prisma`.
- **JWT payload**: `{ sub, email }` — role not included; every request re-fetches the user to check role.
- **Three JWT strategies**: `JwtAdminStrategy` (`'jwt'`, admin-only), `JwtUserStrategy` (`'uJwt'`, user-only), `JwtCombineStrategy` (`'cJwt'`, both). Each hardcodes a role-string check inside `validate()`.
- **Scattered role checks**: 3 manual `role !== 'admin'` checks (`course.service.ts:3648`, `assignment.service.ts:211`, `assignment.service.ts:723`).
- **No RBAC infra**: no CASL/Casbin/AccessControl. No `@Roles()` decorator. Only a `GetUser` param decorator.
- **🔴 Security holes (wider than one route — full user-route audit required)**:
  - `POST /users/` — auth guard commented out (`user.controller.ts:37-41`), passes `body.role` straight to the DB. Anyone can create an admin account.
  - `GET /users/:id` — **no guard at all** (`user.controller.ts:31-35`). Any unauthenticated caller can read any user record.
  - `GET /users/` — `cJwt` only, no permission check: **any** logged-in user (including a student) can list every user in the system.
  - 🔴🔴 **`PUT /course/assignCourse/public/:userId/:courseId`** (`course.controller.ts:322`) — **NO guard at all.** Anyone on the internet can enroll any user into any course by hitting the URL. **Worse than `POST /users`** because it silently mutates enrollment with zero auth. **Recommend patching standalone this week — do not wait for the RBAC project** (it's a two-line guard). See §14.
  - `GET /course/getAllAssignedCourses/public/:id` (`course.controller.ts:361`) — has `cJwt` but no ownership check; any logged-in user can read any user's enrollments by id.
  - **Second auth path**: `JwtAuthGuard` (`auth/jwt.guard.ts`) on `GET /auth/me` verifies the JWT locally and sets `request.user = decoded` — **no DB load, no status check, no role**. This guard must be retired or aligned with the unified Passport strategy during consolidation.
  - **`JwtCombineStrategy` swallows errors** (`jwt.strategy.ts:158-161`): `catch (error) { console.log(...) }` → `validate()` returns `undefined` instead of throwing on an expired/invalid token. Latent auth-bypass. **Fixing this is part of strategy consolidation, not optional cleanup.**

  **Implementation rule: audit EVERY route in `user.controller.ts` and every `public` route, not just `POST /users`.**

---

## 2. Proposed solution — overview

Replace the two-value `Role` enum with a **relational RBAC schema**:

```
User ──many-to-one──> Role ──many-to-many (RolePermission)──> Permission
```

- **Roles** are rows. Super Admin can create/edit/delete them at runtime.
- **Permissions** are a fixed catalog (seeded from code; coarse CRUD + special actions). They are the *vocabulary* of what the system can gate.
- **RolePermission** is the editable join: which permissions each role holds. This is the checklist the Super Admin ticks.
- **Super Admin role** is special (`isSystem = true`): bypasses all permission checks (implicitly holds everything, including permissions added in future), and cannot be deleted, renamed, or have its permissions edited.
- Authorization moves out of the JWT strategies and into a single `@RequiresPermission(...)` decorator + guard.

---

## 3. Schema design

```prisma
model Role {
  id          String           @id @default(uuid())
  slug        String           @unique          // IMMUTABLE stable id: "super-admin" / "admin" / "student" / "moderator" / custom. Never changes even if name is edited.
  name        String           @unique          // EDITABLE display label: "Super Admin" / "Course Manager" / ...
  description String?
  isSystem    Boolean          @default(false)  // Super Admin only — cannot be deleted/renamed/edited
  isLearner   Boolean          @default(false)  // true for Student. Drives learner-vs-operator data scoping (see §4.1). Custom roles default false.
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
  permissions RolePermission[]
  users       User[]
  @@map("roles")
}

model Permission {
  id          String           @id @default(uuid())
  key         String           @unique          // "course:create" — the string used in @RequiresPermission
  resource    String                            // "course" — for grouping in the UI
  action      String                            // "create" — for the checkbox label
  description String?                           // human-readable tooltip
  roles       RolePermission[]
  @@index([resource])
  @@map("permissions")
}

model RolePermission {
  roleId       String
  permissionId String
  role         Role       @relation(fields: [roleId], references: [id], onDelete: Cascade)
  permission   Permission @relation(fields: [permissionId], references: [id], onDelete: Cascade)
  @@id([roleId, permissionId])
  @@map("role_permissions")
}

model AdminAction {                              // audit log
  id           String   @id @default(uuid())
  actorId      String                            // who performed the action
  action       String                            // "role:create", "user:assign-role", ...
  targetUserId String?                           // affected user (nullable)
  metadata     Json?                             // before/after snapshot, e.g. { from: "Admin", to: "Moderator" }
  createdAt    DateTime @default(now())
  actor        User     @relation("ActorActions",  fields: [actorId],      references: [id])
  target       User?    @relation("TargetActions", fields: [targetUserId], references: [id])
  @@index([actorId, createdAt])
  @@index([targetUserId, createdAt])
  @@map("admin_actions")
}
```

**`User` model change:**

```diff
- role  Role            // enum: admin | user
+ roleId        String
+ role          Role          @relation(fields: [roleId], references: [id])
+ actorActions  AdminAction[] @relation("ActorActions")   // audit rows where this user is the actor
+ targetActions AdminAction[] @relation("TargetActions")  // audit rows where this user is the target
```

The `Role` enum type is dropped entirely. (The two `AdminAction` back-relations are required or Prisma won't compile — easy to discover mid-PR otherwise.)

---

## 4. Permission catalog (the scan)

Result of scanning every controller. **Naming convention: `resource:action`.** ~80 permissions across 22 resource groups.

> **Self-scoped routes are intentionally NOT permissioned.** Any logged-in user can read their own notifications, submit their own assessment attempt, post their own comment, manage their own todos, etc. Those routes enforce `userId` scoping in the service. Permissions only gate actions on *shared* or *other users'* data.

### 4.1 Learner-vs-operator data scoping (NOT the same as route permissions)

**This is the trickiest part and a real gap the first draft missed.** There are two *different* questions in this codebase:

1. **"Is the caller allowed to hit this endpoint?"** → answered by `@RequiresPermission` (this is what most of §4 is about).
2. **"Which rows does this endpoint return *for this caller*?"** → answered by **learner-vs-operator data scoping**, which today is implemented as `role === 'user'` branching inside services.

Confirmed branch sites that filter data by role (not access — *content*):

| File | Line | What it does |
|---|---|---|
| `course/course.service.ts` | 103, 175 | `userRole === Role.user` → restrict course/module listing to enrolled+active |
| `course/course.service.ts` | 3057 | `role === 'user' ? { userId, isActive: true } : { userId }` → assigned-courses filter |
| `quiz/quiz.service.ts` | 12–14, 46–54 | `role == 'admin'` vs `role == 'user'` → different quiz list shape |
| `user/user.service.ts` | 431 | contact messages scoped to own only when `role === 'user'` |
| `forum-thread/forum-thread.service.ts` | 182 | `user?.role === 'user'` → enrollment-scoped thread visibility |

**Per-site replacement rules** (not all become `isLearner`):

- **course list/module/assigned-courses, forum visibility** → `isLearner` (enrollment scoping). A Moderator with `course:read` is *not* a learner → sees the operator view.
- **contact messages** (`user.service.ts:431`) → **permission-based, NOT `!isLearner`**: return all messages iff caller has `contact-message:read-all`, else own messages only. (A Moderator without that permission must not see everyone's messages — using `!isLearner` here would wrongly expose them.)
- **quiz list shape** (`quiz.service.ts`) → `isLearner` for the student-shaped vs operator-shaped response.

If we naively delete the `Role` enum, **every one of these breaks** — and a renamed "Student" role or a new "Moderator" (which has `course:read` but is not a learner) would get wrong list behavior.

**Resolution — use `role.isLearner`, not the role name, for data scoping.** Replace every `role === 'user'` data filter with `user.role.isLearner`. Replace every `role === 'admin'` data branch with the negation (`!user.role.isLearner`) **only where it's a data-shape decision**, not an access decision (access decisions become `@RequiresPermission`).

- `isLearner = true` → "this person is a student; scope content to their enrollments."
- `isLearner = false` → operator view (admin, moderator, custom) → unscoped/elevated content view, still subject to route permissions.

This decouples *data scoping* (a binary learner flag) from *access control* (granular permissions) from *display identity* (`role.name`). The seeded Student role is the only `isLearner = true` role by default; custom roles default to `false`.

### 4.2 Resolving `isLearner` vs permissions when they disagree

The two axes can conflict (e.g. a Student role accidentally granted `course:read`, or an "Apprentice" role that is both enrollment-scoped *and* has some operator permission). Firm rules so behavior is never ambiguous:

1. **List / filter / row-visibility decisions → `isLearner` wins.** If `isLearner = true`, content is always scoped to the user's own enrollments regardless of what read-permissions the role holds. A learner never sees the unscoped operator list.
2. **Mutations & admin endpoints → permissions only.** `isLearner` never grants or blocks a mutation; the `@RequiresPermission` guard is the sole authority.
3. **The seeded Student role's permission set is locked to empty** in the UI (save rejects non-empty permission lists for `isLearner` system-ish roles), so the accidental-`course:read`-on-Student case can't happen through the portal.

**`isLearner` editability:** `PATCH /roles/:id` **may** toggle `isLearner` on **custom** (non-system) roles — this supports an "Apprentice" role that is enrollment-scoped but distinct from Student. It is **Super-Admin-only**, writes an audit-log entry, and cannot be toggled on the Super Admin or Student system roles. Documented in §6 and §10.

### Identity & access (super-admin tier)
| Permission | Description |
|---|---|
| `role:read` | View roles and their permission sets |
| `role:create` | Create a new role |
| `role:update` | Rename / redescribe a role |
| `role:delete` | Delete a role (blocked if users are assigned or `isSystem`) |
| `role:assign-permissions` | Edit which permissions a role has |
| `permission:read` | View the permission catalog |
| `audit:read` | View the audit log |

### User management
| Permission | Description |
|---|---|
| `user:read` | List / view users |
| `user:create` | Create a user (defaults to Student role) |
| `user:update` | Edit a user's profile |
| `user:delete` | Delete a user |
| `user:update-status` | Activate / deactivate a user |
| `user:update-password` | Reset another user's password |
| `user:assign-role` | Change a user's role |
| `user:assign-course` | Assign / unassign a user to a course |
| `user:update-payment` | Mark a course as paid for a user |

### Course
| Permission | Description |
|---|---|
| `course:read` | View any course |
| `course:create` | Create a course |
| `course:update` | Edit course details |
| `course:delete` | Delete a course |
| `course:toggle-active` | Activate / deactivate a course |

### Course content hierarchy
| Permission | Description |
|---|---|
| `module:create` / `module:update` / `module:delete` | Manage modules |
| `chapter:create` / `chapter:update` / `chapter:delete` | Manage chapters |
| `section:create` / `section:update` / `section:delete` / `section:reorder` | Manage sections |

### Assessment
| Permission | Description |
|---|---|
| `question-category:create` / `:read` / `:update` / `:delete` | Question categories |
| `question:create` / `:read` / `:update` / `:delete` | Question bank |
| `assessment:create` / `:read` / `:update` / `:delete` | Assessment definitions |
| `assessment:activate` / `:deactivate` | Toggle active |
| `assessment:manage-questions` | Add / remove / reorder questions on an assessment |
| `attempt:read-any` | Read any student's attempt (grading view) |
| `attempt:grade` | Save admin scores |
| `attempt:finalize` | Publish the final grade |
| `attempt:certificate` | Issue a completion certificate |

### Assignment
| Permission | Description |
|---|---|
| `assignment:create` / `:update` / `:delete` | Manage assignments |
| `assignment:read` | View any assignment |
| `assignment:review` | Review submissions and assign scores |

### Quiz
| Permission | Description |
|---|---|
| `quiz:create` / `:update` / `:delete` | Manage quizzes |
| `quiz:assign` / `:unassign` | Attach / detach from chapter |
| `quiz:report-any` | View any user's quiz reports |

### Forum
| Permission | Description |
|---|---|
| `forum-thread:moderate` | Edit / delete **any** thread (not just own) |
| `forum-comment:moderate` | Edit / delete **any** comment (not just own) |

> `forum-thread:create` is **not** a gating permission — creating one's own thread is self-scoped (any authenticated user). The key is reserved in the catalog only for a hypothetical future "create-on-behalf-of" admin route. See §5 footnote.

### Policies / feedback / system
| Permission | Description |
|---|---|
| `policy:manage` | Create / delete course policies |
| `feedback:read-submissions` | Read other users' feedback submissions |
| `contact-message:read-all` | View all contact-us messages |
| `post:create` / `:update` / `:delete` | Manage course posts |
| `post-comment:delete-any` | Delete any post comment |

### Permissions deliberately omitted (self-scoped — granted to any authenticated user)
Notification reads/marks on own data · reading own profile · submitting own assessment attempt · submitting own assignment · posting own comment · subscribing/favoriting threads · personal todos · own contact-us message · marking own course-form/policy complete · updating own progress.

---

## 5. Default seeded roles

Seeded automatically (idempotently) on app boot. Super Admin can edit Admin/Student/Moderator afterward, or delete Moderator.

| Role | `slug` | `isSystem` | `isLearner` | Permissions |
|---|---|---|---|---|
| **Super Admin** | `super-admin` | ✅ true | false | All — implicit (bypasses checks; auto-inherits future permissions) |
| **Admin** | `admin` | false | false | All operational permissions: course/module/chapter/section CRUD, full assessment + assignment + quiz, forum moderation, `user:read/create/update/delete/update-status/update-password/assign-course`, contact-message read, policy/feedback. **Excludes** `role:*`, `permission:read`, `audit:read`, `user:assign-role`, `user:update-payment`. |
| **Student** | `student` | false | ✅ true | None (self-scoped routes need no permission). Permission set locked-empty in UI (§4.2). |
| **Moderator** | `moderator` | false | false | `course:read`, `forum-thread:moderate`, `forum-comment:moderate` (optional preset; deletable). *Note:* `forum-thread:create` is NOT needed — thread creation is self-scoped (§4 / footnote below). |

> **Forum create clarification (review P1 #7):** creating a thread is a self-scoped action available to any authenticated user — it is **not** gated by a permission. `forum-thread:create` therefore does **not** appear in any preset. It exists in the catalog only as a reserved key in case a future *cross-user* "create thread on behalf of someone" admin route is added. Student thread creation stays undecorated.

---

## 6. API surface

All management endpoints require auth + the listed permission. Super Admin bypasses permission checks.

### Permission catalog
```
GET /permissions                 # full catalog, grouped by resource (for the role-edit UI)   [permission:read]
```

### Role management
```
GET    /roles                    # list roles + permissions + user counts                     [role:read]
GET    /roles/:id                # one role with its permissions                               [role:read]
POST   /roles                    # { name, description, permissionKeys, isLearner? }            [role:create]
PATCH  /roles/:id                # { name?, description?, isLearner? }   (rules in §6.1)        [role:update]
PUT    /roles/:id/permissions    # { permissionKeys: string[] } replaces set (403 if isSystem) [role:assign-permissions]
DELETE /roles/:id                # 409 if users assigned or isSystem                           [role:delete]
```

### 6.1 Slug generation & mutability rules

- **`slug` is server-generated on create**, never client-supplied: slugify `name` (`"Course Manager"` → `course-manager`), lowercase, `[a-z0-9-]+`, collapse repeats. On collision, append `-2`, `-3`, … Reserved slugs (`super-admin`, `admin`, `student`, `moderator`) are rejected for custom roles.
- **`slug` is immutable for the life of the role** — even when `name` is later edited. This is what FE feature-flags and audit logs key on.
- **`PATCH /roles/:id` field rules:**
  - System roles (`isSystem = true`, i.e. Super Admin): **only `description`** is editable. `name`, `slug`, `isLearner`, permissions are all frozen → `403`.
  - Custom roles: `name`, `description` editable; `isLearner` editable **Super-Admin-only** + audit-logged (§4.2); `slug` never.
  - The seeded **Student** role: treated as protected — `isLearner` cannot be turned off, permission set stays empty (§4.2).

### User / admin management
```
GET    /users                    # filter by role, status, search                             [user:read]
GET    /users/:id                #                                                             [user:read]
POST   /users                    # create; defaults to Student; other role needs user:assign-role [user:create]
PATCH  /users/:id                # profile                                                     [user:update]
PATCH  /users/:id/role           # { roleId }  (assigning Super Admin requires being Super Admin) [user:assign-role]
PATCH  /users/:id/status         # active / inactive                                           [user:update-status]
DELETE /users/:id                #                                                             [user:delete]
```

### Public signup (no auth)
```
POST   /auth/register            # { firstName, lastName, email, password, ... } — role FORCED to Student server-side
```

### Audit log
```
GET    /audit                    # paginated; filter by actor / target / action               [audit:read]
```

Audit writes fire on: `role:create`, `role:update`, `role:delete`, `role:assign-permissions`, `user:create`, `user:assign-role`, `user:update-status`, `user:delete`.

---

## 7. Authorization mechanics

### Strategy consolidation
The three JWT strategies (`'jwt'`, `'uJwt'`, `'cJwt'`) collapse into **one** strategy (named `'jwt'`) that only authenticates the token and loads the user **with role + permissions** in a single query. Role/permission enforcement moves entirely to the decorator. Every route migrates to this one strategy.

The unified `validate()` must, on **every request**:
1. Load the user with `role` + `role.permissions` (one joined query).
2. **Reject if `user.status === 'inactive'`** (today only `/auth/login` checks this; an already-issued token currently keeps working after deactivation — a real gap). Deactivating a user must take effect on their next request.
3. Reject if the user no longer exists.
4. Strip the password and attach `{ ...user, role: { id, slug, name, isSystem, isLearner, permissions: string[] } }` to `request.user`.

Also as part of this step:
- **Retire `JwtAuthGuard`** (`auth/jwt.guard.ts`) — the local-verify-only guard on `GET /auth/me` that sets `request.user = decoded` with no DB load. Replace its single usage with the unified Passport strategy so `/auth/me` returns a real, status-checked, role-loaded user.
- **Fix the `JwtCombineStrategy` swallowed-exception bug** (don't carry it into the unified strategy).

### Decorator + guard
```ts
@Patch('/courses/:id')
@UseGuards(AuthGuard('jwt'), PermissionsGuard)
@RequiresPermission('course:update')
updateCourse() { ... }
```

- `PermissionsGuard` reads the required permission(s) from route metadata.
- If `user.role.isSystem` → allow (Super Admin).
- Else allow iff the permission(s) are in the user's role's permission set.
- Else `403 Forbidden`.

Variants:
```ts
@RequiresPermission('a', 'b')        // requires ALL listed
@RequiresAnyPermission('a', 'b')     // requires AT LEAST ONE
// (no decorator) → any authenticated user (self-scoped routes)
```

### JWT contents
Stays minimal: `{ sub, email }`. Permissions are **not** baked into the token, so permission edits take effect on the **next request** (no forced re-login). The per-request user+role+permissions load is a single indexed query.

### Login / `/auth/me` response shape (FE contract)
Both `POST /auth/login` and `GET /auth/me` return the expanded permission set so the FE can route/render without a separate fetch per screen:

```jsonc
{
  "user": {
    "id": "…", "firstName": "…", "lastName": "…", "email": "…",
    "role": {
      "id": "…",
      "slug": "admin",          // immutable — use this for FE feature flags
      "name": "Course Manager", // display only — may be renamed by Super Admin
      "isSystem": false,
      "isLearner": false
    },
    "permissions": ["course:read", "course:update", "assessment:grade", "…"]
    // Super Admin: permissions is the full catalog (or the sentinel ["*"] — decide at impl; full list is friendlier to the FE)
  }
}
```

**FE rule:** branch on `role.slug` or on `permissions`, **never** on `role.name` (renamable). Driving UI off `permissions` is preferred; `role.slug` is the fallback for coarse "is this a learner portal vs operator portal" routing.

---

## 8. Migration sequence (single migration file)

1. Create `roles`, `permissions`, `role_permissions`, `admin_actions` tables.
2. Seed the ~80-entry permission catalog.
3. Seed default roles (Super Admin / Admin / Student / Moderator) + their permission sets, with stable `slug`s and `isLearner` flags.
4. Add nullable `roleId` to `users`.
5. Backfill: `roleId = <Admin>` where `role = 'admin'`; `roleId = <Student>` where `role = 'user'`.
6. Set `roleId` `NOT NULL`.
7. Drop the old `role` column.
8. Drop the `Role` enum type.

> **The migration does NOT touch the Super Admin promotion.** A SQL migration must not depend on runtime env (`SUPER_ADMIN_EMAIL` may be absent in CI → failed deploy, and it couples schema to config). Promotion is done **only** by `npm run seed:super-admin` (below), which is idempotent and env-driven. After migration, the bootstrap account is just a normal Admin until the seed script promotes it.

**Site is not live → no rolling-deploy concern; run the migration with the deploy.**

### Boot-time idempotent seed
Permission catalog + default roles seed on every boot (idempotent upserts) so the catalog stays in sync as new permissions are added in code. Existing custom roles are never auto-modified; Super Admin auto-inherits new permissions via the `isSystem` bypass.

### One-time super-admin seed
`npm run seed:super-admin` reads `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` from env, creates the account if no Super Admin exists, exits. Idempotent.

---

## 9. Explicitly out of scope

- **Course-scoped admins** (ABAC) — e.g. "Sarah is an admin only for the NEBOSH course." This is a *different authorization axis* (attribute-based, per-resource) layered on top of RBAC. Not built here. If wanted later, it needs its own design (a `UserCourseRole` / scoping table + resource-ownership checks in services).
- **Per-user permission overrides** — declined in §1.2; strictly role-based.
- **Permissions baked into JWT** — declined for immediate-propagation of permission edits.
- **Fine-grained per-field permissions** — declined; coarse CRUD only.

---

## 10. Safety rails (must-haves in implementation)

- **Last Super Admin lockout protection**: cannot demote/deactivate/delete the final active Super Admin. Enforced with a count check inside the same transaction as the mutation.
- **System-role protection**: for `isSystem` roles (Super Admin), `name` / `slug` / `isLearner` / permissions are all frozen — only `description` is editable; delete is forbidden. `slug` is immutable for **all** roles, system or custom (see §6.1). Enforced at the service layer, not just UI.
- **Self-action guards**: a Super Admin cannot demote or deactivate themselves.
- **Role-delete with assigned users**: `DELETE /roles/:id` returns `409` if any user still holds the role — caller must reassign first.
- **Escalation guard**: assigning the Super Admin role to anyone requires the caller to be a Super Admin (not merely hold `user:assign-role`).

---

## 11. Frontend impact

- **New Super Admin portal**: roles list, role editor (permission checklist grouped by resource — feeds from `GET /permissions`), user/admin management, audit feed.
- **Login response change (BREAKING)**: `user.role` was a string (`"admin"`); it becomes a role object `{ id, slug, name, isSystem, isLearner }` plus a top-level `permissions: string[]`. FE that branches on `user.role === 'admin'` must switch to `user.role.slug === 'admin'` (or, better, drive UI off `permissions`). **Never branch on `role.name`** — it's renamable. Full shape in §7 "Login / `/auth/me` response shape."
- **Signup (BREAKING for clients calling `POST /users` anonymously)**: public registration moves to `POST /auth/register`, which ignores any client-sent role and forces Student. The old `POST /users` becomes admin-only. **Web + mobile both need the new endpoint.** Confirm whether existing clients need a deprecation window or can cut over with the deploy (site not live → likely a clean cutover).
- A dedicated FE handoff doc will accompany the implementation PR (same style as `forum-course-scoping-frontend-handoff.md` and `notifications-contract.md`).

---

## 12. Effort & delivery

- **Revised estimate: ~6–8 days backend** (up from the first draft's optimistic 5). The hidden cost flagged in review is the **service-layer role branching** (§4.1: course/quiz/user/forum), not the decorator sweep. Those refactors touch query logic, not just guards, and need careful testing to avoid breaking student content scoping.
- Single PR + single migration:
  1. Schema (with `slug` + `isLearner`) + migration + seed + secure **all** user routes + strategy consolidation (incl. inactive-user check, `JwtAuthGuard` retirement, swallowed-exception fix) + guard/decorator.
  2. Role + permission-catalog endpoints + audit log.
  3. User/admin management endpoints + safety rails.
  4. Controller sweep — `@RequiresPermission` on every protected route.
  5. **Service-layer refactor** — replace all `role === 'user'`/`'admin'` data-scoping branches with `role.isLearner` / permission checks (§4.1). This is the part most likely to introduce regressions.
  6. Edge cases + test matrix + FE handoff doc.

### CI guard against missed routes
~80 permissions across a large controller surface → easy to forget one. Add **one** of:
- A **role × critical-endpoint test matrix** (student / admin / moderator / super-admin → expected 200/403 on each protected route), or
- A **lint/CI script** that fails if any controller method uses the auth guard but has neither `@RequiresPermission` nor an explicit `@SelfScoped()` marker (an allowlist decorator for the intentionally-ungated self-scoped routes).

The `@SelfScoped()` marker is recommended regardless — it makes "this route is intentionally permission-free" explicit and greppable, instead of a silent omission.

- **Frontend**: Super Admin portal is separate FE work, unblocked once the API lands.

---

## 13. Open items for sign-off

1. Confirm the **Admin default permission set** (§5) — anything to add/remove before it's seeded?
2. Confirm **Moderator** preset is wanted, or seed without it.
3. Confirm the **bootstrap Super Admin email** for the one-time seed.
4. Confirm **course-scoped admins (§9) are genuinely out of scope** for this round.
5. **`assignCourse/public` (§14)** — confirm it should require `user:assign-course` (or be removed). Product sign-off needed in case some integration relies on it. **Recommend patching now, independent of RBAC.**

---

## 14. Public / unauthenticated route decisions

Every route without an auth guard, classified. The sweep must explicitly handle each — either decorate it or add it to the documented unauthenticated allowlist so it's a deliberate choice, not an oversight.

| Route | Current | Decision |
|---|---|---|
| `GET /course/public` | no guard | ✅ **Intentional** — marketing/catalog. Stays public. Allowlist via `@SelfScoped()`/`@Public()`. |
| `GET /course/public/:id` | no guard | ✅ **Intentional** — public course detail. Stays public. |
| `POST /auth/login` | no guard | ✅ Intentional. |
| `POST /auth/register` (new) | n/a | ✅ Intentional public signup; forces Student (§6/§11). |
| 🔴 `PUT /course/assignCourse/public/:userId/:courseId` | **no guard — HOLE** | ❌ **Not intentional.** Require `user:assign-course`, or delete the route. **Patch standalone this week — do not wait for RBAC.** |
| 🔴 `GET /course/getAllAssignedCourses/public/:id` | `cJwt`, no ownership check | ❌ Require `user:read` (operator) **or** restrict to `:id === caller.id` (self). |
| 🔴 `GET /users/:id` | **no guard** | ❌ Require `user:read`, or self. |
| 🔴 `GET /users/` | `cJwt` only | ❌ Require `user:read` (operators only — students must not list all users). |
| 🔴 `POST /users/` | guard commented out | ❌ Require `user:create`; reject client `role` (§6). |

**Standalone hotfix recommendation:** the two 🔴 `assignCourse/public` + `getAllAssignedCourses/public` routes and the unguarded `GET /users/:id` are live data-exposure/mutation holes **right now**, with registrations incoming. They're each a one-to-two-line guard. Strongly recommend a small separate PR this week rather than carrying the exposure for the full 6–8 day RBAC build. The RBAC project then converts these interim guards to `@RequiresPermission`.
