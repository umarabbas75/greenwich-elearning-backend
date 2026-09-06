# Community Forum Wave 2 — Frontend Handoff

Backend Wave 2 is in this repo. Votes, accepted answers, and @mentions are live once the migration `20260906180000_forum_wave2_engagement` is applied (after Wave 1’s `20260906160000_forum_categories`).

Wave 1 contract still applies: [forum-community-wave1-frontend-handoff.md](./forum-community-wave1-frontend-handoff.md). This doc is additive.

**Rich comments:** `content` on comments is already a string; store Quill HTML the same way as thread bodies. No extra upload endpoint — reuse the existing image-upload path used for threads.

---

## 1. Category feature flags

`GET /forum/categories` (and admin create/update) now includes:

```jsonc
{
  "allowAcceptedAnswer": true,
  "allowVotes": true,
  "allowMentions": true
}
```

All default `true`. Drive UI from these flags — do **not** hardcode by slug. Admin PATCH can turn a capability off without a migration.

---

## 2. Votes (likes only — no downvotes)

`POST /forum-thread/:id/vote`  
`POST /forum-thread-comment/:id/vote`

```jsonc
{ "value": 1 }  // like
{ "value": 0 }  // unlike
```

Idempotent. Response:

```jsonc
{ "voteScore": 4, "isVotedByMe": true }
```

Thread list/detail and comment list include `voteScore` and `isVotedByMe`. Hide the control when `category.allowVotes === false`.

---

## 3. Accepted answer (solution)

`POST /forum-thread-comment/:id/accept`

Body optional: `{ "accepted": true | false }`. Omit to **toggle**.

- Thread author or admin only.
- Clears the previous accepted comment.
- Thread has `acceptedCommentId` (nullable). Comments have `isAccepted`.

Hide when `category.allowAcceptedAnswer === false`.

Suggested UI: “Mark as solution” on replies; badge on the accepted row; thread card can show a solved state when `acceptedCommentId` is set.

---

## 4. Comment list sort

`GET /forum-thread-comment/:threadId?sort=top|latest`

| `sort` | Order |
|---|---|
| `top` (default) | accepted first, then `voteScore` desc, then newest |
| `latest` | accepted first, then newest |

Each row: `voteScore`, `isAccepted`, `isVotedByMe`.

Thread list: `GET /forum-thread?sort=top` sorts pinned first, then `voteScore`, then `lastActivityAt`. Default remains pinned then `lastActivityAt`.

---

## 5. Mentions

### Autocomplete

`GET /forum/mentions?q=&threadId=&courseId=`

Returns up to 20 `{ id, firstName, lastName, photo, role }` (no email).

- With `threadId` (or `courseId` on compose): classmates enrolled in that course + admins.
- Otherwise: all active users.
- Empty list if that category has `allowMentions === false`.

### Stored token

Either is parsed on **create** (thread or comment):

```html
<span data-mention-user-id="uuid">@First Last</span>
```

```
@[First Last](uuid)
```

Mentioned users get in-app + email `FORUM_MENTION` (not a second `FORUM_COMMENT` if they already subscribe). Deep link is still `/forum/{threadId}`.

Bell payload:

```jsonc
{
  "threadId": "…",
  "threadTitle": "…",
  "commentId": "…",          // omitted when the mention is in the thread body
  "mentionerFirstName": "…",
  "mentionerLastName": "…"
}
```

Edits do not re-notify.

---

## 6. Comment edit / delete

`PUT` / `DELETE` `/forum-thread-comment/:id` are **author or admin** only. Body for update is `{ content }` (HTML). `isAccepted` / `voteScore` cannot be set via PUT — use accept/vote endpoints.

Create comment now returns the comment in `data` (not `{}`).

---

## 7. Suggested UI

- Thread page: like on the original post; like on each reply; “Mark as solution” for OP/admin; accepted reply pinned to the top of the list with a badge.
- Compose (thread + reply): Quill + `@` autocomplete inserting one of the token shapes above.
- Hub/list: optional “Top” sort; solved badge when `acceptedCommentId` is set.
