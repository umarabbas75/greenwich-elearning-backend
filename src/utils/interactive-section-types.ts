import { SectionType } from '@prisma/client';

const INTERACTIVE_SECTION_TYPES = new Set<SectionType>([
  SectionType.MATCH_AND_LEARN,
  SectionType.VISUAL_ACTIVITY,
  SectionType.ORDERING,
  SectionType.MATCHING,
]);

export function isInteractiveSectionType(
  type: SectionType | string,
): boolean {
  return INTERACTIVE_SECTION_TYPES.has(type as SectionType);
}
