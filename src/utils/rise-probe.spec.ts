import { readFileSync } from 'fs';
import { join } from 'path';
import { parseRiseRuntimeData, unescapeRiseTitle } from './rise-probe';

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf8');
}

describe('parseRiseRuntimeData', () => {
  it('unwraps JSONP + base64 and reports lifting: passed-incomplete, empty quiz', () => {
    const probe = parseRiseRuntimeData(loadFixture('rise-runtime-lifting.js'));
    expect(probe.reporting).toBe('passed-incomplete');
    expect(probe.quizItemCount).toBe(0);
    expect(probe.passingScore).toBeNull();
    expect(probe.title).toContain('Safe Lifting');
    expect(probe.title).toContain('&amp;');
  });

  it('counts fire-safety quiz items and reads passingScore from quiz.settings', () => {
    const probe = parseRiseRuntimeData(
      loadFixture('rise-runtime-fire-safety.js'),
    );
    expect(probe.reporting).toBe('passed-incomplete');
    expect(probe.quizItemCount).toBe(25);
    expect(probe.passingScore).toBe(80);
    expect(probe.title).toContain('Fire Safety');
  });

  it('unescapes a double-encoded Rise title twice', () => {
    expect(
      unescapeRiseTitle('Occupational Health &amp;amp; Safety: Safe Lifting'),
    ).toBe('Occupational Health & Safety: Safe Lifting');
    expect(
      unescapeRiseTitle('Occupational Health &amp; Safety: Safe Lifting'),
    ).toBe('Occupational Health & Safety: Safe Lifting');
  });
});

