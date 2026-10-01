export type RiseReportingMode = string | null;

/**
 * One lesson from the package manifest, in the index space that
 * `suspendData.progress.lessons` keys against.
 *
 * `index` is the position in the FILTERED, SORTED list — deleted lessons
 * removed, then ordered by `position`. Getting that wrong misattributes every
 * decoded progress row, so it is derived here once rather than at each caller.
 */
export type RiseLesson = {
  index: number;
  id: string;
  title: string;
  /** Rise's own lesson type: 'blocks' | 'quiz' | anything it adds later. */
  type: string;
};

export type RiseProbeResult = {
  title: string | null;
  reporting: RiseReportingMode;
  quizItemCount: number;
  passingScore: number | null;
  /**
   * Lessons in manifest order. Empty for any manifest this cannot read — which
   * is the signal to fall back to a single synthetic section (today's
   * behaviour) rather than materialising a lesson tree.
   */
  lessons: RiseLesson[];
  /**
   * Non-null when this manifest could expose the untested index-space
   * assumption documented on `extractRiseLessons`. Logged at import, and while
   * set the progress path keeps the package on binary progress.
   */
  riseIndexSpaceRisk: string | null;
};

/** Rise's sidebar heading entry: in `course.lessons`, but not a lesson. */
const RISE_DIVIDER_TYPE = 'section';

const JSONP_RE = /__jsonp\(\s*"([^"]*)"\s*,\s*"([^"]+)"\s*\)/;

/**
 * Rise `scormcontent/runtime-data.js` is not JSON. It is
 * `__jsonp("runtime-data.js","<base64-json>")`. There is no `quizItemCount`
 * key — count `course.lessons` where `type === "quiz"` via `items.length`.
 * Reporting lives on `settings.reporting` (fallback: `course.exportSettings.reporting`).
 * Passing mark lives on the quiz lesson's `settings.passingScore`.
 */
export function parseRiseRuntimeData(source: string): RiseProbeResult {
  const json = unwrapRiseRuntimeJson(source);
  const course =
    json && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>).course
      : null;
  const courseObj =
    course && typeof course === 'object' && !Array.isArray(course)
      ? (course as Record<string, unknown>)
      : {};
  const root =
    json && typeof json === 'object' && !Array.isArray(json)
      ? (json as Record<string, unknown>)
      : {};

  const settings =
    root.settings && typeof root.settings === 'object'
      ? (root.settings as Record<string, unknown>)
      : {};
  const exportSettings =
    courseObj.exportSettings && typeof courseObj.exportSettings === 'object'
      ? (courseObj.exportSettings as Record<string, unknown>)
      : {};

  const reporting = firstString(settings.reporting, exportSettings.reporting);

  const lessons = Array.isArray(courseObj.lessons) ? courseObj.lessons : [];
  const riseIndexSpaceRisk = describeRiseIndexSpaceRisk(lessons);
  let quizItemCount = 0;
  let passingScore: number | null = null;
  for (const lesson of lessons) {
    if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
      continue;
    }
    const row = lesson as Record<string, unknown>;
    // Must drop exactly what `extractRiseLessons` drops, or the two disagree
    // about what the package contains. Counting a quiz that never becomes a
    // section lets `completeOn: 'passed'` pass its policy gate against a quiz
    // the learner can never reach, so they could never certify.
    if (row.deleted === true) continue;
    if (typeof row.id !== 'string' || row.id.length === 0) continue;
    if (row.type !== 'quiz') continue;
    const items = Array.isArray(row.items) ? row.items : [];
    quizItemCount += items.length;
    if (passingScore == null) {
      const quizSettings =
        row.settings && typeof row.settings === 'object'
          ? (row.settings as Record<string, unknown>)
          : {};
      if (typeof quizSettings.passingScore === 'number') {
        passingScore = quizSettings.passingScore;
      }
    }
  }

  const rawTitle = firstString(courseObj.title, settings.title);

  return {
    title: rawTitle,
    reporting,
    quizItemCount,
    passingScore,
    lessons: extractRiseLessons(lessons),
    riseIndexSpaceRisk,
  };
}

/**
 * Non-null when this manifest is one where "filtered index" and "raw array
 * index" would DISAGREE — a soft-deleted lesson, an id-less entry, a section
 * divider, or `position` departing from array order.
 *
 * Every package imported so far is free of all of them, which is also why the
 * assumption on `extractRiseLessons` is untested rather than wrong. Persisted
 * with the probe (`riseProbeJson`), and the progress path reads it back to
 * refuse lesson mode for the package rather than guess an index space.
 */
