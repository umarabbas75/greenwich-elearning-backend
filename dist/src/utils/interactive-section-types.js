"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInteractiveSectionType = void 0;
const client_1 = require("@prisma/client");
const INTERACTIVE_SECTION_TYPES = new Set([
    client_1.SectionType.MATCH_AND_LEARN,
    client_1.SectionType.VISUAL_ACTIVITY,
    client_1.SectionType.ORDERING,
    client_1.SectionType.MATCHING,
]);
function isInteractiveSectionType(type) {
    return INTERACTIVE_SECTION_TYPES.has(type);
}
exports.isInteractiveSectionType = isInteractiveSectionType;
//# sourceMappingURL=interactive-section-types.js.map