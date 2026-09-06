# Community Forum Wave 3 — Frontend Handoff

Backend Wave 3 is in this repo. Tags, PDF/DOCX attachments, and the in-course Discussions deprecation path are live once migration `20260906200000_forum_wave3_tags_attachments` is applied (after Waves 1–2).

Earlier contracts still apply:

- [forum-community-wave1-frontend-handoff.md](./forum-community-wave1-frontend-handoff.md)
- [forum-community-wave2-frontend-handoff.md](./forum-community-wave2-frontend-handoff.md)

**Do not drop `Post` / `Comment` or `/courses/post*` this wave.** Stop using them in the course player; keep the APIs until a later cleanup.

---

## 1. Category flags

`GET /forum/categories` (and admin create/update) now also includes:

```jsonc
{
  "tagPolicy": "FREEFORM",      // FREEFORM | ADMIN_ONLY | DISABLED
  "allowAttachments": true
}
```

Drive UI from these flags — do **not** hardcode by slug.

| `tagPolicy` | Compose |
|---|---|
| `FREEFORM` | Attach existing tags or type a new name (max 8). |
| `ADMIN_ONLY` | Students may only pick existing tags. Admins can create names. |
| `DISABLED` | Hide the tag field. Sending tags is a 403. |

Hide the file picker when `allowAttachments === false`.

---

## 2. Tags

`GET /forum/tags?q=` — autocomplete, up to 20 `{ id, name, slug }` (no counts).

`POST /forum/tags` `{ name }` — creates or returns the existing slug match.

`PATCH` / `DELETE` `/forum/tags/:id` — admin only.

Thread create/update body:

```jsonc
{
  "tagIds": ["uuid"],     // existing ids
  "tags": ["Module 1"]    // names; creates when policy allows
}
```

Either or both. Max 8. Omit both on update to leave tags unchanged; send `tagIds: []` (or `tags: []`) to clear.

List filter: `GET /forum-thread?tagId=` or `?tag=` (slug).

List and detail include `tags: [{ id, name, slug }]`. Do not read `threadTags`.

Suggested URL: `/forum?category=study&tag=module-1`.

---

## 3. Attachments (thread body only)

Max **3**. PDF and DOCX only. Screenshots stay in Quill.

Upload unsigned to Cloudinary (`folder: 'forum-attachments'`, `resourceType: 'raw'`), then send:

```jsonc
{
  "attachments": [
    {
      "url": "https://…",
      "publicId": "my_uploads/forum-attachments/…",
      "fileName": "brief.pdf",
      "mimeType": "application/pdf",
      "bytes": 12000
    }
  ]
}
```

Create/update: if `attachments` is present, it **replaces** the list. Omit to leave unchanged. `[]` clears.

Detail includes `attachments: [{ id, url, publicId, fileName, mimeType, bytes, createdAt }]`. List does **not**.

`DELETE /forum-thread/:threadId/attachments/:attachmentId` — thread author or admin.

MIME accepted: `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document`. A `.pdf` / `.docx` filename is also enough if the browser sends `octet-stream`.

---

## 4. Deprecate in-course Discussions

Player “Discussions” is a link to Community Study for this course:

```
/forum?category=<studySlug>&courseId=<courseId>
```

- Load `GET /forum/categories` (already cached as `forum-categories`).
- Pick the active board with `courseScope === 'REQUIRED'`. Prefer `slug === 'study'` if several match. Fallback slug `'study'`.
- **Do not** hardcode the slug in policy; the category row is the source of truth.
- Stop fetching `/courses/posts/:courseId`. Stop mounting `DiscussionForum/`.
- Optional data copy: `yarn script:forum-posts-migrate:dry` then `yarn script:forum-posts-migrate`. Idempotent via `sourcePostId`. Does not delete old posts.

---

## 5. Suggested UI

- Compose: tag chips + autocomplete; file list under the editor (max 3, pdf/docx).
- Thread card: tag chips (filter link). Attachments on the **thread page** under the body, not on the list card.
---

## 6. One-level comment replies (same endpoints)

No new comment routes. Nesting is on the existing list payload; posting a nested reply is the existing create body plus `parentId`.

`GET /forum-thread-comment/:threadId` still returns **one** array. Roots have `replies: [...]` (chronological). Nested comments have `parentId` and no further `replies`. One level only — Reply is only on top-level comments.

```jsonc
{
  "id": "root-id",
  "parentId": null,
  "content": "…",
  "voteScore": 2,
  "isVotedByMe": false,
  "isAccepted": false,
  "user": { "id": "…", "firstName": "…", "lastName": "…", "photo": null },
  "replies": [
    { "id": "child-id", "parentId": "root-id", "content": "…", "voteScore": 0, "isVotedByMe": false }
  ]
}
```

`POST /forum-thread-comment`

```jsonc
{ "threadId": "…", "content": "…", "parentId": "optional-top-level-comment-id" }
```

Omit `parentId` for a thread-level reply. Sending a `parentId` that is itself a nested reply is **403** `"Replies can only be one level deep"`. Accept-as-solution is top-level only.

Reply `content` (create and edit) is capped at **300 words**. Count visible words only — HTML tags, entities, and images do not count. Over the cap is **403** `"Replies can be at most 300 words"`.

Vote / edit / delete / accept URLs are unchanged (`/forum-thread-comment/:id`, `/vote`, `/accept`). Patch the cached tree in place — do **not** refetch the thread or comments after a successful post.

Author `user` on thread **list**, thread **detail**, create/update thread, comments, and nested replies includes `role` (`admin` | `user`), same shape as mentions. Notification `commenter` includes `role` too. Do not infer staff from email.

Thread `commentCount` (list) is all comments including nested replies.

---

## 7. Notifications and emails

No new comment endpoints. Same bell + email pipeline. Deep link is still `/forum/{threadId}`.

| Event | Who | Type |
|---|---|---|
| Admin publishes (or board `notifyOnCreate = ALL`) | Enrolled learners + admins | `FORUM_THREAD` |
| Student posts and the class is **not** broadcast (`ADMIN_ONLY` / `NONE`) | Admins only | `FORUM_THREAD` (`studentPost: true`) |
| Student posts on a **moderated** board | Admins only | `FORUM_THREAD` (`pendingReview: true`) |
| New reply | Followers + thread author (not the commenter) | `FORUM_COMMENT` |
| Nested reply | Parent comment author | `FORUM_COMMENT` (`parentCommentId`) — copy is “replied to your comment” |
| `@mention` | Mentioned user | `FORUM_MENTION` (not a second comment ping) |
| Mark as solution | Comment author; thread author if an admin marked it | `FORUM_ANSWER_ACCEPTED` |

Not sent: likes, tag/attachment changes, edits, un-accept.

The admin inbox is still CC’d on new threads and new replies. Likes do not CC.