function describeRiseIndexSpaceRisk(rawLessons: unknown[]): string | null {
  let deleted = 0;
  let unusable = 0;
  let dividers = 0;
  let outOfOrder = false;
  let previousPosition = -Infinity;

  rawLessons.forEach((lesson, i) => {
    if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
      unusable += 1;
      return;
    }
    const row = lesson as Record<string, unknown>;
    if (row.deleted === true) {
      deleted += 1;
      return;
    }
    // `extractRiseLessons` drops these, which shifts every index after them —
    // exactly the same hazard as a soft-deletion, so it has to be reported the
    // same way rather than silently changing the index space.
    if (typeof row.id !== 'string' || row.id.length === 0) {
      unusable += 1;
      return;
    }
    // Dropped by `extractRiseLessons` too, and whether Rise's own index space
    // counts them is exactly what nobody has verified.
    if (row.type === RISE_DIVIDER_TYPE) {
      dividers += 1;
      return;
    }
    const position =
      typeof row.position === 'number' && Number.isFinite(row.position)
        ? row.position
        : i;
    if (position < previousPosition) outOfOrder = true;
    previousPosition = position;
  });

  if (deleted === 0 && unusable === 0 && dividers === 0 && !outOfOrder) {
    return null;
  }
  const parts: string[] = [];
  if (deleted > 0) parts.push(`${deleted} soft-deleted lesson(s)`);
  if (unusable > 0)
    parts.push(`${unusable} lesson(s) dropped for a missing id`);
  if (dividers > 0) parts.push(`${dividers} section divider(s)`);
  if (outOfOrder) parts.push('position order differs from array order');
  return parts.join('; ');
}

/**
 * Lessons in the index space `suspendData` keys against.
 *
 * Three traps:
 *
 * 1. **`deleted` is a soft flag.** Removed lessons stay in the array.
 * 2. **`position` is authoritative, not array order.**
 * 3. **`type: 'section'` is a divider**, a heading in Rise's sidebar with no
 *    content of its own. Materialising it as a Section would give the learner
 *    a curriculum entry nothing can ever complete, so it is dropped here.
 *
 * ## An assumption worth knowing about
 *
 * `suspendData.progress.lessons` is keyed by integer. This function assumes
 * those keys index the FILTERED, SORTED list — deleted lessons and dividers
 * removed, ordered by `position`. That was verified end-to-end on a live
 * registration only in the case where every interpretation COINCIDES: the live
 * packages checked had no deleted lessons, no dividers and `position` equal to
 * array order.
 *
 * The fixtures do not settle it either. `rise-runtime-hira.js` is the course
 * MANIFEST (`runtime-data.js`), not Rise's player code, and it is synthesised
 * by scripts/build-scorm-fixtures.ts with the deleted lesson and the reordered
 * quiz injected; the suspendData fixture is re-encoded from values recorded on
 * a package with neither. Neither shows how the player derives a key.
 *
 * So whenever the readings could DIFFER, `describeRiseIndexSpaceRisk` flags the
 * manifest, and the progress path refuses lesson mode for that package (binary
 * progress, see `ScormRuntimeService.applyLessonProgress`) until someone has
 * checked a real learner's decode and marked it verified. Guessing would
 * attribute every completion after the divergence to the wrong section.
 *
 * Returns `[]` for anything unreadable — a manifest shape Rise changes under
 * us degrades the import to a single section rather than producing a lesson
 * tree with indices that mean nothing.
 */
function extractRiseLessons(rawLessons: unknown[]): RiseLesson[] {
  const rows: Array<{
    position: number;
    id: string;
    title: string | null;
    type: string;
  }> = [];

  for (let i = 0; i < rawLessons.length; i += 1) {
    const lesson = rawLessons[i];
    if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson))
      continue;
    const row = lesson as Record<string, unknown>;

    if (row.deleted === true) continue;
    if (typeof row.id !== 'string' || row.id.length === 0) continue;
    if (row.type === RISE_DIVIDER_TYPE) continue;

    // Fall back to array order when `position` is absent or not a number, so a
    // manifest missing the field still yields a stable, sensible ordering.
    const position =
      typeof row.position === 'number' && Number.isFinite(row.position)
        ? row.position
        : i;

    rows.push({
      position,
      id: row.id,
      // Left null here on purpose: a fallback name has to reflect the lesson's
      // FINAL index, and that is not known until after the sort below.
      title:
        typeof row.title === 'string' && row.title.length > 0
          ? unescapeRiseTitle(row.title)
          : null,
      type: typeof row.type === 'string' ? row.type : 'blocks',
    });
  }

  // Stable sort on position; ties keep discovery order.
  rows.sort((a, b) => a.position - b.position);

  return rows.map((row, index) => ({
    index,
    id: row.id,
    title: row.title ?? `Lesson ${index + 1}`,
    type: row.type,
  }));
}

export function unwrapRiseRuntimeJson(source: string): unknown {
  const trimmed = source.trim();
  const jsonp = JSONP_RE.exec(trimmed);
  if (jsonp) {
    const decoded = Buffer.from(jsonp[2], 'base64').toString('utf8');
    return JSON.parse(decoded);
  }
  return JSON.parse(trimmed);
}

/**
 * Rise double-escapes manifest titles (`&amp;amp;`). Probe titles are
 * typically single-escaped. Unescape twice is safe for both: a single
 * `&amp;` becomes `&` then stays `&`.
 */
export function unescapeRiseTitle(title: string): string {
  return unescapeHtmlEntities(unescapeHtmlEntities(title));
}

function unescapeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}
