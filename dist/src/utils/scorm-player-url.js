"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scormPlayerReturnUrl = void 0;
const strip_trailing_slash_1 = require("./strip-trailing-slash");
function scormPlayerReturnUrl(frontendBaseUrl, courseId) {
    const base = (0, strip_trailing_slash_1.stripTrailingSlash)(frontendBaseUrl.trim());
    const id = encodeURIComponent(courseId);
    return `${base}/studentCourses/${id}/scorm`;
}
exports.scormPlayerReturnUrl = scormPlayerReturnUrl;
//# sourceMappingURL=scorm-player-url.js.map