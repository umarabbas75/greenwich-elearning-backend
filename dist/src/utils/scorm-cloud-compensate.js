"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compensateCloudRegistration = void 0;
const error_message_1 = require("./error-message");
async function compensateCloudRegistration(cloud, registrationId, logger) {
    try {
        await cloud.deleteRegistration(registrationId);
    }
    catch (err) {
        logger.warn(`Failed to compensate Cloud registration ${registrationId}: ${(0, error_message_1.errorMessage)(err)}`);
    }
}
exports.compensateCloudRegistration = compensateCloudRegistration;
//# sourceMappingURL=scorm-cloud-compensate.js.map