describe('parseRiseRuntimeData — lesson manifest', () => {
  const lessons = () =>
    parseRiseRuntimeData(loadFixture('rise-runtime-hira.js')).lessons;

  it('returns the 14 live lessons in position order', () => {
    const result = lessons();
    expect(result).toHaveLength(14);
    expect(result.map((l) => l.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
  });

  /**
   * The fixture writes the quiz FIRST in the array with `position: 13`. An
   * index space built from array order would put it at 0 and shift every
   * lesson — silently misattributing every decoded progress row by one.
   */
  it('honours position over array order', () => {
    const result = lessons();
    expect(result[13]).toMatchObject({ id: 'lesson-quiz', type: 'quiz' });
    expect(result[0]).toMatchObject({ id: 'lesson-0', type: 'blocks' });
  });

  /**
   * A soft-deleted lesson must neither appear nor consume an index — it would
   * inflate the denominator and shift everything after it.
   */
  it('excludes deleted lessons without leaving a gap', () => {
    const result = lessons();
    expect(result.map((l) => l.id)).not.toContain('lesson-removed');
    expect(new Set(result.map((l) => l.index)).size).toBe(result.length);
  });

  it('exposes the quiz lesson like any other', () => {
    const quiz = lessons().filter((l) => l.type === 'quiz');
    expect(quiz).toHaveLength(1);
    expect(quiz[0].title).toBe('Quiz');
  });

  it('unescapes lesson titles', () => {
    const result = lessons();
    expect(result[0].title).toBe(
      'Key Terms in Hazard Identification and Risk Assessment',
    );
  });

  it('falls back to array order when position is missing', () => {
    const manifest = {
      course: {
        lessons: [
          { id: 'a', title: 'A', type: 'blocks' },
          { id: 'b', title: 'B', type: 'blocks' },
        ],
      },
    };
    const probe = parseRiseRuntimeData(JSON.stringify(manifest));
    expect(probe.lessons.map((l) => l.id)).toEqual(['a', 'b']);
  });

  it('skips lessons with no usable id', () => {
    const manifest = {
      course: {
        lessons: [
          { id: 'a', title: 'A', position: 0 },
          { title: 'no id', position: 1 },
          { id: '', title: 'empty id', position: 2 },
          { id: 'b', title: 'B', position: 3 },
        ],
      },
    };
    const probe = parseRiseRuntimeData(JSON.stringify(manifest));
    expect(probe.lessons.map((l) => l.id)).toEqual(['a', 'b']);
    expect(probe.lessons.map((l) => l.index)).toEqual([0, 1]);
  });

  /**
   * An unreadable manifest degrades the import to a single synthetic section —
   * today's behaviour — rather than producing indices that mean nothing.
   */
  it('returns [] for manifests it cannot read', () => {
    expect(parseRiseRuntimeData('{}').lessons).toEqual([]);
    expect(parseRiseRuntimeData('{"course":{}}').lessons).toEqual([]);
    expect(
      parseRiseRuntimeData('{"course":{"lessons":"nope"}}').lessons,
    ).toEqual([]);
    expect(
      parseRiseRuntimeData('{"course":{"lessons":[null,1,"x"]}}').lessons,
    ).toEqual([]);
  });

  it('leaves the existing non-Rise fixtures without lessons they do not have', () => {
    const lifting = parseRiseRuntimeData(
      loadFixture('rise-runtime-lifting.js'),
    );
    expect(Array.isArray(lifting.lessons)).toBe(true);
  });
});

describe('parseRiseRuntimeData — deleted lessons and the quiz gate', () => {
  /**
   * The policy gate refuses `completeOn: 'passed'` when a package has no
   * scoreable quiz items. Counting a DELETED quiz's items passes that gate
   * against a quiz the learner can never reach, so they could never certify.
   */
  it('does not count items from a deleted quiz', () => {
    const manifest = {
      course: {
        lessons: [
          { id: 'l1', type: 'blocks', title: 'One', position: 0 },
          {
            id: 'q-old',
            type: 'quiz',
            title: 'Removed Quiz',
            position: 1,
            deleted: true,
            items: new Array(25).fill({ id: 'q' }),
            settings: { passingScore: 80 },
          },
        ],
      },
    };
    const probe = parseRiseRuntimeData(JSON.stringify(manifest));
    expect(probe.quizItemCount).toBe(0);
    expect(probe.passingScore).toBeNull();
    expect(probe.lessons.map((l) => l.id)).toEqual(['l1']);
  });

  it('still counts a live quiz alongside a deleted one', () => {
    const manifest = {
      course: {
        lessons: [
          {
            id: 'q-old',
            type: 'quiz',
            title: 'Removed',
            position: 0,
            deleted: true,
            items: new Array(25).fill({ id: 'q' }),
            settings: { passingScore: 50 },
          },
          {
            id: 'q-new',
            type: 'quiz',
            title: 'Quiz',
            position: 1,
            items: new Array(10).fill({ id: 'q' }),
            settings: { passingScore: 80 },
          },
        ],
      },
    };
    const probe = parseRiseRuntimeData(JSON.stringify(manifest));
    expect(probe.quizItemCount).toBe(10);
    expect(probe.passingScore).toBe(80);
  });
});

describe('parseRiseRuntimeData — index-space risk reporting', () => {
  /**
   * The decoded suspendData index space is assumed to key the filtered+sorted
   * lesson list. Anything that makes that differ from raw array order has to be
   * surfaced at import, because a silent shift misattributes every completion
   * after it.
   */
  it('is null for a manifest where both readings coincide', () => {
    const manifest = {
      course: {
        lessons: [
          { id: 'a', title: 'A', type: 'blocks', position: 0 },
          { id: 'b', title: 'B', type: 'blocks', position: 1 },
        ],
      },
    };
    expect(
      parseRiseRuntimeData(JSON.stringify(manifest)).riseIndexSpaceRisk,
    ).toBeNull();
  });

  it('reports soft-deleted lessons', () => {
    const risk = parseRiseRuntimeData(
      loadFixture('rise-runtime-hira.js'),
    ).riseIndexSpaceRisk;
    expect(risk).toContain('soft-deleted');
  });

  /** Dropping an id-less entry shifts indices exactly like a deletion does. */
  it('reports lessons dropped for a missing id', () => {
    const manifest = {
      course: {
        lessons: [
          { id: 'a', title: 'A', position: 0 },
          { title: 'no id', position: 1 },
          { id: 'b', title: 'B', position: 2 },
        ],
      },
    };
    const probe = parseRiseRuntimeData(JSON.stringify(manifest));
    expect(probe.riseIndexSpaceRisk).toContain('missing id');
    expect(probe.lessons).toHaveLength(2);
  });

  it('reports position order diverging from array order', () => {
    const manifest = {
      course: {
        lessons: [
          { id: 'a', title: 'A', position: 5 },
          { id: 'b', title: 'B', position: 1 },
        ],
      },
    };
    expect(
      parseRiseRuntimeData(JSON.stringify(manifest)).riseIndexSpaceRisk,
    ).toContain('position order');
  });
});

describe('parseRiseRuntimeData — section dividers', () => {
  const manifest = {
    course: {
      lessons: [
        { id: 'd1', type: 'section', title: 'Part One', position: 0 },
        { id: 'a', type: 'blocks', title: 'A', position: 1 },
        { id: 'd2', type: 'section', title: 'Part Two', position: 2 },
        { id: 'b', type: 'blocks', title: 'B', position: 3 },
        { id: 'q', type: 'quiz', title: 'Quiz', position: 4, items: [{}] },
      ],
    },
  };

  /**
   * A divider is a sidebar heading with no content. As a Section it would be a
   * curriculum entry the learner can never complete.
   */
  it('does not materialise dividers as lessons', () => {
    const probe = parseRiseRuntimeData(JSON.stringify(manifest));
    expect(probe.lessons.map((l) => l.id)).toEqual(['a', 'b', 'q']);
    expect(probe.lessons.map((l) => l.index)).toEqual([0, 1, 2]);
  });

  /**
   * Whether Rise's suspendData keys count dividers is unverified, so a package
   * that has them must be flagged — the progress path keeps it on binary.
   */
  it('flags the index space as unverified', () => {
    expect(
      parseRiseRuntimeData(JSON.stringify(manifest)).riseIndexSpaceRisk,
    ).toContain('2 section divider(s)');
  });

  it('still counts the quiz', () => {
    expect(parseRiseRuntimeData(JSON.stringify(manifest)).quizItemCount).toBe(
      1,
    );
  });
});
