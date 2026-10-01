import { readFileSync } from 'fs';
import { join } from 'path';
import { parseRiseRuntimeData } from './rise-probe';
import { parseRiseSuspendData, resolveRiseLesson } from './rise-progress';

function fixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

const HIRA_SUSPEND = fixture('rise-suspend-data-hira.json');
const HIRA_LESSONS = parseRiseRuntimeData(
  fixture('rise-runtime-hira.js'),
).lessons;

describe('parseRiseSuspendData', () => {
  /**
   * The numbers here are the ones measured on live registration f896568a
   * (2026-09-21): lessons 0, 1 and 4 complete out of 14. If the decoder ever
   * disagrees with these, it is not reading Rise's format.
   */
  it('decodes the captured HIRA blob to completed lessons 0, 1 and 4', () => {
    const result = parseRiseSuspendData(HIRA_SUSPEND);
    expect(result).not.toBeNull();
    expect(result!.completedIndices).toEqual([0, 1, 4]);
  });

  it('reports the content-package fingerprint and ignores opened-only lessons', () => {
    const result = parseRiseSuspendData(HIRA_SUSPEND)!;
    // Lesson 5 was opened (4% through) but not completed — it must stay out of
    // completedIndices.
    expect(result.cpv).toBe('z9SXlNnk');
    expect(result.completedIndices).not.toContain(5);
  });

  /**
   * `progress.p` is 21 in this blob. Returning it would hand callers a second,
   * competing progress number that disagrees with the engine's the moment a
   * package is replaced.
   */
  it('does not surface progress.p', () => {
    const result = parseRiseSuspendData(HIRA_SUSPEND)!;
    expect(Object.keys(result).sort()).toEqual(['completedIndices', 'cpv']);
  });

  it('returns null for an unsupported version rather than guessing', () => {
    const v4 = JSON.stringify({ ...JSON.parse(HIRA_SUSPEND), v: 4 });
    expect(parseRiseSuspendData(v4)).toBeNull();
  });

  it('returns null for a truncated code stream', () => {
    const parsed = JSON.parse(HIRA_SUSPEND);
    // Drop the dictionary-building prefix so later codes reference entries that
    // were never built — the shape a cut-off blob actually has.
    const truncated = JSON.stringify({ v: 3, d: parsed.d.slice(-40) });
    expect(parseRiseSuspendData(truncated)).toBeNull();
  });

  it('returns null for a code outside the dictionary', () => {
    const parsed = JSON.parse(HIRA_SUSPEND);
    const corrupted = JSON.stringify({ v: 3, d: [...parsed.d, 999999] });
    expect(parseRiseSuspendData(corrupted)).toBeNull();
  });

  it.each([
    ['empty string', ''],
    ['whitespace', '   '],
    ['not json', '{"v":3,'],
    ['no envelope', '[]'],
    ['empty code array', '{"v":3,"d":[]}'],
    ['decodes to non-json', JSON.stringify({ v: 3, d: [123, 34, 34] })],
  ])('returns null for %s without throwing', (_label, input) => {
    expect(() => parseRiseSuspendData(input)).not.toThrow();
    expect(parseRiseSuspendData(input)).toBeNull();
  });

  it.each([[null], [undefined], [42], [{}], [[]]])(
    'returns null for the non-string %p',
    (input) => {
      expect(parseRiseSuspendData(input)).toBeNull();
    },
  );

  /**
   * A learner who launched and finished nothing is NOT a decode failure — the
   * difference matters, because null means "fall back to binary progress" while
   * an empty array means "we know they have completed zero lessons".
   */
  it('distinguishes an empty lesson set from an unreadable blob', () => {
    const empty = encodeSuspend({ progress: { p: 0, lessons: {} } });
    const result = parseRiseSuspendData(empty);
    expect(result).not.toBeNull();
    expect(result!.completedIndices).toEqual([]);

    // No `lessons` key at all is a shape we do not understand.
    expect(
      parseRiseSuspendData(encodeSuspend({ progress: { p: 0 } })),
    ).toBeNull();
  });

  it('ignores lesson keys that are not canonical non-negative integers', () => {
    const odd = encodeSuspend({
      progress: {
        lessons: {
          '0': { c: 1 },
          '01': { c: 1 },
          '-1': { c: 1 },
          '1.5': { c: 1 },
          abc: { c: 1 },
          '2': { c: 1 },
        },
      },
    });
    expect(parseRiseSuspendData(odd)!.completedIndices).toEqual([0, 2]);
  });

  it('treats only c===1 (or true) as complete', () => {
    const mixed = encodeSuspend({
      progress: {
        lessons: {
          '0': { c: 1 },
          '1': { c: true },
          '2': { c: 0 },
          '3': { p: 100 },
          '4': {},
        },
      },
    });
    expect(parseRiseSuspendData(mixed)!.completedIndices).toEqual([0, 1]);
  });
});

