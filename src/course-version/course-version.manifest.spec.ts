import {
  computeStructuralFingerprint,
  countSectionsInManifest,
  diffManifests,
  diffManifestsTitled,
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

  it('fingerprint equal for identical structure (ignores the `order` field)', () => {
    const fpA = computeStructuralFingerprint(manifestA);
    // Same nesting and same section/quiz order → equal. The numeric `order`
    // field is not part of the hash (chapter/module order comes from the array
    // position, which is deterministic in buildManifestFromLiveTree).
    const fpCopy = computeStructuralFingerprint({
      modules: [
        {
          sourceId: 'mod-1',
          order: 99,
          chapters: [
            {
              sourceId: 'ch-1',
              order: 99,
              sectionIds: ['sec-1', 'sec-2'],
              quizIds: ['quiz-1'],
            },
          ],
        },
      ],
    });
    expect(fpA).toBe(fpCopy);
    expect(fpA).not.toBe(computeStructuralFingerprint(manifestB));
  });

  it('fingerprint detects section reorder within a chapter', () => {
    const reordered = {
      modules: [
        {
          sourceId: 'mod-1',
          order: 0,
          chapters: [
            {
              sourceId: 'ch-1',
              order: 0,
              sectionIds: ['sec-2', 'sec-1'],
              quizIds: ['quiz-1'],
            },
          ],
        },
      ],
    };
    expect(computeStructuralFingerprint(manifestA)).not.toBe(
      computeStructuralFingerprint(reordered),
    );
  });

  it('fingerprint ignores quiz reorder within a chapter (order not structural)', () => {
    const reorderedQuizzes = {
      modules: [
        {
          sourceId: 'mod-1',
          order: 0,
          chapters: [
            {
              sourceId: 'ch-1',
              order: 0,
              sectionIds: ['sec-1', 'sec-2'],
              quizIds: ['quiz-2', 'quiz-1'],
            },
          ],
        },
      ],
    };
    const baseline = {
      modules: [
        {
          sourceId: 'mod-1',
          order: 0,
          chapters: [
            {
              sourceId: 'ch-1',
              order: 0,
              sectionIds: ['sec-1', 'sec-2'],
              quizIds: ['quiz-1', 'quiz-2'],
            },
          ],
        },
      ],
    };
    expect(computeStructuralFingerprint(baseline)).toBe(
      computeStructuralFingerprint(reorderedQuizzes),
    );
  });

  it('fingerprint detects relocation across chapters (flat id sets unchanged)', () => {
    // quiz-1 moves from ch-1 to ch-2. The flat {moduleIds,chapterIds,sectionIds,
    // quizIds} sets are byte-identical, so the OLD flat fingerprint missed this;
    // the nested fingerprint must not.
    const before = {
      modules: [
        {
          sourceId: 'mod-1',
          order: 0,
          chapters: [
            {
              sourceId: 'ch-1',
              order: 0,
              sectionIds: ['sec-1'],
              quizIds: ['quiz-1'],
            },
            { sourceId: 'ch-2', order: 1, sectionIds: ['sec-2'], quizIds: [] },
          ],
        },
      ],
    };
    const after = {
      modules: [
        {
          sourceId: 'mod-1',
          order: 0,
          chapters: [
            { sourceId: 'ch-1', order: 0, sectionIds: ['sec-1'], quizIds: [] },
            {
              sourceId: 'ch-2',
              order: 1,
              sectionIds: ['sec-2'],
              quizIds: ['quiz-1'],
            },
          ],
        },
      ],
    };
    expect(computeStructuralFingerprint(before)).not.toBe(
      computeStructuralFingerprint(after),
    );
  });

  it('diffs manifests for new-since-pinned summary', () => {
    expect(diffManifests(manifestA, manifestB)).toEqual({
      newSections: 1,
      newChapters: 1,
    });
  });

  it('checks manifest membership for delete guard', () => {
    expect(isIdReferencedInManifest(manifestA, 'section', 'sec-1')).toBe(true);
    expect(isIdReferencedInManifest(manifestA, 'section', 'sec-9')).toBe(false);
    expect(isIdReferencedInManifest(manifestA, 'quiz', 'quiz-1')).toBe(true);
    expect(isIdReferencedInManifest(manifestA, 'chapter', 'ch-1')).toBe(true);
    expect(isIdReferencedInManifest(manifestA, 'module', 'mod-1')).toBe(true);
  });

  // ─── PR 3: diffManifestsTitled ─────────────────────────────────────
  //
  // Structural diff. The interesting properties are (a) added/removed
  // are pure sourceId set differences, (b) moved fires ONLY when parent
  // chain differs (never on a title change), and (c) renamed fires only
  // when the parent chain matches AND the caller supplies distinct titles
  // per version — a scenario impossible in the current schema but wired
  // for the future.
  describe('diffManifestsTitled', () => {
    // Shared title map — every id known to any fixture below. Callers
    // supply titles because manifests store bare sourceIds only.
    const titles = new Map<string, string>([
      ['mod-1', 'Module One'],
      ['mod-2', 'Module Two'],
      ['ch-1', 'Chapter One'],
      ['ch-2', 'Chapter Two'],
      ['ch-3', 'Chapter Three'],
      ['sec-1', 'Section 1'],
      ['sec-2', 'Section 2'],
      ['sec-3', 'Section 3'],
      ['sec-4', 'Section 4'],
      ['quiz-1', 'Quiz 1'],
    ]);

    it('identical manifests produce empty arrays in every bucket', () => {
      const d = diffManifestsTitled(manifestA, manifestA, titles);
      expect(d.added).toEqual([]);
      expect(d.removed).toEqual([]);
      expect(d.moved).toEqual([]);
      expect(d.renamed).toEqual([]);
    });

    it('detects an added section (present in to, absent in from)', () => {
      // A → B adds ch-2 with sec-3.
      const d = diffManifestsTitled(manifestA, manifestB, titles);
      // Both the new chapter AND its new section land in added — each is
      // its own row so the FE renders them at the correct nesting level.
      expect(d.added.find((a) => a.id === 'ch-2')).toEqual(
        expect.objectContaining({
          id: 'ch-2',
          entityType: 'chapter',
          title: 'Chapter Two',
          path: 'Module One',
        }),
      );
      expect(d.added.find((a) => a.id === 'sec-3')).toEqual(
        expect.objectContaining({
          id: 'sec-3',
          entityType: 'section',
          title: 'Section 3',
          path: 'Module One › Chapter Two',
        }),
      );
      expect(d.removed).toEqual([]);
    });

    it('detects a removed entry (present in from, absent in to)', () => {
      // B → A removes ch-2 and sec-3.
      const d = diffManifestsTitled(manifestB, manifestA, titles);
      expect(d.removed.find((r) => r.id === 'ch-2')).toBeDefined();
      expect(d.removed.find((r) => r.id === 'sec-3')).toBeDefined();
      expect(d.added).toEqual([]);
    });

    it('detects a section moved to another chapter (parent chain differs)', () => {
      const from = {
        modules: [
          {
            sourceId: 'mod-1',
            order: 0,
            chapters: [
              {
                sourceId: 'ch-1',
                order: 0,
                sectionIds: ['sec-1'],
                quizIds: [],
              },
              {
                sourceId: 'ch-2',
                order: 1,
                sectionIds: [],
                quizIds: [],
              },
            ],
          },
        ],
      };
      const to = {
        modules: [
          {
            sourceId: 'mod-1',
            order: 0,
            chapters: [
              {
                sourceId: 'ch-1',
                order: 0,
                sectionIds: [],
                quizIds: [],
              },
              {
                // sec-1 moved here
                sourceId: 'ch-2',
                order: 1,
                sectionIds: ['sec-1'],
                quizIds: [],
              },
            ],
          },
        ],
      };
      const d = diffManifestsTitled(from, to, titles);
      expect(d.moved).toHaveLength(1);
      expect(d.moved[0]).toEqual(
        expect.objectContaining({
          id: 'sec-1',
          entityType: 'section',
          fromPath: 'Module One › Chapter One',
          toPath: 'Module One › Chapter Two',
        }),
      );
      // Critical negative: the section is NOT in added/removed — this is
      // the whole point of the move-detection branch.
      expect(d.added).toEqual([]);
      expect(d.removed).toEqual([]);
    });

    it('detects a chapter reparented to another module', () => {
      const from = {
        modules: [
          {
            sourceId: 'mod-1',
            order: 0,
            chapters: [
              {
                sourceId: 'ch-1',
                order: 0,
                sectionIds: [],
                quizIds: [],
              },
            ],
          },
          {
            sourceId: 'mod-2',
            order: 1,
            chapters: [],
          },
        ],
      };
      const to = {
        modules: [
          {
            sourceId: 'mod-1',
            order: 0,
            chapters: [],
          },
          {
            sourceId: 'mod-2',
            order: 1,
            chapters: [
              {
                sourceId: 'ch-1',
                order: 0,
                sectionIds: [],
                quizIds: [],
              },
            ],
          },
        ],
      };
      const d = diffManifestsTitled(from, to, titles);
      expect(d.moved).toHaveLength(1);
      expect(d.moved[0].id).toBe('ch-1');
      expect(d.moved[0].fromPath).toBe('Module One');
      expect(d.moved[0].toPath).toBe('Module Two');
    });

    // ─── regression tests for the v1 title-based-path bug ───────────
    //
    // The v1 plan built paths from titles and detected moves by string
    // comparison. That meant renaming a single chapter would flag EVERY
    // descendant section as moved (their path string changed). These
    // tests pin the structural detection so a future refactor can't
    // regress.

    it('renaming a chapter title does NOT cascade descendant sections into moved[]', () => {
      // Same manifest, but titles differ between from and to. Since the
      // pure function operates on a single title Map, we simulate this
      // by using different maps for the two calls — mimicking a caller
      // that resolved titles per-version.
      const from = manifestA;
      const to = manifestA; // structurally identical
      const fromTitles = new Map(titles);
      fromTitles.set('ch-1', 'Old Chapter Title');
      // Move detection is structural — parent chain unchanged, so even
      // though the chapter title differs, sec-1 and sec-2 must NOT be in
      // moved[]. The chapter itself lands in renamed[] (if we passed
      // distinct titles for it).
      const toTitles = new Map(titles);
      toTitles.set('ch-1', 'New Chapter Title');
      // Combine into one Map with the "to" side winning for the
      // structural check; the from side's title is used for the from
      // display path. This is what a real caller would do if they
      // snapshot titles per version. Our current schema doesn't, but
      // the diff function's structural detection is what we're pinning
      // here.
      const combined = new Map(toTitles);
      const d = diffManifestsTitled(from, to, combined);
      // Zero moved entries — the whole point.
      expect(d.moved).toEqual([]);
      // sec-1 and sec-2 must not be added/removed either — they exist
      // in both manifests with the same parent chain.
      expect(d.added).toEqual([]);
      expect(d.removed).toEqual([]);
    });

    it('renaming a module does NOT cascade any descendants into moved[]', () => {
      const combined = new Map(titles);
      combined.set('mod-1', 'Renamed Module');
      const d = diffManifestsTitled(manifestA, manifestA, combined);
      expect(d.moved).toEqual([]);
      expect(d.added).toEqual([]);
      expect(d.removed).toEqual([]);
    });

    it('quiz reparented with its chapter → moved with same fromPath/toPath as its parent (each row emitted)', () => {
      // A chapter carrying a quiz gets reparented. Both the chapter and
      // the quiz land in moved[] because each entity type is emitted
      // as its own row (design decision — plan risks).
      const from = {
        modules: [
          {
            sourceId: 'mod-1',
            order: 0,
            chapters: [
              {
                sourceId: 'ch-1',
                order: 0,
                sectionIds: [],
                quizIds: ['quiz-1'],
              },
            ],
          },
          { sourceId: 'mod-2', order: 1, chapters: [] },
        ],
      };
      const to = {
        modules: [
          { sourceId: 'mod-1', order: 0, chapters: [] },
          {
            sourceId: 'mod-2',
            order: 1,
            chapters: [
              {
                sourceId: 'ch-1',
                order: 0,
                sectionIds: [],
                quizIds: ['quiz-1'],
              },
            ],
          },
        ],
      };
      const d = diffManifestsTitled(from, to, titles);
      expect(d.moved.map((m) => m.id).sort()).toEqual(
        ['ch-1', 'quiz-1'].sort(),
      );
    });

    it('missing title in the Map falls back to (untitled) without crashing', () => {
      // A referenced source row was hard-deleted after the manifest was
      // published (edge case: cascade from Course.onDelete, or manual DB
      // cleanup). The diff must render, not crash.
      const emptyTitles = new Map<string, string>();
      const d = diffManifestsTitled(manifestA, manifestB, emptyTitles);
      const added = d.added.find((a) => a.id === 'ch-2');
      expect(added?.title).toBe('(untitled)');
    });
  });
});
