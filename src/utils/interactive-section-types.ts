import { SectionType } from '@prisma/client';

/** Types with a Check/verify step. FLASHCARDS is flip-to-reveal only — not included. */
const INTERACTIVE_SECTION_TYPES = new Set<SectionType>([
  SectionType.MATCH_AND_LEARN,
  SectionType.VISUAL_ACTIVITY,
  SectionType.ORDERING,
  SectionType.MATCHING,
]);

export function isInteractiveSectionType(type: SectionType | string): boolean {
  return INTERACTIVE_SECTION_TYPES.has(type as SectionType);
}
