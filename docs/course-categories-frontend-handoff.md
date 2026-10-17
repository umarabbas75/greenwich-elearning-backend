# Course Categories — Frontend Handoff

**Status:** Backend implemented. Migration `20261018120000_course_categories` is applied on the current database, and existing courses are already assigned.
**Audience:** Frontend — admin category management, and grouping courses in the catalogue.

Base path: `/api/v1`.

---

## 1. What changed

Every course can belong to one category. Categories are how the catalogue is grouped: all NEBOSH courses sit under NEBOSH, all IOSH courses under IOSH, and so on.

- Categories are a real table. An admin can create, rename, reorder, and delete them.
- A course has one category, or none.
- Existing courses are already assigned (see §8). The course titled `test` is the only one left uncategorised.
- Deleting a category does not delete its courses. The API refuses the delete until those courses are moved.

---

## 2. Auth

| Call | Token |
|---|---|
| Category list, create, update, delete, and assign | **Admin** bearer. Same token as other admin course writes (`AuthGuard('jwt')`, role `admin`). |
| `GET /courses`, `GET /courses/:id`, assigned-course lists | Existing logged-in token (`cJwt`). Unchanged. |
| `GET /courses/public`, `GET /courses/public/:id` | No auth. Unchanged. |

Do not call `GET /courses/categories` from the public site. Public and learner screens should group courses using the `category` object already embedded on each course.

---

## 3. Shapes

### 3.1 Category on a course

Present on the course payloads listed in §6. Either `null` or:

```json
{
  "id": "c0a10000-0000-4000-8000-000000000001",
  "name": "NEBOSH",
  "slug": "nebosh"
}
```

The course row also has a scalar `categoryId` (the same id, or `null`). Use `category` for display. Use `categoryId` when posting an assignment.

### 3.2 Category record

Returned by the category endpoints:

```json
{
  "id": "c0a10000-0000-4000-8000-000000000001",
  "name": "NEBOSH",
  "slug": "nebosh",
  "description": "NEBOSH qualifications",
  "sortOrder": 1,
  "courseCount": 2,
  "createdAt": "2026-10-18T00:00:00.000Z",
  "updatedAt": "2026-10-18T00:00:00.000Z"
}
```

`courseCount` counts every course in the category, including inactive ones.

`description` is `string | null`.

### 3.3 Success envelope

Unchanged from the rest of the course API:

```json
{
  "message": "Successfully fetched course categories",
  "statusCode": 200,
  "data": []
}
```

---

## 4. Admin category API

All five routes require the admin token.

### 4.1 List

`GET /api/v1/courses/categories`

No query params. Ordered by `sortOrder` ascending, then `name`.

```json
{
  "message": "Successfully fetched course categories",
  "statusCode": 200,
  "data": [
    {
      "id": "c0a10000-0000-4000-8000-000000000001",
      "name": "NEBOSH",
      "slug": "nebosh",
      "description": "NEBOSH qualifications",
      "sortOrder": 1,
      "courseCount": 2,
      "createdAt": "2026-10-18T00:00:00.000Z",
      "updatedAt": "2026-10-18T00:00:00.000Z"
    }
  ]
}
```

Use this list to fill the category dropdown and the category-management screen. Do not hardcode the ids in §8. An admin can rename or recreate a category, and the id will change.

### 4.2 Create

`POST /api/v1/courses/categories`

