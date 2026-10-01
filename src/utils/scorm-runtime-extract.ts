/**
 * Finding the SCO runtime record inside a SCORM Cloud registration payload.
 *
 * ## Why a tree walk rather than a property read
 *
 * `runtime` is NOT on the registration. It hangs off the deepest activity in
 * `activityDetails`, which for a single-SCO Rise package is one level down:
 *
 *   registration
 *   └── activityDetails          ← attempts, suspended, completionAmount
 *       └── children[0]          ← the SCO
 *           └── runtime          ← location, suspendData, entry, exit
 *
 * A mapper written against `payload.runtime` reads `undefined` and silently
 * writes nothing — the failure is invisible, which is why this is a named,
 * tested function instead of an inline lookup.
 *
 * ## Detail levels
 *
 * The payload shape is set by the caller, and the three levels map exactly onto
 * SCORM Cloud's `resultsFormat` for postbacks. Verified against the live API:
 *
 *   GET /registrations/{id}                        (= COURSE)   children: []
 *   …?includeChildResults=true                     (= ACTIVITY) children, no runtime
 *   …?includeChildResults=true&includeRuntime=true (= FULL)     children + runtime
 *
 * So an ACTIVITY-format postback carries no `suspendData`. That measurement is
 * what makes the pull path (which asks for FULL explicitly) the only source of
 * lesson-level progress, and it is why `extractRuntime` returning `null` has to
 * be an ordinary, expected outcome rather than an error.
 */

export type ExtractedRuntime = {
  /** The SCO's runtime record. Present only at FULL detail. */
  runtime: Record<string, unknown> | null;
  /** Attempt count from the deepest activity carrying one. */
  attempts: number | null;
  /** Whether the activity is suspended (a resumable session exists). */
  suspended: boolean | null;
  /**
   * Cloud's own completion fraction, 0..1.
   *
   * Normalised from `{ scaled: number }` — the activity-level field is an
   * OBJECT, unlike the registration-level `registrationCompletionAmount`, which
   * is a bare float. Reading the activity one as a number yields `null`, which
   * is the bug this normalisation exists to prevent.
   *
   * Always 0 for Rise (it reports no progress measure), so it is stored for
   * auditability and never displayed or used as a numerator.
   */
  completionAmount: number | null;
};

/**
 * Depth-first walk of `activityDetails` for the deepest node carrying a
 * `runtime`, falling back to the deepest node overall for the scalar fields.
 *
 * Returns `null` only when there is no `activityDetails` at all. A COURSE-level
 * payload yields a result with `runtime: null` and usable scalars, which is the
 * distinction callers need in order to leave existing progress untouched rather
 * than overwriting it with absence.
 */
export function extractRuntime(payload: unknown): ExtractedRuntime | null {
  if (!isRecord(payload)) return null;
  const root = payload.activityDetails;
  if (!isRecord(root)) return null;

  let runtime: Record<string, unknown> | null = null;
  let runtimeDepth = -1;

  // Each scalar is tracked independently, deepest-non-null wins. Taking them
  // all from one "best" node instead would drop a field the deepest activity
  // happens to omit — the SCO is the most specific answer where it has one, but
  // where it is silent the parent activity's value is still the right one.
  const scalars = {
    attempts: { value: null as number | null, depth: -1 },
    suspended: { value: null as boolean | null, depth: -1 },
    completionAmount: { value: null as number | null, depth: -1 },
  };

  // Strictly deeper wins, matching the `runtime` capture above. With `>=` the
  // LAST sibling at the deepest level would win while `runtime` kept the FIRST,
  // so on a multi-SCO package the scalars could describe a different activity
  // than the suspendData they are reported alongside.
  const take = <T>(
    slot: { value: T | null; depth: number },
    candidate: T | null,
    depth: number,
  ): void => {
    if (candidate !== null && depth > slot.depth) {
      slot.value = candidate;
      slot.depth = depth;
    }
  };

  const visit = (node: Record<string, unknown>, depth: number): void => {
    if (isRecord(node.runtime) && depth > runtimeDepth) {
      runtime = node.runtime;
      runtimeDepth = depth;
    }
    take(scalars.attempts, toFiniteNumber(node.attempts), depth);
    take(
      scalars.suspended,
      typeof node.suspended === 'boolean' ? node.suspended : null,
      depth,
    );
    take(
      scalars.completionAmount,
      toCompletionAmount(node.completionAmount),
      depth,
    );

    const children = node.children;
    if (!Array.isArray(children)) return;
    for (const child of children) {
      if (isRecord(child)) visit(child, depth + 1);
    }
  };
  visit(root, 0);

  return {
    runtime,
    attempts: scalars.attempts.value,
    suspended: scalars.suspended.value,
    completionAmount: scalars.completionAmount.value,
  };
}

/**
 * `{ scaled: 0.0 }` at activity level, a bare number at registration level.
 * Accept both so a caller cannot be caught out by which one it was handed.
 */
function toCompletionAmount(value: unknown): number | null {
  if (isRecord(value)) return toFiniteNumber(value.scaled);
  return toFiniteNumber(value);
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
