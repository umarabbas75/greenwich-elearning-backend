export type RiseReportingMode = string | null;

export type RiseProbeResult = {
  title: string | null;
  reporting: RiseReportingMode;
  quizItemCount: number;
  passingScore: number | null;
};

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

  const reporting = firstString(
    settings.reporting,
    exportSettings.reporting,
  );

  const lessons = Array.isArray(courseObj.lessons) ? courseObj.lessons : [];
  let quizItemCount = 0;
  let passingScore: number | null = null;
  for (const lesson of lessons) {
    if (!lesson || typeof lesson !== 'object' || Array.isArray(lesson)) {
      continue;
    }
    const row = lesson as Record<string, unknown>;
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
  };
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