```json
{
  "name": "Highfield",
  "description": "optional",
  "sortOrder": 7,
  "slug": "highfield"
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | Trimmed. Blank or whitespace-only is rejected. Must be unique. |
| `description` | no | Trimmed. Empty string is stored as `null`. |
| `slug` | no | Generated from `name` when omitted. Must be unique. |
| `sortOrder` | no | Integer. When omitted, the next value after the current highest `sortOrder`. |

Slug rules: lowercase, non-alphanumeric runs become a single `-`, leading and trailing `-` are stripped, max 60 characters. `"NEBOSH Awards"` becomes `"nebosh-awards"`. A name that produces no slug falls back to `"category"`.

`data` is the new category with `courseCount: 0`.

### 4.3 Update

`PATCH /api/v1/courses/categories/:id`

Send only the fields that change. All of them are optional.

```json
{
  "name": "NEBOSH Qualifications",
  "description": null,
  "slug": "nebosh",
  "sortOrder": 1
}
```

| Field | Behaviour |
|---|---|
| `name` | Renames the category. Also regenerates `slug` from the new name, unless `slug` is sent in the same request. |
| `slug` | Sets the slug explicitly. Send this when a rename must keep the old URL slug. |
| `description` | `null` or `""` clears it. Omit the field to leave it unchanged. |
| `sortOrder` | Integer. Omit to leave it unchanged. |

`data` is the updated category, including `courseCount`.

There is no separate “reorder” endpoint. To reorder, PATCH `sortOrder` on each category.

### 4.4 Delete

`DELETE /api/v1/courses/categories/:id`

Succeeds only when `courseCount` is 0.

```json
{
  "message": "Successfully deleted course category",
  "statusCode": 200,
  "data": { "id": "c0a10000-0000-4000-8000-000000000006" }
}
```

If any course still points at it, nothing is deleted and the response is **409**:

```json
{
  "status": 409,
  "error": "Move or unassign 2 course(s) before deleting this category"
}
```

UI: disable delete, or confirm and then move courses, when `courseCount > 0`. Show `error` from the 409. Courses are never deleted as a side effect.

### 4.5 Assign a course

`PUT /api/v1/courses/:courseId/category`

This is the call for a category dropdown on a course.

Assign:

```json
{ "categoryId": "c0a10000-0000-4000-8000-000000000001" }
```

Clear:

```json
{ "categoryId": null }
```

`categoryId` must be present. Omitting the key is a validation error. `null` is the clear value.

Success `data` is a small payload, not the full course:

```json
{
  "id": "db46d143-a12e-4997-a8ac-433de17f6634",
  "title": "NEBOSH Health and Safety at Work Award",
  "categoryId": "c0a10000-0000-4000-8000-000000000001",
  "category": {
    "id": "c0a10000-0000-4000-8000-000000000001",
    "name": "NEBOSH",
    "slug": "nebosh"
  }
}
```

After a clear, `categoryId` and `category` are both `null`, and `message` is `"Successfully cleared course category"`.

---

## 5. Category on course create and edit

These are optional. Prefer `PUT /courses/:id/category` when the screen only changes the category, because that response includes the nested `category` object.

### 5.1 Create course

`POST /api/v1/courses` (admin) accepts an optional `categoryId` (uuid) alongside the existing body.

- Omit it and the course is created with no category.
- Unknown id: **403** `{ "status": 403, "error": "Category not found" }` (this path still uses the course API’s existing error shape, not the 404 from §4.5).

The created course in `data` includes the `categoryId` scalar. It does **not** include the nested `category` object. Refetch the course if the screen needs `name` and `slug` immediately.

### 5.2 Update course

`PUT /api/v1/courses/:id` (admin) accepts `categoryId`:

| Body | Result |
|---|---|
| field omitted | category unchanged |
| `"categoryId": "<uuid>"` | course moves to that category |
| `"categoryId": null` | category cleared |

Unknown id: same **403** `"Category not found"` as create.

`data` is the updated course row. It includes `categoryId` and does **not** include the nested `category` object.

---

## 6. Course reads that now include `category`

No request change. Each of these adds `category` (`{ id, name, slug } | null`) on the course.

| Endpoint | Auth | Where it sits |
|---|---|---|
| `GET /api/v1/courses` | logged-in | each item in `data` |
| `GET /api/v1/courses/:id` | logged-in | `data.category` |
| `GET /api/v1/courses/public` | none | each active course in `data` |
| `GET /api/v1/courses/public/:id` | none | `data.category` |
| `GET /api/v1/courses/getAllAssignedCourses/:userId` | logged-in | `data[].course.category` |
| `GET /api/v1/courses/getAllAssignedCourses/public/:userId` | logged-in | `data[].course.category` |

`GET /courses/public` only returns `isActive: true` courses, same as before. Inactive courses still appear on the admin list (`GET /courses`) and still count toward `courseCount`.

Suggested catalogue grouping:

1. Take the courses you already render.
2. Group by `course.category?.id`.
3. Label the group with `course.category.name`.
4. Order groups by the admin list’s `sortOrder` if you have it. On public pages you do not have `sortOrder` on the embedded object, so order groups by `name`, or keep the order of first appearance.
5. Render courses with `category === null` in an “Uncategorised” group, or hide that group when it is empty.

`slug` is safe to use in a public URL such as `/courses/category/nebosh`. It changes when an admin renames the category, unless the rename request also sends the old `slug`.

---

## 7. Errors

Category endpoints (§4) return:

| HTTP | When | Body |
|---|---|---|
| 400 | blank `name`, non-integer `sortOrder` | `{ "status": 400, "error": "name is required" }` |
| 400 | class-validator (missing `name` on create, missing `categoryId` on assign, `categoryId` not a uuid) | `{ "statusCode": 400, "message": ["categoryId must be a UUID"], "error": "Bad Request" }` |
| 404 | category id or course id does not exist | `{ "status": 404, "error": "Category not found" }` or `"Course not found"` |
| 409 | duplicate `name` or `slug` | `{ "status": 409, "error": "A category with this name or slug already exists" }` |
| 409 | delete while courses are still assigned | `{ "status": 409, "error": "Move or unassign N course(s) before deleting this category" }` |

Two body shapes exist on 400. Branch on the HTTP status, then read `error` when it is a string, and `message` when it is an array.

Course create and update (§5) do not use this table. A bad `categoryId` there is **403** `{ "status": 403, "error": "Category not found" }`.

A learner or non-admin token on any §4 route is **403** `{ "status": 403, "error": "UnAuthorized" }`.

---

## 8. Data already assigned

Loaded from the live course titles. Ids below are the ones created by the migration. Still load them from `GET /courses/categories` at runtime.

| Name | Slug | sortOrder | Courses |
|---|---|---|---|
| NEBOSH | `nebosh` | 1 | 2 |
| IOSH | `iosh` | 2 | 1 |
| OSHA | `osha` | 3 | 2 |
| OTHM | `othm` | 4 | 2 |
| International Awards | `international-awards` | 5 | 12 |
| Short Courses | `short-courses` | 6 | 2 |

How they were chosen:

- Title starts with `NEBOSH`, `IOSH`, `OSHA`, or `OTHM` → that category.
- Title contains `International Award` (including `Level2 International Award in Environmental Management`) → International Awards.
- `Confined Space Safety` and `Work Permit Receiver: International Best Practice for Safe Work Control` → Short Courses.
- `test` → no category.

Admins can rename any of these. A rename updates `name` and, unless `slug` is sent, `slug`.

---

## 9. UI checklist

**Admin — categories**

- Screen to list categories (`name`, `courseCount`, `sortOrder`).
- Create with a name. Description and sort order are optional.
- Rename in place via PATCH. Warn that the slug changes with the name unless the form keeps the current slug and sends it back.
- Delete is allowed only when `courseCount` is 0. Otherwise show the 409 `error` and point the admin at reassignment.

**Admin — course**

- Category dropdown on create and on the course edit screen, options from `GET /courses/categories`.
- Include an empty option, “No category”, which sends `categoryId: null` on assign or on course update.
- Saving only the category: `PUT /courses/:courseId/category`.
- After assign, update local state from `data.category`. Do not expect `category` on the `PUT /courses/:id` response.

**Public catalogue and learner course lists**

- Group by `category.name`. Treat `category: null` as uncategorised.
- No new request is required on the existing course list calls.
