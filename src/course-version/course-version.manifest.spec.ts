import {
  computeStructuralFingerprint,
  countSectionsInManifest,
  diffManifests,
  getSectionIdsFromManifest,
  isIdReferencedInManifest,
  parseManifest,
} from './course-version.manifest';

const manifestA = {
  modules: [
    {
      sourceId: 'mod-1',
      order: 0,
      chapters: [
        {
          sourceId: 'ch-1',
          order: 0,
          sectionIds: ['sec-1', 'sec-2'],
          quizIds: ['quiz-1'],
        },
      ],
    },
  ],
};

const manifestB = {
  modules: [
    {
      sourceId: 'mod-1',
      order: 0,
      chapters: [
        {
          sourceId: 'ch-1',
          order: 0,
          sectionIds: ['sec-1', 'sec-2'],
          quizIds: ['quiz-1'],
        },
        {
          sourceId: 'ch-2',
          order: 1,
          sectionIds: ['sec-3'],
          quizIds: [],
        },
      ],
    },
  ],
};

describe('course-version.manifest', () => {
  it('parses valid manifest JSON', () => {
    expect(parseManifest(manifestA)).toEqual(manifestA);
    expect(parseManifest(null)).toBeNull();
    expect(parseManifest({})).toBeNull();
  });

  it('counts sections and extracts ids', () => {
    expect(countSectionsInManifest(manifestA)).toBe(2);
    expect(getSectionIdsFromManifest(manifestA)).toEqual(['sec-1', 'sec-2']);
  });

  it('detects structural fingerprint equality', () => {
    const fpA = computeStructuralFingerprint(manifestA);
    const fpCopy = computeStructuralFingerprint({
      modules: [
        {
          sourceId: 'mod-1',
          order: 99,
          chapters: [
            {
              sourceId: 'ch-1',
              order: 99,
              sectionIds: ['sec-2', 'sec-1'],
              quizIds: ['quiz-1'],
            },
          ],
        },
      ],
    });
    expect(fpA).toBe(fpCopy);
    expect(fpA).not.toBe(computeStructuralFingerprint(manifestB));
  });

  it('diffs manifests for new-since-pinned summary', () => {
    expect(diffManifests(manifestA, manifestB)).toEqual({
      newSections: 1,
      newChapters: 1,
    });
  });

  it('checks manifest membership for delete guard', () => {
    expect(isIdReferencedInManifest(manifestA, 'section', 'sec-1')).toBe(true);
    expect(isIdReferencedInManifest(manifestA, 'section', 'sec-9')).toBe(
      false,
    );
    expect(isIdReferencedInManifest(manifestA, 'quiz', 'quiz-1')).toBe(true);
    expect(isIdReferencedInManifest(manifestA, 'chapter', 'ch-1')).toBe(true);
    expect(isIdReferencedInManifest(manifestA, 'module', 'mod-1')).toBe(true);
  });
});
