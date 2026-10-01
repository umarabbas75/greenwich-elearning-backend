/**
 * Decoding Articulate Rise's learner-progress signals out of a SCORM Cloud
 * runtime record.
 *
 * ## Why this exists
 *
 * Rise reports nothing usable through the standard SCORM progress channels. On
 * a live registration 32 minutes and 3 lessons into a 14-lesson package, every
 * documented field read empty:
 *
 *   runtime.progressMeasure          ''
 *   activityDetails.completionAmount { scaled: 0 }
 *   registrationCompletionAmount     0
 *
 * The only place the learner's real position exists is `runtime.suspendData` —
 * Articulate's private resume blob. It is undocumented, so everything here is
 * written to degrade rather than throw: a malformed, truncated or re-versioned
 * blob costs us progress granularity, never a request. Callers fall back to the
 * binary "did the package report itself complete" signal, which is exactly the
 * behaviour that existed before this module.
 *
 * ## The format
 *
 * `{"v":3,"d":[<int>,…]}` where `d` is LZW over a 256-entry initial dictionary.
 * Decoded, it is:
 *
 *   { "cpv": "z9SXlNnk",
 *     "progress": { "p": 21,
 *                   "lessons": { "0": { "c": 1, "p": 100, "i": {…} }, … } } }
 *
 * - `lessons[n].c === 1` → that lesson is complete
 * - keys are **array indices into the package manifest's lesson list**, not
 *   lesson ids — which is why they are only ever resolved against the
 *   registration's own package (see `ScormRuntimeService.applyLessonProgress`)
 * - an absent key means the learner never opened that lesson
 * - `cpv` is Rise's content-package fingerprint; it changes when the package is
 *   re-authored, and is surfaced so a caller can detect an index space that no
 *   longer matches the manifest its sections were built from
 *
 * `progress.p` is deliberately NOT returned. It is exactly
 * `floor(lessonsCompleted / lessonCount * 100)` — measured against the live
 * blob, 3 of 14 complete gave `p = 21`, matching the lesson count and not the
 * block count (82 of 371 would be 22). Storing it would duplicate a number the
 * percentage engine already derives from the progress rows, and the two would
 * disagree the moment a package is replaced, because Rise's denominator is
 * frozen at authoring time while ours is not. One number, one source.
 */

export type RiseSuspendProgress = {
  /** Manifest lesson indices the learner has completed. Ascending, deduped. */
  completedIndices: number[];
  /** Rise's content-package fingerprint, when present. */
  cpv: string | null;
};

/** The only `v` this decoder claims to understand. */
const SUPPORTED_SUSPEND_VERSION = 3;

/** LZW over single-byte chars: the dictionary starts with all of them. */
const LZW_DICT_SIZE = 256;

/**
 * Decode `runtime.suspendData` into the set of completed lesson indices.
 *
 * Returns `null` for anything it cannot read with confidence — a different
 * `v`, a truncated code stream, JSON that does not carry `progress.lessons`.
 * Never throws.
 *
 * An empty `progress.lessons` is NOT a failure: it is a learner who has
 * launched but finished nothing, and it correctly yields `completedIndices: []`.
 */
export function parseRiseSuspendData(raw: unknown): RiseSuspendProgress | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;

  let envelope: unknown;
  try {
    envelope = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(envelope)) return null;
  if (envelope.v !== SUPPORTED_SUSPEND_VERSION) return null;
  if (!Array.isArray(envelope.d) || envelope.d.length === 0) return null;

  const decoded = lzwDecode(envelope.d);
  if (decoded === null) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(decoded);
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;

  const progress = isRecord(payload.progress) ? payload.progress : null;
  if (!progress) return null;
  // `lessons` is the one field this function exists to read. A blob without it
  // is a shape we do not understand, which is different from a learner who has
  // completed nothing — the latter has `lessons` present and empty.
  if (!isRecord(progress.lessons)) return null;

  const completed = new Set<number>();

  for (const [key, value] of Object.entries(progress.lessons)) {
    const index = toLessonIndex(key);
    if (index === null) continue;
    // Rise writes `c: 1` on completion and omits the key entirely otherwise.
    // Compare loosely against both 1 and true so a future encoding of the same
    // flag does not silently read as "not complete".
    if (isRecord(value) && (value.c === 1 || value.c === true)) {
      completed.add(index);
    }
  }

  return {
    completedIndices: Array.from(completed).sort((a, b) => a - b),
    cpv: typeof payload.cpv === 'string' && payload.cpv ? payload.cpv : null,
  };
}

