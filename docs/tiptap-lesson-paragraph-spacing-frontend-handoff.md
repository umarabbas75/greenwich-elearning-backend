# TipTap lesson paragraph spacing — frontend handoff

Authors report that **vertical spacing / blank lines** they add in the admin **TipTap** lesson editor do not appear the same way in the **student course player**. This note describes the cause, what is **in scope** for a fix, and suggested approaches for the frontend team.

**Backend:** No change required. Section `description` is stored and returned as-is (TipTap envelope or legacy HTML). See `assertNoInlineBase64` in `src/course/course.service.ts` — it does not alter markup.

**Repo:** Implementation lives in **`greenwich-elearning`** (frontend).

---

## Symptom

- In **Edit Lesson** (TipTap), pressing **Enter** creates visible gaps between blocks (including blank lines between learning-outcome lines and body copy).
- On **`/studentNewCourse/...`**, the same lesson looks **tighter**: intentional blank lines often disappear; blocks can read as one continuous stack.

Example URLs (production):

- Admin chapter/lesson authoring under `/course/{courseId}/{moduleId}/{chapterId}`.
- Learner player: `/studentNewCourse/{courseId}/{chapterId}/{moduleId}/{sectionId}`.

---

## Root cause (frontend)

### Two render paths for `section.description`

| Saved format | Detection | Learner renderer |
| --- | --- | --- |
| **TipTap** | JSON envelope with `__greenwichEditor: "tiptap"` | `LessonRichContent` → `TiptapLessonContent` (React tree from JSON) |
| **Legacy Quill** | Plain HTML string | `LessonRichContent` → `RichContent` (`dangerouslySetInnerHTML`) |

Relevant files:

- `src/lib/course/tiptap/document.ts` — `parseSectionDescription`, `isTiptapDescription`
- `src/components/common/LessonRichContent.tsx` — branch on `parsed.kind`
- `src/components/course/tiptap/TiptapLessonContent.tsx` — paragraph nodes render as `<p>{…}</p>`
- `src/app/(coursePage)/studentNewCourse/[...slug]/page.tsx` — DEFAULT lesson body uses `LessonRichContent`

### Why blank lines vanish on the learner path

1. A blank line in TipTap is usually an **empty paragraph node**, serialized as `<p></p>` (see `serializeLessonTiptapDoc` / `generateHTML`).
2. `TiptapLessonContent` renders empty blocks as **`<p></p>` with no `<br>` and no min-height**.
3. **Tailwind preflight** zeroes default `<p>` margins.
4. `globals.css` defines learner/admin styles for **headings, lists, tables, callouts**, etc., under `.lesson-tiptap-content` and `.section-modal-tiptap-editor`, but **does not define paragraph block spacing** for normal `<p>` elements.
5. The course player wraps content in **`prose`**, which spaces paragraphs that have text; **empty `<p>` elements collapse** (no content height + margin collapse), so extra **Enter** presses often produce **no visible gap**.

The **admin editor** still *looks* spaced because ProseMirror shows **editable empty blocks** (cursor line height), not because the learner receives different data.

### Enter vs Shift+Enter

| Author action | Stored as | Learner expectation |
| --- | --- | --- |
| **Enter** | New `paragraph` (possibly empty) | Block gap / blank line |
| **Shift+Enter** | `hardBreak` → `<br>` inside same `<p>` | Single line break only, not a full blank line |

Support/docs for authors can mention this later; the spacing fix below targets **paragraph gaps**, especially empty paragraphs.

---

## Scope for the fix (required)

Apply changes **only** where all of the following are true:

1. **Surface:** Student **course player** (lesson body), not admin modals, not course marketing pages, not forum, not assessment UI.
2. **Content type:** Sections whose `description` parses as **TipTap** (`parseSectionDescription(…).kind === 'tiptap'`).
3. **Do not change** legacy **Quill** HTML rendering (`RichContent` without `.lesson-tiptap-content`).

### Scoping hooks already in the codebase

- TipTap learner output is wrapped in **`lesson-tiptap-content`** (see `TiptapLessonContent`). Quill path uses **`rich-content`** only via `RichContent` — **no** `lesson-tiptap-content` class.
- Prefer selectors like **`.lesson-tiptap-content p`** (and variants below), **not** bare **`.rich-content p`**, so Quill lessons stay unchanged.

### Explicitly out of scope (unless product asks otherwise)

