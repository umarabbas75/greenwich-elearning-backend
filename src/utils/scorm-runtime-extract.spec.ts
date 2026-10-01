import { readFileSync } from 'fs';
import { join } from 'path';
import { extractRuntime } from './scorm-runtime-extract';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'));
}

const FULL = fixture('scorm-registration-full.json');
const ACTIVITY = fixture('scorm-registration-activity.json');
const COURSE = fixture('scorm-registration-course.json');

describe('extractRuntime', () => {
  /**
   * The bug this function exists to prevent: `payload.runtime` is undefined on
   * every real payload, so a mapper reading it writes nothing and says nothing.
   */
  it('finds runtime on a nested child, not on the registration', () => {
    expect((FULL as any).runtime).toBeUndefined();

    const result = extractRuntime(FULL)!;
    expect(result.runtime).not.toBeNull();
    expect(result.runtime!.location).toBe('index.html#/lessons/lesson-5');
    expect(typeof result.runtime!.suspendData).toBe('string');
  });

  /**
   * The three fixtures are the three `resultsFormat` levels. ACTIVITY carrying
   * no runtime is the measurement that decides push-vs-pull for the whole
   * freshness model, so it is pinned here rather than left as prose.
   */
  it('returns runtime only at FULL detail', () => {
    expect(extractRuntime(FULL)!.runtime).not.toBeNull();
    expect(extractRuntime(ACTIVITY)!.runtime).toBeNull();
    expect(extractRuntime(COURSE)!.runtime).toBeNull();
  });

  it('still reports scalars when runtime is absent', () => {
    const activity = extractRuntime(ACTIVITY)!;
    expect(activity.attempts).toBe(1);
    expect(activity.suspended).toBe(true);
  });

  /**
   * Activity-level completionAmount is `{ scaled: n }`; the registration-level
   * field is a bare float. Reading the former as a number silently yields null.
   */
  it('normalises the object form of completionAmount', () => {
    expect(extractRuntime(FULL)!.completionAmount).toBe(0);

    const bare = { activityDetails: { completionAmount: 0.42, children: [] } };
    expect(extractRuntime(bare)!.completionAmount).toBe(0.42);
  });

  it('prefers the deepest activity carrying a runtime', () => {
    const deep = {
      activityDetails: {
        attempts: 1,
        children: [
          { attempts: 2, children: [] },
          {
            attempts: 3,
            suspended: true,
            children: [
              { attempts: 4, suspended: false, runtime: { location: 'deep' } },
            ],
          },
        ],
      },
    };
    const result = extractRuntime(deep)!;
    expect(result.runtime!.location).toBe('deep');
    // Scalars come from the runtime-bearing node, not the root.
    expect(result.attempts).toBe(4);
    expect(result.suspended).toBe(false);
  });

  /**
   * The scalars must describe the SAME activity as the runtime they accompany.
   * With last-sibling-wins they could come from a different SCO than the
   * suspendData that produced the lesson progress.
   */
  it('takes scalars from the same sibling the runtime came from', () => {
    const multiSco = {
      activityDetails: {
        attempts: 1,
        children: [
          { attempts: 7, suspended: true, runtime: { location: 'first' } },
          { attempts: 9, suspended: false },
        ],
      },
    };
    const result = extractRuntime(multiSco)!;
    expect(result.runtime!.location).toBe('first');
    expect(result.attempts).toBe(7);
    expect(result.suspended).toBe(true);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['an array', []],
    ['an object with no activityDetails', { id: 'r1' }],
    ['activityDetails that is not an object', { activityDetails: 'x' }],
  ])('returns null for %s without throwing', (_label, payload) => {
    expect(() => extractRuntime(payload)).not.toThrow();
    expect(extractRuntime(payload)).toBeNull();
  });

  it('survives malformed children without throwing', () => {
    const messy = {
      activityDetails: {
        attempts: 1,
        children: [null, 'x', 42, { children: 'not-an-array' }],
      },
    };
    expect(() => extractRuntime(messy)).not.toThrow();
    expect(extractRuntime(messy)!.runtime).toBeNull();
    expect(extractRuntime(messy)!.attempts).toBe(1);
  });

  it('reports null rather than 0 for missing scalars', () => {
    const bare = { activityDetails: { children: [] } };
    const result = extractRuntime(bare)!;
    expect(result.attempts).toBeNull();
    expect(result.suspended).toBeNull();
    expect(result.completionAmount).toBeNull();
  });
});