export type RiseLessonRef = {
  lessonId: string;
  lessonIndex: number;
  lessonTitle: string;
};

/** `index.html#/lessons/<uuid>` — the only location shape Rise emits. */
const RISE_LOCATION_RE = /#\/lessons\/([^/?#]+)/;

/**
 * Resolve `runtime.location` (Rise's bookmark) to a manifest lesson.
 *
 * **This is a label, never a numerator.** The bookmark is where the learner
 * last *was*, which on a freely-navigable package says nothing about how much
 * they have finished: the live capture that motivated this module had a
 * bookmark at index 5 with `{0, 1, 4}` complete — non-contiguous, and
 * `lessonIndex - 1` would have overstated progress by 67%. Rise sets
 * `navigationMode: ""` (free roam), so this is by design rather than a quirk.
 *
 * Returns `null` for an empty location, an unparseable one, or an id that is
 * not in this package's manifest.
 */
export function resolveRiseLesson(
  locationRaw: unknown,
  lessons: Array<{ index: number; id: string; title: string }>,
): RiseLessonRef | null {
  if (typeof locationRaw !== 'string' || locationRaw.length === 0) return null;
  if (!Array.isArray(lessons) || lessons.length === 0) return null;

  const match = RISE_LOCATION_RE.exec(locationRaw);
  if (!match) return null;

  // `decodeURIComponent` throws URIError on a malformed escape (`a%zz`). The
  // location is learner-influenced runtime data, and this module's contract is
  // that bad input degrades progress rather than breaking a request — an
  // uncaught throw here would surface as a 5xx that Cloud retries forever on
  // the same body, so the registration would never persist anything.
  let lessonId: string;
  try {
    lessonId = decodeURIComponent(match[1]);
  } catch {
    lessonId = match[1];
  }

  const lesson = lessons.find((l) => l.id === lessonId);
  if (!lesson) return null;

  return {
    lessonId: lesson.id,
    lessonIndex: lesson.index,
    lessonTitle: lesson.title,
  };
}

/**
 * Classic LZW with a 256-entry initial dictionary.
 *
 * Returns `null` rather than throwing on a code that is neither in the
 * dictionary nor the single legal look-ahead case (`code === nextCode`), which
 * is what a truncated or corrupted stream produces.
 */
function lzwDecode(codes: unknown[]): string | null {
  const dictionary: string[] = new Array(LZW_DICT_SIZE);
  for (let i = 0; i < LZW_DICT_SIZE; i += 1) {
    dictionary[i] = String.fromCharCode(i);
  }

  const first = codes[0];
  if (!isCode(first) || first >= LZW_DICT_SIZE) return null;

  let previous = dictionary[first];
  const out: string[] = [previous];
  let nextCode = LZW_DICT_SIZE;

  for (let i = 1; i < codes.length; i += 1) {
    const code = codes[i];
    if (!isCode(code)) return null;

    let current: string;
    if (code < dictionary.length && dictionary[code] !== undefined) {
      current = dictionary[code];
    } else if (code === nextCode) {
      // The one legal forward reference: the encoder emitted a code for an
      // entry the decoder is about to build on this very iteration.
      current = previous + previous[0];
    } else {
      return null;
    }

    out.push(current);
    dictionary[nextCode] = previous + current[0];
    nextCode += 1;
    previous = current;
  }

  return out.join('');
}

function isCode(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Lesson keys arrive as JSON object keys, so always strings. Accept only a
 * canonical non-negative integer — `"01"` or `"1.5"` or `"-1"` would mean the
 * blob is not the shape we think it is, and silently coercing them risks
 * attributing progress to the wrong lesson.
 */
function toLessonIndex(key: string): number | null {
  if (!/^(0|[1-9]\d*)$/.test(key)) return null;
  const index = Number(key);
  return Number.isSafeInteger(index) ? index : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