| Area | Reason |
| --- | --- |
| `.rich-content` used without `.lesson-tiptap-content` | Legacy Quill lessons |
| `.section-modal-tiptap-editor` | Admin authoring; optional parity pass, not required for this ticket |
| `VisualActivity` / activity instructions that use `RichContent` directly | May be Quill HTML; separate decision |
| Backend API or `description` storage format | Data is already correct |
| Changing TipTap envelope schema | Not needed for spacing |

### Course player touchpoints to verify after fix

- DEFAULT text lesson: `studentNewCourse/[...slug]/page.tsx` (main content branch).
- Optional regression: ORDERING / MATCHING / FLASHCARDS **intro** blocks that reuse `LessonRichContent` with the same `description` — still TipTap-only if envelope is TipTap.

---

## Suggested approaches (frontend chooses)

Pick one primary approach; combining **CSS + small renderer tweak** is acceptable if CSS alone cannot preserve empty lines reliably.

### Option A — CSS-only (minimal)

Add rules under **`.lesson-tiptap-content`** in `src/app/globals.css` (or a course-player-scoped CSS module imported only on `studentNewCourse` layouts):

- **Paragraph rhythm:** e.g. `margin-block` on `.lesson-tiptap-content > p` (and/or `p` inside doc root) aligned with admin readability — tune against `prose` / `prose-sm` on the player so you do not double-stack margins awkwardly.
- **Empty paragraphs:** e.g. `.lesson-tiptap-content p:empty { min-height: 1.5em; }` or `p:empty::before { content: '\200b'; }` so intentional blank lines occupy vertical space.

**Pros:** Small diff, no serializer change.  
**Cons:** Must test margin collapse with `prose`; nested `p` inside callouts/columns/tabs may need `:not()` exclusions (see existing patterns for task lists at `.lesson-tiptap-content ul[data-type='taskList'] li > div > p { margin: 0; }`).

### Option B — Renderer tweak (focused)

In `TiptapLessonContent.tsx` `paragraph` renderer: if the node has no inline content (or only whitespace), render `<p><br /></p>` or a `<p className="lesson-tiptap-empty-p">` with a dedicated min-height class.

**Pros:** Explicit parity with TipTap empty blocks; CSS can stay simpler.  
**Cons:** Slightly larger change; still scope styles to `.lesson-tiptap-content`.

### Option C — Use generated HTML for display (not recommended)

The TipTap envelope also stores `html` from `generateHTML`. Switching the player to that HTML would affect embedded nodes (MCQ, flashcards, tabs) that **require** the JSON React renderer today. **Do not** replace `TiptapLessonContent` with raw HTML for full lessons.

---

## Implementation checklist

1. **Confirm** test lesson `description` is TipTap (`isTiptapDescription` true) — e.g. starts with `{"__greenwichEditor":"tiptap",…}`.
2. **Implement** spacing fix scoped to **`.lesson-tiptap-content`** on the course player only.
3. **Regression:** Open a **legacy Quill** lesson (plain HTML `description`) — spacing must be **unchanged**.
4. **Regression:** TipTap lesson with **callouts, columns, tabs, task lists, tables, images** — no broken layout; respect existing `margin: 0` on task-item inner `p` if still needed.
5. **Regression:** Empty line between two paragraphs; multiple consecutive empty lines; Shift+Enter line break within one paragraph.
6. **Optional:** Dark mode (`dark:prose-invert` on player).

---

## Acceptance criteria

- Given a DEFAULT section saved with the TipTap editor, blank lines created with **Enter** in admin appear as **visible vertical space** in the student course player, reasonably matching author intent.
- Legacy Quill sections (no TipTap envelope) are **pixel- or behavior-unchanged** relative to current production.
- No global `.rich-content p` rule that would affect Quill-only pages.
- Fix is limited to learner TipTap rendering (`.lesson-tiptap-content` and/or `TiptapLessonContent`), not admin `.section-modal-tiptap-editor`, unless the team explicitly adds a follow-up parity task.

---

## Reference: TipTap envelope (unchanged)

Stored in `sections.description` (string):

```json
{
  "__greenwichEditor": "tiptap",
  "v": 1,
  "doc": { "type": "doc", "content": [ … ] },
  "html": "<p>…</p>"
}
```

Learner DEFAULT lessons must continue to render from **`doc`** via `TiptapLessonContent`, not from `html` alone.

---

## Related code constants

- `USE_TIPTAP_DEFAULT_EDITOR` / `shouldUseTiptapDefaultEditor` — `src/constants/course-editor.ts` (new DEFAULT sections use TipTap; existing Quill stays on Quill until migrated).

---

*Handoff for frontend — spacing parity between TipTap authoring and the student course player. No backend work required.*
