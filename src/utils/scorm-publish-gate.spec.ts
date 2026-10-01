import { SectionType } from '@prisma/client';
import {
  evaluateScormPublishGate,
  scormGateCandidateSectionsWhere,
  scormPackageSectionIds,
} from './scorm-publish-gate';

describe('scormPackageSectionIds', () => {
  it('uses one section per manifest lesson when there is a manifest', () => {
    const ids = scormPackageSectionIds({
      sectionId: 's1',
      lessons: [{ sectionId: 's1' }, { sectionId: 's2' }, { index: 2 }],
    });
    expect([...ids]).toEqual(['s1', 's2']);
  });

  it('falls back to the single synthetic section without a manifest', () => {
    expect([...scormPackageSectionIds({ sectionId: 's1', lessons: null })]).toEqual(['s1']);
    // A manifest whose lessons carry no sectionId is no manifest at all.
    expect([...scormPackageSectionIds({ sectionId: 's1', lessons: [{}] })]).toEqual(['s1']);
  });

  it('is empty with no READY package or no section', () => {
    expect(scormPackageSectionIds(null).size).toBe(0);
    expect(scormPackageSectionIds({ sectionId: null, lessons: null }).size).toBe(0);
  });
});

describe('scormGateCandidateSectionsWhere', () => {
  it('does not filter on isActive — the gate splits that out itself', () => {
    const where = scormGateCandidateSectionsWhere('c1');
    expect(where).not.toHaveProperty('isActive');
    expect(where).toMatchObject({
      type: SectionType.SCORM,
      isArchived: false,
      chapter: { isArchived: false, module: { courseId: 'c1', isArchived: false } },
    });
  });
});

describe('evaluateScormPublishGate', () => {
  const expected = new Set(['a', 'b', 'c']);

  it('passes when the live set is exactly the package set', () => {
    const result = evaluateScormPublishGate(expected, [
      { id: 'a', isActive: true },
      { id: 'b', isActive: true },
      { id: 'c', isActive: true },
    ]);
    expect(result.problems).toEqual([]);
  });

  it('separates deactivated, archived/missing and leftover sections', () => {
    const result = evaluateScormPublishGate(expected, [
      { id: 'a', isActive: true },
      { id: 'b', isActive: false },
      // 'c' absent: archived or never built
      { id: 'old', isActive: true },
    ]);
    expect(result.missing).toEqual(['b', 'c']);
    expect(result.deactivated).toEqual(['b']);
    expect(result.gone).toBe(1);
    expect(result.extra).toEqual(['old']);
    expect(result.problems).toEqual([
      '1 of the 3 section(s) its READY package produced are archived or missing — the import is incomplete; re-import the package',
      '1 section(s) of this package are deactivated — reactivate them',
      '1 leftover SCORM section(s) not from this package are live — archive them',
    ]);
  });

  it('does not count a deactivated leftover as extra', () => {
    const result = evaluateScormPublishGate(new Set(['a']), [
      { id: 'a', isActive: true },
      { id: 'old', isActive: false },
    ]);
    expect(result.problems).toEqual([]);
  });
});