describe('resolveRiseLesson', () => {
  it('resolves a bookmark URL to its manifest lesson', () => {
    const ref = resolveRiseLesson('index.html#/lessons/lesson-5', HIRA_LESSONS);
    expect(ref).toEqual({
      lessonId: 'lesson-5',
      lessonIndex: 5,
      lessonTitle: 'Considering Routine and Non-Routine Activities',
    });
  });

  /**
   * The bookmark is index 5 while {0,1,4} are complete. Guarding the gap is the
   * point: `lessonIndex` is a label, and anything deriving a numerator from it
   * would overstate this learner by 67%.
   */
  it('points past lessons the learner has not completed', () => {
    const ref = resolveRiseLesson(
      'index.html#/lessons/lesson-5',
      HIRA_LESSONS,
    )!;
    const completed = parseRiseSuspendData(HIRA_SUSPEND)!.completedIndices;
    expect(ref.lessonIndex).toBe(5);
    expect(completed).toEqual([0, 1, 4]);
    expect(completed).not.toContain(ref.lessonIndex);
  });

  it.each([
    ['empty location', ''],
    ['no lesson fragment', 'index.html'],
    ['unknown lesson id', 'index.html#/lessons/not-a-real-lesson'],
    ['wrong fragment shape', 'index.html#/pages/lesson-5'],
  ])('returns null for %s', (_label, location) => {
    expect(resolveRiseLesson(location, HIRA_LESSONS)).toBeNull();
  });

  it('returns null when there is no manifest to resolve against', () => {
    expect(resolveRiseLesson('index.html#/lessons/lesson-5', [])).toBeNull();
  });

  /**
   * `decodeURIComponent` throws URIError on a malformed escape, and the
   * location is learner-influenced. The module contract is that bad input
   * degrades progress rather than throwing into a request.
   */
  it('does not throw on a malformed percent-escape', () => {
    expect(() =>
      resolveRiseLesson('index.html#/lessons/a%zz', HIRA_LESSONS),
    ).not.toThrow();
    expect(
      resolveRiseLesson('index.html#/lessons/a%zz', HIRA_LESSONS),
    ).toBeNull();
  });

  it('matches a percent-encoded lesson id', () => {
    const encoded = `index.html#/lessons/${encodeURIComponent('lesson-3')}`;
    expect(resolveRiseLesson(encoded, HIRA_LESSONS)!.lessonIndex).toBe(3);
  });

  it('tolerates query and hash noise after the lesson id', () => {
    const ref = resolveRiseLesson(
      'index.html#/lessons/lesson-0?resume=1',
      HIRA_LESSONS,
    );
    expect(ref!.lessonIndex).toBe(0);
  });
});

/** Mirrors scripts/build-scorm-fixtures.ts so specs can build ad-hoc blobs. */
function encodeSuspend(payload: unknown): string {
  const input = JSON.stringify(payload);
  const dictionary = new Map<string, number>();
  for (let i = 0; i < 256; i += 1) dictionary.set(String.fromCharCode(i), i);
  let nextCode = 256;
  let current = '';
  const out: number[] = [];
  for (const char of input) {
    const candidate = current + char;
    if (dictionary.has(candidate)) {
      current = candidate;
    } else {
      out.push(dictionary.get(current)!);
      dictionary.set(candidate, nextCode);
      nextCode += 1;
      current = char;
    }
  }
  if (current !== '') out.push(dictionary.get(current)!);
  return JSON.stringify({ v: 3, d: out });
}
